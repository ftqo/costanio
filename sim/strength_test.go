package sim

import (
	"errors"
	"math/rand/v2"
	"testing"
	"time"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/game"
)

// TestStrongPlaysToCompletion confirms an all-Strong table finishes games on
// base and on expansions. base+cak runs to the full 13-VP game now that Strong
// plays the Knights VP engine; Islands keeps a base-reachable target, since
// this is a completion check and not a measure of sailing (that is
// TestShoresSmallBotsSail and docs/bots.md).
func TestStrongPlaysToCompletion(t *testing.T) {
	skipUnlessSlow(t, "all-Strong games are clone-heavy")
	allStrong := func(engine.PlayerID) game.CommandSource { return bot.NewStrong() }
	cases := []struct {
		ruleset string
		target  int
	}{
		{"base", 8},
		{"base+islands", 8},
		{"base+cak", 13},
	}
	for _, tc := range cases {
		t.Run(tc.ruleset, func(t *testing.T) {
			st := openStore(t)
			res, err := RunGame(st, Options{
				Players: 4, Ruleset: tc.ruleset, TargetVP: tc.target, Seed: 5,
				Timeout: 120 * time.Second, Bots: allStrong,
			})
			if err != nil {
				t.Fatalf("%s: %v", tc.ruleset, err)
			}
			if res.WinnerVP < tc.target {
				t.Errorf("%s: winner VP %d < %d", tc.ruleset, res.WinnerVP, tc.target)
			}
		})
	}
}

// TestStrongBeatsSimple is the strength benchmark: one Strong bot against
// three Simple baselines, over many seeds, with Strong's seat rotated so
// first-mover advantage cancels out. A fair share is 25%; a genuinely strong
// bot wins far more.
func TestStrongBeatsSimple(t *testing.T) {
	skipUnlessSlow(t, "strength benchmark is slow")
	const games = 24
	const players = 4

	strongWins, finished := 0, 0
	for i := range games {
		strongSeat := engine.PlayerID(i % players)
		st := openStore(t)
		res, err := RunGame(st, Options{
			Players:  players,
			Ruleset:  "base",
			TargetVP: 10,
			Seed:     uint64(1000 + i),
			Timeout:  120 * time.Second,
			Bots: func(seat engine.PlayerID) game.CommandSource {
				if seat == strongSeat {
					return bot.NewStrong()
				}
				return bot.NewSimple()
			},
		})
		st.Close()
		if errors.Is(err, ErrStalemate) {
			// A rare all-bot deadlock (the Simple baselines have no anti-sprawl
			// cap and can get stuck). Not Strong's fault, so exclude it from the
			// win rate.
			t.Logf("game %d (seed %d) stalemated; skipping", i, 1000+i)
			continue
		}
		if err != nil {
			t.Fatalf("game %d: %v", i, err)
		}
		finished++
		if res.Winner == strongSeat {
			strongWins++
		}
	}

	winRate := float64(strongWins) / float64(finished)
	t.Logf("Strong won %d/%d games (%.0f%%); fair share is 25%%", strongWins, finished, winRate*100)
	if winRate <= 0.40 {
		t.Errorf("Strong win rate %.0f%%, want well above 25%%", winRate*100)
	}
}

// TestStrongDoesNotChaseLongestRoad checks that no all-Strong bot builds a long
// road relative to its settlements: bots build roads only to reach settlement
// spots. Random seeds each run let -count=N explore more games; a failure
// prints its seed, which reproduces the game.
func TestStrongDoesNotChaseLongestRoad(t *testing.T) {
	skipUnlessSlow(t, "plays full games")
	for range 12 {
		seed := rand.Uint64()
		st := openStore(t)
		res, err := RunGame(st, Options{
			Players: 4,
			Seed:    seed,
			Timeout: 60 * time.Second,
			Bots:    func(engine.PlayerID) game.CommandSource { return bot.NewStrong() },
		})
		if errors.Is(err, ErrStalemate) {
			t.Logf("seed %d stalemated; skipping", seed)
			continue
		}
		if err != nil {
			t.Fatalf("seed %d: game did not finish: %v", seed, err)
		}
		events, err := Transcript(st, res.GameID)
		if err != nil {
			t.Fatalf("seed %d: %v", seed, err)
		}
		state, err := engine.Replay(events)
		if err != nil {
			t.Fatalf("seed %d: %v", seed, err)
		}
		roads := make([]int, len(state.Players))
		for _, owner := range state.Roads {
			roads[owner]++
		}
		builds := make([]int, len(state.Players))
		for _, b := range state.Buildings {
			builds[b.Owner]++
		}
		for p := range state.Players {
			// With no longest-road pursuit, roads stay within ~2 per building
			// plus slack. A road-chasing bot accumulates far more.
			if builds[p] > 0 && roads[p] > builds[p]*2+4 {
				t.Errorf("seed %d seat %d built %d roads for %d buildings",
					seed, p, roads[p], builds[p])
			}
		}
	}
}

// TestStrongBeatsSimpleKnights is the Knights strength gate: one Strong seat against
// three Simple baselines on base+cak at the full 13-VP target, with the Strong
// seat rotated. Strong must win well above the 25% fair share, showing the
// Knights-aware play (improvements/metropolises, knights, barbarian defense,
// progress cards) is a real edge.
func TestStrongBeatsSimpleKnights(t *testing.T) {
	skipUnlessSlow(t, "strength benchmark is slow")
	const games = 24
	const players = 4

	strongWins, finished := 0, 0
	for i := range games {
		strongSeat := engine.PlayerID(i % players)
		st := openStore(t)
		res, err := RunGame(st, Options{
			Players:  players,
			Ruleset:  "base+cak",
			TargetVP: 13,
			Seed:     uint64(2000 + i),
			Timeout:  120 * time.Second,
			Bots: func(seat engine.PlayerID) game.CommandSource {
				if seat == strongSeat {
					return bot.NewStrong()
				}
				return bot.NewSimple()
			},
		})
		st.Close()
		if errors.Is(err, ErrStalemate) {
			t.Logf("game %d (seed %d) stalemated; skipping", i, 2000+i)
			continue
		}
		if err != nil {
			t.Fatalf("game %d: %v", i, err)
		}
		finished++
		if res.Winner == strongSeat {
			strongWins++
		}
	}

	winRate := float64(strongWins) / float64(finished)
	t.Logf("CAK Strong won %d/%d games (%.0f%%); fair share is 25%%", strongWins, finished, winRate*100)
	if winRate <= 0.40 {
		t.Errorf("CAK Strong win rate %.0f%%, want well above 25%%", winRate*100)
	}
}
