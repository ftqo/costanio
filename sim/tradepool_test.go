package sim

import (
	"testing"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/game"
)

// TestTradingAgainstPool re-prices player-to-player trading against opponents
// that want different cards than the candidate.
//
// Against clones trading measured 48.7% [46.7, 50.7] with 12.5 offers a game
// and 0.03 accepted: four copies of one evaluator want the same resources at
// once, so declining is correct and no offer policy can win. In the pool the
// expander wants wood and brick and the point-rusher ore and wheat, so
// mutually profitable trades exist.
//
// Trading is driven by the actor's runOfferResponses, so this must run through
// sim's full path, not train.PlayGame (see docs/bots.md).
func TestTradingAgainstPool(t *testing.T) {
	skipLadderUnlessRequested(t)
	for _, tc := range []struct {
		name string
		new  func() game.CommandSource
	}{
		{"trading-on", func() game.CommandSource { return bot.NewStrong() }},
		{"trading-off", func() game.CommandSource { return bot.NewStrong(bot.WithoutPlayerTrades()) }},
	} {
		for _, rs := range []string{"base", "base+cak"} {
			st := openStore(t)
			cs := append([]Contender{{Name: tc.name, New: tc.new}}, diversePool()...)
			l, err := Run(st, LadderOptions{
				Contenders: cs, Games: 6000, Players: 4, Ruleset: rs,
				Seed: 1_800_000, Workers: 10,
			})
			if err != nil {
				t.Fatal(err)
			}
			r := l.Results[0]
			t.Logf("%-9s %-12s %.1f%% [%.1f%%, %.1f%%]  avgVP %.2f  (fair 25%%)",
				rs, tc.name, r.WinRate*100, r.CILow*100, r.CIHigh*100, r.AvgVP)
		}
	}
}
