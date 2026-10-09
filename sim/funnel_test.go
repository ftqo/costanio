package sim

import (
	"testing"

	"time"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/game"
)

// TestOfferFunnel counts trade events from the event log rather than from bot
// instrumentation, so it can't miss a path.
//
// It documents a known defect: about 6.83 offers a game get 0.07 responses,
// because runOfferResponses only runs on the actor's timer tick (game/actor.go)
// while a new offer replaces the single State.ActiveOffer. It only logs for
// now; once fixed it should assert a response rate proportional to offers.
func TestOfferFunnel(t *testing.T) {
	st := openStore(t)
	tracked := map[engine.EventType]bool{
		engine.EvTradeOffered: true, engine.EvTradeResponded: true,
		engine.EvTradeCountered: true, engine.EvTradeExecuted: true,
		engine.EvTradeCancelled: true, engine.EvBankTraded: true,
	}
	games := 30
	for di, delay := range []time.Duration{0, 20 * time.Microsecond, 2 * time.Millisecond} {
		counts := map[engine.EventType]int{}
		for i := range games {
			res, err := RunGame(st, Options{
				Players: 4, Ruleset: "base", Seed: uint64(5000 + i + di*100000), BotDelay: delay,
				Timeout: 120 * time.Second,
				Bots: func(p engine.PlayerID) game.CommandSource {
					if p == 0 {
						return bot.NewStrong()
					}
					w := bot.DefaultWeights()
					w.Expansion *= 2
					return bot.NewStrong(bot.WithWeights(w))
				},
			})
			if err != nil {
				t.Fatal(err)
			}
			evs, err := Transcript(st, res.GameID)
			if err != nil {
				t.Fatal(err)
			}
			for _, e := range evs {
				if tracked[e.Type] {
					counts[e.Type]++
				}
			}
		}
		t.Logf("--- botDelay %v", delay)
		for _, k := range []engine.EventType{engine.EvTradeOffered, engine.EvTradeResponded,
			engine.EvTradeCountered, engine.EvTradeExecuted} {
			t.Logf("  %-20v %6d  (%.2f/game)", k, counts[k], float64(counts[k])/float64(games))
		}
	}
}
