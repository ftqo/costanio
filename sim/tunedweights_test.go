package sim

import (
	"testing"

	"github.com/ftqo/costan.io/bot"
)

// TestTunedWeightsBeatHandSet validates the reach/opp retune through the real
// stack, on a seed base neither weight study searched on. Sweep results are
// only trusted once they hold on held-out seeds under sim.Run; two earlier
// candidates turned out to be artifacts of a since-fixed dev-card bug.
func TestTunedWeightsBeatHandSet(t *testing.T) {
	skipLadderUnlessRequested(t)
	skipLadderUnderRace(t)
	skipUnlessSlow(t, "plays hundreds of games")
	st := openStore(t)
	handSet := bot.DefaultWeights()
	handSet.Reach = 0.8 // the original hand-set values
	handSet.Opp = 0.6

	l, err := Run(st, LadderOptions{
		Contenders: []Contender{
			{Name: "tuned", New: strongWith(bot.DefaultWeights())},
			{Name: "hand-set", New: strongWith(handSet)},
		},
		Games: 1200, Players: 4, Seed: 8_800_000, Workers: 8,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Log("\n" + l.String())
	if l.Beats("hand-set", "tuned") {
		t.Fatalf("retuned weights lose:\n%s", l)
	}
}
