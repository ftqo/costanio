package sim

import (
	"testing"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/game"
)

// TestProgressCardUtilisation tracks how much of the Knights progress deck the
// bot uses. Before most cards had candidate generators it drew 62.86 cards per
// game, played 19.97 (32%) and discarded 27.53 at the hand limit.
func TestProgressCardUtilisation(t *testing.T) {
	skipUnlessSlow(t, "plays hundreds of games")
	st := openStore(t)
	drawn, played, discarded, games := 0, 0, 0, 0
	for seed := uint64(1); seed <= 150; seed++ {
		res, err := RunGame(st, Options{
			Players: 4, Ruleset: "base+cak", Seed: seed,
			Bots: func(engine.PlayerID) game.CommandSource { return bot.NewStrong() },
		})
		if err != nil {
			continue
		}
		games++
		events, err := Transcript(st, res.GameID)
		if err != nil {
			t.Fatal(err)
		}
		for _, e := range events {
			switch string(e.Type) {
			case "cak_progress_drawn":
				drawn++
			case "cak_progress_played":
				played++
			case "cak_progress_discarded":
				discarded++
			}
		}
	}
	t.Logf("%d games: %.2f drawn, %.2f played (%.0f%%), %.2f discarded per game",
		games, float64(drawn)/float64(games), float64(played)/float64(games),
		100*float64(played)/float64(drawn), float64(discarded)/float64(games))
}

// TestProgressBatch3Wins prices the final batch of progress cards (Alchemist,
// Bishop, Spy, Master Merchant, Commercial Harbor, Merchant Fleet) by ablating
// WithoutProgressBatch3.
func TestProgressBatch3Wins(t *testing.T) {
	skipLadderUnlessRequested(t)
	st := openStore(t)
	l, err := Run(st, LadderOptions{
		Contenders: []Contender{
			{Name: "all cards", New: func() game.CommandSource { return bot.NewStrong() }},
			{Name: "without batch 3", New: func() game.CommandSource { return bot.NewStrong(bot.WithoutProgressBatch3()) }},
		},
		Games: 2400, Players: 4, Ruleset: "base+cak", Seed: 4_100_000, Workers: 8,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Log("\n" + l.String())
	if l.Beats("without batch 3", "all cards") {
		t.Fatalf("playing them weakened the bot:\n%s", l)
	}
}

// TestProgressBatch2Wins prices the second batch of Knights progress cards
// (Saboteur, Deserter, Intrigue, Diplomat, Inventor) against the set the bot
// had before them, via `bot.WithoutProgressBatch2`.
func TestProgressBatch2Wins(t *testing.T) {
	skipLadderUnlessRequested(t)
	st := openStore(t)
	l, err := Run(st, LadderOptions{
		Contenders: []Contender{
			{Name: "all cards", New: func() game.CommandSource { return bot.NewStrong() }},
			{Name: "without batch 2", New: func() game.CommandSource { return bot.NewStrong(bot.WithoutProgressBatch2()) }},
		},
		Games: 2400, Players: 4, Ruleset: "base+cak", Seed: 4_300_000, Workers: 8,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Log("\n" + l.String())
	if l.Beats("without batch 2", "all cards") {
		t.Fatalf("playing them weakened the bot:\n%s", l)
	}
}

// TestFreeProgressPlaysWin prices the progress cards whose effect resolves
// through a pending (Wedding, Road Building). They are rule-played rather than
// scored because a one-step evaluator sees a pending as no change and never
// picks them; this measures whether that special case wins games.
func TestFreeProgressPlaysWin(t *testing.T) {
	skipLadderUnlessRequested(t)
	st := openStore(t)
	l, err := Run(st, LadderOptions{
		Contenders: []Contender{
			{Name: "plays them", New: func() game.CommandSource { return bot.NewStrong() }},
			{Name: "holds them", New: func() game.CommandSource { return bot.NewStrong(bot.WithoutFreeProgressPlays()) }},
		},
		Games: 2400, Players: 4, Ruleset: "base+cak", Seed: 4_500_000, Workers: 8,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Log("\n" + l.String())
	if l.Beats("holds them", "plays them") {
		t.Fatalf("rule-playing the pending cards weakened the bot:\n%s", l)
	}
}
