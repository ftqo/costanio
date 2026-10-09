package sim

import (
	"testing"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/game"
	"github.com/ftqo/costan.io/store"
)

// gameFingerprint plays one game with `seat` driven by `w` and every other seat
// on the default weights, and returns something that differs whenever any
// decision differed: the log diverges at the first different command, so the
// scores and event count are enough.
func gameFingerprint(t *testing.T, ruleset string, seed uint64, seat engine.PlayerID, mk func() game.CommandSource) [5]int {
	t.Helper()
	st, err := store.OpenMem()
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	res, err := RunGame(st, Options{
		Players: 4, Ruleset: ruleset, Seed: seed, DiceMode: "random", BoardMode: "fair",
		Bots: func(p engine.PlayerID) game.CommandSource {
			if p == seat {
				return mk()
			}
			return bot.NewStrong()
		},
	})
	if err != nil {
		t.Fatalf("%s seed %d: %v", ruleset, seed, err)
	}
	var fp [5]int
	copy(fp[:4], res.Scores)
	fp[4] = res.Events
	return fp
}

// TestPoolArmsPlayDifferently checks that each arm of a measurement
// pool plays differently from the baseline.
//
// A weight can be inert under a ruleset: Weights.Army reads KnightsPlayed and
// LargestArmyHolder, which Knights disables (DevCardsDisabled), so an
// "army-racer" arm is just the shipped bot in base+cak, where
// TestAgainstHumanCalibratedPool runs. A weight that changes no decision can
// only be seen from the games, so every arm must prove it plays differently.
func TestPoolArmsPlayDifferently(t *testing.T) {
	for _, pool := range []struct {
		name       string
		ruleset    string
		contenders []Contender
	}{
		// The rulesets each pool is measured in: TestAgainstHumanCalibratedPool runs
		// base and base+cak.
		{"humanpool", "base+cak", humanCalibratedPool()},
		{"humanpool", "base", humanCalibratedPool()},
		{"diversePool", "base", diversePool()},
	} {
		t.Run(pool.name+"/"+pool.ruleset, func(t *testing.T) {
			// An arm fails only if it matched the baseline on every seed: a real
			// strategy can make the same choices in a single deal.
			seeds := []uint64{11, 23, 47, 61, 89}
			for _, c := range pool.contenders {
				diverged := false
				var lastFP [5]int
				for _, seed := range seeds {
					base := gameFingerprint(t, pool.ruleset, seed, 0, func() game.CommandSource { return bot.NewStrong() })
					got := gameFingerprint(t, pool.ruleset, seed, 0, c.New)
					lastFP = got
					if got != base {
						diverged = true
						break
					}
				}
				if !diverged {
					t.Errorf("%s/%s plays the same game as the default bot on %s across all %d seeds "+
						"(last: scores %v, %d events)",
						pool.name, c.Name, pool.ruleset, len(seeds), lastFP[:4], lastFP[4])
				}
			}
		})
	}
}

// TestNaivePoliciesChangeGame: WithNaivePolicy swaps one sub-policy for a
// poor version to price what it is worth. A name that is accepted but never
// read would make the ablation run the real policy and report it as worthless,
// so every name is checked individually.
func TestNaivePoliciesChangeGame(t *testing.T) {
	for _, name := range []string{"placement", "setup-road", "robber", "discard", "trade"} {
		t.Run(name, func(t *testing.T) {
			seeds := []uint64{11, 23, 47, 61, 89}
			for _, seed := range seeds {
				base := gameFingerprint(t, "base", seed, 0, func() game.CommandSource { return bot.NewStrong() })
				got := gameFingerprint(t, "base", seed, 0, func() game.CommandSource {
					return bot.NewStrong(bot.WithNaivePolicy(name))
				})
				if got != base {
					return
				}
			}
			t.Errorf("WithNaivePolicy(%q) plays the same game as the real bot across all %d seeds", name, len(seeds))
		})
	}
}
