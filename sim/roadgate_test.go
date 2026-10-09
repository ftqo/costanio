package sim

import (
	"testing"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/game"
)

// TestRoadGateAgainstPool tests the hand-written road gate on its own.
//
// bestPlay only considers roads when no open settlement spot is reachable and
// the network is still proportional to settlements (roads < buildings*2+2).
// That rule was set against clone ladders, which can't price racing a rival to
// a spot.
//
// The cloned build chooser has no such rule and imitates humans well (67.2%)
// but plays far worse (19.4% against 27.1%). Removing just the gate tests
// whether the roads humans build are worth anything, without the clone's other
// errors.
func TestRoadGateAgainstPool(t *testing.T) {
	skipLadderUnlessRequested(t)
	for _, tc := range []struct {
		name string
		opts []bot.Option
	}{
		{"gated", nil},
		{"ungated", []bot.Option{bot.WithUngatedRoads()}},
	} {
		for _, rs := range []string{"base", "base+cak"} {
			st := openStore(t)
			cs := append([]Contender{{Name: tc.name, New: func() game.CommandSource {
				return bot.NewStrong(tc.opts...)
			}}}, diversePool()...)
			l, err := Run(st, LadderOptions{
				Contenders: cs, Games: 4000, Players: 4, Ruleset: rs,
				Seed: 8_100_000, Workers: 12,
			})
			if err != nil {
				t.Fatal(err)
			}
			r := l.Results[0]
			t.Logf("ROADGATE %-9s %-9s %.1f%% [%.1f%%, %.1f%%]  avgVP %.2f",
				rs, tc.name, r.WinRate*100, r.CILow*100, r.CIHigh*100, r.AvgVP)
		}
	}
}
