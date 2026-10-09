package sim

import (
	"testing"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/game"
)

// TestInformationRulesCost prices the rule that the bot may not read hidden
// state. It only measures: the rule holds regardless, but its cost is recorded
// so it stays visible.
func TestInformationRulesCost(t *testing.T) {
	skipLadderUnlessRequested(t)
	skipLadderUnderRace(t)
	skipUnlessSlow(t, "plays hundreds of games")
	st := openStore(t)
	l, err := Run(st, LadderOptions{
		Contenders: []Contender{
			{Name: "reads hidden state", New: func() game.CommandSource { return bot.NewStrong(bot.WithHiddenInfo()) }},
			{Name: "public info only (shipped)", New: func() game.CommandSource { return bot.NewStrong() }},
		},
		Games: 1200, Players: 4, Seed: 7_700_000, Workers: 8,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Log("\n" + l.String())
}
