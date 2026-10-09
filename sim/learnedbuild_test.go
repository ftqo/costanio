package sim

import (
	"testing"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/game"
)

// TestLearnedBuildAgainstPool decides whether cloning what humans build, and
// when they stop, plays better than scoring builds through the evaluator.
//
// It reproduces a strong player's choice 67.2% of the time (mean 7.6 legal
// options) against 48.6% for "take the most production". The network has no
// hand-written road gate, and treats ending the turn as a real candidate where
// a greedy evaluator spends whenever spending scores positively.
func TestLearnedBuildAgainstPool(t *testing.T) {
	skipLadderUnlessRequested(t)
	for _, tc := range []struct {
		name string
		new  func() game.CommandSource
	}{
		{"evaluator", func() game.CommandSource { return bot.NewStrong() }},
		{"cloned-build", func() game.CommandSource { return bot.NewStrong(bot.WithLearnedBuild()) }},
	} {
		for _, rs := range []string{"base", "base+cak"} {
			st := openStore(t)
			cs := append([]Contender{{Name: tc.name, New: tc.new}}, diversePool()...)
			l, err := Run(st, LadderOptions{
				Contenders: cs, Games: 4000, Players: 4, Ruleset: rs,
				Seed: 2_200_000, Workers: 12,
			})
			if err != nil {
				t.Fatal(err)
			}
			r := l.Results[0]
			t.Logf("BUILD %-9s %-14s %.1f%% [%.1f%%, %.1f%%]  avgVP %.2f  (fair 25%%)",
				rs, tc.name, r.WinRate*100, r.CILow*100, r.CIHigh*100, r.AvgVP)
		}
	}
}
