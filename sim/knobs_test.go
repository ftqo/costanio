package sim

import (
	"testing"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/game"
)

// Ladders for `WithoutSimpleDefend` and `WithUngatedOffers`, the two options in
// bot/options.go that no ladder exercised. docs/bots.md requires
// `bot.WithoutSimpleDefend()` for any Knights weight study.

// TestSimpleDefendMasksTheKnightWeights: Strong inherits a hard-rule knight
// backstop from the baseline bot that recruits whenever bestPlay returns
// nothing. It masks the knight weights (zeroing cak_knight changes a quarter of
// decisions and not the win rate). This checks whether removing the backstop
// changes the bot at all; if it does, weight studies must use the option.
func TestSimpleDefendMasksTheKnightWeights(t *testing.T) {
	skipLadderUnlessRequested(t)
	st := openStore(t)
	l, err := Run(st, LadderOptions{
		Contenders: []Contender{
			{Name: "with backstop", New: func() game.CommandSource { return bot.NewStrong() }},
			{Name: "evaluator only", New: func() game.CommandSource { return bot.NewStrong(bot.WithoutSimpleDefend()) }},
		},
		Games: 2400, Players: 4, Ruleset: "base+cak", Seed: 4_700_000, Workers: 8,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Log("\n" + l.String())
	// Not asserting the backstop wins: an evaluator that made it redundant
	// would be better. The failure that matters is the shipped bot being
	// measurably worse than the arm weight studies use.
	if l.Beats("evaluator only", "with backstop") {
		t.Fatalf("shipped backstop is weaker than the control arm:\n%s", l)
	}
}

// TestGatedOffersBeatTheOverpay prices the gate on offerTrade's two-for-one. The
// gated version simulates the swap and keeps the largest quantity that still
// improves the bot's own position; the ungated one always gives two when it
// holds two. This backs the option doc's claim that ungated "measured negative
// against opponents that accept".
func TestGatedOffersBeatTheOverpay(t *testing.T) {
	skipLadderUnlessRequested(t)
	st := openStore(t)
	l, err := Run(st, LadderOptions{
		Contenders: []Contender{
			{Name: "gated", New: func() game.CommandSource { return bot.NewStrong() }},
			{Name: "ungated overpay", New: func() game.CommandSource { return bot.NewStrong(bot.WithUngatedOffers()) }},
		},
		Games: 2400, Players: 4, Ruleset: "base", Seed: 4_900_000, Workers: 8,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Log("\n" + l.String())
	if l.Beats("ungated overpay", "gated") {
		t.Fatalf("the gate weakened the bot:\n%s", l)
	}
}
