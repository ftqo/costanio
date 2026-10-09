package sim

import (
	"fmt"
	"testing"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// simpleGameSteps plays a full bot.Simple self-play game the way the adversarial
// suites do (bot move, falling back to the engine's auto move) and returns how
// many steps it took. A game that hits cap never finished.
func simpleGameSteps(t *testing.T, ruleset string, players int, seed uint64, cap int) int {
	t.Helper()
	cfg := engine.GameConfig{Players: players, Ruleset: ruleset, TargetVP: 8}
	log, err := engine.New(cfg, engine.SeedsFrom(seed))
	if err != nil {
		t.Fatal(err)
	}
	s := engine.Empty()
	for _, e := range log {
		if err := engine.Apply(s, e); err != nil {
			t.Fatal(err)
		}
	}
	b := bot.NewSimple()
	step := 0
	for ; s.Phase != engine.PhaseFinished && step < cap; step++ {
		seat := actingSeat(s)
		cmd, ok := b.Act(s, seat)
		if !ok {
			if cmd, ok = engine.AutoCommand(s); !ok {
				return step
			}
		}
		events, err := engine.Decide(s, cmd)
		if err != nil {
			if cmd, ok = engine.AutoCommand(s); !ok {
				return step
			}
			if events, err = engine.Decide(s, cmd); err != nil {
				t.Fatalf("%s seed %d: auto %s: %v", ruleset, seed, cmd.Type, err)
			}
		}
		for _, e := range events {
			if err := engine.Apply(s, e); err != nil {
				t.Fatalf("%s seed %d: apply %s: %v", ruleset, seed, e.Type, err)
			}
		}
	}
	return step
}

// TestSimpleTwoPlayerGamesTerminate is the bot.Simple half of the termination
// guarantee TestTwoPlayerGamesTerminate makes for Strong. It is also a
// performance guard: Simple drives every adversarial battery, which caps steps
// rather than failing, so a Simple livelock makes the suites slow, not red.
//
// Two livelocks are guarded, both worst at two players:
//
//   - the unconditional 4:1 dig toward ore, which left a hand of ore with no
//     settlement to upgrade, so every later turn passed (bot.simpleBankDig);
//   - buying undefended cities under Knights, razed at each landfall and
//     rebuilt the next turn (bot.simpleDefend).
//
// Budgets are not zero: a greedy baseline can be stuck on a hostile board, and
// Fishermen's old boot is a rules-level trap at two players. They are ~3x the
// measured rate.
func TestSimpleTwoPlayerGamesTerminate(t *testing.T) {
	skipUnlessSlow(t, "plays hundreds of games")
	// The adversarial suites' own cap.
	const stepCap = 6000
	// Every shipped module and composition should be listed here, or the test
	// only covers the ones that are.
	//
	// The newer rows use the base game's budget of 2: 40 two-player games each
	// (seeds 11-50) finished 40/40 for base+rivers, base+raiders, base+wagons,
	// explorers, base+caravans+islands and base+raiders+wagons.
	//
	// The explorers row runs at TargetVP 8, below the scenario's 17, which hides
	// the Explorers stall. The default-target checks are
	// TestSimpleExplorersStalledSeedsTerminate and TestExplorersGamesTerminate
	// (sim/explorers_terminate_test.go).
	budget := map[string]int{
		"base": 2, "base+islands": 2, "base+cak": 20, "base+fishermen": 12, "base+caravans": 2,
		"base+harbormaster": 2, "base+rivers": 2, "base+raiders": 2, "base+wagons": 2,
		"explorers": 2, "base+caravans+islands": 2, "base+raiders+wagons": 2,
	}
	games := 200
	if raceEnabled {
		games = 20 // the detector costs ~15x and finds nothing in single-goroutine bot logic
	}
	// cak+explorers is swept at its default target of 22 by
	// TestExplorersGamesTerminate instead (200 of 200 at two to four players).
	//
	// base+cak+raiders is intentionally absent: Simple stalls in 19 of 20
	// two-player games (each module alone and Strong both finish 20/20). Raiders drops Knights' fleet, which locks the Knights robber out, and
	// Simple can't play around it. That is bot weakness, not a dead state, and a
	// budget large enough to admit it would assert nothing. Add the row when
	// Simple learns the pairing.
	for _, rs := range []string{"base", "base+islands", "base+cak", "base+fishermen", "base+caravans",
		"base+harbormaster", "base+rivers", "base+raiders", "base+wagons", "explorers",
		"base+caravans+islands", "base+raiders+wagons"} {
		t.Run(rs, func(t *testing.T) {
			var stuck []uint64
			for seed := uint64(1); seed <= uint64(games); seed++ {
				if simpleGameSteps(t, rs, 2, seed, stepCap) >= stepCap {
					stuck = append(stuck, seed)
				}
			}
			// Round the scaled budget up. 2/200 scales to 0 over the 20-game race
			// sample, which would demand a perfect run from a process that fails
			// about one game in a hundred. A real livelock regression scores 5 to 12
			// stuck seeds out of 20, so the guard still holds.
			want := (budget[rs]*games + 199) / 200
			if len(stuck) > want {
				t.Fatalf("%d/%d two-player %s games did not finish in %d steps (budget %d): seeds %v",
					len(stuck), games, rs, stepCap, want, stuck)
			}
		})
	}
}

// simpleGameStepsAtDefaultVP is simpleGameSteps at the ruleset's default victory
// target (TargetVP 0, i.e. 10) rather than 8, and it reports whether the bot
// ever traded toward a road it could not yet pay for.
//
// TestSimpleTwoPlayerGamesTerminate plays to 8, where the leader usually
// finishes before the table runs out of moves; before the fix two-player base
// was 0/200 stuck at 8 and 23/200 at 10. Real tables play the default.
func simpleGameStepsAtDefaultVP(t *testing.T, ruleset string, players int, seed uint64, cap int) (steps int, dugForRoad bool) {
	t.Helper()
	cfg := engine.GameConfig{Players: players, Ruleset: ruleset}
	log, err := engine.New(cfg, engine.SeedsFrom(seed))
	if err != nil {
		t.Fatal(err)
	}
	s := engine.Empty()
	for _, e := range log {
		if err := engine.Apply(s, e); err != nil {
			t.Fatal(err)
		}
	}
	b := bot.NewSimple()
	step := 0
	for ; s.Phase != engine.PhaseFinished && step < cap; step++ {
		seat := actingSeat(s)
		cmd, ok := b.Act(s, seat)
		if !ok {
			if cmd, ok = engine.AutoCommand(s); !ok {
				return step, dugForRoad
			}
		}
		// A bank trade by a seat holding neither half of a road's cost: the
		// seat the old road want could not see, because engine.Decide says a
		// road is illegal when you cannot pay for it.
		if cmd.Type == engine.CmdBankTrade {
			h := s.Players[cmd.Player].Hand
			if h[board.Wood] == 0 && h[board.Brick] == 0 {
				dugForRoad = true
			}
		}
		events, err := engine.Decide(s, cmd)
		if err != nil {
			if cmd, ok = engine.AutoCommand(s); !ok {
				return step, dugForRoad
			}
			if events, err = engine.Decide(s, cmd); err != nil {
				t.Fatalf("%s seed %d: auto %s: %v", ruleset, seed, cmd.Type, err)
			}
		}
		for _, e := range events {
			if err := engine.Apply(s, e); err != nil {
				t.Fatalf("%s seed %d: apply %s: %v", ruleset, seed, e.Type, err)
			}
		}
	}
	return step, dugForRoad
}

// TestSimpleRoadStarvedGamesTerminate pins the third Simple livelock: a seat
// with no settlement to upgrade, no settlement spot off its setup roads, an
// empty development deck and a hand of the wrong resources. A road is its only
// move, but simpleBankDig asked engine.Decide whether a road was legal, which
// says no when the seat can't pay. So it never traded toward one.
//
// The seeds are pinned: each hit the 6000-step cap before the fix and finishes
// in under 1200 steps after. Fast enough for the default gate.
func TestSimpleRoadStarvedGamesTerminate(t *testing.T) {
	const stepCap = 6000
	cases := []struct {
		ruleset string
		players int
		seeds   []uint64
	}{
		{"base", 4, []uint64{17, 58, 153, 193, 194}},
		{"base", 2, []uint64{2, 4, 17, 40}},
		{"base", 3, []uint64{4, 8, 41}},
		{"base+islands", 4, []uint64{5, 60, 78}},
		{"base+caravans", 2, []uint64{1, 2, 4}},
	}
	anyDug := false
	for _, c := range cases {
		t.Run(fmt.Sprintf("%s/%dp", c.ruleset, c.players), func(t *testing.T) {
			for _, seed := range c.seeds {
				steps, dug := simpleGameStepsAtDefaultVP(t, c.ruleset, c.players, seed, stepCap)
				if steps >= stepCap {
					t.Errorf("%s %dp seed %d: did not finish in %d steps",
						c.ruleset, c.players, seed, stepCap)
				}
				anyDug = anyDug || dug
			}
		})
	}
	// Assert the escape actually happened, so the test can't pass just because
	// the seeds stopped being hard: some seat bank-traded while holding neither
	// wood nor brick.
	if !anyDug {
		t.Error("no seat bank-traded toward an unaffordable road")
	}
}
