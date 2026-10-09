// Command costan-attract-search plays a batch of games and keeps the few whose
// trimmed recording would make the best homepage loop.
//
//	go run ./cmd/costan-attract-search -n 1200 -workers 10 \
//	    -players 3 -preset beginner -keep 8 -outdir /tmp/attract
//
// It writes recordings rather than seeds: bots are paced by a real clock
// (`-bot-delay`, so trade offers can be answered), so a seed does not replay
// byte for byte. The chosen file is copied into the frontend as-is.
//
// Trimming keeps only frames where something is placed; the score below picks
// which game looks best.
package main

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"math/rand/v2"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/game"
	"github.com/ftqo/costan.io/replay"
	"github.com/ftqo/costan.io/sim"
	"github.com/ftqo/costan.io/store"
)

// candidate is one played game, reduced to the numbers the score cares about.
type candidate struct {
	seed       uint64
	frames     int
	bytes      int
	gz         int // gzipped size, which is what ships
	cities     int
	setts      int
	roads      int
	robber     int
	setup      int // setup-phase placements: the board filling from empty
	buildShare float64
	builders   int // seats that built at least one settlement or city after setup
	winner     int
	scores     []int
	margin     int // winner's VP minus the runner-up's
	score      float64
	data       []byte
}

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func run() error {
	n := flag.Int("n", 200, "games to play")
	workers := flag.Int("workers", 8, "games in flight at once")
	players := flag.Int("players", 3, "seats per game")
	ruleset := flag.String("ruleset", "base", "ruleset")
	preset := flag.String("preset", "beginner", "named map preset, empty for procedural")
	seed0 := flag.Uint64("seed-from", 1, "first seed; seeds run consecutively from here")
	lookahead := flag.Int("lookahead", 3, "bot within-turn lookahead")
	width := flag.Int("width", 24, "bot candidates deepened per ply")
	delay := flag.Duration("bot-delay", 12*time.Millisecond, "pace bot seats so trade offers survive")
	timeout := flag.Duration("timeout", 10*time.Minute, "per-game ceiling")
	keep := flag.Int("keep", 5, "how many of the best to write out")
	minShare := flag.Float64("min-build-share", 0.55, "reject a recording where placements are less than this fraction of frames (the rest is the robber)")
	minFrames := flag.Int("min-frames", 40, "reject a recording with fewer trimmed frames")
	maxFrames := flag.Int("max-frames", 0, "reject a recording with more trimmed frames (0 = no limit)")
	maxGzip := flag.Int("max-gzip", 60_000, "reject a recording whose gzipped size exceeds this many bytes")
	outdir := flag.String("outdir", "", "write the winners here (required)")
	flag.Parse()

	if *outdir == "" {
		return errors.New("-outdir is required")
	}
	if err := os.MkdirAll(*outdir, 0o750); err != nil {
		return err
	}

	var (
		mu                       sync.Mutex
		best                     []candidate
		played, rejected, passed int
	)
	started := time.Now()
	seeds := make(chan uint64)
	var wg sync.WaitGroup
	for range *workers {
		wg.Go(func() {
			for s := range seeds {
				c, err := play(s, *players, *ruleset, *preset, *lookahead, *width, *delay, *timeout)
				mu.Lock()
				played++
				switch {
				case err != nil:
					log.Printf("seed %d: %v", s, err)
					rejected++
				case c.frames < *minFrames || (*maxFrames > 0 && c.frames > *maxFrames) || c.gz > *maxGzip || c.winner < 0 || c.buildShare < *minShare:
					rejected++
				default:
					passed++
					best = append(best, *c)
					// Keep the pool bounded: these carry a whole recording each.
					sort.Slice(best, func(i, j int) bool { return best[i].score > best[j].score })
					if len(best) > *keep {
						best = best[:*keep]
					}
				}
				if played%25 == 0 {
					log.Printf("%d/%d played, %d rejected, %s elapsed", played, *n, rejected, time.Since(started).Round(time.Second))
				}
				mu.Unlock()
			}
		})
	}
	for i := range *n {
		seeds <- *seed0 + uint64(i)
	}
	close(seeds)
	wg.Wait()

	if len(best) == 0 {
		return fmt.Errorf("no game passed the gates out of %d", *n)
	}
	// `passed` rather than len(best): the pool is capped at -keep.
	log.Printf("%d played in %s, %d passed the gates, keeping the best %d",
		played, time.Since(started).Round(time.Second), passed, len(best))
	fmt.Printf("\n%-4s %-6s %-7s %-7s %-6s %-6s %-6s %-7s %-7s %-7s %-7s %s\n",
		"rank", "seed", "frames", "gzipKB", "setup", "cities", "setts", "roads", "robber", "build%", "margin", "scores")
	for i, c := range best {
		name := filepath.Join(*outdir, fmt.Sprintf("%02d-seed%d.frames.json", i+1, c.seed))
		if err := os.WriteFile(name, c.data, 0o600); err != nil {
			return err
		}
		fmt.Printf("%-4d %-6d %-7d %-7.0f %-6d %-6d %-6d %-7d %-7d %-7.2f %-7d %v  -> %s\n",
			i+1, c.seed, c.frames, float64(c.gz)/1024, c.setup, c.cities, c.setts, c.roads, c.robber, c.buildShare, c.margin, c.scores, name)
	}
	return nil
}

// play runs one game and folds it into a trimmed recording.
func play(seed uint64, players int, ruleset, preset string, lookahead, width int, delay, timeout time.Duration) (*candidate, error) {
	var authored *board.Board
	if preset != "" {
		b, err := board.PresetBoard(preset, players, rand.New(rand.NewPCG(seed, seed)))
		if err != nil {
			return nil, fmt.Errorf("preset: %w", err)
		}
		authored = b
	}
	st, err := store.OpenMem()
	if err != nil {
		return nil, err
	}
	defer st.Close()

	res, err := sim.RunGame(st, sim.Options{
		Players: players, Ruleset: ruleset, Seed: seed, Timeout: timeout, BotDelay: delay,
		Board: authored,
		Bots: func(engine.PlayerID) game.CommandSource {
			return bot.NewStrong(bot.WithLookahead(lookahead, width), bot.WithPlayerTrades())
		},
	})
	if err != nil {
		return nil, err
	}
	events, err := st.LoadEvents(res.GameID, 0)
	if err != nil {
		return nil, err
	}
	file, err := replay.Fold(res.GameID, events, game.Spectator)
	if err != nil {
		return nil, err
	}
	file.Meta.Bot = "strong"
	file.Meta.Lookahead = lookahead
	file.Meta.Width = width
	replay.Trim(file, true)

	data, err := json.Marshal(file)
	if err != nil {
		return nil, err
	}
	c := &candidate{
		seed: seed, frames: len(file.Frames), bytes: len(data), gz: gzipLen(data),
		winner: file.Meta.Winner, scores: file.Meta.Scores, data: data,
	}
	builders := map[engine.PlayerID]bool{}
	for _, f := range file.Frames {
		switch f.Type {
		case engine.EvCityBuilt:
			c.cities++
		case engine.EvSettlementBuilt:
			c.setts++
		case engine.EvRoadBuilt:
			c.roads++
		case engine.EvRobberMoved:
			c.robber++
		case engine.EvSettlementPlace, engine.EvRoadPlaced, engine.EvSetupCityPlace:
			c.setup++
		default:
			// Everything else a trimmed recording can hold (the robber aside,
			// counted above) is a module placement this score has no opinion
			// about: the homepage plays base games.
		}
		if f.Type == engine.EvCityBuilt || f.Type == engine.EvSettlementBuilt {
			var d struct {
				Player engine.PlayerID `json:"player"`
			}
			if json.Unmarshal(f.Event.Data, &d) == nil {
				builders[d.Player] = true
			}
		}
	}
	c.builders = len(builders)
	c.buildShare = float64(c.setup+c.cities+c.setts+c.roads) / float64(max(1, c.frames))
	c.margin = margin(c.scores, c.winner)
	c.score = score(c, players)
	return c, nil
}

// gzipLen is the size that crosses the wire. Frames repeat near-identical views,
// so raw size overstates the cost by far (368 KB raw vs 6.3 KB served).
func gzipLen(data []byte) int {
	var buf bytes.Buffer
	w := gzip.NewWriter(&buf)
	if _, err := w.Write(data); err != nil {
		return len(data)
	}
	if err := w.Close(); err != nil {
		return len(data)
	}
	return buf.Len()
}

func margin(scores []int, winner int) int {
	if winner < 0 || winner >= len(scores) {
		return 99
	}
	second := -1
	for i, s := range scores {
		if i != winner && s > second {
			second = s
		}
	}
	return scores[winner] - second
}

// score ranks a recording for the front page. Every term is something a visitor
// can see, plus one for tension.
//
// Cities weigh most (an upgrade visibly changes a piece already placed), then
// spread across seats (so the whole board fills), then a close finish.
func score(c *candidate, players int) float64 {
	s := 4.0*float64(c.cities) + 2.0*float64(c.setts) + 0.5*float64(c.roads) + 0.1*float64(c.robber)
	// What fraction of the loop is a piece going down. The robber counts for
	// little: lots of robber moves and few builds is dull to watch.
	s += 25.0 * c.buildShare
	// Every seat visibly in the game, scaled so a 3-player and a 4-player run
	// are judged on the same axis.
	s += 10.0 * float64(c.builders) / float64(players)
	// A one- or two-point finish is a game; a blowout is a demonstration.
	switch {
	case c.margin <= 1:
		s += 8
	case c.margin == 2:
		s += 4
	}
	return s
}
