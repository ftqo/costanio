package sim

import (
	"testing"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/game"
)

// TestFlatResourcesAgainstPool re-tests the opening resource weights.
//
// earlyResW discounts ore to 0.85 and sheep to 0.9. Across 40329 human games,
// fitting win probability on opening pips per resource gives wood +0.296,
// brick +0.315, sheep +0.300, wheat +0.367, ore +0.382: all positive and nearly
// equal, ore highest. More pips of anything helps; no resource is preferred.
//
// What the data does show is concentration: a >=50% share of any single
// resource wins 20-23% against a 25% base rate, and 0% wheat wins 20.1%. That
// is a diversity effect, which the evaluator prices separately.
func TestFlatResourcesAgainstPool(t *testing.T) {
	skipLadderUnlessRequested(t)
	for _, tc := range []struct {
		name string
		opts []bot.Option
	}{
		{"tuned-weights", nil},
		{"flat-weights", []bot.Option{bot.WithFlatResourceWeights()}},
	} {
		for _, rs := range []string{"base", "base+cak"} {
			st := openStore(t)
			cs := append([]Contender{{Name: tc.name, New: func() game.CommandSource {
				return bot.NewStrong(tc.opts...)
			}}}, diversePool()...)
			l, err := Run(st, LadderOptions{
				Contenders: cs, Games: 5000, Players: 4, Ruleset: rs,
				Seed: 8_300_000, Workers: 10,
			})
			if err != nil {
				t.Fatal(err)
			}
			r := l.Results[0]
			t.Logf("FLATRES %-9s %-14s %.1f%% [%.1f%%, %.1f%%]  avgVP %.2f",
				rs, tc.name, r.WinRate*100, r.CILow*100, r.CIHigh*100, r.AvgVP)
		}
	}
}
