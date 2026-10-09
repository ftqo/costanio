// Command costan-sim plays a full game between N bots and prints the
// move-by-move transcript and result. It exercises the engine, game actor,
// and store end to end without a network.
//
//	costan-sim -players 4 -ruleset base
//	costan-sim -players 4 -ruleset base+islands -dice fair -quiet
package main

import (
	"crypto/rand"
	"encoding/binary"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"sync/atomic"
	"time"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/game"
	"github.com/ftqo/costan.io/sim"
	"github.com/ftqo/costan.io/store"

	// Register the expansion modules so non-base rulesets resolve.
	_ "github.com/ftqo/costan.io/engine/explorers" // register the Explorers ruleset
	_ "github.com/ftqo/costan.io/engine/harbormaster"
	_ "github.com/ftqo/costan.io/engine/islands"
	_ "github.com/ftqo/costan.io/engine/knights"
	_ "github.com/ftqo/costan.io/engine/raiders"
	_ "github.com/ftqo/costan.io/engine/rivers"
	_ "github.com/ftqo/costan.io/engine/scenarios"
	_ "github.com/ftqo/costan.io/engine/wagons"
)

func main() {
	players := flag.Int("players", 4, "number of bot players (2-10)")
	ruleset := flag.String("ruleset", "base", "ruleset, e.g. base, base+islands, base+cak, base+fishermen, base+caravans, base+harbormaster, base+rivers, base+raiders, base+wagons")
	target := flag.Int("target", 0, "victory-point target (0 = ruleset default)")
	dice := flag.String("dice", "", "dice mode: random (default) or fair")
	boardMode := flag.String("board", "", "board mode: fair (default) or random")
	seedFlag := flag.Uint64("seed", 0, "game seed (0 = random)")
	timeout := flag.Duration("timeout", 60*time.Second, "max time to wait for the game to finish")
	quiet := flag.Bool("quiet", false, "print only the result, not the transcript")
	botKind := flag.String("bot", "strong", "bot type: strong or simple")
	n := flag.Int("n", 1, "number of games to play; >1 runs a parallel batch and prints a summary")
	workers := flag.Int("workers", runtime.NumCPU(), "concurrent games when -n > 1")
	dumpBoard := flag.String("dump-board", "", "write the generated board as JSON to this path (or - for stdout) and exit, playing no turns")
	dumpView := flag.String("dump-view", "", "write the generated board and every module's view state as JSON to this path (or - for stdout) and exit")
	flag.Parse()

	// Game start canonicalises the ruleset anyway; do it up front so the output
	// names the ruleset actually played.
	*ruleset = canonicaliseRuleset(os.Stderr, *ruleset)

	if *dumpBoard != "" {
		if err := writeBoard(*dumpBoard, *players, *ruleset, *target, *boardMode, *seedFlag, false); err != nil {
			log.Fatalf("dump-board: %v", err)
		}
		return
	}
	if *dumpView != "" {
		if err := writeBoard(*dumpView, *players, *ruleset, *target, *boardMode, *seedFlag, true); err != nil {
			log.Fatalf("dump-view: %v", err)
		}
		return
	}

	bots := func(engine.PlayerID) game.CommandSource { return bot.NewStrong() }
	if *botKind == "simple" {
		bots = func(engine.PlayerID) game.CommandSource { return bot.NewSimple() }
	}
	opts := sim.Options{
		Players: *players, Ruleset: *ruleset, TargetVP: *target,
		DiceMode: *dice, BoardMode: *boardMode, Timeout: *timeout, Bots: bots,
	}

	if *n > 1 {
		runBatch(opts, *seedFlag, *n, *workers, *botKind)
		return
	}

	seed := *seedFlag
	if seed == 0 {
		var b [8]byte
		rand.Read(b[:])
		seed = binary.LittleEndian.Uint64(b[:])
	}

	// In-memory, like the batch path below; the seed reproduces any game.
	st, err := store.OpenMem()
	if err != nil {
		log.Fatalf("store: %v", err)
	}

	fmt.Printf("costan-sim: %d %q bots, ruleset %q, seed %d\n\n", *players, *botKind, *ruleset, seed)

	opts.Seed = seed
	res, err := sim.RunGame(st, opts)
	if err != nil {
		st.Close()
		log.Fatalf("sim: %v", err)
	}

	if !*quiet {
		events, err := sim.Transcript(st, res.GameID)
		if err != nil {
			st.Close()
			log.Fatalf("transcript: %v", err)
		}
		for _, e := range events {
			if line := render(e); line != "" {
				fmt.Println(line)
			}
		}
		fmt.Println()
	}

	fmt.Printf("Game over after %d events.\n", res.Events)
	// A finished game can have no winner (engine.NoPlayer): a draw.
	if res.Winner < 0 {
		fmt.Println("Draw: no winner")
	} else {
		fmt.Printf("Winner: P%d with %d VP\n", res.Winner, res.WinnerVP)
	}
	for p, vp := range res.Scores {
		marker := "  "
		if engine.PlayerID(p) == res.Winner {
			marker = "* "
		}
		fmt.Printf("%sP%d: %d VP\n", marker, p, vp)
	}
	st.Close()
}

// canonicaliseRuleset returns the canonical spelling of rs, telling the
// operator on w when that is not what they typed. Silent when the string is
// already canonical.
func canonicaliseRuleset(w io.Writer, rs string) string {
	canon := engine.CanonicalRuleset(rs)
	if canon != rs {
		fmt.Fprintf(w, "costan-sim: ruleset %q is not canonical; playing %q (module order is normalised at game creation)\n", rs, canon)
	}
	return canon
}

// runBatch plays n games concurrently across `workers` goroutines and prints an
// aggregate summary instead of transcripts. Each game gets its own in-memory
// store (no file IO) so throughput scales with cores. Seeds are baseSeed+i when
// baseSeed != 0 (reproducible), else random per game.
func runBatch(opts sim.Options, baseSeed uint64, n, workers int, botKind string) {
	if workers < 1 {
		workers = 1
	}
	if workers > n {
		workers = n
	}
	fmt.Printf("costan-sim: %d games, %d %q bots, ruleset %q, %d workers\n",
		n, opts.Players, botKind, opts.Ruleset, workers)

	var (
		idx       atomic.Int64
		finished  atomic.Int64
		stalemate atomic.Int64
		failed    atomic.Int64
		totalVP   atomic.Int64
		totalEv   atomic.Int64
		winsMu    sync.Mutex
		wins      = make([]int, opts.Players)
		drawn     int // finished with no winner; guarded by winsMu
	)
	start := time.Now()
	var wg sync.WaitGroup
	for range workers {
		wg.Go(func() {
			for {
				i := idx.Add(1) - 1
				if i >= int64(n) {
					return
				}
				seed := baseSeed + uint64(i)
				if baseSeed == 0 {
					var b [8]byte
					rand.Read(b[:])
					seed = binary.LittleEndian.Uint64(b[:])
				}
				st, err := store.OpenMem()
				if err != nil {
					log.Fatalf("store: %v", err)
				}
				o := opts
				o.Seed = seed
				res, err := sim.RunGame(st, o)
				st.Close()
				switch {
				case err == nil:
					finished.Add(1)
					totalVP.Add(int64(res.WinnerVP))
					totalEv.Add(int64(res.Events))
					winsMu.Lock()
					if res.Winner < 0 {
						drawn++ // a drawn game has no seat to credit
					} else {
						wins[res.Winner]++
					}
					winsMu.Unlock()
				case errors.Is(err, sim.ErrStalemate):
					stalemate.Add(1)
				default:
					failed.Add(1)
					log.Printf("seed %d: %v", seed, err)
				}
			}
		})
	}
	wg.Wait()
	elapsed := time.Since(start)

	fin := finished.Load()
	fmt.Printf("\nfinished %d/%d in %s (%.1f games/s)\n",
		fin, n, elapsed.Round(time.Millisecond), float64(n)/elapsed.Seconds())
	if s := stalemate.Load(); s > 0 {
		fmt.Printf("stalemates: %d\n", s)
	}
	winsMu.Lock()
	d := drawn
	winsMu.Unlock()
	if d > 0 {
		fmt.Printf("draws: %d\n", d)
	}
	if f := failed.Load(); f > 0 {
		fmt.Printf("errors: %d\n", f)
	}
	if fin > 0 {
		fmt.Printf("avg winner VP: %.1f, avg events: %.0f\n",
			float64(totalVP.Load())/float64(fin), float64(totalEv.Load())/float64(fin))
		fmt.Print("wins by seat:")
		for p, c := range wins {
			fmt.Printf(" P%d=%d (%.0f%%)", p, c, 100*float64(c)/float64(fin))
		}
		fmt.Println()
	}
}

// render turns an event into a one-line transcript entry. Base events get
// friendly text; module events fall back to type + payload.
func render(e engine.Event) string {
	switch e.Type {
	case engine.EvGameCreated:
		return "--- game created ---"
	case engine.EvBoardGenerated:
		return "--- board generated ---"
	case engine.EvSettlementPlace:
		d := engine.DecodeEvent[engine.SettlementPlacedData](e)
		return fmt.Sprintf("P%d places a settlement", d.Player)
	case engine.EvRoadPlaced:
		d := engine.DecodeEvent[engine.RoadPlacedData](e)
		return fmt.Sprintf("P%d places a road", d.Player)
	case engine.EvTurnStarted:
		d := engine.DecodeEvent[engine.TurnStartedData](e)
		return fmt.Sprintf("- P%d's turn -", d.Player)
	case engine.EvDiceRolled:
		d := engine.DecodeEvent[engine.DiceRolledData](e)
		return fmt.Sprintf("P%d rolls %d (%d+%d)", d.Player, d.D1+d.D2, d.D1, d.D2)
	case engine.EvRobberMoved:
		d := engine.DecodeEvent[engine.RobberMovedData](e)
		return fmt.Sprintf("P%d moves the robber", d.Player)
	case engine.EvCardStolen:
		d := engine.DecodeEvent[engine.CardStolenData](e)
		return fmt.Sprintf("P%d steals a card from P%d", d.Thief, d.Victim)
	case engine.EvRoadBuilt:
		d := engine.DecodeEvent[engine.BuiltData](e)
		return fmt.Sprintf("P%d builds a road", d.Player)
	case engine.EvSettlementBuilt:
		d := engine.DecodeEvent[engine.BuiltData](e)
		return fmt.Sprintf("P%d builds a settlement", d.Player)
	case engine.EvCityBuilt:
		d := engine.DecodeEvent[engine.BuiltData](e)
		return fmt.Sprintf("P%d builds a city", d.Player)
	case engine.EvBankTraded:
		d := engine.DecodeEvent[engine.BankTradedData](e)
		return fmt.Sprintf("P%d trades with the bank", d.Player)
	case engine.EvDevCardBought:
		d := engine.DecodeEvent[engine.DevCardBoughtData](e)
		return fmt.Sprintf("P%d buys a development card", d.Player)
	case engine.EvLongestRoad:
		d := engine.DecodeEvent[engine.TitleData](e)
		return fmt.Sprintf("longest road -> P%d", d.Holder)
	case engine.EvLargestArmy:
		d := engine.DecodeEvent[engine.TitleData](e)
		return fmt.Sprintf("largest army -> P%d", d.Holder)
	case engine.EvGameFinished:
		d := engine.DecodeEvent[engine.GameFinishedData](e)
		if d.Winner < 0 {
			return "=== drawn: no winner ==="
		}
		return fmt.Sprintf("=== P%d wins with %d VP ===", d.Winner, d.VP)
	case engine.EvTurnEnded, engine.EvResDistributed, engine.EvDiscardsReq,
		engine.EvCardsDiscarded, engine.EvStartingRes:
		return "" // omit the noisy bookkeeping events
	default:
		// Module event: show the type and compact payload.
		var compact map[string]any
		if err := json.Unmarshal(e.Data, &compact); err != nil {
			return fmt.Sprintf("[%s] %s", e.Type, e.Data)
		}
		return fmt.Sprintf("[%s] %v", e.Type, compact)
	}
}

// writeBoard folds a game's seeded setup events into a state and writes the
// board as JSON, playing no turns. With withExt it also writes every module's
// view state, which scenario boards need to be drawable (fishing grounds, the
// oasis, rivers live in the ext, not the tiles).
//
// Used for the board-art fixtures, so the engine stays the source of truth.
// Deterministic for a given seed. The output matches the wire format
// (Board.MarshalJSON and each module's ViewExt).
func writeBoard(path string, players int, ruleset string, target int, boardMode string, seed uint64, withExt bool) error {
	if target == 0 {
		target = 10
	}
	cfg := engine.GameConfig{
		Players: players, Ruleset: ruleset, TargetVP: target, BoardMode: boardMode,
	}
	setup, err := engine.New(cfg, engine.SeedsFrom(seed))
	if err != nil {
		return fmt.Errorf("setup: %w", err)
	}
	s := engine.Empty()
	for _, e := range setup {
		if err := engine.Apply(s, e); err != nil {
			return fmt.Errorf("apply: %w", err)
		}
	}
	if s.Board == nil {
		return errors.New("setup produced no board")
	}
	var payload any = s.Board
	if withExt {
		// Same envelope as the /api/preview endpoint.
		ext := engine.ModuleExtViews(s, 0)
		payload = struct {
			Config engine.GameConfig `json:"config"`
			Board  *board.Board      `json:"board"`
			Ext    map[string]any    `json:"ext"`
		}{Config: s.Config, Board: s.Board, Ext: ext}
	}
	data, err := json.MarshalIndent(payload, "", " ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	if path == "-" {
		_, err = os.Stdout.Write(data)
		return err
	}
	// The dump is a committed, world-readable test fixture
	// (frontend/dev/board-shots.board.json and friends), not a secret.
	//nolint:gosec // G301: a committed JSON fixture directory is world-readable
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	//nolint:gosec // G306: same, for the fixture file itself
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return err
	}
	fmt.Printf("board: %d players, ruleset %q, seed %d -> %s (%d tiles, %d harbors)\n",
		players, ruleset, seed, path, len(s.Board.Tiles), len(s.Board.Harbors))
	return nil
}
