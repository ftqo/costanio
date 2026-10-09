package sim

import (
	"testing"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/game"
)

func strongWith(w bot.Weights) func() game.CommandSource {
	return func() game.CommandSource { return bot.NewStrong(bot.WithWeights(w)) }
}

// TestLadderSeparatesUnequalContenders is the ladder's own sanity check: Strong
// versus the greedy Simple baseline, the largest strength gap available. If the
// ladder can't separate those, nothing it reports can be trusted.
//
// Not calibrated on a crippled weight vector: zeroing VP and VPRush only moved
// Strong from 54% to 46%, because winningMove bypasses the evaluator when a win
// is available and the production terms correlate with scoring anyway.
func TestLadderSeparatesUnequalContenders(t *testing.T) {
	skipLadderUnlessRequested(t)
	skipLadderUnderRace(t)
	st := openStore(t)
	l, err := Run(st, LadderOptions{
		Contenders: []Contender{
			{Name: "strong", New: strongWith(bot.DefaultWeights())},
			{Name: "simple", New: func() game.CommandSource { return bot.NewSimple() }},
		},
		Games: 120, Players: 4, Seed: 7000, Workers: 8,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Log("\n" + l.String())
	if !l.Beats("strong", "simple") {
		t.Fatalf("ladder could not separate Strong from the Simple baseline:\n%s", l)
	}
}

// TestEvalFeaturesABLadder measures the two evaluation features added on top of
// the hand-tuned baseline (robber denial and road reachability) against the
// vector that zeroes them, which reproduces the previous evaluator exactly.
//
// It only asserts the new vector does not lose: at 400 games the Wilson
// interval is roughly +/-5 points, so a 2-point edge is invisible. The real
// measurement is the -ladder.games run in docs/bots.md.
func TestEvalFeaturesABLadder(t *testing.T) {
	skipLadderUnlessRequested(t)
	skipLadderUnderRace(t)
	skipUnlessSlow(t, "ladder A/B is slow")
	st := openStore(t)
	l, err := Run(st, LadderOptions{
		Contenders: []Contender{
			{Name: "current", New: strongWith(bot.DefaultWeights())},
			{Name: "legacy", New: strongWith(bot.BaselineWeights())},
		},
		Games: 400, Players: 4, Seed: 4200, Workers: 8,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Log("\n" + l.String())
	if l.Beats("legacy", "current") {
		t.Fatalf("robber-denial + reachability weakened the bot:\n%s", l)
	}
}
