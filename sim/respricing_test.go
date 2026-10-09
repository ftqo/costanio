package sim

import (
	"testing"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/game"
)

// TestResourcePricingMatters asks whether the earlyResW/lateResW schedule (ten
// hand-set constants) does anything at all, by comparing it with flat pricing
// (every resource 1.0). If they are indistinguishable, tuning the constants
// isn't worth compute.
func TestResourcePricingMatters(t *testing.T) {
	skipLadderUnlessRequested(t)
	skipLadderUnderRace(t)
	skipUnlessSlow(t, "plays thousands of games")
	st := openStore(t)
	l, err := Run(st, LadderOptions{
		Contenders: []Contender{
			{Name: "tuned schedule (shipped)", New: func() game.CommandSource { return bot.NewStrong() }},
			{Name: "flat pricing", New: func() game.CommandSource { return bot.NewStrong(bot.WithFlatResourceWeights()) }},
		},
		Games: 4000, Players: 4, Seed: 3_800_000, Workers: 8,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Log("\n" + l.String())
}
