// Package sim runs full bot-vs-bot games through the real engine, actor and
// store. It backs the costan-sim CLI and the end-to-end tests.
package sim

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"hash/fnv"
	"strings"
	"time"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/game"
	"github.com/ftqo/costan.io/store"
)

// ErrStalemate is returned (wrapped) when a game runs past the event cap without
// finishing: a non-terminating all-bot loop, not an engine fault. Callers that
// sample many seeds can errors.Is this to skip the rare stuck game.
var ErrStalemate = errors.New("sim: game exceeded event cap without finishing (stalemate)")

type Options struct {
	Players   int
	Ruleset   string // "base", "base+islands", "eap", ...
	TargetVP  int    // 0 = ruleset default
	DiceMode  string // "", "random", "fair"
	BoardMode string // "", "random", "fair"
	// FriendlyRobber enables the casual rule shielding low-public-VP players
	// from the robber. Exercises bot/auto robber placement under the toggle.
	FriendlyRobber bool
	// Board is an authored map (land-only is fine; call Frame first), passed
	// through as the lobby passes a gallery map. Needed for Islands, whose real
	// games use gallery archipelagos; procedural generation makes one landmass.
	Board *board.Board
	// Modules is per-module config, passed through to GameConfig.Modules the way
	// the lobby does (for example {"islands": {"start_island": "any"}}).
	Modules map[string]json.RawMessage
	Seed    uint64
	Timeout time.Duration // 0 = 30s
	// MaxEvents caps how long a game may run before it's treated as a
	// stalemate (0 = default). A normal game is a few hundred events; a stuck
	// one reaches tens of thousands, so this aborts it long before Timeout.
	MaxEvents int
	// Bots assigns a command source per seat; nil seats every seat with
	// bot.Simple. Used for mixed match-ups (e.g. strong vs. baseline).
	Bots func(seat engine.PlayerID) game.CommandSource
	// BotDelay paces bot seats, as the server does (COSTAN_BOT_DELAY, default
	// 1500ms in production). With zero (the harness default) runAutoSeats plays
	// up to 64 actions before runOfferResponses runs, so a trade offer is gone
	// before anyone answers it. Use a small non-zero value to measure offers.
	BotDelay time.Duration
	// IDTag distinguishes runs that differ in something the marshalled
	// GameConfig cannot see, chiefly the Bots assignment. It is folded into the
	// game id, so derive it deterministically from the run (contender names, seat
	// order), never from a clock or counter.
	IDTag string
}

// defaultMaxEvents bounds a game's length. Real games finish in a few hundred
// events; this is far above any legitimate game but far below a stalemate loop.
const defaultMaxEvents = 8000

type Result struct {
	GameID   string
	Winner   engine.PlayerID
	WinnerVP int
	Scores   []int // VP per seat
	Events   int   // total events in the finished log
}

// ErrDuplicateGame is returned (wrapped) when the store already holds a row for
// this run's game id, i.e. the same Options ran twice against one store. It is a
// harness error, not a game outcome, and named so a sweep doesn't mistake it
// for a game that never completed.
var ErrDuplicateGame = errors.New("sim: duplicate game id")

// GameID is the deterministic row id for a run. It must be deterministic (the
// package asserts replay(events) == live state, so runs must be reproducible)
// and must distinguish runs that share a seed.
//
// It hashes the full marshalled GameConfig (so new config fields are covered
// automatically), the seed and Options.IDTag. Options.Bots is a func and cannot
// be hashed, so any sweep that varies Bots, or anything else outside the
// config, must name that variation in IDTag. Otherwise the arms collide as
// ErrDuplicateGame in a shared store, or silently share ids across stores.
//
// Shape: "sim-<seed>-<16 hex digits>". The seed is kept readable for failure
// messages; nothing parses the id.
func GameID(opts Options, cfgJSON []byte) string {
	h := fnv.New64a()
	_, _ = h.Write(cfgJSON)
	var seed [8]byte
	binary.LittleEndian.PutUint64(seed[:], opts.Seed)
	_, _ = h.Write(seed[:])
	_, _ = h.Write([]byte(opts.IDTag))
	return fmt.Sprintf("sim-%d-%016x", opts.Seed, h.Sum64())
}

// isUniqueViolation reports whether err is SQLite's primary-key/unique
// constraint failure. modernc.org/sqlite reports it as a message rather than a
// typed error the store re-exports, so this matches on the text.
func isUniqueViolation(err error) bool {
	return err != nil && strings.Contains(err.Error(), "UNIQUE constraint failed")
}

// RunGame seats Players bots, plays to completion through the game actor, and
// returns the outcome. Every seat is a server-side bot.Simple acting on the
// authoritative state.
func RunGame(st *store.Store, opts Options) (Result, error) {
	if opts.Players < 2 || opts.Players > 10 {
		return Result{}, fmt.Errorf("sim: players must be 2-10, got %d", opts.Players)
	}
	if opts.Ruleset == "" {
		opts.Ruleset = "base"
	}
	// Canonicalise the ruleset for the bookkeeping too. game.Manager.Start
	// canonicalises before engine.New, but without this the games row and the
	// hashed id would use the caller's spelling: store.Game.Ruleset buckets
	// per-ruleset stats and Elo, and two spellings of one ruleset would get two
	// game ids.
	opts.Ruleset = engine.CanonicalRuleset(opts.Ruleset)
	if opts.Timeout == 0 {
		opts.Timeout = 30 * time.Second
	}

	cfg := engine.GameConfig{
		Players:        opts.Players,
		Ruleset:        opts.Ruleset,
		TargetVP:       opts.TargetVP,
		DiceMode:       opts.DiceMode,
		BoardMode:      opts.BoardMode,
		FriendlyRobber: opts.FriendlyRobber,
		Board:          opts.Board,
		Modules:        opts.Modules,
	}
	cfgJSON, err := json.Marshal(cfg)
	if err != nil {
		return Result{}, err
	}

	host, err := st.CreateGuest("bot-0")
	if err != nil {
		return Result{}, err
	}
	gameID := GameID(opts, cfgJSON)
	if err := st.CreateGame(&store.Game{ID: gameID, Ruleset: opts.Ruleset, Config: cfgJSON, CreatedBy: host.ID}); err != nil {
		if isUniqueViolation(err) {
			return Result{}, fmt.Errorf("%w: %s (ruleset %q, %d players, seed %d) already exists in this store",
				ErrDuplicateGame, gameID, opts.Ruleset, opts.Players, opts.Seed)
		}
		return Result{}, err
	}
	for seat := range opts.Players {
		uid := host.ID
		if seat > 0 {
			u, err := st.CreateGuest(fmt.Sprintf("bot-%d", seat))
			if err != nil {
				return Result{}, err
			}
			uid = u.ID
		}
		if err := st.AddSeat(gameID, seat, uid); err != nil {
			return Result{}, err
		}
		if err := st.SetSeatStatus(gameID, seat, "bot"); err != nil {
			return Result{}, err
		}
	}

	mgr := game.NewManager(st, nil)
	// Opt out of game.DefaultEventCap. The harness detects a non-terminating
	// game itself and reports ErrStalemate; the manager's cap would instead
	// ForceFinish it with a tiebreak winner, and strength measurements would
	// count a stuck bot as a winner. MaxEvents is the only cap here.
	mgr.SetEventCap(0)
	if opts.BotDelay > 0 {
		mgr.SetBotDelay(opts.BotDelay)
	}
	if opts.Bots != nil {
		mgr.SetBotFactory(opts.Bots)
	} else {
		mgr.SetBotFactory(func(engine.PlayerID) game.CommandSource { return bot.NewSimple() })
	}
	defer mgr.StopAll()

	if err := mgr.Start(gameID, cfg, engine.SeedsFrom(opts.Seed)); err != nil {
		return Result{}, err
	}

	maxEvents := opts.MaxEvents
	if maxEvents == 0 {
		maxEvents = defaultMaxEvents
	}

	// The actor drives all seats automatically; wait for it to finish.
	deadline := time.Now().Add(opts.Timeout)
	checks := 0
	for {
		g, err := st.GameByID(gameID)
		if err != nil {
			return Result{}, err
		}
		switch g.Status {
		case "finished":
			return buildResult(st, gameID)
		case "paused-error":
			return Result{}, fmt.Errorf("sim: game %s hit an engine error", gameID)
		}
		if time.Now().After(deadline) {
			n, _ := st.CountEvents(gameID)
			return Result{}, fmt.Errorf("sim: game did not finish within %s (%d events)", opts.Timeout, n)
		}
		// Guard against a stalemate, checked periodically so the COUNT query
		// doesn't run every 5ms.
		//
		// The count in the error is a sample: the actor keeps appending while this
		// loop sleeps, so it varies run to run (by thousands under load). That is
		// the poll, not nondeterminism.
		checks++
		if checks >= 40 {
			checks = 0
			if n, err := st.CountEvents(gameID); err == nil && n > maxEvents {
				return Result{}, fmt.Errorf("%w: %d events, seed %d", ErrStalemate, n, opts.Seed)
			}
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func buildResult(st *store.Store, gameID string) (Result, error) {
	events, err := st.LoadEvents(gameID, 0)
	if err != nil {
		return Result{}, err
	}
	state, err := engine.Replay(events)
	if err != nil {
		return Result{}, err
	}
	// Report VP including module contributions (island chips, caravan/route
	// titles, metropolis, etc.), the same total the win check uses (see
	// engine.finalize).
	scores := make([]int, len(state.Players))
	for p := range state.Players {
		scores[p] = state.VPWithModules(engine.PlayerID(p))
	}
	// A finished game can have no winner: engine.NoPlayer (-1) is a draw, and
	// indexing the seat arrays with it panics. No bot concedes today, but the
	// harness must survive a replayed log that ends in one.
	winnerVP := 0
	if state.Winner >= 0 {
		winnerVP = state.VPWithModules(state.Winner)
	}
	return Result{
		GameID:   gameID,
		Winner:   state.Winner,
		WinnerVP: winnerVP,
		Scores:   scores,
		Events:   len(events),
	}, nil
}

// Transcript loads a finished game's full (unredacted) event log for
// rendering.
func Transcript(st *store.Store, gameID string) ([]engine.Event, error) {
	return st.LoadEvents(gameID, 0)
}
