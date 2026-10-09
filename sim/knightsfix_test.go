package sim

import (
	"testing"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/game"
)

// TestPendingMetropolisCredited prices crediting a metropolis that has been
// earned but not yet placed (55% of grants). Uncredited, the level-4
// improvement that earns it looks worth ~1 positional point instead of 2 VP.
func TestPendingMetropolisCredited(t *testing.T) {
	skipLadderUnlessRequested(t)
	st := openStore(t)
	l, err := Run(st, LadderOptions{
		Contenders: []Contender{
			{Name: "credits pending", New: func() game.CommandSource { return bot.NewStrong() }},
			{Name: "blind to pending", New: func() game.CommandSource { return bot.NewStrong(bot.WithoutPendingMetropolis()) }},
		},
		Games: 2400, Players: 4, Ruleset: "base+cak", Seed: 6_200_000, Workers: 8,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Log("\n" + l.String())
	if l.Beats("blind to pending", "credits pending") {
		t.Fatalf("crediting the pending metropolis weakened the bot:\n%s", l)
	}
}

// TestAqueductPolicy prices choosing the Aqueduct's free resource rather than
// letting the engine's auto-pass take whatever the bank holds most of.
func TestAqueductPolicy(t *testing.T) {
	skipLadderUnlessRequested(t)
	st := openStore(t)
	l, err := Run(st, LadderOptions{
		Contenders: []Contender{
			{Name: "chooses", New: func() game.CommandSource { return bot.NewStrong() }},
			{Name: "auto-pass", New: func() game.CommandSource { return bot.NewStrong(bot.WithoutAqueductPolicy()) }},
		},
		Games: 2400, Players: 4, Ruleset: "base+cak", Seed: 3_600_000, Workers: 8,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Log("\n" + l.String())
	if l.Beats("auto-pass", "chooses") {
		t.Fatalf("choosing the aqueduct resource weakened the bot:\n%s", l)
	}
}
