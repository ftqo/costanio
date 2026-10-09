package game

import (
	"testing"
	"time"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/knights"
	"github.com/ftqo/costan.io/timings"
)

// TestBudgetFor checks the per-decision turn budget derived from the turn
// timer: reactive actions are capped below the main-turn budget, untimed games
// stay untimed, and a short timer compresses every kind.
func TestBudgetFor(t *testing.T) {
	sec := func(n int) time.Duration { return time.Duration(n) * time.Second }
	cases := []struct {
		name         string
		decider      engine.Decider
		turnTimerSec int
		want         time.Duration
	}{
		// 60s game: reactive actions capped, main gets the full budget.
		{"roll 60", engine.Decider{Kind: engine.DecisionRoll}, 60, timings.RollCap},
		{"discard 60", engine.Decider{Kind: engine.DecisionDiscard}, 60, timings.DiscardCap},
		{"robber 60", engine.Decider{Kind: engine.DecisionRobber}, 60, timings.RobberCap},
		{"setup 60", engine.Decider{Kind: engine.DecisionSetup}, 60, timings.SetupCap},
		{"setup road 60", engine.Decider{Kind: engine.DecisionSetupRoad}, 60, timings.SetupRoadCap},
		{"main 60", engine.Decider{Kind: engine.DecisionMain}, 60, sec(60)},
		{"none 60", engine.Decider{Kind: engine.DecisionNone}, 60, 0},

		// Module decisions are sized by which obligation is owed: the
		// aqueduct's free resource is one tap, a wedding give is a hand-sized
		// decision.
		{
			"module: one-tap pick",
			engine.Decider{Kind: engine.DecisionModule, Decisions: []string{knights.DecisionAqueduct}},
			60, timings.ModuleCaps[knights.DecisionAqueduct],
		},
		{
			"module: deliberative pick",
			engine.Decider{Kind: engine.DecisionModule, Decisions: []string{knights.DecisionWeddingGive}},
			60, timings.ModuleCaps[knights.DecisionWeddingGive],
		},
		{
			"module: both keeps longer",
			engine.Decider{Kind: engine.DecisionModule, Decisions: []string{knights.DecisionAqueduct, knights.DecisionWeddingGive}},
			60, max(timings.ModuleCaps[knights.DecisionAqueduct], timings.ModuleCaps[knights.DecisionWeddingGive]),
		},
		{
			"module: unknown id gets default",
			engine.Decider{Kind: engine.DecisionModule, Decisions: []string{"decision_from_the_future"}},
			60, timings.ModuleDefaultCap,
		},
		{
			// A module decider with no ids still gets a clock, or the seat
			// stalls the table.
			"module: no ids gets default",
			engine.Decider{Kind: engine.DecisionModule},
			60, timings.ModuleDefaultCap,
		},

		// Untimed game: every base kind is untimed. The lobby rejects such a
		// config, but a game restored from an older log may carry one.
		{"roll untimed", engine.Decider{Kind: engine.DecisionRoll}, 0, 0},
		{"main untimed", engine.Decider{Kind: engine.DecisionMain}, 0, 0},
		{"setup negative", engine.Decider{Kind: engine.DecisionSetup}, -5, 0},
		// Module decisions keep their cap even untimed: a module that Blocks
		// holds the whole table, so no deadline would freeze it (a camel vote
		// would never resolve).
		{
			"module untimed",
			engine.Decider{Kind: engine.DecisionModule, Decisions: []string{knights.DecisionAqueduct}},
			0, timings.ModuleCap([]string{knights.DecisionAqueduct}),
		},
		{
			"module negative",
			engine.Decider{Kind: engine.DecisionModule, Decisions: []string{knights.DecisionAqueduct}},
			-5, timings.ModuleCap([]string{knights.DecisionAqueduct}),
		},

		// Fast 15s game: caps clamp down to the main budget.
		{"roll 15", engine.Decider{Kind: engine.DecisionRoll}, 15, timings.RollCap},
		{"discard 15", engine.Decider{Kind: engine.DecisionDiscard}, 15, sec(15)},
		{"setup 15", engine.Decider{Kind: engine.DecisionSetup}, 15, sec(15)},
		{"setup road 10", engine.Decider{Kind: engine.DecisionSetupRoad}, 10, sec(10)},
		{"main 15", engine.Decider{Kind: engine.DecisionMain}, 15, sec(15)},
		// A 5s game compresses even the shortest module cap to the main budget.
		{
			"module quick 5",
			engine.Decider{Kind: engine.DecisionModule, Decisions: []string{knights.DecisionAqueduct}},
			5, sec(5),
		},
	}
	for _, c := range cases {
		if got := budgetFor(c.decider, c.turnTimerSec); got != c.want {
			t.Errorf("%s: budgetFor(%+v, %d) = %s, want %s", c.name, c.decider, c.turnTimerSec, got, c.want)
		}
	}
}
