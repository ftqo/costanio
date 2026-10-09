package sim

import (
	"testing"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/game"
	"github.com/ftqo/costan.io/store"
)

// TestTradeRatesAgainstHumanBaseline compares bot trade rates with a recorded
// human baseline. Self-play can't evaluate trading: bots that all under-trade
// agree with each other, and a ladder only ranks bots against each other.
//
// 1424 human games (4 players, base, >=20 turns) against 40 bot games:
//
//	                        humans      bot
//	turns per game            74.8      81.5
//	player offers per turn    0.47      0.07     6.7x fewer
//	trades executed per turn  0.09      0.04     2.2x fewer
//	bank trades per turn      0.24      0.31     1.3x more
//	offer -> accept rate     19.1%     49.4%
//	games with a player trade 99.2%
//
// The bot barely offers and trades at the bank instead, at a worse price than
// an agreed player trade. Its high acceptance rate means its offers are too
// generous.
//
// Logs rather than asserts: a threshold would pin today's numbers, and "trade
// more" is a strength hypothesis only a ladder can settle. See docs/bots.md.
func TestTradeRatesAgainstHumanBaseline(t *testing.T) {
	skipUnlessSlow(t, "plays 40 games to measure trade rates")
	const games = 40
	var offers, executed, bank, turns, played int
	for seed := uint64(1); seed <= games; seed++ {
		st, err := store.OpenMem()
		if err != nil {
			t.Fatal(err)
		}
		res, err := RunGame(st, Options{
			Players: 4, Ruleset: "base", Seed: seed, DiceMode: "random", BoardMode: "fair",
			Bots: func(engine.PlayerID) game.CommandSource { return bot.NewStrong() },
		})
		if err != nil {
			st.Close()
			continue
		}
		evs, err := st.LoadEvents(res.GameID, 0)
		if err != nil {
			st.Close()
			t.Fatal(err)
		}
		played++
		for _, e := range evs {
			// A tagged switch with a default satisfies both linters: staticcheck
			// rewrites untagged forms to this, and `exhaustive` accepts a default.
			switch e.Type {
			case engine.EvTradeOffered:
				offers++
			case engine.EvTradeExecuted:
				executed++
			case engine.EvBankTraded:
				bank++
			case engine.EvTurnEnded:
				turns++
			default:
			}
		}
		st.Close()
	}
	f := float64(played)
	t.Logf("HUMAN baseline (1424 games): turns 74.8  offers/turn 0.47  executed/turn 0.09  bank/turn 0.24  accept 19.1%%")
	t.Logf("bot games %d: turns/game %.1f  offers/game %.1f (%.2f/turn)  executed/game %.1f (%.2f/turn)  bank/game %.1f (%.2f/turn)",
		played, float64(turns)/f, float64(offers)/f, float64(offers)/float64(turns),
		float64(executed)/f, float64(executed)/float64(turns), float64(bank)/f, float64(bank)/float64(turns))
	if offers > 0 {
		t.Logf("offer->executed rate %.1f%%", 100*float64(executed)/float64(offers))
	}
}
