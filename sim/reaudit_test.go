package sim

import (
	"testing"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/game"
)

// TestReauditAgainstPool re-runs conclusions that were decided on a clone
// ladder but depend on the opponent.
//
// Against clones, contesting a title, blocking, racing and expanding before a
// rival are zero-sum and read ~50% at any strength. Expansion was flat against
// clones and worth +1.9 on Knights against the pool.
//
// Each row is a candidate against diversePool, fair share 25%. A row that beats
// the x1 baseline outside its interval should be replicated on a fresh seed
// before shipping (see TestExpansionConfirm).
func TestReauditAgainstPool(t *testing.T) {
	skipLadderUnlessRequested(t)
	base := bot.DefaultWeights()

	army4 := base
	army4.Army = base.Army * 4
	army16 := base
	army16.Army = base.Army * 16
	opp4 := base
	opp4.Opp = base.Opp * 4

	rows := []struct {
		name string
		opts []bot.Option
	}{
		{"baseline", nil},
		// Largest Army: humans hold it in 56.7% of wins, this bot in 40.8%. It
		// measured inert at four scales against clones, which can't price a
		// contested title.
		{"army x4", []bot.Option{bot.WithWeights(army4)}},
		{"army x16", []bot.Option{bot.WithWeights(army16)}},
		// Opponent awareness only matters against players unlike you, so clones
		// can't measure it.
		{"opp x4", []bot.Option{bot.WithWeights(opp4)}},
		// Longest Road chasing: contested title, same blindness as army.
		{"lr chase", []bot.Option{bot.WithLongestRoad()}},
	}

	for _, rs := range []string{"base", "base+cak"} {
		for _, r := range rows {
			st := openStore(t)
			cs := append([]Contender{{Name: r.name, New: func() game.CommandSource {
				return bot.NewStrong(r.opts...)
			}}}, diversePool()...)
			l, err := Run(st, LadderOptions{
				Contenders: cs, Games: 3000, Players: 4, Ruleset: rs,
				Seed: 4_200_000, Workers: 12,
			})
			if err != nil {
				t.Fatal(err)
			}
			res := l.Results[0]
			t.Logf("REAUDIT %-9s %-10s %.1f%% [%.1f%%, %.1f%%]  avgVP %.2f",
				rs, r.name, res.WinRate*100, res.CILow*100, res.CIHigh*100, res.AvgVP)
		}
	}
}
