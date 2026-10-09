package sim

import (
	"testing"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/game"
)

// TestLearnedTermAgainstPool prices the learned win-probability term.
//
// Unlike the other clones it affects every decision, because it enters eval.
// It costs +14% per game end to end (99ms to 113ms), inside the 40% budget.
//
// The model predicts an outcome while the evaluator chooses a move, and three
// hypotheses read off its coefficients have already failed on this ladder.
func TestLearnedTermAgainstPool(t *testing.T) {
	skipLadderUnlessRequested(t)
	base := bot.DefaultWeights()
	for _, rs := range []string{"base", "base+cak"} {
		for _, lw := range []float64{0, 1, 3, 10} {
			w := base
			w.Learned = lw
			st := openStore(t)
			cs := append([]Contender{{Name: "candidate", New: func() game.CommandSource {
				return bot.NewStrong(bot.WithWeights(w))
			}}}, diversePool()...)
			l, err := Run(st, LadderOptions{
				Contenders: cs, Games: 4000, Players: 4, Ruleset: rs,
				Seed: 5_100_000, Workers: 10,
			})
			if err != nil {
				t.Fatal(err)
			}
			r := l.Results[0]
			t.Logf("LEARNED %-9s w=%-5.1f %.1f%% [%.1f%%, %.1f%%]  avgVP %.2f",
				rs, lw, r.WinRate*100, r.CILow*100, r.CIHigh*100, r.AvgVP)
		}
	}
}
