package sim

import (
	"encoding/json"
	"testing"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/game"
)

// TestNoDeckPeek: engine.decideBuyDevCard resolves the draw from the seed and
// log position, so code that scores a purchase by simulating it conditions on
// the actual card. When bestPlay did that, VP cards were 21.6% [20.7, 22.5] of
// the bot's purchases against a 20% deck share. A failure means something is
// simulating the buy again.
func TestNoDeckPeek(t *testing.T) {
	skipUnlessSlow(t, "plays hundreds of games")
	st := openStore(t)
	bought, vp := 0, 0
	for seed := uint64(1); seed <= 250; seed++ {
		res, err := RunGame(st, Options{
			Players: 4, Ruleset: "base", Seed: seed,
			Bots: func(engine.PlayerID) game.CommandSource { return bot.NewStrong() },
		})
		if err != nil {
			continue
		}
		events, err := Transcript(st, res.GameID)
		if err != nil {
			t.Fatal(err)
		}
		for _, e := range events {
			if e.Type != engine.EvDevCardBought {
				continue
			}
			var d engine.DevCardBoughtData
			if json.Unmarshal(e.Data, &d) != nil {
				continue
			}
			bought++
			if d.Card == engine.DevVictoryPoint {
				vp++
			}
		}
	}
	if bought < 200 {
		t.Fatalf("only %d dev-card purchases across the sweep", bought)
	}
	share := float64(vp) / float64(bought)
	lo := wilsonLow(vp, bought)
	t.Logf("purchases %d, victory-point cards %d (%.1f%%); deck share is 20%%", bought, vp, share*100)
	if lo > 0.20 {
		t.Errorf("VP cards are %.1f%% of purchases (95%% lower bound %.1f%%), above the 20%% deck share",
			share*100, lo*100)
	}
}

func wilsonLow(k, n int) float64 { lo, _ := wilson(k, n); return lo }
