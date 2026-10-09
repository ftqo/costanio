// Command costan-replay plays one bot game and writes it out as a replay file:
// the event log, plus the spectator view after each event.
//
//	go run ./cmd/costan-replay -players 4 -ruleset base -seed 7 \
//	    -lookahead 3 -width 24 -out frontend/replay-live.frames.json
//
// The fold lives in package replay (see its doc comment); the server uses the
// same code, so a file written here matches what it serves for the same log.
//
// Frames are unredacted spectator views: a finished game shows everything.
package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
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

// main is a thin wrapper so `run` can return through the deferred Close.
func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func run() error {
	players := flag.Int("players", 4, "number of bot players (2-10)")
	ruleset := flag.String("ruleset", "base", "ruleset, e.g. base, base+islands, base+cak, base+wagons")
	seed := flag.Uint64("seed", 0, "game seed (0 = random)")
	lookahead := flag.Int("lookahead", 3, "within-turn lookahead depth (shipped default is 1)")
	width := flag.Int("width", 24, "candidates deepened per ply (shipped default is 10)")
	// Non-zero so trade offers get answered: with no delay runAutoSeats can
	// destroy an offer before any seat responds (see sim.Options).
	delay := flag.Duration("bot-delay", 12*time.Millisecond, "pace bot seats so trade offers survive")
	timeout := flag.Duration("timeout", 10*time.Minute, "max time to wait for the game to finish")
	preset := flag.String("preset", "", "named map preset to play on (e.g. beginner); empty = procedural")
	from := flag.Int("from", 0, "first frame to write (0 = the first frame that has a board)")
	to := flag.Int("to", 0, "last frame to write (0 = all of them)")
	out := flag.String("out", "-", "write the replay JSON here (- for stdout)")
	flag.Parse()

	// An authored map goes in through Options.Board, as the lobby does for a
	// gallery map (the homepage uses the beginner layout). Resolved before the
	// store is opened, since a log.Fatalf after that would skip Close.
	var authored *board.Board
	if *preset != "" {
		b, err := board.PresetBoard(*preset, *players, rand.New(rand.NewPCG(*seed, *seed)))
		if err != nil {
			return fmt.Errorf("preset: %w", err)
		}
		authored = b
	}

	st, err := store.OpenMem()
	if err != nil {
		return fmt.Errorf("store: %w", err)
	}
	defer st.Close()

	// Every seat is a Strong bot with the search widened via bot.WithLookahead
	// (beyond depth 1 and width 10 it costs time without adding strength).
	bots := func(engine.PlayerID) game.CommandSource {
		return bot.NewStrong(bot.WithLookahead(*lookahead, *width), bot.WithPlayerTrades())
	}

	started := time.Now()
	res, err := sim.RunGame(st, sim.Options{
		Players:  *players,
		Ruleset:  *ruleset,
		Seed:     *seed,
		Timeout:  *timeout,
		BotDelay: *delay,
		Bots:     bots,
		Board:    authored,
	})
	if err != nil {
		return fmt.Errorf("run: %w", err)
	}
	log.Printf("game %s finished in %s: winner seat %d, scores %v, %d events",
		res.GameID, time.Since(started).Round(time.Millisecond), res.Winner, res.Scores, res.Events)

	events, err := st.LoadEvents(res.GameID, 0)
	if err != nil {
		return fmt.Errorf("load events: %w", err)
	}

	file, err := replay.Fold(res.GameID, events, game.Spectator)
	if err != nil {
		return err
	}
	file.Meta.Bot = "strong"
	file.Meta.Lookahead = *lookahead
	file.Meta.Width = *width
	frames := file.Frames

	// Determinism check: the fold's final state must equal a clean replay of
	// the log. Done here rather than in Fold because it costs a second pass,
	// which the server cannot afford per request but a committed file can.
	want, err := engine.Replay(events)
	if err != nil {
		return fmt.Errorf("replay: %w", err)
	}
	a, _ := json.Marshal(frames[len(frames)-1].View)
	b, _ := json.Marshal(game.NewFullView(want, game.Spectator))
	if !bytes.Equal(a, b) {
		return errors.New("fold diverged from replay(log)")
	}

	// Trim to the requested window. The default start is the first frame with a
	// board; earlier events have nothing to draw.
	lo := *from
	if lo == 0 {
		for i, f := range frames {
			if f.View != nil && f.View.Board != nil && len(f.View.Board.Tiles) > 0 {
				lo = i
				break
			}
		}
	}
	hi := len(frames)
	if *to > 0 && *to < hi {
		hi = *to
	}
	if lo > 0 || hi < len(frames) {
		frames = frames[lo:hi]
		log.Printf("trimmed to frames [%d,%d) -> %d frames", lo, hi, len(frames))
	}
	file.Frames = frames

	data, err := json.Marshal(file)
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}
	if *out == "-" {
		_, err := os.Stdout.Write(data)
		return err
	}
	if err := os.WriteFile(*out, data, 0o600); err != nil {
		return fmt.Errorf("write: %w", err)
	}
	log.Printf("wrote %s (%d frames, %.1f MB)", *out, len(frames), float64(len(data))/(1<<20))
	return nil
}
