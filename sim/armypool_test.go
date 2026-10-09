package sim

import (
	"testing"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/game"
)

// TestArmyAgainstPool re-tests Largest Army pricing against a diverse pool.
// Against clones it measured 50.1/50.4/49.2/50.8 at four scales, but clones
// can't price a contested title. Strong human winners hold Largest Army 56.7%
// of the time against this bot's 40.8%.
func TestArmyAgainstPool(t *testing.T) {
	skipLadderUnlessRequested(t)
	base := bot.DefaultWeights()
	for _, mult := range []float64{1, 4, 16} {
		w := base
		w.Army = base.Army * mult
		st := openStore(t)
		l, err := vsPool(st, "candidate", func() game.CommandSource { return bot.NewStrong(bot.WithWeights(w)) }, 2000, 5_400_000)
		if err != nil {
			t.Fatal(err)
		}
		r := l.Results[0]
		t.Logf("Army x%-3.0f  %.1f%% [%.1f%%, %.1f%%]  (fair share 25%%)", mult, r.WinRate*100, r.CILow*100, r.CIHigh*100)
	}
}
