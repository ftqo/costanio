package sim

import (
	"testing"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/game"
)

// TestDevHeldAgainstPool tests a hypothesis from human games.
//
// A win-probability model fit to 40329 strong human games ranks the number of
// development cards in hand as the second strongest public predictor of
// winning (permutation importance +0.018, behind cities at +0.031). Our
// evaluator prices it at zero (Dev was set to 0 after measuring against
// clones).
//
// The model can't separate "buying dev cards wins" from "winning players can
// afford dev cards", so this is a ladder question.
func TestDevHeldAgainstPool(t *testing.T) {
	skipLadderUnlessRequested(t)
	base := bot.DefaultWeights()
	for _, rs := range []string{"base", "base+cak"} {
		for _, dev := range []float64{0, 0.25, 0.75, 2.0} {
			w := base
			w.Dev = dev
			st := openStore(t)
			cs := append([]Contender{{Name: "candidate", New: func() game.CommandSource {
				return bot.NewStrong(bot.WithWeights(w))
			}}}, diversePool()...)
			l, err := Run(st, LadderOptions{
				Contenders: cs, Games: 3000, Players: 4, Ruleset: rs,
				Seed: 3_100_000, Workers: 12,
			})
			if err != nil {
				t.Fatal(err)
			}
			r := l.Results[0]
			t.Logf("DEVHELD %-9s Dev=%-5.2f %.1f%% [%.1f%%, %.1f%%]  avgVP %.2f",
				rs, dev, r.WinRate*100, r.CILow*100, r.CIHigh*100, r.AvgVP)
		}
	}
}
