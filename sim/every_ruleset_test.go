package sim

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/engine"
)

// TestRulesetsPlayToCompletion covers a hand-picked list up to two modules,
// but there are over two hundred valid rulesets, and three-module
// interactions can stall where every pair finishes.
//
// So this plays every valid ruleset: one game each, two seats, Strong bot.
// Enough to catch "this combination cannot end", not to estimate a rate.
// Slow-gated (a couple of hundred games).

func TestEveryRulesetFinishes(t *testing.T) {
	skipUnlessSlow(t, "plays every valid ruleset to a finish")
	const stepCap = 12000
	for _, rs := range engine.ValidRulesets() {
		t.Run(rs, func(t *testing.T) {
			t.Parallel()
			if steps := strongGameSteps(t, rs, 2, 1, stepCap); steps >= stepCap {
				t.Errorf("%s did not finish in %d steps", rs, stepCap)
			}
		})
	}
}

// strongGameSteps plays one game to a finish or a cap and returns the steps
// taken. Uses the Strong bot, as production does.
func strongGameSteps(t *testing.T, ruleset string, players int, seed uint64, cap int) int {
	t.Helper()
	log, err := engine.New(engine.GameConfig{Players: players, Ruleset: ruleset}, engine.SeedsFrom(seed))
	if err != nil {
		t.Fatal(err)
	}
	s := engine.Empty()
	for _, e := range log {
		if err := engine.Apply(s, e); err != nil {
			t.Fatal(err)
		}
	}
	b := bot.NewStrong()
	step := 0
	for ; s.Phase != engine.PhaseFinished && step < cap; step++ {
		seat := actingSeat(s)
		cmd, ok := b.Act(s, seat)
		if !ok {
			if cmd, ok = engine.AutoCommand(s); !ok {
				t.Fatalf("%s: unfinished game has no automatic command at step %d", ruleset, step)
			}
		}
		events, err := engine.Decide(s, cmd)
		if err != nil {
			if cmd, ok = engine.AutoCommand(s); !ok {
				t.Fatalf("%s: unfinished game has no automatic command at step %d", ruleset, step)
			}
			if events, err = engine.Decide(s, cmd); err != nil {
				t.Fatalf("%s: auto %s: %v", ruleset, cmd.Type, err)
			}
		}
		for _, e := range events {
			if err := engine.Apply(s, e); err != nil {
				t.Fatalf("%s: apply %s: %v", ruleset, e.Type, err)
			}
		}
	}
	return step
}

// That failure was seed-dependent at four seats, which the two-seat sweep
// can't show. Play every superset of the triple over eight seeds.
func TestKnightsIslandsRaidersFinishes(t *testing.T) {
	skipUnlessSlow(t, "plays eight four-seat games per Raiders triple")
	for _, rs := range engine.ValidRulesets() {
		parts := strings.Split(rs, "+")
		if !slices.Contains(parts, "cak") || !slices.Contains(parts, "islands") || !slices.Contains(parts, "raiders") {
			continue
		}
		for seed := range uint64(8) {
			t.Run(fmt.Sprintf("%s/seed%d", rs, seed), func(t *testing.T) {
				t.Parallel()
				const cap = 12000
				if steps := strongGameSteps(t, rs, 4, seed, cap); steps >= cap {
					t.Fatalf("%s seed %d did not finish in %d steps", rs, seed, cap)
				}
			})
		}
	}
}
