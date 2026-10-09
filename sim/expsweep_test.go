package sim

import (
	"testing"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/game"
)

// TestExpansionAgainstPool prices expansion against a pool that differs from the
// candidate. Against the human-calibrated pool an expansion-heavy variant beat
// the default on Knights (28.8% vs 26.7%) and matched it on base; clone ladders
// read it as flat, since four identical bots wanting one corner only changes
// who gets it. Strong human winners finish with 2.55 settlements to this bot's
// 1.95.
func TestExpansionAgainstPool(t *testing.T) {
	skipLadderUnlessRequested(t)
	base := bot.DefaultWeights()
	for _, rs := range []string{"base", "base+cak"} {
		for _, mult := range []float64{1, 1.5, 2, 3} {
			w := base
			w.Expansion = base.Expansion * mult
			st := openStore(t)
			cs := append([]Contender{{Name: "candidate", New: func() game.CommandSource {
				return bot.NewStrong(bot.WithWeights(w))
			}}}, diversePool()...)
			l, err := Run(st, LadderOptions{
				Contenders: cs, Games: 3000, Players: 4, Ruleset: rs,
				Seed: 6_100_000, Workers: 12,
			})
			if err != nil {
				t.Fatal(err)
			}
			r := l.Results[0]
			t.Logf("%-9s Expansion x%-4.1f  %.1f%% [%.1f%%, %.1f%%]  avgVP %.2f  (fair 25%%)",
				rs, mult, r.WinRate*100, r.CILow*100, r.CIHigh*100, r.AvgVP)
		}
	}
}
