package sim

import (
	"testing"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/game"
)

// TestTradeEngagement measures player-to-player trading through the real stack.
// It cannot be measured on the headless fast path: offer responses are driven by
// the actor's runOfferResponses, not by engine.PendingDeciders, so a fast-path
// playout shows offers made and none ever answered.
func TestTradeEngagement(t *testing.T) {
	skipUnlessSlow(t, "plays hundreds of games")
	for _, tc := range []struct {
		name string
		opts []bot.Option
	}{
		{"trading on (shipped)", nil},
		{"trading off", []bot.Option{bot.WithoutPlayerTrades()}},
	} {
		st := openStore(t)
		var offered, executed, games int
		for seed := uint64(1); seed <= 150; seed++ {
			res, err := RunGame(st, Options{
				Players: 4, Ruleset: "base", Seed: seed,
				Bots: func(engine.PlayerID) game.CommandSource { return bot.NewStrong(tc.opts...) },
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
				switch e.Type {
				case engine.EvTradeOffered:
					offered++
				case engine.EvTradeExecuted:
					executed++
				default:
					// a tally, not a dispatch: every other event type is uncounted
				}
			}
		}
		t.Logf("%-22s offers %.2f/game, settled %.2f/game  (strong humans ~42 offers)",
			tc.name, float64(offered)/float64(games), float64(executed)/float64(games))
	}
}

// TestTradingWins prices player-to-player trading end to end.
func TestTradingWins(t *testing.T) {
	skipLadderUnlessRequested(t)
	st := openStore(t)
	l, err := Run(st, LadderOptions{
		Contenders: []Contender{
			{Name: "trades", New: func() game.CommandSource { return bot.NewStrong() }},
			{Name: "no trades", New: func() game.CommandSource { return bot.NewStrong(bot.WithoutPlayerTrades()) }},
		},
		Games: 2400, Players: 4, Seed: 3_900_000, Workers: 12,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Log("\n" + l.String())
}
