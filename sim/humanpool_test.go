package sim

import (
	"testing"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/game"
)

// A pool calibrated to how strong humans play, from 2315 winners and 4448
// openings in human games:
//
//	settlements 2.55 | cities 2.17 | held Largest Army 56.7% | 3.14 settlements
//	standing at the first city | opening corners 62.4% three-resource
//
// Self-play against clones can't evaluate anything opponent-dependent (trading,
// denial, racing), because four copies of one evaluator want the same things
// at once. These opponents differ along the axes humans differ on. It is not a
// human table, but a harder and more varied one than a monoculture.
func humanCalibratedPool() []Contender {
	// Expands wide and settles rather than upgrading: humans win with 2.55
	// settlements to this bot's 1.95.
	expander := bot.DefaultWeights()
	expander.Expansion *= 2
	expander.Reach *= 1.5

	// Contests military strength, which humans hold in 56.7% of their wins and
	// this bot in 40.8%.
	//
	// It scales both terms because Weights.Army is inert under Knights:
	// armyProximity reads KnightsPlayed and LargestArmyHolder, and Knights sets
	// DevCardsDisabled and has no Largest Army (docs/rules/knights.md). KnightsLevel
	// is the Knights analogue, per weighted knight level, scaled by barbarian
	// proximity. TestPoolArmsPlayDifferently guards this.
	army := bot.DefaultWeights()
	army.Army *= 16
	army.KnightsLevel *= 4

	// Plays its own board and rushes points, the opposite pole from the
	// field-aware default.
	rusher := bot.DefaultWeights()
	rusher.VP *= 2
	rusher.Opp = 0

	return []Contender{
		{Name: "expander", New: func() game.CommandSource { return bot.NewStrong(bot.WithWeights(expander)) }},
		{Name: "army-racer", New: func() game.CommandSource { return bot.NewStrong(bot.WithWeights(army)) }},
		{Name: "point-rusher", New: func() game.CommandSource { return bot.NewStrong(bot.WithWeights(rusher)) }},
	}
}

// TestAgainstHumanCalibratedPool plays one seat of the shipped bot against three
// different strategies rather than three copies of itself. Fair share is 25%.
func TestAgainstHumanCalibratedPool(t *testing.T) {
	skipLadderUnlessRequested(t)
	for _, tc := range []struct {
		name    string
		ruleset string
		games   int
	}{
		{"base", "base", 3000},
		{"base+cak", "base+cak", 2000},
	} {
		st := openStore(t)
		cs := append([]Contender{{Name: "shipped", New: func() game.CommandSource { return bot.NewStrong() }}},
			humanCalibratedPool()...)
		l, err := Run(st, LadderOptions{
			Contenders: cs, Games: tc.games, Players: 4, Ruleset: tc.ruleset,
			Seed: 2_700_000, Workers: 12,
		})
		if err != nil {
			t.Fatal(err)
		}
		t.Logf("%s:\n%s", tc.name, l.String())
	}
}
