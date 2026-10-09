package sim

import (
	"testing"

	"github.com/ftqo/costan.io/bot"
)

// TestDevWeightZeroBeatsHolding validates, through the real stack, that dropping
// the blanket development-card holding bonus is an improvement.
//
//   - The seed base differs from the one the weight study searched on, so a
//     vector can't win by suiting one board sequence.
//   - It runs on sim.Run (manager, actor, store) rather than the headless
//     training loop, so it measures the bot that ships.
func TestDevWeightZeroBeatsHolding(t *testing.T) {
	skipLadderUnlessRequested(t)
	skipLadderUnderRace(t)
	skipUnlessSlow(t, "plays hundreds of games")
	st := openStore(t)
	held := bot.DefaultWeights()
	held.Dev = 2.5 // the value that shipped before measurement contradicted it

	l, err := Run(st, LadderOptions{
		Contenders: []Contender{
			{Name: "dev-0", New: strongWith(bot.DefaultWeights())},
			{Name: "dev-2.5", New: strongWith(held)},
		},
		Games: 600, Players: 4, Seed: 5_500_000, Workers: 8,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Log("\n" + l.String())
	if l.Beats("dev-2.5", "dev-0") {
		t.Fatalf("zeroing the dev weight weakened the bot:\n%s", l)
	}
	if !l.Beats("dev-0", "dev-2.5") {
		t.Logf("no significant separation at %d games", l.Played)
	}
}
