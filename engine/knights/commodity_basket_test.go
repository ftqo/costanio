package knights

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// A basket mixing give kinds at different rates: a player with 2:1 wheat and
// 4:1 on everything else pays 2 wheat + 4 wood for 2 coin in one command.
func TestCommodityBasketMixedRates(t *testing.T) {
	s, _ := newGame(t, 12, nil)
	s.Board.Harbors = nil // base 4:1 everywhere
	clearStartingCities(s)
	rolled(t, s)
	p := s.Cur
	x := ext(s)

	// Merchant Fleet names wheat: 2:1 on wheat for the turn, 4:1 on wood.
	x.Players[p].Progress = []ProgressCard{CardMerchantFleet}
	step(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardMerchantFleet, "res": int(board.Wheat)})})
	if got := s.BankRatio(p, board.Wheat); got != 2 {
		t.Fatalf("wheat ratio = %d, want 2", got)
	}

	s.Players[p].Hand = engine.Hand{}
	s.Players[p].Hand[board.Wheat] = 2
	s.Players[p].Hand[board.Wood] = 4
	x.Players[p].Commodities = CommodityHand{}
	supply0 := x.CommoditySupply[Coin]
	bankWood0, bankWheat0 := s.Bank[board.Wood], s.Bank[board.Wheat]

	spend := engine.Hand{}
	spend[board.Wheat] = 2
	spend[board.Wood] = 4
	step(t, s, engine.Command{Player: p, Type: CmdCommodityTrade, Data: mustJSON(t, map[string]any{
		"spend_res": spend,
		"want_com":  []int{0, 0, 2},
	})})

	if x.Players[p].Commodities[Coin] != 2 {
		t.Errorf("coin = %d, want 2", x.Players[p].Commodities[Coin])
	}
	if x.CommoditySupply[Coin] != supply0-2 {
		t.Errorf("coin supply = %d, want %d", x.CommoditySupply[Coin], supply0-2)
	}
	if s.Players[p].Hand[board.Wheat] != 0 || s.Players[p].Hand[board.Wood] != 0 {
		t.Errorf("hand = %v, want the whole stake spent", s.Players[p].Hand)
	}
	if s.Bank[board.Wheat] != bankWheat0+2 || s.Bank[board.Wood] != bankWood0+4 {
		t.Errorf("bank did not receive the stake: wheat %d->%d wood %d->%d",
			bankWheat0, s.Bank[board.Wheat], bankWood0, s.Bank[board.Wood])
	}
}

// L3/L4: exact payment. A stake that does not divide by its rate, or divides
// but does not cover the ask, is refused whole. No change, no burnt cards.
func TestCommodityBasketRequiresExactPayment(t *testing.T) {
	s, _ := newGame(t, 13, nil)
	s.Board.Harbors = nil
	clearStartingCities(s)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	s.Players[p].Hand = engine.Hand{}
	s.Players[p].Hand[board.Wood] = 9
	x.Players[p].Commodities = CommodityHand{}

	odd := engine.Hand{}
	odd[board.Wood] = 5 // 4:1 does not divide 5
	reject(t, s, engine.Command{Player: p, Type: CmdCommodityTrade, Data: mustJSON(t, map[string]any{
		"spend_res": odd,
		"want_com":  []int{0, 0, 1},
	})}, engine.ErrBadTrade)

	short := engine.Hand{}
	short[board.Wood] = 4 // divides, but funds 1 unit against an ask of 2
	reject(t, s, engine.Command{Player: p, Type: CmdCommodityTrade, Data: mustJSON(t, map[string]any{
		"spend_res": short,
		"want_com":  []int{0, 0, 2},
	})}, engine.ErrBadTrade)

	if s.Players[p].Hand[board.Wood] != 9 || x.Players[p].Commodities[Coin] != 0 {
		t.Errorf("a refused basket moved cards: hand=%v coms=%v", s.Players[p].Hand, x.Players[p].Commodities)
	}
}

// L2: a good on both sides is two trades. Without the rule the arithmetic is no
// longer an exact test, as in the base bank basket.
func TestCommodityBasketRejectsGoodOnBothSides(t *testing.T) {
	s, _ := newGame(t, 14, nil)
	s.Board.Harbors = nil
	clearStartingCities(s)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	s.Players[p].Hand = engine.Hand{}
	s.Players[p].Hand[board.Wood] = 4
	x.Players[p].Commodities = CommodityHand{Cloth: 4}

	spend := engine.Hand{}
	spend[board.Wood] = 4
	reject(t, s, engine.Command{Player: p, Type: CmdCommodityTrade, Data: mustJSON(t, map[string]any{
		"spend_res": spend,
		"spend_com": []int{4, 0, 0},
		"want_com":  []int{1, 0, 1}, // cloth is being spent AND bought
	})}, engine.ErrSameResource)
}

// A commodity give side in a basket, priced at its own rate, buying a mix of
// resources and commodities at once.
func TestCommodityBasketCommodityGiveMixedTake(t *testing.T) {
	s, _ := newGame(t, 15, nil)
	s.Board.Harbors = nil
	clearStartingCities(s)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	s.Players[p].Hand = engine.Hand{}
	x.Players[p].Commodities = CommodityHand{Cloth: 8}

	want := engine.Hand{}
	want[board.Ore] = 1
	step(t, s, engine.Command{Player: p, Type: CmdCommodityTrade, Data: mustJSON(t, map[string]any{
		"spend_com": []int{8, 0, 0},
		"want_res":  want,
		"want_com":  []int{0, 1, 0},
	})})

	if x.Players[p].Commodities[Cloth] != 0 {
		t.Errorf("cloth = %d, want 0 spent", x.Players[p].Commodities[Cloth])
	}
	if s.Players[p].Hand[board.Ore] != 1 || x.Players[p].Commodities[Paper] != 1 {
		t.Errorf("take = %v / %v, want 1 ore + 1 paper", s.Players[p].Hand, x.Players[p].Commodities)
	}
}

// A pure resource-for-resource trade belongs to the base bank lane and must
// not bypass its rules through this one.
func TestCommodityBasketRejectsPureResourceTrade(t *testing.T) {
	s, _ := newGame(t, 16, nil)
	s.Board.Harbors = nil
	clearStartingCities(s)
	rolled(t, s)
	p := s.Cur
	s.Players[p].Hand = engine.Hand{}
	s.Players[p].Hand[board.Wood] = 4

	spend := engine.Hand{}
	spend[board.Wood] = 4
	want := engine.Hand{}
	want[board.Ore] = 1
	reject(t, s, engine.Command{Player: p, Type: CmdCommodityTrade, Data: mustJSON(t, map[string]any{
		"spend_res": spend,
		"want_res":  want,
	})}, engine.ErrBadCommand)
}

// The ask must be fillable: a resource from the bank, a commodity from its
// stack. Either being short refuses the whole basket.
func TestCommodityBasketRefusedWhenSupplyShort(t *testing.T) {
	s, _ := newGame(t, 17, nil)
	s.Board.Harbors = nil
	clearStartingCities(s)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	s.Players[p].Hand = engine.Hand{}
	s.Players[p].Hand[board.Wood] = 8
	x.Players[p].Commodities = CommodityHand{}
	x.CommoditySupply[Coin] = 1

	spend := engine.Hand{}
	spend[board.Wood] = 8
	reject(t, s, engine.Command{Player: p, Type: CmdCommodityTrade, Data: mustJSON(t, map[string]any{
		"spend_res": spend,
		"want_com":  []int{0, 0, 2},
	})}, ErrComSupplyEmpty)

	if s.Players[p].Hand[board.Wood] != 8 {
		t.Errorf("refused basket spent cards: hand=%v", s.Players[p].Hand)
	}
}

// Replay determinism for an event the sim never produces (bots send the scalar
// form): replay(log) must reproduce the live state.
func TestCommodityBasketReplays(t *testing.T) {
	s, log := newGame(t, 20, nil)
	s.Board.Harbors = nil
	clearStartingCities(s)
	// rolled() drops its events and the replay needs all of them, so drive the roll
	// and its interrupts here.
	log = append(log, step(t, s, engine.Command{Player: s.Cur, Type: engine.CmdRollDice})...)
	for s.RobberPending || len(s.PendingDiscards) > 0 {
		cmd, ok := engine.AutoCommand(s)
		if !ok {
			t.Fatal("stuck on interrupts")
		}
		log = append(log, step(t, s, cmd)...)
	}
	p := s.Cur
	x := ext(s)
	// The stake is set directly, so the player's hand is not reproducible from the
	// log and is not compared. The bank and commodity supply are set up and moved
	// only by logged events, so those are what replay must match.
	s.Players[p].Hand[board.Wood] = 4
	x.Players[p].Commodities = CommodityHand{Cloth: 4}
	bank0, supply0 := s.Bank, x.CommoditySupply

	spend := engine.Hand{}
	spend[board.Wood] = 4 // 1 unit at 4:1
	want := engine.Hand{}
	want[board.Ore] = 1
	evs := step(t, s, engine.Command{Player: p, Type: CmdCommodityTrade, Data: mustJSON(t, map[string]any{
		"spend_res": spend,
		"spend_com": []int{4, 0, 0}, // 4 cloth at 4:1, a second unit
		"want_res":  want,
		"want_com":  []int{0, 0, 1},
	})})
	if len(evs) != 1 || evs[0].Type != EvCommodityBasket {
		t.Fatalf("events = %v, want one %s", evs, EvCommodityBasket)
	}
	replayed, err := engine.Replay(append(log, evs...))
	if err != nil {
		t.Fatalf("Replay: %v", err)
	}
	// Absolute expectations rather than replayed-equals-live, since both run the
	// same fold and would agree on wrong arithmetic. The stake returns to its pile
	// and the ask comes off its own.
	wantBank := bank0
	wantBank[board.Wood] += 4
	wantBank[board.Ore]--
	wantSupply := supply0
	wantSupply[Cloth] += 4
	wantSupply[Coin]--
	if replayed.Bank != wantBank {
		t.Errorf("replayed bank = %v, want %v", replayed.Bank, wantBank)
	}
	if got := ext(replayed).CommoditySupply; got != wantSupply {
		t.Errorf("replayed supply = %v, want %v", got, wantSupply)
	}
	// And the live state agrees, which is the determinism guarantee itself.
	if s.Bank != wantBank || x.CommoditySupply != wantSupply {
		t.Errorf("live bank/supply = %v/%v, want %v/%v", s.Bank, x.CommoditySupply, wantBank, wantSupply)
	}
}

// good_ratios publishes the cheapest lane, which at Trade 3 is the Trading
// House at 2:1. The basket lane cannot use that price, so the maritime rate is
// published separately; quoting 2:1 would let the client offer a trade the
// server refuses.
func TestGoodMaritimeRatiosIgnoresTradingHouse(t *testing.T) {
	s, _ := newGame(t, 19, nil)
	s.Board.Harbors = nil // base 4:1
	clearStartingCities(s)
	rolled(t, s)
	p := s.Cur
	ext(s).Players[p].Improve[Trade] = 3

	if got := (Module{}).goodRatios(s, p)["cloth"]; got != 2 {
		t.Errorf("goodRatios[cloth] = %d, want 2 (Trading House is reachable)", got)
	}
	if got := (Module{}).goodMaritimeRatios(s, p)["cloth"]; got != 4 {
		t.Errorf("goodMaritimeRatios[cloth] = %d, want 4 (the lane a basket actually uses)", got)
	}
}

// The scalar form is unchanged: only a want array selects the basket, so
// clients and bots sending give/get/count still work.
func TestCommodityScalarFormStillWorks(t *testing.T) {
	s, _ := newGame(t, 18, nil)
	s.Board.Harbors = nil
	clearStartingCities(s)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	s.Players[p].Hand = engine.Hand{}
	s.Players[p].Hand[board.Wood] = 4
	x.Players[p].Commodities = CommodityHand{}

	step(t, s, engine.Command{Player: p, Type: CmdCommodityTrade,
		Data: mustJSON(t, map[string]any{"give_res": int(board.Wood), "get_com": int(Coin), "count": 1})})
	if x.Players[p].Commodities[Coin] != 1 || s.Players[p].Hand[board.Wood] != 0 {
		t.Errorf("scalar commodity trade broke: coms=%v hand=%v", x.Players[p].Commodities, s.Players[p].Hand)
	}
}
