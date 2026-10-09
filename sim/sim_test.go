package sim

import (
	"errors"
	"math/rand/v2"
	"testing"
	"time"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/game"

	// Register the expansion modules so their rulesets resolve.
	_ "github.com/ftqo/costan.io/engine/harbormaster"
	_ "github.com/ftqo/costan.io/engine/islands"
	_ "github.com/ftqo/costan.io/engine/knights"
	_ "github.com/ftqo/costan.io/engine/raiders"
	_ "github.com/ftqo/costan.io/engine/rivers"
	_ "github.com/ftqo/costan.io/engine/scenarios"
	_ "github.com/ftqo/costan.io/engine/wagons"

	"github.com/ftqo/costan.io/store"
)

func openStore(t *testing.T) *store.Store {
	t.Helper()
	st, err := store.OpenMem() // in-memory: no file IO, much faster for sims
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	return st
}

func TestFourBotGameCompletes(t *testing.T) {
	st := openStore(t)
	res, err := RunGame(st, Options{
		Players:  4,
		Ruleset:  "base",
		TargetVP: 8, // modest target keeps the test quick
		Seed:     42,
		Timeout:  60 * time.Second,
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.Winner < 0 || int(res.Winner) >= 4 {
		t.Fatalf("winner = %d", res.Winner)
	}
	if res.WinnerVP < 8 {
		t.Errorf("winner VP = %d, want >= 8", res.WinnerVP)
	}
	if res.Events < 30 {
		t.Errorf("suspiciously short game: %d events", res.Events)
	}
	// The log replays to the same winner: full crash-safe round trip.
	events, _ := Transcript(st, res.GameID)
	state, err := engine.Replay(events)
	if err != nil {
		t.Fatal(err)
	}
	if state.Winner != res.Winner {
		t.Errorf("replay winner %d != result winner %d", state.Winner, res.Winner)
	}
}

// Each ruleset must be playable end to end by bots. Targets are low so the
// suite stays fast; the point is reaching a winner.
func TestRulesetsPlayToCompletion(t *testing.T) {
	skipUnlessSlow(t, "plays nine full games")
	cases := []struct {
		ruleset string
		players int
		target  int
	}{
		{"base", 4, 7},
		{"base+islands", 4, 7},
		// Bots play Knights with base moves only (no knights/improvements), so
		// target a VP reachable by base building. Full 13-VP Knights needs an
		// expansion-aware bot.
		{"base+cak", 4, 8},
		{"base+fishermen", 4, 7},
		{"base+caravans", 4, 7},
		{"base+raiders", 4, 12},
		// Every module and composition should have a row here.
		{"base+rivers", 4, 7},
		{"base+wagons", 4, 7},
		{"base+harbormaster", 4, 7},
		// Explorers owns its target (17) and refuses a lower one, so this row
		// is a whole game.
		{"explorers", 4, 17},
		// The one pairing a standalone takes, also a whole game: the target is
		// the scenario's 17 plus 5, and the scenario refuses a lower one. 40 of
		// 40 four-player strong-bot games finished (average winner 22.1 VP,
		// seats within 20-30%).
		{"cak+explorers", 4, 22},
		{"base+caravans+islands", 4, 7},
		{"base+raiders+wagons", 4, 12},
	}
	for _, tc := range cases {
		t.Run(tc.ruleset, func(t *testing.T) {
			// Tournament dice are random per game, so the bot must finish every
			// ruleset on any seed. Random seeds each run let -count=N explore more
			// games; a failure prints its seed.
			for range 4 {
				seed := rand.Uint64()
				st := openStore(t)
				res, err := RunGame(st, Options{
					Players:  tc.players,
					Ruleset:  tc.ruleset,
					TargetVP: tc.target,
					Seed:     seed,
					Timeout:  180 * time.Second,
					// The production Strong bot, so every ruleset is driven to a finish.
					Bots: func(engine.PlayerID) game.CommandSource { return bot.NewStrong() },
				})
				if errors.Is(err, ErrStalemate) {
					// A game that cannot end is the one outcome a tournament can't
					// absorb, and the bot plays every module now, so this fails rather
					// than logging (and not t.Skip, which would print ok). The seed in
					// the message reproduces it.
					t.Fatalf("%s seed %d stalemated: %v", tc.ruleset, seed, err)
				}
				if err != nil {
					t.Fatalf("%s seed %d: %v", tc.ruleset, seed, err)
				}
				if res.WinnerVP < tc.target {
					t.Errorf("%s seed %d: winner VP %d < target %d", tc.ruleset, seed, res.WinnerVP, tc.target)
				}
			}
		})
	}
}

func TestFairDiceGameCompletes(t *testing.T) {
	st := openStore(t)
	res, err := RunGame(st, Options{
		Players:  4,
		Ruleset:  "base",
		TargetVP: 7,
		DiceMode: engine.DiceFair,
		Seed:     99,
		Timeout:  60 * time.Second,
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.WinnerVP < 7 {
		t.Errorf("fair-dice winner VP = %d", res.WinnerVP)
	}
}
