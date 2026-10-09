package sim

import (
	"testing"
	"time"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/game"
)

// TestLearnedTermGameCost measures what the learned value term costs a whole
// game, which is the number the latency budget is about. eval is only part of a
// move's work, so a 2.3x eval is not a 2.3x bot.
func TestLearnedTermGameCost(t *testing.T) {
	for _, learned := range []float64{0, 1} {
		w := bot.DefaultWeights()
		w.Learned = learned
		st := openStore(t)
		start := time.Now()
		n := 12
		for i := range n {
			if _, err := RunGame(st, Options{
				Players: 4, Ruleset: "base", Seed: uint64(90000 + i + int(learned)*1000),
				Bots: func(engine.PlayerID) game.CommandSource {
					return bot.NewStrong(bot.WithWeights(w))
				},
			}); err != nil {
				t.Fatal(err)
			}
		}
		t.Logf("Learned=%.0f  %v for %d games  (%.0fms/game)",
			learned, time.Since(start).Round(time.Millisecond), n,
			float64(time.Since(start).Milliseconds())/float64(n))
	}
}
