package sim

import (
	"testing"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/game"
)

// TestLearnedAcceptAgainstPool decides whether a cloned acceptance policy makes
// trading worth anything.
//
// Trading currently measures neutral (27.85% on, 27.98% off, 12000 games an
// arm), with the bot accepting almost nothing. Strong humans accept 15.6% of
// offers received. The cloned policy reaches AUC 0.780 on held-out games
// against 0.634 for "accept if it completes a build".
//
// The threshold is swept because AUC doesn't say where to cut. The base rate
// is 0.156.
func TestLearnedAcceptAgainstPool(t *testing.T) {
	skipLadderUnlessRequested(t)
	for _, tc := range []struct {
		name string
		opts []bot.Option
	}{
		{"evaluator", nil},
		{"cloned-0.15", []bot.Option{bot.WithLearnedAccept(0.15)}},
		{"cloned-0.35", []bot.Option{bot.WithLearnedAccept(0.35)}},
		{"no-trades", []bot.Option{bot.WithoutPlayerTrades()}},
	} {
		for _, rs := range []string{"base", "base+cak"} {
			st := openStore(t)
			cs := append([]Contender{{Name: tc.name, New: func() game.CommandSource {
				return bot.NewStrong(tc.opts...)
			}}}, diversePool()...)
			l, err := Run(st, LadderOptions{
				Contenders: cs, Games: 4000, Players: 4, Ruleset: rs,
				Seed: 2_400_000, Workers: 12,
			})
			if err != nil {
				t.Fatal(err)
			}
			r := l.Results[0]
			t.Logf("ACCEPT %-9s %-12s %.1f%% [%.1f%%, %.1f%%]  avgVP %.2f",
				rs, tc.name, r.WinRate*100, r.CILow*100, r.CIHigh*100, r.AvgVP)
		}
	}
}
