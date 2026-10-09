package bot

import (
	"reflect"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/knights"
	"github.com/ftqo/costan.io/engine/raiders"
	"github.com/ftqo/costan.io/engine/rivers"
	"github.com/ftqo/costan.io/engine/wagons"
)

func tradeScenario(t *testing.T, ruleset string) *engine.State {
	t.Helper()
	evs, err := engine.New(engine.GameConfig{Players: 4, Ruleset: ruleset}, engine.SeedsFrom(19))
	if err != nil {
		t.Fatal(err)
	}
	s, err := engine.Replay(evs)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; s.Phase != engine.PhasePlay; i++ {
		cmd, ok := engine.AutoCommand(s)
		if !ok || i > 100 {
			t.Fatal("setup did not finish")
		}
		if err := engine.DecideForEval(s, cmd); err != nil {
			t.Fatal(err)
		}
	}
	// Wagons begins on the first play batch, after the setup phase changes.
	if _, active := wagons.StateExt(s); active {
		for _, e := range (wagons.Wagons{}).Hooks().OnEvents(s, nil) {
			e.Seq = s.NextSeq
			if err := engine.Apply(s, e); err != nil {
				t.Fatal(err)
			}
		}
	}
	s.Cur, s.Rolled = 0, true
	return s
}

func TestTradePreviewSharedCurrency(t *testing.T) {
	s := tradeScenario(t, "base+cak+rivers+wagons")
	r, _ := rivers.StateExt(s)
	r.Coins[0], r.Coins[1] = 4, 0
	x, _ := knights.StateExt(s)
	x.Players[0].Commodities = knights.CommodityHand{knights.Cloth: 1}
	x.Players[1].Commodities = knights.CommodityHand{}
	s.Players[1].Hand = engine.Hand{board.Wood: 1}
	s.ActiveOffer = &engine.TradeOffer{By: 0, GiveCom: raw2(map[string]any{
		"coins": 3, "commodities": []int{1, 0, 0},
	}), Want: engine.Hand{board.Wood: 1}}
	seq := s.NextSeq
	after, ok := previewTradeResponse(s, 1)
	if !ok {
		t.Fatal("affordable mixed trade was refused")
	}
	ar, _ := rivers.StateExt(after)
	ax, _ := knights.StateExt(after)
	if ar.Coins[0] != 1 || ar.Coins[1] != 3 || wagons.Gold(after, 1) != 3 ||
		ax.Players[0].Commodities[knights.Cloth] != 0 || ax.Players[1].Commodities[knights.Cloth] != 1 ||
		after.Players[1].Hand[board.Wood] != 0 {
		t.Fatalf("preview coins=%v wagon=%d commodities=%v/%v hand=%v", ar.Coins, wagons.Gold(after, 1), ax.Players[0].Commodities, ax.Players[1].Commodities, after.Players[1].Hand)
	}
	if s.NextSeq != seq || r.Coins[0] != 4 || r.Coins[1] != 0 ||
		x.Players[0].Commodities[knights.Cloth] != 1 || x.Players[1].Commodities[knights.Cloth] != 0 ||
		s.Players[1].Hand[board.Wood] != 1 {
		t.Fatal("preview mutated the live game")
	}
	s.ActiveOffer.WantCom = raw2([]int{1, 0, 0})
	if _, ok := previewTradeResponse(s, 1); ok {
		t.Fatal("preview paid a commodity with a card from the same trade")
	}
}

func TestBotsPriceCurrencyAndPayment(t *testing.T) {
	for _, tc := range []struct{ ruleset, key string }{
		{"base+rivers", "coins"}, {"base+wagons", "gold"},
		{"base+raiders", "gold"}, {"base+rivers+wagons", "coins"},
		{"base+raiders+wagons", "wagon_gold"},
	} {
		t.Run(tc.ruleset, func(t *testing.T) {
			s := tradeScenario(t, tc.ruleset)
			if x, ok := rivers.StateExt(s); ok {
				for p := range x.Coins {
					x.Coins[p] = 20
				}
			}
			if x, ok := raiders.StateExt(s); ok {
				x.Gold[1] = 20
			}
			if x, ok := wagons.StateExt(s); ok {
				x.Gold[1] = 20
			}
			s.Players[1].Hand = engine.Hand{}
			s.ActiveOffer = &engine.TradeOffer{By: 0, Give: engine.Hand{board.Ore: 1},
				WantCom: raw2(map[string]int{tc.key: 20})}
			for _, threshold := range []float64{0, 0.01} {
				b := NewStrong()
				b.acceptThreshold = threshold
				// The learned resource-only policy must not bypass currency pricing.
				cmd, ok := b.respond(s, 1)
				if ok && cmd.Type == engine.CmdRespondTrade {
					t.Fatal("gave away entire purse for one card")
				}
			}
			if cmd, ok := simpleRespond(s, 1); ok && cmd.Type == engine.CmdRespondTrade {
				t.Fatal("Simple ignored the currency stake")
			}
			s.ActiveOffer.WantCom = raw2(map[string]int{tc.key: 21})
			if _, ok := previewTradeResponse(s, 1); ok {
				t.Fatal("preview accepted unaffordable payment")
			}
			// A gift of currency should be accepted, including when the offerer's
			// hidden resource cards are changed. Only the advertised stake matters.
			s.ActiveOffer.Give, s.ActiveOffer.WantCom = engine.Hand{}, nil
			s.ActiveOffer.GiveCom = raw2(map[string]int{tc.key: 2})
			a, aok := NewStrong().respond(s, 1)
			s.Players[0].Hand = engine.Hand{board.Ore: 19}
			s.Players[0].DevCards[engine.DevVictoryPoint] = 5
			b, bok := NewStrong().respond(s, 1)
			if !aok || a.Type != engine.CmdRespondTrade || aok != bok || !reflect.DeepEqual(a, b) {
				t.Fatal("currency gift refused, or response depended on hidden cards")
			}
		})
	}
}
