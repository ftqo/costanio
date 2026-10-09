package sim

import (
	"testing"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/game"
)

// TestRoadOpensAgainstPool re-tests the opening-road scorer against opponents
// that differ.
//
// setupRoad leads with the pips of the vertex the road runs into, which the
// distance rule makes unbuildable. Scoring only what the road opens measured
// 49.9% [48.6, 51.3] over 5000 games, but against clones, which can't price
// reaching a spot before a rival.
//
// Human games disagree: "point at the richest far corner" is the worst
// opening-road heuristic measured (0.213 top-1, below random's 0.348), while
// "point toward open space" gets 0.490.
func TestRoadOpensAgainstPool(t *testing.T) {
	skipLadderUnlessRequested(t)
	for _, tc := range []struct {
		name string
		opts []bot.Option
	}{
		{"runs-into", nil},
		{"opens", []bot.Option{bot.WithRoadOpens()}},
	} {
		for _, rs := range []string{"base", "base+cak"} {
			st := openStore(t)
			cs := append([]Contender{{Name: tc.name, New: func() game.CommandSource {
				return bot.NewStrong(tc.opts...)
			}}}, diversePool()...)
			l, err := Run(st, LadderOptions{
				Contenders: cs, Games: 5000, Players: 4, Ruleset: rs,
				Seed: 4_700_000, Workers: 10,
			})
			if err != nil {
				t.Fatal(err)
			}
			r := l.Results[0]
			t.Logf("ROADOPENS %-9s %-10s %.1f%% [%.1f%%, %.1f%%]  avgVP %.2f",
				rs, tc.name, r.WinRate*100, r.CILow*100, r.CIHigh*100, r.AvgVP)
		}
	}
}
