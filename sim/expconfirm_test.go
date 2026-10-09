package sim

import (
	"testing"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/game"
)

// TestExpansionConfirm replicates the pool sweep on a fresh seed at higher N.
// The first sweep put Knights at 29.9% -> 32.1% for Expansion x2 with intervals
// that only just separated, and base flat; a shipped weight needs the effect to
// hold on a different seed.
func TestExpansionConfirm(t *testing.T) {
	skipLadderUnlessRequested(t)
	base := bot.DefaultWeights()
	for _, rs := range []string{"base", "base+cak"} {
		for _, mult := range []float64{1, 2} {
			w := base
			w.Expansion = base.Expansion * mult
			st := openStore(t)
			cs := append([]Contender{{Name: "candidate", New: func() game.CommandSource {
				return bot.NewStrong(bot.WithWeights(w))
			}}}, diversePool()...)
			l, err := Run(st, LadderOptions{
				Contenders: cs, Games: 5000, Players: 4, Ruleset: rs,
				Seed: 9_900_000, Workers: 12,
			})
			if err != nil {
				t.Fatal(err)
			}
			r := l.Results[0]
			t.Logf("CONFIRM %-9s Expansion x%-4.1f  %.1f%% [%.1f%%, %.1f%%]  avgVP %.2f",
				rs, mult, r.WinRate*100, r.CILow*100, r.CIHigh*100, r.AvgVP)
		}
	}
}
