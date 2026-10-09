package sim

import (
	"testing"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/game"
)

// TestLearnedPlacementAgainstPool decides whether cloning human openings plays
// better or only agrees with humans more.
//
// The network matches a strong human's exact corner 50.7% of the time (out of
// ~41 legal options) against about 36% for the hand-written scorer, and changes
// the first placement on 20% of boards. Agreement isn't a win rate, so this
// measures one, against the pool rather than clones, because taking a spot
// before a rival only has value against different opponents.
func TestLearnedPlacementAgainstPool(t *testing.T) {
	skipLadderUnlessRequested(t)
	for _, tc := range []struct {
		name string
		new  func() game.CommandSource
	}{
		{"hand-written", func() game.CommandSource { return bot.NewStrong(bot.WithHandPlacement()) }},
		{"cloned", func() game.CommandSource { return bot.NewStrong() }},
	} {
		for _, rs := range []string{"base", "base+cak"} {
			st := openStore(t)
			cs := append([]Contender{{Name: tc.name, New: tc.new}}, diversePool()...)
			l, err := Run(st, LadderOptions{
				Contenders: cs, Games: 4000, Players: 4, Ruleset: rs,
				Seed: 6_600_000, Workers: 12,
			})
			if err != nil {
				t.Fatal(err)
			}
			r := l.Results[0]
			t.Logf("PLACE %-9s %-14s %.1f%% [%.1f%%, %.1f%%]  avgVP %.2f  (fair 25%%)",
				rs, tc.name, r.WinRate*100, r.CILow*100, r.CIHigh*100, r.AvgVP)
		}
	}
}
