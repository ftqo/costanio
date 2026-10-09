package sim

import (
	"testing"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/game"
)

// TestLearnedSetupRoadAgainstPool decides whether cloning the opening road plays
// better, alongside the shipped settlement clone.
//
// It reproduces a strong player's road 67.0% of the time from 2-3 candidates,
// against 46.8% for the best heuristic (point toward open space) and 33.5% for
// random. Our scorer leads with the pips of the vertex the road runs into, the
// worst heuristic measured on human games (0.232, below random), naming a
// corner the distance rule makes unbuildable.
//
// One-shot from a fixed candidate set, so errors shouldn't compound as in
// build choice (19.4% against the evaluator's 27.1%).
func TestLearnedSetupRoadAgainstPool(t *testing.T) {
	skipLadderUnlessRequested(t)
	for _, tc := range []struct {
		name string
		opts []bot.Option
	}{
		{"hand-road", nil},
		{"cloned-road", []bot.Option{bot.WithLearnedSetupRoad()}},
	} {
		for _, rs := range []string{"base", "base+cak"} {
			st := openStore(t)
			cs := append([]Contender{{Name: tc.name, New: func() game.CommandSource {
				return bot.NewStrong(tc.opts...)
			}}}, diversePool()...)
			l, err := Run(st, LadderOptions{
				Contenders: cs, Games: 5000, Players: 4, Ruleset: rs,
				Seed: 3_900_000, Workers: 10,
			})
			if err != nil {
				t.Fatal(err)
			}
			r := l.Results[0]
			t.Logf("SETUPROAD %-9s %-12s %.1f%% [%.1f%%, %.1f%%]  avgVP %.2f",
				rs, tc.name, r.WinRate*100, r.CILow*100, r.CIHigh*100, r.AvgVP)
		}
	}
}
