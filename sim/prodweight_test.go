package sim

import (
	"testing"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/game"
)

// TestProductionAgainstPool tests whether the Production weight is too high.
//
// In a linear model fit to 40329 strong human games, production pips have the
// smallest coefficients of any own-player fact (+0.08 to +0.14 per standard
// deviation), below cities (+0.73), dev cards held (+0.58), public VP (+0.56)
// and roads built (+0.33). Since production is upstream of every piece, a naive
// reading should overstate it, yet it still ranks last.
func TestProductionAgainstPool(t *testing.T) {
	skipLadderUnlessRequested(t)
	base := bot.DefaultWeights()
	for _, rs := range []string{"base", "base+cak"} {
		for _, mult := range []float64{1, 0.6, 0.3} {
			w := base
			w.Prod = base.Prod * mult
			st := openStore(t)
			cs := append([]Contender{{Name: "candidate", New: func() game.CommandSource {
				return bot.NewStrong(bot.WithWeights(w))
			}}}, diversePool()...)
			l, err := Run(st, LadderOptions{
				Contenders: cs, Games: 3000, Players: 4, Ruleset: rs,
				Seed: 5_500_000, Workers: 12,
			})
			if err != nil {
				t.Fatal(err)
			}
			r := l.Results[0]
			t.Logf("PROD %-9s Production x%-4.1f %.1f%% [%.1f%%, %.1f%%]  avgVP %.2f",
				rs, mult, r.WinRate*100, r.CILow*100, r.CIHigh*100, r.AvgVP)
		}
	}
}
