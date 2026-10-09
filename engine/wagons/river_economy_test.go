package wagons

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/knights"
	"github.com/ftqo/costan.io/engine/rivers"
)

func TestRiverCrossingPrices(t *testing.T) {
	s, x := opened(t, 4, "base+rivers+wagons")
	river, _ := rivers.StateExt(s)
	var site board.Edge
	for _, r := range river.Rivers {
		if len(r.Sites) > 0 {
			site = r.Sites[0]
			break
		}
	}
	if !site.Valid() {
		t.Fatal("fixture has no river crossing")
	}
	x.SharedCurrency = true
	x.Barb = [tradeHexCount]board.Edge{}
	p := s.Cur
	for _, tc := range []struct {
		name     string
		built    bool
		owner    engine.PlayerID
		mp, toll int
	}{
		{"ford", false, p, 3, 0}, {"own bridge", true, p, 1, 0}, {"foreign bridge", true, (p + 1) % 4, 1, 2},
	} {
		t.Run(tc.name, func(t *testing.T) {
			delete(river.Bridges, site)
			if tc.built {
				river.Bridges[site] = tc.owner
			}
			mp, toll, owner := price(s, x, p, step{E: site})
			if mp != tc.mp || toll != tc.toll || (toll > 0 && owner != tc.owner) {
				t.Fatalf("got %d MP, %d toll to %d", mp, toll, owner)
			}
		})
	}
}

func TestRiverWagonPurseAndPurchaseLimitAreShared(t *testing.T) {
	s, x := opened(t, 4, "base+rivers+wagons")
	x.SharedCurrency = true
	river, _ := rivers.StateExt(s)
	p := s.Cur
	river.Coins[p] = 8
	x.Gold[p] = 99 // the legacy purse differs on purpose
	do(t, s, cmd(p, CmdBuy, map[string]any{"res": "wood"}))
	if river.Coins[p] != 6 || Gold(s, p) != 6 || river.SpentThisTurn != 1 {
		t.Fatal("wagon purchase did not debit the shared purse")
	}
	do(t, s, cmd(p, rivers.CmdSpendCoins, map[string]any{"res": "brick"}))
	if river.Coins[p] != 4 || purchases(s, x) != 2 {
		t.Fatal("river purchase did not share the cap")
	}
	refuse(t, s, cmd(p, CmdBuy, map[string]any{"res": "wood"}), ErrGoldLimit)
	view := x.ComposeView(s, x.ViewExt(p)).(map[string]any)
	if view["gold"].([]int)[p] != 4 || view["bought"].(int) != 2 {
		t.Fatal("view is not the shared purse")
	}
	clone := s.Clone()
	changeGold(clone, ext(clone), p, -1)
	if Gold(s, p) != 4 || Gold(clone, p) != 3 {
		t.Fatal("cloned purses alias")
	}
}

func TestLegacyWagonStartRetainsSeparatePurse(t *testing.T) {
	s, x := opened(t, 4, "base+rivers+wagons")
	river, _ := rivers.StateExt(s)
	river.Coins[0] = 7
	fire(t, s, []engine.Event{engine.NewEvent(EvStart, startData{Gold: 3})})
	if x.SharedCurrency || x.Gold[0] != 3 || river.Coins[0] != 7 {
		t.Fatal("old start event changed meaning")
	}
	fire(t, s, []engine.Event{engine.NewEvent(EvStart, startData{Gold: 3, SharedCurrency: true})})
	if Gold(s, 0) != 10 {
		t.Fatal("new starting gold replaced setup earnings")
	}
}

func TestSharedPurseNoAliasOverspend(t *testing.T) {
	s, x := opened(t, 4, "base+rivers+wagons")
	x.SharedCurrency = true
	river, _ := rivers.StateExt(s)
	p := s.Cur
	river.Coins[p] = 3
	offer := map[string]any{"give_com": map[string]int{"coins": 2, "gold": 2}, "want": engine.Hand{board.Wood: 1}}
	if _, err := engine.Decide(s, cmd(p, engine.CmdOfferTrade, offer)); err == nil {
		t.Fatal("two aliases overspent one purse")
	}
	offer["give_com"] = map[string]int{"coins": 1, "gold": 2}
	do(t, s, cmd(p, engine.CmdOfferTrade, offer))
	if river.Coins[p] != 3 {
		t.Fatal("offer spent the purse before acceptance")
	}
}

func TestWagonTradeKeepsRaidersGold(t *testing.T) {
	s, x := opened(t, 4, "base+raiders+wagons")
	p := s.Cur
	x.Gold[p] = 3
	payload := raw(map[string]int{"wagon_gold": 2})
	if n, ok := (Wagons{}).tradeExtraHeld(s, p, payload); n != 2 || !ok {
		t.Fatal("wagon gold spelling missing")
	}
	fire(t, s, (Wagons{}).tradeExtraEvents(s, p, (p+1)%4, payload))
	if x.Gold[p] != 1 {
		t.Fatal("wrong wagon payment")
	}
	if n, _ := (Wagons{}).tradeExtraHeld(s, p, raw(map[string]int{"gold": 1})); n != 0 {
		t.Fatal("raider gold also debits wagon purse")
	}
}

func TestCurrencyAliasesRejectBadPayments(t *testing.T) {
	for _, ruleset := range []string{"base+wagons", "base+rivers+wagons"} {
		s, _ := opened(t, 4, ruleset)
		p := s.Cur
		s.Players[p].Hand[board.Wood] = 1
		for _, extra := range []map[string]int{{"gold": -1}, {"coins": 1, "gold": int(^uint(0) >> 1)}, {"wagon_gold": -1}} {
			if ruleset == "base+wagons" && extra["coins"] > 0 {
				continue
			}
			if ruleset == "base+rivers+wagons" && extra["wagon_gold"] < 0 {
				continue
			}
			_, err := engine.Decide(s, cmd(p, engine.CmdOfferTrade, map[string]any{"give": engine.Hand{board.Wood: 1}, "give_com": extra, "want": engine.Hand{board.Brick: 1}}))
			if err == nil {
				t.Fatalf("%s accepted invalid currency %v", ruleset, extra)
			}
		}
	}
}

func TestSharedPurseSettlesMixedPlayerTradeOnce(t *testing.T) {
	s, _ := opened(t, 4, "base+cak+rivers+wagons")
	p, q := s.Cur, (s.Cur+1)%4
	river, _ := rivers.StateExt(s)
	cx, _ := knights.StateExt(s)
	river.Coins[p], river.Coins[q] = 4, 0
	cx.Players[p].Commodities[knights.Cloth] = 1
	cx.Players[q].Commodities[knights.Cloth] = 0
	s.Players[q].Hand[board.Wood] = 1
	woodBefore := s.Players[p].Hand[board.Wood]
	do(t, s, cmd(p, engine.CmdOfferTrade, map[string]any{"give_com": map[string]any{"coins": 3, "commodities": []int{1, 0, 0}}, "want": engine.Hand{board.Wood: 1}}))
	do(t, s, cmd(q, engine.CmdRespondTrade, map[string]any{"accept": true}))
	do(t, s, cmd(p, engine.CmdExecuteTrade, map[string]any{"with": q}))
	if river.Coins[p] != 1 || river.Coins[q] != 3 || Gold(s, p) != 1 || Gold(s, q) != 3 {
		t.Fatal("shared currency was not transferred exactly once")
	}
	if cx.Players[p].Commodities[knights.Cloth] != 0 || cx.Players[q].Commodities[knights.Cloth] != 1 {
		t.Fatal("commodity was not transferred exactly once")
	}
	if s.Players[p].Hand[board.Wood] != woodBefore+1 || s.Players[q].Hand[board.Wood] != 0 || s.ActiveOffer != nil {
		t.Fatal("resource transfer or offer completion failed")
	}
}
