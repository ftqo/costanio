package sim

import (
	"testing"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/game"
)

// TestLookaheadWins prices within-turn lookahead: re-scoring the strongest few
// candidates by the best position reachable one action later. One-step scoring
// prices a move by the position right after it, so a road that opens a
// settlement or a trade that completes a city reads as pure cost.
func TestLookaheadWins(t *testing.T) {
	skipLadderUnlessRequested(t)
	st := openStore(t)
	l, err := Run(st, LadderOptions{
		Contenders: []Contender{
			{Name: "lookahead (shipped)", New: func() game.CommandSource { return bot.NewStrong() }},
			{Name: "one-step", New: func() game.CommandSource { return bot.NewStrong(bot.WithLookahead(0, 0)) }},
		},
		Games: 3000, Players: 4, Seed: 2_900_000, Workers: 8,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Log("\n" + l.String())
	if l.Beats("one-step", "lookahead (shipped)") {
		t.Fatalf("lookahead weakened the bot:\n%s", l)
	}
}
