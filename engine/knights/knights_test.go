package knights

import (
	"encoding/json"
	"errors"
	"reflect"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// fixtureGone fails the test because the board no longer offers the position it
// was written around. Used instead of t.Skip: searches here run on fixed seeds,
// so a missing position means the board changed, and a skip would still report
// ok. The same applies when a search over a range of seeds runs out.
func fixtureGone(t *testing.T, why string, args ...any) {
	t.Helper()
	t.Fatalf("the fixture no longer provides "+why+
		", so this test checked nothing (it used to t.Skip here, which prints ok)", args...)
}

func mustJSON(t *testing.T, v any) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func step(t *testing.T, s *engine.State, cmd engine.Command) []engine.Event {
	t.Helper()
	events, err := engine.Decide(s, cmd)
	if err != nil {
		t.Fatalf("Decide(%s by %d): %v", cmd.Type, cmd.Player, err)
	}
	for _, e := range events {
		if err := engine.Apply(s, e); err != nil {
			t.Fatalf("Apply(%s): %v", e.Type, err)
		}
	}
	return events
}

// newGame drives a Knights game through setup with auto commands.
func newGame(t *testing.T, seed uint64, modCfg *Config) (*engine.State, []engine.Event) {
	t.Helper()
	cfg := engine.GameConfig{Players: 3, Ruleset: "base+cak"}
	if modCfg != nil {
		raw, _ := json.Marshal(modCfg)
		cfg.Modules = map[string]json.RawMessage{Name: raw}
	}
	log, err := engine.New(cfg, engine.SeedsFrom(seed))
	if err != nil {
		t.Fatal(err)
	}
	s := engine.Empty()
	for _, e := range log {
		if err := engine.Apply(s, e); err != nil {
			t.Fatal(err)
		}
	}
	for s.Phase == engine.PhaseSetup {
		cmd, ok := engine.AutoCommand(s)
		if !ok {
			t.Fatal("setup stuck")
		}
		log = append(log, step(t, s, cmd)...)
	}
	return s, log
}

// newSetupGame returns a freshly dealt Knights game still in PhaseSetup.
// newGame always drives setup to completion.
func newSetupGame(t *testing.T, seed uint64) *engine.State {
	t.Helper()
	log, err := engine.New(engine.GameConfig{Players: 3, Ruleset: "base+cak"}, engine.SeedsFrom(seed))
	if err != nil {
		t.Fatal(err)
	}
	s := engine.Empty()
	for _, e := range log {
		if err := engine.Apply(s, e); err != nil {
			t.Fatal(err)
		}
	}
	if s.Phase != engine.PhaseSetup {
		t.Fatalf("fresh game is in %v, want PhaseSetup", s.Phase)
	}
	return s
}

// rolled gets the current player past a clean roll.
func rolled(t *testing.T, s *engine.State) {
	t.Helper()
	step(t, s, engine.Command{Player: s.Cur, Type: engine.CmdRollDice})
	for s.RobberPending || len(s.PendingDiscards) > 0 {
		cmd, ok := engine.AutoCommand(s)
		if !ok {
			t.Fatal("stuck on interrupts")
		}
		step(t, s, cmd)
	}
}

func TestDefaultTargetVP(t *testing.T) {
	s, _ := newGame(t, 1, nil)
	if s.Config.TargetVP != defaultTargetVP {
		t.Errorf("target = %d, want %d", s.Config.TargetVP, defaultTargetVP)
	}
}

// Under Knights the second setup placement is a city. After setup each player
// holds one settlement (round 1) and one city (round 2), the city taken from
// the city supply.
func TestSetupRound2PlacesCity(t *testing.T) {
	s, _ := newGame(t, 7, nil)

	cities := make(map[engine.PlayerID]int)
	setts := make(map[engine.PlayerID]int)
	for _, b := range s.Buildings {
		if b.City {
			cities[b.Owner]++
		} else {
			setts[b.Owner]++
		}
	}
	for p := engine.PlayerID(0); p < engine.PlayerID(s.Config.Players); p++ {
		if cities[p] != 1 {
			t.Errorf("player %d: cities=%d, want 1 (round-2 setup city)", p, cities[p])
		}
		if setts[p] != 1 {
			t.Errorf("player %d: settlements=%d, want 1 (round-1 setup settlement)", p, setts[p])
		}
		if got := s.Players[p].CitiesLeft; got != engine.MaxCities-1 {
			t.Errorf("player %d: CitiesLeft=%d, want %d", p, got, engine.MaxCities-1)
		}
		if got := s.Players[p].SettlementsLeft; got != engine.MaxSettlements-1 {
			t.Errorf("player %d: SettlementsLeft=%d, want %d", p, got, engine.MaxSettlements-1)
		}
	}
}

func TestDevCardsDisabled(t *testing.T) {
	s, _ := newGame(t, 2, nil)
	rolled(t, s)
	s.Players[s.Cur].Hand = engine.CostDevCard
	if _, err := engine.Decide(s, engine.Command{Player: s.Cur, Type: engine.CmdBuyDevCard}); !errors.Is(err, engine.ErrUnknownCommand) {
		t.Errorf("dev buy under cak err = %v", err)
	}
}

func TestEventDieAndCommodities(t *testing.T) {
	s, _ := newGame(t, 3, nil)

	// A city of the current player on a sheep hex with a known number, and no other
	// city of theirs. Their other buildings are stripped so the cloth delta is 1
	// whatever the seed dealt.
	p := s.Cur
	var hex board.Hex
	found := false
	// Sorted so the same sheep hex is picked every run.
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		if tile, ok := s.Board.Tiles[h]; ok && tile.Res == board.Sheep && h != s.Board.Robber {
			hex, found = h, true
			break
		}
	}
	if !found {
		fixtureGone(t, "no sheep hex")
	}
	for bv, b := range s.Buildings {
		if b.Owner == p {
			delete(s.Buildings, bv)
		}
	}
	v := hex.Vertices()[0]
	s.Buildings[v] = engine.Building{Owner: p, City: true}

	// Roll exactly that number via Alchemist-style fixed dice.
	tile := s.Board.Tiles[hex]
	d1 := tile.Number / 2
	d2 := tile.Number - d1
	if d1 < 1 || d2 < 1 || d1 > 6 || d2 > 6 {
		fixtureGone(t, "number not reachable by two dice halves")
	}
	x := ext(s)
	x.AlchemistD1, x.AlchemistD2 = d1, d2

	clothBefore := x.Players[p].Commodities[Cloth]
	events := step(t, s, engine.Command{Player: p, Type: engine.CmdRollDice})

	var sawEventDie, sawAdjust bool
	for _, e := range events {
		switch e.Type {
		case EvEventDie:
			sawEventDie = true
		case EvCommodityAdjust:
			sawAdjust = true
		default:
		}
	}
	if !sawEventDie {
		t.Error("no event die")
	}
	if !sawAdjust {
		t.Fatalf("no commodity adjust in %+v", events)
	}
	if x.Players[p].Commodities[Cloth] != clothBefore+1 {
		t.Errorf("cloth = %d, want +1", x.Players[p].Commodities[Cloth])
	}
	if x.AlchemistD1 != 0 {
		t.Error("fixed dice not cleared")
	}
	// Conservation including commodities is covered implicitly: the adjust
	// returned one sheep to the bank for the cloth granted.
}

// The event die is rolled on every Roll Dice phase, including a 7.
func TestEventDieRolledOnSeven(t *testing.T) {
	s, _ := newGame(t, 3, nil)
	clearStartingCities(s)
	x := ext(s)
	x.AlchemistD1, x.AlchemistD2 = 3, 4 // force a production total of 7

	events := step(t, s, engine.Command{Player: s.Cur, Type: engine.CmdRollDice})

	var sawSeven, sawEventDie bool
	for _, e := range events {
		switch e.Type {
		case engine.EvDiceRolled:
			d := engine.DecodeEvent[engine.DiceRolledData](e)
			if d.D1+d.D2 == 7 {
				sawSeven = true
			}
		case EvEventDie:
			sawEventDie = true
		default:
		}
	}
	if !sawSeven {
		t.Fatalf("expected a forced 7 roll, events=%v", events)
	}
	if !sawEventDie {
		t.Error("event die was not rolled on a 7")
	}
}

// The commodity bank rate against harbors: a generic 3:1 port lowers it, a
// specific 2:1 resource harbor never does. The last case (2:1 on all five
// resources) is the one a client inferring from resource rates gets wrong.
func TestCommodityBankRatioHarbors(t *testing.T) {
	s, _ := newGame(t, 11, nil)
	clearStartingCities(s)
	p := engine.PlayerID(0)

	// Pick a vertex this player owns, and hang each harbor off it in turn.
	var owned board.Vertex
	found := false
	for v, b := range s.Buildings {
		if b.Owner == p {
			owned, found = v, true
			break
		}
	}
	if !found {
		t.Fatal("player 0 has no building to sit a harbor on")
	}

	cases := []struct {
		name    string
		harbors []board.Harbor
		want    int
	}{
		{"no harbor", nil, 4},
		{
			"generic 3:1 lowers it",
			[]board.Harbor{{Verts: [2]board.Vertex{owned, owned}, Ratio: 3, Res: board.ResNone}},
			3,
		},
		{
			"specific 2:1 does not",
			[]board.Harbor{{Verts: [2]board.Vertex{owned, owned}, Ratio: 2, Res: board.Sheep}},
			4,
		},
		{
			// Every resource reads 2:1, and cloth still costs 4.
			"specific 2:1 on all five still does not",
			[]board.Harbor{
				{Verts: [2]board.Vertex{owned, owned}, Ratio: 2, Res: board.Wood},
				{Verts: [2]board.Vertex{owned, owned}, Ratio: 2, Res: board.Brick},
				{Verts: [2]board.Vertex{owned, owned}, Ratio: 2, Res: board.Sheep},
				{Verts: [2]board.Vertex{owned, owned}, Ratio: 2, Res: board.Wheat},
				{Verts: [2]board.Vertex{owned, owned}, Ratio: 2, Res: board.Ore},
			},
			4,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s.Board.Harbors = tc.harbors
			for _, com := range []Commodity{Cloth, Paper, Coin} {
				if got := (Module{}).commodityBankRatio(s, p, com); got != tc.want {
					t.Errorf("commodity %d ratio = %d, want %d", com, got, tc.want)
				}
			}
		})
	}
}

// GoodRatios must publish the cheapest lane the player can reach. Two
// properties:
//
//  1. the published ratio is min(commodityBankRatio, Trading House if reachable);
//  2. commodity_trade on its own still charges commodityBankRatio.
//
// (2) lives in TestCommodityTradeIgnoresTradeLevel.
func TestGoodRatiosPublishesCheapestLane(t *testing.T) {
	s, _ := newGame(t, 11, nil)
	clearStartingCities(s)
	p := engine.PlayerID(0)
	var owned board.Vertex
	for v, b := range s.Buildings {
		if b.Owner == p {
			owned = v
			break
		}
	}
	genericPort := []board.Harbor{
		{Verts: [2]board.Vertex{owned, owned}, Ratio: 3, Res: board.ResNone},
	}

	cases := []struct {
		name    string
		harbors []board.Harbor
		trade   int
		want    int
	}{
		{"no port, no trade track", nil, 0, 4},
		{"generic port alone", genericPort, 0, 3},
		{"Trade 2 is not yet the Trading House", nil, 2, 4},
		{"Trade 3 beats the base rate", nil, 3, 2},
		{"Trade 3 beats a generic port", genericPort, 3, 2},
		{"Trade 5 still reads 2:1", genericPort, 5, 2},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s.Board.Harbors = tc.harbors
			ext(s).Players[p].Improve[Trade] = tc.trade
			got := (Module{}).goodRatios(s, p)
			for name, com := range map[string]Commodity{"cloth": Cloth, "paper": Paper, "coin": Coin} {
				if got[name] != tc.want {
					t.Errorf("goodRatios[%q] = %d, want %d", name, got[name], tc.want)
				}
				// The published number is the best lane, so never worse than maritime and
				// never better than 2:1.
				maritime := (Module{}).commodityBankRatio(s, p, com)
				if got[name] > maritime {
					t.Errorf("goodRatios[%q] = %d, worse than maritime %d", name, got[name], maritime)
				}
				if got[name] < tradingHouseCost {
					t.Errorf("goodRatios[%q] = %d, better than any lane offers", name, got[name])
				}
			}
		})
	}
	ext(s).Players[p].Improve[Trade] = 0
}

// Reaching Trade level 3 does not make commodity_trade cheaper: the Trading
// House is its own command, so the maritime lane still charges 4:1 even though
// the published rate says 2:1.
func TestCommodityTradeIgnoresTradeLevel(t *testing.T) {
	s, _ := newGame(t, 12, nil)
	s.Board.Harbors = nil // force the 4:1 base rate
	clearStartingCities(s)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	x.Players[p].Improve[Trade] = 3

	// The Trading House price is published...
	if got := (Module{}).goodRatios(s, p)["cloth"]; got != 2 {
		t.Fatalf("goodRatios[cloth] = %d, want 2 at Trade 3", got)
	}
	// ...but two cloth do not buy anything on the maritime lane.
	s.Players[p].Hand = engine.Hand{}
	x.Players[p].Commodities = CommodityHand{Cloth: 2}
	reject(t, s, engine.Command{Player: p, Type: CmdCommodityTrade,
		Data: mustJSON(t, map[string]any{"give_com": int(Cloth), "get_res": int(board.Wheat), "count": 1})},
		ErrNoCommodities)
	if x.Players[p].Commodities[Cloth] != 2 || s.Players[p].Hand[board.Wheat] != 0 {
		t.Errorf("rejected trade moved cards: coms=%v hand=%v", x.Players[p].Commodities, s.Players[p].Hand)
	}

	// Four cloth do, at the unchanged 4:1.
	x.Players[p].Commodities = CommodityHand{Cloth: 4}
	step(t, s, engine.Command{Player: p, Type: CmdCommodityTrade,
		Data: mustJSON(t, map[string]any{"give_com": int(Cloth), "get_res": int(board.Wheat), "count": 1})})
	if x.Players[p].Commodities[Cloth] != 0 || s.Players[p].Hand[board.Wheat] != 1 {
		t.Errorf("maritime commodity trade at Trade 3 charged %v, want 4 cloth for 1 wheat (hand=%v)",
			x.Players[p].Commodities, s.Players[p].Hand)
	}
}

// Knights rules: Merchant Fleet may name a commodity, granting 2:1 on it for the turn.
func TestMerchantFleetCommodity(t *testing.T) {
	s, _ := newGame(t, 18, nil)
	s.Board.Harbors = nil // base 4:1
	clearStartingCities(s)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	x.Players[p].Progress = []ProgressCard{CardMerchantFleet}

	step(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardMerchantFleet, "com": int(Cloth)})})

	if got := (Module{}).commodityBankRatio(s, p, Cloth); got != 2 {
		t.Errorf("named-commodity ratio = %d, want 2", got)
	}
	if got := (Module{}).commodityBankRatio(s, p, Coin); got != 4 {
		t.Errorf("other-commodity ratio = %d, want 4 (fleet is good-specific)", got)
	}
}

// Resources may be traded for commodities with the supply at the bank ratio
// (4:1 here, no ports).
func TestResourceForCommodityBankTrade(t *testing.T) {
	s, _ := newGame(t, 11, nil)
	s.Board.Harbors = nil // force 4:1
	clearStartingCities(s)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	s.Players[p].Hand = engine.Hand{board.Wood: 4}
	x.Players[p].Commodities = CommodityHand{}

	step(t, s, engine.Command{Player: p, Type: CmdCommodityTrade,
		Data: mustJSON(t, map[string]any{"give_res": int(board.Wood), "get_com": int(Cloth), "count": 1})})

	if s.Players[p].Hand[board.Wood] != 0 {
		t.Errorf("wood not spent: %v", s.Players[p].Hand)
	}
	if x.Players[p].Commodities[Cloth] != 1 {
		t.Errorf("cloth not received: %v", x.Players[p].Commodities)
	}
}

// Commodities may be traded with the supply at 4:1 (or 3:1 with a generic
// port) for a resource or another commodity.
func TestCommodityBankTrade(t *testing.T) {
	s, _ := newGame(t, 12, nil)
	s.Board.Harbors = nil // force 4:1
	clearStartingCities(s)
	rolled(t, s)
	p := s.Cur
	x := ext(s)

	// commodity -> resource
	s.Players[p].Hand = engine.Hand{}
	x.Players[p].Commodities = CommodityHand{Cloth: 4}
	step(t, s, engine.Command{Player: p, Type: CmdCommodityTrade,
		Data: mustJSON(t, map[string]any{"give_com": int(Cloth), "get_res": int(board.Wood), "count": 1})})
	if x.Players[p].Commodities[Cloth] != 0 || s.Players[p].Hand[board.Wood] != 1 {
		t.Errorf("commodity->resource failed: coms=%v hand=%v", x.Players[p].Commodities, s.Players[p].Hand)
	}

	// commodity -> other commodity
	x.Players[p].Commodities = CommodityHand{Cloth: 4}
	step(t, s, engine.Command{Player: p, Type: CmdCommodityTrade,
		Data: mustJSON(t, map[string]any{"give_com": int(Cloth), "get_com": int(Coin), "count": 1})})
	if x.Players[p].Commodities[Cloth] != 0 || x.Players[p].Commodities[Coin] != 1 {
		t.Errorf("commodity->commodity failed: %v", x.Players[p].Commodities)
	}
}

// No same-good trade with the supply. The base lane and the Trading House
// already refuse it; the commodity maritime lane must too.
func TestCommodityTradeRejectsSameCommodity(t *testing.T) {
	s, _ := newGame(t, 12, nil)
	s.Board.Harbors = nil // force 4:1
	clearStartingCities(s)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	x.Players[p].Commodities = CommodityHand{Cloth: 4}

	reject(t, s, engine.Command{Player: p, Type: CmdCommodityTrade,
		Data: mustJSON(t, map[string]any{"give_com": int(Cloth), "get_com": int(Cloth), "count": 1})},
		engine.ErrSameResource)
	if x.Players[p].Commodities[Cloth] != 4 {
		t.Errorf("rejected like-for-like trade moved cards: %v", x.Players[p].Commodities)
	}
}

// The merchant token's holder trades the resource of its hex with the bank at
// 2:1 (in addition to the merchant being worth 1 VP).
func TestMerchantTokenGivesTwoToOne(t *testing.T) {
	s, _ := newGame(t, 8, nil)
	x := ext(s)
	p := engine.PlayerID(0)

	// Find a producing land hex whose resource p does not already trade at 2:1, so
	// the merchant is what lowers the ratio.
	var hex board.Hex
	var res board.Resource
	found := false
	for h, tile := range s.Board.Tiles {
		if tile.Res.Producing() && h != s.Board.Robber && s.BankRatio(p, tile.Res) > 2 {
			hex, res, found = h, tile.Res, true
			break
		}
	}
	if !found {
		fixtureGone(t, "no producing hex without a pre-existing 2:1")
	}

	before := s.BankRatio(p, res) // > 2 by construction
	h := hex
	x.Merchant = &h
	x.MerchantOwner = p
	if got := s.BankRatio(p, res); got != 2 {
		t.Errorf("merchant owner bank ratio on merchant-hex resource = %d, want 2", got)
	}
	// The 2:1 follows ownership: handing the merchant to someone else restores p's
	// original ratio, whatever harbors p has.
	x.MerchantOwner = (p + 1) % engine.PlayerID(len(s.Players))
	if got := s.BankRatio(p, res); got != before {
		t.Errorf("non-owner still gets merchant 2:1: ratio=%d, want %d", got, before)
	}
}

// A level-4/5 improvement that would claim a metropolis is refused when the
// player has no metropolis-free city; it must not stack on one that has a
// metropolis.
func TestMetropolisNeedsFreeCity(t *testing.T) {
	s, _ := newGame(t, 9, nil)
	clearStartingCities(s)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	makeCity(s, p) // exactly one city

	var cityV board.Vertex
	for v, b := range s.Buildings {
		if b.Owner == p && b.City {
			cityV = v
		}
	}
	// p already holds the Trade metropolis on its only city, at level 4.
	x.Players[p].Improve[Trade] = 4
	x.Players[p].Metropolis[Trade] = true
	x.Players[p].MetropolisAt[Trade] = cityV
	// Advancing Politics to 4 would claim a second metropolis with no free city.
	x.Players[p].Improve[Politics] = 3
	x.Players[p].Commodities[commodityForTrack(Politics)] = 10

	reject(t, s, engine.Command{Player: p, Type: CmdImproveCity,
		Data: mustJSON(t, map[string]any{"track": int(Politics)})}, ErrNoFreeCity)
}

// The promotion cap is per knight, not per player: two knights may each be
// promoted in one turn (as the Smith does), but one knight may not go
// 1 -> 2 -> 3.
func TestPromoteOncePerKnightPerTurn(t *testing.T) {
	s, _ := newGame(t, 16, nil)
	clearStartingCities(s)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	v1 := board.Vertex{Q: 0, R: 0, Side: board.N}
	v2 := board.Vertex{Q: 2, R: 0, Side: board.S}
	x.Knights[v1] = Knight{Owner: p, Level: 1}
	x.Knights[v2] = Knight{Owner: p, Level: 1}
	x.Players[p].Improve[Politics] = 3 // a Fortress, so 2 -> 3 is not what blocks
	s.Players[p].Hand = engine.Hand{board.Sheep: 5, board.Ore: 5}

	step(t, s, engine.Command{Player: p, Type: CmdPromoteKnight, Data: mustJSON(t, map[string]any{"v": v1})})
	if x.Knights[v1].Level != 2 {
		t.Fatalf("first promote failed: level=%d", x.Knights[v1].Level)
	}

	// The same knight again is the one thing the rule forbids.
	reject(t, s, engine.Command{Player: p, Type: CmdPromoteKnight,
		Data: mustJSON(t, map[string]any{"v": v1})}, ErrAlreadyPromoted)

	// A different knight is fine.
	step(t, s, engine.Command{Player: p, Type: CmdPromoteKnight, Data: mustJSON(t, map[string]any{"v": v2})})
	if x.Knights[v2].Level != 2 {
		t.Fatalf("second knight should have been promotable, level=%d", x.Knights[v2].Level)
	}
}

// The cap travels with the knight, so walking away from the spot it was promoted
// on does not buy it a second promotion in the same turn.
func TestPromotedKnightStaysCappedAcrossAMove(t *testing.T) {
	s, _ := newGame(t, 16, nil)
	clearStartingCities(s)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	v1 := board.Vertex{Q: 0, R: 0, Side: board.N}
	v2 := board.Vertex{Q: 2, R: 0, Side: board.S}
	x.Knights[v1] = Knight{Owner: p, Level: 1}
	x.Players[p].Improve[Politics] = 3
	s.Players[p].Hand = engine.Hand{board.Sheep: 5, board.Ore: 5}

	step(t, s, engine.Command{Player: p, Type: CmdPromoteKnight, Data: mustJSON(t, map[string]any{"v": v1})})

	// Relocate it by hand: this checks the flag survives the copy to a new key,
	// not whether the move is legal.
	k := x.Knights[v1]
	delete(x.Knights, v1)
	x.Knights[v2] = k

	reject(t, s, engine.Command{Player: p, Type: CmdPromoteKnight,
		Data: mustJSON(t, map[string]any{"v": v2})}, ErrAlreadyPromoted)
}

// Deserter replaces a knight with one of equal strength at every tier. The
// taker holds no knights, so no tier is full and no fallback can mask a wrong
// level (the full-tier case is TestDeserterFallsBackToBasicWhenTierFull).
func TestDeserterReplacementMatchesEveryTier(t *testing.T) {
	for _, lvl := range []int{1, 2, 3} {
		s, _ := newGame(t, 32, nil)
		rolled(t, s)
		p := s.Cur
		x := ext(s)
		q := (p + 1) % engine.PlayerID(len(s.Players))

		v := board.Vertex{Q: 2, R: -1, Side: board.N}
		x.Knights[v] = Knight{Owner: q, Level: lvl}
		x.Players[p].Progress = []ProgressCard{CardDeserter}

		step(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
			Data: mustJSON(t, map[string]any{"card": CardDeserter, "victim": q})})
		step(t, s, engine.Command{Player: q, Type: CmdDeserterSurrender,
			Data: mustJSON(t, map[string]any{"v": v})})
		if x.DeserterLevel != lvl {
			t.Errorf("surrendered a level-%d knight: owed level = %d, want %d", lvl, x.DeserterLevel, lvl)
		}

		// A mighty knight arrives this way even with no Fortress built, the one
		// exception to the Politics-3 requirement.
		spot := knightSpotFor(t, s, p)
		step(t, s, engine.Command{Player: p, Type: CmdDeserterPlace,
			Data: mustJSON(t, map[string]any{"v": spot})})
		if got := x.Knights[spot].Level; got != lvl {
			t.Errorf("surrendered a level-%d knight: placed level = %d, want %d", lvl, got, lvl)
		}
	}
}

// A moving knight may pass through the player's own buildings and knights, but
// not through an opponent's piece.
func TestKnightMovesPastOwnPieces(t *testing.T) {
	s, _ := newGame(t, 17, nil)
	clearStartingCities(s)
	x := ext(s)
	p := engine.PlayerID(0)

	var from, mid, to board.Vertex
	var e1, e2 board.Edge
	found := false
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, v0 := range h.Vertices() {
			if !s.Board.LandVertex(v0) {
				continue
			}
			for _, ea := range v0.Edges() {
				if !s.Board.LandEdge(ea) {
					continue
				}
				v1 := ea.Other(v0)
				if !s.Board.LandVertex(v1) {
					continue
				}
				for _, eb := range v1.Edges() {
					if eb == ea || !s.Board.LandEdge(eb) {
						continue
					}
					v2 := eb.Other(v1)
					if v2 == v0 || !s.Board.LandVertex(v2) {
						continue
					}
					from, mid, to, e1, e2, found = v0, v1, v2, ea, eb, true
					break
				}
				if found {
					break
				}
			}
			if found {
				break
			}
		}
		if found {
			break
		}
	}
	if !found {
		fixtureGone(t, "no two-edge land path found")
	}
	delete(s.Buildings, from)
	delete(s.Buildings, to)
	delete(x.Knights, from)
	delete(x.Knights, to)
	delete(x.Knights, mid)
	s.Roads[e1] = p
	s.Roads[e2] = p

	s.Buildings[mid] = engine.Building{Owner: p} // own piece in the path
	if !knightReachable(s, x, from, to, p) {
		t.Errorf("knight should pass its own building at %v to reach %v", mid, to)
	}
	s.Buildings[mid] = engine.Building{Owner: p + 1} // opponent piece blocks
	if knightReachable(s, x, from, to, p) {
		t.Errorf("knight must not pass an opponent building at %v", mid)
	}
}

// Progress draws are dealt starting with the current player, then clockwise.
func TestPlayersFromCurrent(t *testing.T) {
	s, _ := newGame(t, 1, nil) // 3 players
	s.Cur = 1
	got := playersFromCurrent(s)
	want := []engine.PlayerID{1, 2, 0}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
}

// Trading House yields "any 1 other commodity or resource", so a commodity for
// the same commodity is refused.
func TestTradingHouseRejectsSameCommodity(t *testing.T) {
	s, _ := newGame(t, 19, nil)
	clearStartingCities(s)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	x.Players[p].Improve[Trade] = 3
	x.Players[p].Commodities = CommodityHand{Cloth: 2}

	reject(t, s, engine.Command{Player: p, Type: CmdTradingHouse,
		Data: mustJSON(t, map[string]any{"give": Cloth, "get_com": Cloth})}, engine.ErrBadCommand)
}

// The active player may build and trade while holding more than 4 progress
// cards, but may not end the turn still over the limit.
func TestActivePlayerDefersProgressReconcile(t *testing.T) {
	s, _ := newGame(t, 20, nil)
	s.Board.Harbors = nil
	clearStartingCities(s)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	x.Players[p].Progress = []ProgressCard{CardMining, CardMining, CardMining, CardMining, CardMining} // 5 > limit
	s.Players[p].Hand = engine.Hand{board.Wood: 4}

	// A voluntary bank trade is allowed despite being over the progress limit.
	step(t, s, engine.Command{Player: p, Type: engine.CmdBankTrade,
		Data: mustJSON(t, map[string]any{"give": board.Wood, "get": board.Brick, "count": 1})})

	// Ending the turn is not allowed until the hand is reconciled to 4.
	reject(t, s, engine.Command{Player: p, Type: engine.CmdEndTurn}, engine.ErrModulePending)

	step(t, s, engine.Command{Player: p, Type: CmdDiscardProgress,
		Data: mustJSON(t, map[string]any{"card": CardMining})})
	step(t, s, engine.Command{Player: p, Type: engine.CmdEndTurn})
}

// A displaced knight is relocated by its owner, to any empty intersection
// reachable along their own routes.
func TestDisplacedKnightRelocatesByChoice(t *testing.T) {
	s, _ := newGame(t, 21, nil)
	clearStartingCities(s)
	rolled(t, s)
	p := s.Cur
	q := (p + 1) % engine.PlayerID(len(s.Players))
	x := ext(s)

	// Find a vertex C with at least three land-edge neighbors.
	var C, n1, n2, n3 board.Vertex
	var e1, e2, e3 board.Edge
	found := false
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, v := range h.Vertices() {
			if !s.Board.LandVertex(v) {
				continue
			}
			var es []board.Edge
			var ns []board.Vertex
			for _, e := range v.Edges() {
				if !s.Board.LandEdge(e) {
					continue
				}
				if w := e.Other(v); s.Board.LandVertex(w) {
					es = append(es, e)
					ns = append(ns, w)
				}
			}
			if len(es) >= 3 {
				C, e1, e2, e3 = v, es[0], es[1], es[2]
				n1, n2, n3 = ns[0], ns[1], ns[2]
				found = true
			}
			if found {
				break
			}
		}
		if found {
			break
		}
	}
	if !found {
		fixtureGone(t, "no vertex with three land edges")
	}
	for _, v := range []board.Vertex{C, n1, n2, n3} {
		delete(s.Buildings, v)
		delete(x.Knights, v)
	}
	s.Roads[e1] = p // n1–C: the displacer's approach
	s.Roads[e2] = q // C–n2: a relocation route for the displaced owner
	s.Roads[e3] = q // C–n3: another
	x.Knights[n1] = Knight{Owner: p, Level: 2, Active: true}
	x.Knights[C] = Knight{Owner: q, Level: 1, Active: true}

	// p displaces q's knight off C.
	step(t, s, engine.Command{Player: p, Type: CmdMoveKnight,
		Data: mustJSON(t, map[string]any{"from": n1, "to": C})})

	if got := x.Knights[C]; !got.Active && got.Owner != p || x.Knights[C].Owner != p {
		t.Fatalf("displacer should occupy C, got %+v", x.Knights[C])
	}
	if x.RelocPlayer != q {
		t.Fatalf("displaced owner %d should owe a relocation, RelocPlayer=%d", q, x.RelocPlayer)
	}
	// The displaced knight is not yet on the board (awaiting its owner's choice).
	for _, k := range x.Knights {
		if k.Owner == q {
			t.Fatalf("displaced knight should be in limbo until relocated")
		}
	}

	// q chooses a reachable empty spot.
	step(t, s, engine.Command{Player: q, Type: CmdRelocateKnight,
		Data: mustJSON(t, map[string]any{"to": n3})})
	if k, ok := x.Knights[n3]; !ok || k.Owner != q || k.Level != 1 {
		t.Errorf("relocated knight = %+v (ok=%v), want q level 1 at n3", k, ok)
	}
	if x.RelocPlayer != engine.NoPlayer {
		t.Errorf("relocation pending should be cleared, RelocPlayer=%d", x.RelocPlayer)
	}
}

// On a tied defended win, each tied defender (in turn order from the current
// player) draws a progress card from a deck of their choice, even with zero
// city improvements.
func TestDefenderTieInteractiveDraw(t *testing.T) {
	s, _ := newGame(t, 23, nil)
	clearStartingCities(s)
	x := ext(s)
	s.Cur = 0

	deckTotal := func(tr Track) int {
		n := 0
		for _, c := range x.Decks[tr] {
			n += c
		}
		return n
	}

	// Arm the tied-defender queue via a tied defended win (players 0 and 1 tied).
	applyAll(t, s, []engine.Event{engine.NewEvent(EvBarbarianAttack, barbarianAttackData{
		Win: true, Defender: engine.NoPlayer, TiedDefenders: []engine.PlayerID{0, 1},
	})})
	if len(x.DefenderDraws) != 2 || x.DefenderDraws[0] != 0 {
		t.Fatalf("queue should be [0 1] starting with current player, got %v", x.DefenderDraws)
	}

	// Player 0 (zero improvements) chooses the Politics deck and draws.
	polBefore := deckTotal(Politics)
	step(t, s, engine.Command{Player: 0, Type: CmdDefenderDraw,
		Data: mustJSON(t, map[string]any{"track": int(Politics)})})
	if deckTotal(Politics) != polBefore-1 {
		t.Errorf("player 0 did not draw from Politics: before=%d after=%d", polBefore, deckTotal(Politics))
	}
	if len(x.DefenderDraws) != 1 || x.DefenderDraws[0] != 1 {
		t.Fatalf("queue should advance to [1], got %v", x.DefenderDraws)
	}

	// Player 1 chooses the Science deck.
	sciBefore := deckTotal(Science)
	step(t, s, engine.Command{Player: 1, Type: CmdDefenderDraw,
		Data: mustJSON(t, map[string]any{"track": int(Science)})})
	if deckTotal(Science) != sciBefore-1 {
		t.Errorf("player 1 did not draw from Science")
	}
	if len(x.DefenderDraws) != 0 {
		t.Errorf("queue should be drained, got %v", x.DefenderDraws)
	}
}

// When a 7 and a barbarian landfall coincide, the event die resolves first, so a
// city wall pillaged on that roll lowers the discard threshold: a player at
// 8 cards (safe behind a wall, threshold 9) must discard once the wall is gone
// (threshold 7). Searches seeds for one whose event die shows a ship.
func TestSevenDiscardReflectsSameRollPillage(t *testing.T) {
	for seed := uint64(1); seed < 400; seed++ {
		s, _ := newGame(t, seed, nil)
		clearStartingCities(s)
		p := s.Cur
		x := ext(s)
		makeCity(s, p) // p's only city; no knights -> weakest defender, gets pillaged
		var cityV board.Vertex
		for v, b := range s.Buildings {
			if b.Owner == p && b.City {
				cityV = v
			}
		}
		x.Walled[cityV] = true
		x.Players[p].Walls = 1
		x.Attacks = 1                                  // not the (possibly skipped) first attack
		x.Barbarians = BarbarianTrack - 1              // this roll is a landfall
		s.Players[p].Hand = engine.Hand{board.Wood: 8} // 8 > 7 base, but <= 9 with the wall
		x.AlchemistD1, x.AlchemistD2 = 3, 4            // force a production total of 7

		events, err := engine.Decide(s, engine.Command{Player: p, Type: engine.CmdRollDice})
		if err != nil {
			t.Fatalf("seed %d: roll: %v", seed, err)
		}
		pillaged, discardN := false, 0
		for _, e := range events {
			if e.Type == EvBarbarianAttack {
				d := engine.DecodeEvent[barbarianAttackData](e)
				for _, dg := range d.Downgraded {
					if dg.Player == p && dg.V == cityV {
						pillaged = true
					}
				}
			}
			if e.Type == engine.EvDiscardsReq {
				d := engine.DecodeEvent[engine.DiscardsReqData](e)
				for _, r := range d.Required {
					if r.Player == p {
						discardN = r.Count
					}
				}
			}
		}
		if !pillaged {
			continue // event die wasn't a ship this seed; try another
		}
		if discardN != 4 {
			t.Fatalf("seed %d: wall pillaged on the 7 but p discards %d, want 4 (threshold should drop to 7)", seed, discardN)
		}
		return // verified
	}
	fixtureGone(t, "no seed produced a ship event die with a pillage")
}

// On a non-7 roll whose event die is a barbarian landfall, the event die resolves
// before production: a city pillaged this roll produces as a settlement (1), not a
// city (2), and yields no commodity.
func TestNonSevenPillageReducesSameRollProduction(t *testing.T) {
	for seed := uint64(1); seed < 600; seed++ {
		s, _ := newGame(t, seed, nil)
		clearStartingCities(s)
		p := s.Cur
		x := ext(s)
		makeCity(s, p) // p's only city; no knights -> weakest defender, gets pillaged

		var cityV board.Vertex
		for v, b := range s.Buildings {
			if b.Owner == p && b.City {
				cityV = v
			}
		}

		// Pick a producing hex next to the city, not under the robber, whose number no
		// other hex the city touches and no other p building shares, so the city's
		// contribution to that number is exactly 1.
		var res board.Resource
		var num int
		picked := false
	cands:
		for _, h := range cityV.Hexes() {
			t0, ok := s.Board.Tiles[h]
			if !ok || !t0.Res.Producing() || t0.Number == 0 || t0.Number == 7 || h == s.Board.Robber {
				continue
			}
			for _, h2 := range cityV.Hexes() {
				if h2 == h {
					continue
				}
				if t2, ok := s.Board.Tiles[h2]; ok && t2.Number == t0.Number {
					continue cands // the city touches a second hex of this number
				}
			}
			for v, b := range s.Buildings {
				if b.Owner != p || v == cityV {
					continue
				}
				for _, hh := range v.Hexes() {
					if tt, ok := s.Board.Tiles[hh]; ok && tt.Number == t0.Number {
						continue cands // another p building shares this number
					}
				}
			}
			res, num, picked = t0.Res, t0.Number, true
			break
		}
		if !picked {
			continue
		}

		d1 := num / 2
		d2 := num - d1
		x.AlchemistD1, x.AlchemistD2 = d1, d2 // force the production total
		x.Attacks = 1                         // not the (possibly skipped) first attack
		x.Barbarians = BarbarianTrack - 1     // this roll is a landfall

		events, err := engine.Decide(s, engine.Command{Player: p, Type: engine.CmdRollDice})
		if err != nil {
			t.Fatalf("seed %d: roll: %v", seed, err)
		}

		pillaged, comAdjusted := false, false
		pGain := 0
		for _, e := range events {
			switch e.Type {
			case EvBarbarianAttack:
				d := engine.DecodeEvent[barbarianAttackData](e)
				for _, dg := range d.Downgraded {
					if dg.Player == p && dg.V == cityV {
						pillaged = true
					}
				}
			case engine.EvResDistributed:
				d := engine.DecodeEvent[engine.ResDistributedData](e)
				for _, g := range d.Gains {
					if g.Player == p {
						pGain = g.Gain[res]
					}
				}
			case EvCommodityAdjust:
				d := engine.DecodeEvent[commodityAdjustData](e)
				if d.Player == p && d.Res == res {
					comAdjusted = true
				}
			default:
			}
		}
		if !pillaged {
			continue // event die wasn't a ship this seed; try another
		}
		if pGain != 1 {
			t.Fatalf("seed %d: pillaged city should produce a settlement's 1 %v, got %d "+
				"(event die must resolve before production)", seed, res, pGain)
		}
		if comAdjusted {
			t.Fatalf("seed %d: pillaged (now settlement) city must yield no %v commodity", seed, res)
		}
		return // verified
	}
	fixtureGone(t, "no seed produced a non-7 ship landfall pillaging the city's hex")
}

func TestImproveAndMetropolis(t *testing.T) {
	s, _ := newGame(t, 4, nil)
	clearStartingCities(s)
	rolled(t, s)
	p := s.Cur

	// Needs a city.
	if _, err := engine.Decide(s, engine.Command{Player: p, Type: CmdImproveCity, Data: mustJSON(t, map[string]any{"track": Trade})}); !errors.Is(err, ErrNeedCity) {
		t.Errorf("no-city improve err = %v", err)
	}
	makeCity(s, p)
	x := ext(s)

	// March Trade to 4: costs 1+2+3+4 cloth.
	for level := range 4 {
		x.Players[p].Commodities[Cloth] = level + 1
		events := step(t, s, engine.Command{Player: p, Type: CmdImproveCity, Data: mustJSON(t, map[string]any{"track": Trade})})
		if level+1 == metropolisLevel {
			foundMetro := false
			for _, e := range events {
				if e.Type == EvMetropolis {
					foundMetro = true
				}
			}
			if !foundMetro {
				t.Fatal("level 4 should claim the metropolis")
			}
		}
	}
	if !x.Players[p].Metropolis[Trade] {
		t.Error("metropolis not held")
	}
	if x.Players[p].Commodities[Cloth] != 0 {
		t.Errorf("commodities left = %d", x.Players[p].Commodities[Cloth])
	}

	// Another player at level 5 steals it.
	q := (p + 1) % engine.PlayerID(len(s.Players))
	makeCity(s, q)
	x.Players[q].Improve[Trade] = 4 // surgically at 4 (no metropolis flag)
	x.Players[q].Commodities[Cloth] = 5
	// q must act on their own turn.
	step(t, s, engine.Command{Player: p, Type: engine.CmdEndTurn})
	for s.Cur != q {
		cmd, ok := engine.AutoCommand(s)
		if !ok {
			t.Fatal("stuck")
		}
		step(t, s, cmd)
	}
	if !s.Rolled {
		rolled(t, s)
	}
	events := step(t, s, engine.Command{Player: q, Type: CmdImproveCity, Data: mustJSON(t, map[string]any{"track": Trade})})
	stole := false
	for _, e := range events {
		if e.Type == EvMetropolis {
			d := engine.DecodeEvent[metropolisData](e)
			if d.Holder == q && d.Prev == p {
				stole = true
			}
		}
	}
	if !stole {
		t.Errorf("level 5 should steal the metropolis: %+v", events)
	}
	if x.Players[p].Metropolis[Trade] || !x.Players[q].Metropolis[Trade] {
		t.Error("metropolis flags wrong after steal")
	}
}

// makeCity upgrades (or plants) a city for the player.
func makeCity(s *engine.State, p engine.PlayerID) {
	for v, b := range s.Buildings {
		if b.Owner == p && !b.City {
			s.Buildings[v] = engine.Building{Owner: p, City: true}
			return
		}
	}
}

// clearStartingCities reverts the Knights round-2 setup cities to settlements,
// so a test can start from two settlements and no city (no incidental
// commodities, no extra barbarian strength or wall targets). Real games start
// with one city each; TestSetupRound2PlacesCity covers that.
func clearStartingCities(s *engine.State) {
	for v, b := range s.Buildings {
		if b.City {
			s.Buildings[v] = engine.Building{Owner: b.Owner}
			s.Players[b.Owner].CitiesLeft++
			s.Players[b.Owner].SettlementsLeft--
		}
	}
}

func TestKnightLifecycleAndBarbarians(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)

	// Build a knight on the road network.
	spot := knightSpotFor(t, s, p)
	s.Players[p].Hand = costKnight
	step(t, s, engine.Command{Player: p, Type: CmdBuildKnight, Data: mustJSON(t, map[string]any{"v": spot})})
	if k := x.Knights[spot]; k.Owner != p || k.Level != 1 || k.Active {
		t.Fatalf("knight = %+v", k)
	}

	// Activate (1 wheat).
	s.Players[p].Hand = costActivate
	step(t, s, engine.Command{Player: p, Type: CmdActivateKnight, Data: mustJSON(t, map[string]any{"v": spot})})
	if !x.Knights[spot].Active {
		t.Fatal("knight not active")
	}

	// An enemy knight blocks our road through its vertex.
	if (Module{}).blocksVertex(s, spot, p+1) != true {
		t.Error("enemy knight should block vertex")
	}
	if (Module{}).blocksVertex(s, spot, p) {
		t.Error("own knight should not block")
	}

	// Barbarian attack: cities exist, our 1 active knight defends.
	makeCity(s, p)
	x.Barbarians = barbarianTrack - 1
	attack, _ := (Module{}).attackEvents(s, x)
	if len(attack) != 1 || attack[0].Type != EvBarbarianAttack {
		t.Fatalf("attack events = %+v", attack)
	}
	d := engine.DecodeEvent[barbarianAttackData](attack[0])
	if d.Cities < 1 {
		t.Fatalf("no cities counted")
	}
	if d.Win != (d.Strength >= d.Cities) {
		t.Error("win flag inconsistent")
	}
	attack[0].Seq = s.NextSeq
	if err := engine.Apply(s, attack[0]); err != nil {
		t.Fatal(err)
	}
	if x.Barbarians != 0 || x.Attacks != 1 {
		t.Errorf("fleet state after attack: %d/%d", x.Barbarians, x.Attacks)
	}
	if x.Knights[spot].Active {
		t.Error("knights should stand down after the attack")
	}
	if !d.Win && len(d.Downgraded) == 0 {
		t.Error("a loss with cities must downgrade someone")
	}
}

// TestWallLostWhenWalledCityPillaged: pillaging a walled city removes the wall
// and its +2 discard bonus.
func TestWallLostWhenWalledCityPillaged(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	clearStartingCities(s)
	rolled(t, s)
	p := s.Cur
	x := ext(s)

	makeCity(s, p)
	s.Players[p].Hand = costWall
	step(t, s, engine.Command{Player: p, Type: CmdBuildWall})
	if x.Players[p].Walls != 1 || len(x.Walled) != 1 {
		t.Fatalf("wall not bound to a city: walls=%d walled=%v", x.Players[p].Walls, x.Walled)
	}

	// No defenders -> the attack is a loss and p's only (walled) city is pillaged.
	x.Barbarians = barbarianTrack - 1
	attack, _ := (Module{}).attackEvents(s, x)
	d := engine.DecodeEvent[barbarianAttackData](attack[0])
	if d.Win {
		fixtureGone(t, "unexpected defended win; need a loss to pillage")
	}
	attack[0].Seq = s.NextSeq
	if err := engine.Apply(s, attack[0]); err != nil {
		t.Fatal(err)
	}
	if x.Players[p].Walls != 0 {
		t.Errorf("wall count not decremented after pillage: %d", x.Players[p].Walls)
	}
	if len(x.Walled) != 0 {
		t.Errorf("walled-vertex set not cleared after pillage: %v", x.Walled)
	}
}

func knightSpotFor(t *testing.T, s *engine.State, p engine.PlayerID) board.Vertex {
	t.Helper()
	for e, owner := range s.Roads {
		if owner != p {
			continue
		}
		for _, v := range []board.Vertex{e.A, e.B} {
			if _, taken := s.Buildings[v]; taken {
				continue
			}
			if _, taken := ext(s).Knights[v]; taken {
				continue
			}
			return v
		}
	}
	fixtureGone(t, "no knight spot")
	return board.Vertex{}
}

// TestKnightRefreshesNextTurn: a knight activated this turn cannot act until a
// new turn starts.
func TestKnightRefreshesNextTurn(t *testing.T) {
	s, _ := newGame(t, 14, nil)
	rolled(t, s)
	p := s.Cur
	spot := knightSpotFor(t, s, p)

	s.Players[p].Hand = costKnight
	step(t, s, engine.Command{Player: p, Type: CmdBuildKnight, Data: mustJSON(t, map[string]any{"v": spot})})
	s.Players[p].Hand = costActivate
	step(t, s, engine.Command{Player: p, Type: CmdActivateKnight, Data: mustJSON(t, map[string]any{"v": spot})})

	x := ext(s)
	if !x.Knights[spot].FreshlyActivated {
		t.Fatal("knight should be freshly activated the turn it is activated")
	}
	// End the turn; the next turn's start must clear the flag.
	step(t, s, engine.Command{Player: p, Type: engine.CmdEndTurn})
	if x.Knights[spot].FreshlyActivated {
		t.Error("knight still freshly activated after the turn passed")
	}
	if !x.Knights[spot].Active {
		t.Error("refresh should not deactivate the knight")
	}
}

// TestDefenderTieDrawsProgress: on a defended win where two players tie for
// strongest, no Defender VP is awarded but each tied player draws a progress
// card.
func TestDefenderTieDrawsProgress(t *testing.T) {
	s, _ := newGame(t, 22, nil)
	clearStartingCities(s)
	x := ext(s)
	// One city -> attack strength 1; two players each field an active knight
	// (strength 1) -> defense 2 >= 1, a win, tied for strongest.
	makeCity(s, 0)
	spot0 := board.Vertex{Q: 0, R: 0, Side: board.N}
	spot1 := board.Vertex{Q: 1, R: 0, Side: board.S}
	x.Knights[spot0] = Knight{Owner: 0, Level: 1, Active: true}
	x.Knights[spot1] = Knight{Owner: 1, Level: 1, Active: true}
	// Both have an improvement so they're eligible to draw.
	x.Players[0].Improve[Trade] = 1
	x.Players[1].Improve[Science] = 1

	attack, tied := (Module{}).attackEvents(s, x)
	d := engine.DecodeEvent[barbarianAttackData](attack[0])
	if !d.Win {
		t.Fatalf("expected a defended win, strength=%d cities=%d", d.Strength, d.Cities)
	}
	if d.Defender != engine.NoPlayer {
		t.Errorf("a tie must award no Defender VP, got holder %d", d.Defender)
	}
	if len(tied) != 2 {
		t.Fatalf("expected two tied defenders, got %v", tied)
	}
}

func TestSkipFirstBarbarianAttack(t *testing.T) {
	s, _ := newGame(t, 6, &Config{SkipFirstBarbarianAttack: true})
	x := ext(s)
	makeCity(s, 0)
	x.Barbarians = barbarianTrack - 1

	attack, _ := (Module{}).attackEvents(s, x)
	d := engine.DecodeEvent[barbarianAttackData](attack[0])
	if !d.Skipped {
		t.Fatal("first attack should be skipped")
	}
	attack[0].Seq = s.NextSeq
	engine.Apply(s, attack[0])
	if x.Attacks != 1 || x.Barbarians != 0 {
		t.Errorf("after skipped attack: %d/%d", x.Attacks, x.Barbarians)
	}
	// Second landfall is real.
	x.Barbarians = barbarianTrack - 1
	attack, _ = (Module{}).attackEvents(s, x)
	if engine.DecodeEvent[barbarianAttackData](attack[0]).Skipped {
		t.Error("only the first attack skips")
	}
}

// TestBarbarianDistanceResolver checks the configured attack threshold clamps to
// [4,12] and otherwise falls back to the default track length.
func TestBarbarianDistanceResolver(t *testing.T) {
	cases := []struct{ in, want int }{
		{0, barbarianTrack},
		{4, 4},
		{7, 7},
		{12, 12},
		{3, barbarianTrack},
		{13, barbarianTrack},
		{-5, barbarianTrack},
	}
	for _, c := range cases {
		if got := (Config{BarbarianDistance: c.in}).barbarianDistance(); got != c.want {
			t.Errorf("barbarianDistance(%d) = %d, want %d", c.in, got, c.want)
		}
	}
}

// TestBarbarianDistanceTriggersAttack: the attack threshold comes from config.
// With the same fleet progress, a short track lands the fleet while the default
// track is still at sea.
func TestBarbarianDistanceTriggersAttack(t *testing.T) {
	// shipAttack advances to a slot whose event die shows a ship, pins the fleet at
	// `progress`, and reports whether that roll fired a barbarian attack. The face
	// depends on (PublicSeed, EventDieSeq(NextSeq)) and the events are not applied,
	// so NextSeq has to be advanced by hand to roll a new face.
	shipAttack := func(t *testing.T, modCfg *Config, progress int) bool {
		t.Helper()
		s, _ := newGame(t, 9, modCfg)
		x := ext(s)
		makeCity(s, 0)
		for range 80 {
			x.Barbarians = progress
			out := (Module{}).onDiceRolled(s, 3, 2)
			ship, atk := false, false
			for _, e := range out {
				switch e.Type {
				case EvEventDie:
					if engine.DecodeEvent[eventDieData](e).Face == "ship" {
						ship = true
					}
				case EvBarbarianAttack:
					atk = true
				default:
				}
			}
			if ship {
				return atk
			}
			s.NextSeq++ // the event die is a function of NextSeq; move it or re-roll nothing
		}
		t.Fatal("no ship face in 80 event-die slots")
		return false
	}

	// Distance 4: a ship at progress 3 lands the fleet (3+1 >= 4).
	if !shipAttack(t, &Config{BarbarianDistance: 4}, 3) {
		t.Error("distance 4: ship at progress 3 should trigger an attack")
	}
	// Default 7: a ship at progress 3 does not (3+1 < 7).
	if shipAttack(t, nil, 3) {
		t.Error("default distance: ship at progress 3 must not trigger an attack")
	}
}

func TestWallsRaiseDiscardLimit(t *testing.T) {
	s, _ := newGame(t, 7, nil)
	rolled(t, s)
	p := s.Cur
	makeCity(s, p)
	s.Players[p].Hand = costWall

	step(t, s, engine.Command{Player: p, Type: CmdBuildWall, Data: mustJSON(t, nil)})
	if got := (Module{}).discardLimitDelta(s, p); got != 2 {
		t.Errorf("delta = %d, want 2", got)
	}
	x := ext(s)
	if x.Players[p].Walls != 1 {
		t.Errorf("walls = %d", x.Players[p].Walls)
	}
}

// The wall bonus must survive the real turn.go 7-roll path: a walled player
// with exactly base+2 cards does not discard; an unwalled one over the base
// limit does.
func TestWallDiscardThresholdThroughRoll(t *testing.T) {
	s, _ := newGame(t, 7, nil)
	p := s.Cur
	q := engine.PlayerID((int(p) + 1) % s.Config.Players)
	ext(s).Players[p].Walls = 1 // threshold 7 + 2 = 9
	s.Players[p].Hand = engine.Hand{board.Wood: 9}
	s.Players[q].Hand = engine.Hand{board.Wood: 8}

	xx := ext(s)
	xx.AlchemistD1, xx.AlchemistD2 = 3, 4 // force a 7
	step(t, s, engine.Command{Player: p, Type: engine.CmdRollDice})

	if n, ok := s.PendingDiscards[p]; ok {
		t.Errorf("walled player with 9 cards forced to discard %d; wall should raise the threshold to 9", n)
	}
	if s.PendingDiscards[q] != 4 {
		t.Errorf("unwalled player with 8 cards: discard = %d, want 4", s.PendingDiscards[q])
	}
}

// On a 7, commodities count toward the discard threshold and the half-discard,
// and a player may pay the requirement with resources and/or commodities; the
// auto-discard spills into commodities when resources fall short.
func TestCommodityDiscardOnSeven(t *testing.T) {
	s, _ := newGame(t, 7, nil)
	p := s.Cur
	s.Players[p].Hand = engine.Hand{board.Wood: 5}
	ext(s).Players[p].Commodities = CommodityHand{Cloth: 6} // 5 + 6 = 11 cards

	xx := ext(s)
	xx.AlchemistD1, xx.AlchemistD2 = 3, 4 // force a 7
	step(t, s, engine.Command{Player: p, Type: engine.CmdRollDice})
	if s.PendingDiscards[p] != 5 { // floor(11/2)
		t.Fatalf("discard need = %d, want 5", s.PendingDiscards[p])
	}

	// Pay 3 resources + 2 commodities = 5.
	step(t, s, engine.Command{Player: p, Type: engine.CmdDiscardCards,
		Data: mustJSON(t, map[string]any{"cards": engine.Hand{board.Wood: 3}, "commodities": CommodityHand{Cloth: 2}})})
	if _, ok := s.PendingDiscards[p]; ok {
		t.Error("discard still pending")
	}
	if s.Players[p].Hand[board.Wood] != 2 || ext(s).Players[p].Commodities[Cloth] != 4 {
		t.Errorf("after discard: wood=%d cloth=%d, want 2/4", s.Players[p].Hand[board.Wood], ext(s).Players[p].Commodities[Cloth])
	}
}

func TestCommodityAutoDiscardSpillsToCommodities(t *testing.T) {
	s, _ := newGame(t, 7, nil)
	p := s.Cur
	s.Players[p].Hand = engine.Hand{board.Wood: 2}
	ext(s).Players[p].Commodities = CommodityHand{Coin: 8} // 2 + 8 = 10 -> discard 5
	xx := ext(s)
	xx.AlchemistD1, xx.AlchemistD2 = 3, 4
	step(t, s, engine.Command{Player: p, Type: engine.CmdRollDice})

	cmd, ok := engine.AutoCommand(s)
	if !ok || cmd.Type != engine.CmdDiscardCards {
		t.Fatalf("auto did not produce a discard: %+v", cmd)
	}
	if _, err := engine.Decide(s, cmd); err != nil {
		t.Fatalf("auto discard rejected: %v", err)
	}
}

// TestCommodityOnlyDiscardClearsRequirement: a 7-discard paid entirely in
// commodities emits only EvCommodityDiscarded, which must still clear the
// pending requirement.
func TestCommodityOnlyDiscardClearsRequirement(t *testing.T) {
	s, _ := newGame(t, 11, nil)
	p := s.Cur
	s.Players[p].Hand = engine.Hand{}                      // no resources at all
	ext(s).Players[p].Commodities = CommodityHand{Coin: 8} // 8 -> discard 4, all commodities
	xx := ext(s)
	xx.AlchemistD1, xx.AlchemistD2 = 3, 4 // force a 7
	step(t, s, engine.Command{Player: p, Type: engine.CmdRollDice})

	if _, ok := s.PendingDiscards[p]; !ok {
		t.Fatal("expected a pending discard for the commodity-heavy player")
	}
	// Resolve every pending discard via auto; it must terminate (no infinite ask).
	for i := 0; len(s.PendingDiscards) > 0; i++ {
		if i > 8 {
			t.Fatal("pending discard never cleared (commodity discard loops)")
		}
		cmd, ok := engine.AutoCommand(s)
		if !ok || cmd.Type != engine.CmdDiscardCards {
			t.Fatalf("auto did not produce a discard: ok=%v %+v", ok, cmd)
		}
		step(t, s, cmd)
	}
	if got := ext(s).Players[p].Commodities[Coin]; got != 4 {
		t.Errorf("expected 4 coins left after discarding 4, got %d", got)
	}
}

func TestProgressDrawPlayAndOverflow(t *testing.T) {
	s, _ := newGame(t, 8, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)

	// Hand a card directly and play it: Warlord activates all knights free.
	spot := knightSpotFor(t, s, p)
	x.Knights[spot] = Knight{Owner: p, Level: 1}
	x.Players[p].Progress = []ProgressCard{CardWarlord}
	deckBefore := x.Decks[Politics][CardWarlord]

	step(t, s, engine.Command{Player: p, Type: CmdPlayProgress, Data: mustJSON(t, map[string]any{"card": CardWarlord})})
	if !x.Knights[spot].Active {
		t.Error("warlord did not activate the knight")
	}
	if len(x.Players[p].Progress) != 0 {
		t.Errorf("card not spent: %v", x.Players[p].Progress)
	}
	// Back under its own deck, not into the shuffled part (see
	// TestPlayedCardGoesUnderTheDeck).
	if x.Decks[Politics][CardWarlord] != deckBefore {
		t.Error("played card went back into the shuffled part of the deck")
	}
	if u := x.Under[Politics]; len(u) != 1 || u[0] != CardWarlord {
		t.Errorf("played card did not go under the deck: bottom = %v", u)
	}

	// Overflow: 5 cards block the game until a discard.
	x.Players[p].Progress = []ProgressCard{CardSpy, CardSpy, CardBishop, CardWedding, CardDeserter}
	if _, err := engine.Decide(s, engine.Command{Player: p, Type: engine.CmdEndTurn}); !errors.Is(err, engine.ErrModulePending) {
		t.Errorf("overflow should block, err = %v", err)
	}
	cmd, ok := engine.AutoCommand(s)
	if !ok || cmd.Type != CmdDiscardProgress {
		t.Fatalf("auto = %+v", cmd)
	}
	step(t, s, cmd)
	if len(x.Players[p].Progress) != 4 {
		t.Errorf("hand after auto discard = %d", len(x.Players[p].Progress))
	}
}

func TestAlchemistFixesNextRoll(t *testing.T) {
	s, _ := newGame(t, 9, nil)
	p := s.Cur
	x := ext(s)
	x.Players[p].Progress = []ProgressCard{CardAlchemist}

	step(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardAlchemist, "d1": 2, "d2": 3})})
	events := step(t, s, engine.Command{Player: p, Type: engine.CmdRollDice})
	var roll engine.DiceRolledData
	for _, e := range events {
		if e.Type == engine.EvDiceRolled {
			roll = engine.DecodeEvent[engine.DiceRolledData](e)
		}
	}
	if roll.D1 != 2 || roll.D2 != 3 {
		t.Errorf("roll = %d,%d, want 2,3", roll.D1, roll.D2)
	}
}

func TestResourceMonopolyCapsAtTwo(t *testing.T) {
	s, _ := newGame(t, 10, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	x.Players[p].Progress = []ProgressCard{CardResourceMonopoly}
	q := (p + 1) % engine.PlayerID(len(s.Players))
	s.Players[q].Hand = engine.Hand{board.Wheat: 4}

	step(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardResourceMonopoly, "res": board.Wheat})})
	if s.Players[q].Hand[board.Wheat] != 2 {
		t.Errorf("victim wheat = %d, want 2 (max 2 taken)", s.Players[q].Hand[board.Wheat])
	}
}

func TestMerchantFleetTurnScoped2to1(t *testing.T) {
	s, _ := newGame(t, 12, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	x.Players[p].Progress = []ProgressCard{CardMerchantFleet}

	// Clear setup buildings so no harbor seat skews the base ratio.
	s.Buildings = nil

	// Before playing it, ore trades at the base 4:1.
	if r := s.BankRatio(p, board.Ore); r != 4 {
		t.Fatalf("base ratio = %d, want 4", r)
	}

	step(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardMerchantFleet, "res": board.Ore})})
	if x.Fleet[p] != board.Ore+1 {
		t.Fatalf("fleet not set: %d", x.Fleet[p])
	}

	// Now ore is 2:1 (the chosen good only), others unchanged.
	if r := s.BankRatio(p, board.Ore); r != 2 {
		t.Errorf("fleet ratio = %d, want 2", r)
	}
	if r := s.BankRatio(p, board.Wood); r != 4 {
		t.Errorf("non-fleet ratio = %d, want 4", r)
	}

	// A 2:1 bank trade succeeds: 2 ore -> 1 wheat.
	s.Players[p].Hand = engine.Hand{board.Ore: 2}
	bankWheat := s.Bank[board.Wheat]
	if bankWheat == 0 {
		s.Bank[board.Wheat] = 1
	}
	step(t, s, engine.Command{Player: p, Type: engine.CmdBankTrade,
		Data: mustJSON(t, map[string]any{"give": board.Ore, "get": board.Wheat, "count": 1})})
	if s.Players[p].Hand[board.Ore] != 0 || s.Players[p].Hand[board.Wheat] != 1 {
		t.Errorf("fleet trade failed: %v", s.Players[p].Hand)
	}

	// The fleet expires when the next turn begins.
	step(t, s, engine.Command{Player: p, Type: engine.CmdEndTurn})
	if x.Fleet[p] != 0 {
		t.Errorf("fleet survived the turn: %d", x.Fleet[p])
	}
}

func TestCommercialHarborInteractive(t *testing.T) {
	s, _ := newGame(t, 16, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	x.Players[p].Progress = []ProgressCard{CardCommercialHarbor}
	s.Players[p].Hand = engine.Hand{board.Wheat: 1} // resource the taker offers
	q := (p + 1) % engine.PlayerID(len(s.Players))
	// Pin q's hand so the wheat assertion counts only the harbor's transfer.
	s.Players[q].Hand = engine.Hand{}
	x.Players[q].Commodities = CommodityHand{Cloth: 1, Paper: 1}

	// Play the harbor, offering q a Wheat in exchange for a commodity of q's choice.
	step(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardCommercialHarbor,
			"gives": []map[string]any{{"player": q, "res": board.Wheat}}})})

	if x.HarborGive[q] != board.Wheat {
		t.Fatalf("harbor not pending for q: %v", x.HarborGive)
	}
	// The turn is blocked until q responds; auto can resolve it.
	if _, err := engine.Decide(s, engine.Command{Player: p, Type: engine.CmdEndTurn}); !errors.Is(err, engine.ErrModulePending) {
		t.Errorf("harbor should block, err = %v", err)
	}

	// q chooses to return Paper (their choice), not Cloth.
	step(t, s, engine.Command{Player: q, Type: CmdHarborGive,
		Data: mustJSON(t, map[string]any{"com": Paper})})

	if s.Players[p].Hand[board.Wheat] != 0 {
		t.Errorf("p did not surrender the offered wheat: %v", s.Players[p].Hand)
	}
	if s.Players[q].Hand[board.Wheat] != 1 {
		t.Errorf("q did not receive wheat: %v", s.Players[q].Hand)
	}
	if x.Players[q].Commodities[Paper] != 0 || x.Players[q].Commodities[Cloth] != 1 {
		t.Errorf("q returned the wrong commodity: %v", x.Players[q].Commodities)
	}
	if x.Players[p].Commodities[Paper] != 1 {
		t.Errorf("p did not receive paper: %v", x.Players[p].Commodities)
	}
	if len(x.HarborGive) != 0 || x.HarborTaker != engine.NoPlayer {
		t.Errorf("harbor pending not cleared: give=%v taker=%d", x.HarborGive, x.HarborTaker)
	}
}

func TestTradingHouseTradeL3(t *testing.T) {
	s, _ := newGame(t, 21, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)

	// Without Trade level 3, the ability is unavailable.
	x.Players[p].Commodities = CommodityHand{Cloth: 2}
	if _, err := engine.Decide(s, engine.Command{Player: p, Type: CmdTradingHouse,
		Data: mustJSON(t, map[string]any{"give": Cloth, "get_res": board.Wheat})}); err == nil {
		t.Fatal("trading house should require Trade level 3")
	}

	x.Players[p].Improve[Trade] = 3

	// 2 cloth -> 1 wheat (from the bank). Asserted as a delta: setup and the
	// production roll already put cards in the hand.
	bankWheat := s.Bank[board.Wheat]
	wheatBefore := s.Players[p].Hand[board.Wheat]
	step(t, s, engine.Command{Player: p, Type: CmdTradingHouse,
		Data: mustJSON(t, map[string]any{"give": Cloth, "get_res": board.Wheat})})
	if x.Players[p].Commodities[Cloth] != 0 {
		t.Errorf("cloth not spent: %v", x.Players[p].Commodities)
	}
	if got := s.Players[p].Hand[board.Wheat]; got != wheatBefore+1 {
		t.Errorf("wheat %d -> %d, want +1: %v", wheatBefore, got, s.Players[p].Hand)
	}
	if s.Bank[board.Wheat] != bankWheat-1 {
		t.Errorf("bank wheat not drawn: got %d want %d", s.Bank[board.Wheat], bankWheat-1)
	}

	// 2 paper -> 1 coin (commodity output, drawn off the coin stack).
	x.Players[p].Commodities = CommodityHand{Paper: 2}
	step(t, s, engine.Command{Player: p, Type: CmdTradingHouse,
		Data: mustJSON(t, map[string]any{"give": Paper, "get_com": Coin})})
	if x.Players[p].Commodities[Paper] != 0 || x.Players[p].Commodities[Coin] != 1 {
		t.Errorf("paper->coin failed: %v", x.Players[p].Commodities)
	}

	// Insufficient commodity is rejected.
	x.Players[p].Commodities = CommodityHand{Cloth: 1}
	if _, err := engine.Decide(s, engine.Command{Player: p, Type: CmdTradingHouse,
		Data: mustJSON(t, map[string]any{"give": Cloth, "get_res": board.Wheat})}); err == nil {
		t.Fatal("trading house should require 2 of the commodity")
	}
}

func TestMasterMerchantChoosesCards(t *testing.T) {
	s, _ := newGame(t, 15, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	x.Players[p].Progress = []ProgressCard{CardMasterMerchant}
	q := (p + 1) % engine.PlayerID(len(s.Players))
	// q must out-score p; give them a known hand.
	makeCity(s, q)
	s.Players[q].Hand = engine.Hand{board.Ore: 1, board.Wheat: 1, board.Wood: 3}

	if s.PublicVP(q) <= s.PublicVP(p) {
		fixtureGone(t, "victim does not out-score the player on this seed")
	}

	// Playing the card opens a look; the thief then picks. A cards field in the
	// play payload is ignored.
	before := s.Players[p].Hand
	step(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardMasterMerchant, "victim": q,
			"cards": engine.Hand{board.Wood: 2}})})
	if x.MMThief != p || x.MMVictim != q {
		t.Fatalf("master merchant look not opened: thief=%d victim=%d", x.MMThief, x.MMVictim)
	}
	if s.Players[p].Hand != before {
		t.Errorf("opening the look must not take anything yet: before %v after %v", before, s.Players[p].Hand)
	}

	// The thief sees the victim's resource hand (reveal hook); others do not.
	if got := (Module{}).revealHands(s, p); len(got) != 1 || got[0] != q {
		t.Errorf("reveal hook should expose victim %d to thief, got %v", q, got)
	}
	if got := (Module{}).revealHands(s, q); got != nil {
		t.Errorf("reveal hook must not expose the hand to non-thieves, got %v", got)
	}

	// Over-taking (more than the victim holds, or more than 2) is rejected.
	reject(t, s, engine.Command{Player: p, Type: CmdMasterMerchantPick,
		Data: mustJSON(t, map[string]any{"cards": engine.Hand{board.Sheep: 2}})}, engine.ErrNoResources)
	reject(t, s, engine.Command{Player: p, Type: CmdMasterMerchantPick,
		Data: mustJSON(t, map[string]any{"cards": engine.Hand{board.Wood: 3}})}, engine.ErrBadCommand)

	// Pick ore + wheat specifically (not random).
	step(t, s, engine.Command{Player: p, Type: CmdMasterMerchantPick,
		Data: mustJSON(t, map[string]any{"cards": engine.Hand{board.Ore: 1, board.Wheat: 1}})})
	if s.Players[p].Hand[board.Ore] != before[board.Ore]+1 || s.Players[p].Hand[board.Wheat] != before[board.Wheat]+1 {
		t.Errorf("did not take the chosen cards: before %v after %v", before, s.Players[p].Hand)
	}
	if s.Players[q].Hand[board.Ore] != 0 || s.Players[q].Hand[board.Wheat] != 0 || s.Players[q].Hand[board.Wood] != 3 {
		t.Errorf("victim hand wrong after take: %v", s.Players[q].Hand)
	}
	if x.MMThief != engine.NoPlayer || x.MMVictim != engine.NoPlayer {
		t.Errorf("look not cleared after the pick: thief=%d victim=%d", x.MMThief, x.MMVictim)
	}
}

// Take 2 cards, or all if fewer. Taking 1 when the victim holds 2 or more is
// refused.
func TestMasterMerchantMustTakeTwo(t *testing.T) {
	s, _ := newGame(t, 15, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	x.Players[p].Progress = []ProgressCard{CardMasterMerchant}
	q := (p + 1) % engine.PlayerID(len(s.Players))
	makeCity(s, q)
	s.Players[q].Hand = engine.Hand{board.Ore: 1, board.Wheat: 1, board.Wood: 3}
	if s.PublicVP(q) <= s.PublicVP(p) {
		fixtureGone(t, "victim does not out-score the player on this seed")
	}

	step(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardMasterMerchant, "victim": q})})
	if x.MMThief != p || x.MMVictim != q {
		t.Fatalf("master merchant look not opened: thief=%d victim=%d", x.MMThief, x.MMVictim)
	}

	// Under-taking (1 card while the victim holds >= 2) is illegal.
	reject(t, s, engine.Command{Player: p, Type: CmdMasterMerchantPick,
		Data: mustJSON(t, map[string]any{"cards": engine.Hand{board.Wood: 1}})}, engine.ErrBadCommand)

	// Taking exactly 2 succeeds.
	step(t, s, engine.Command{Player: p, Type: CmdMasterMerchantPick,
		Data: mustJSON(t, map[string]any{"cards": engine.Hand{board.Wood: 2}})})
	if x.MMThief != engine.NoPlayer {
		t.Errorf("look not cleared after a valid pick: thief=%d", x.MMThief)
	}
}

func TestMasterMerchantTakesCommodity(t *testing.T) {
	s, _ := newGame(t, 15, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	x.Players[p].Progress = []ProgressCard{CardMasterMerchant}
	q := (p + 1) % engine.PlayerID(len(s.Players))
	makeCity(s, q)
	s.Players[p].Hand = engine.Hand{} // zero the thief's hand for absolute assertions
	s.Players[q].Hand = engine.Hand{board.Ore: 1}
	x.Players[q].Commodities = CommodityHand{Coin: 2}
	if s.PublicVP(q) <= s.PublicVP(p) {
		fixtureGone(t, "victim does not out-score the player on this seed")
	}

	step(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardMasterMerchant, "victim": q})})

	// The thief sees the victim's commodity breakdown via ExtView.
	tv := x.ViewExt(p).(*ExtView)
	if tv.MasterMerchant == nil || tv.MasterMerchant.Victim != q {
		t.Fatalf("ExtView should mark the master-merchant victim for the thief: %+v", tv.MasterMerchant)
	}
	if tv.Players[q].Commodities == nil || tv.Players[q].Commodities[Coin] != 2 {
		t.Errorf("thief should see the victim's commodity breakdown: %+v", tv.Players[q].Commodities)
	}
	if ov := x.ViewExt(q).(*ExtView); ov.MasterMerchant != nil {
		t.Errorf("non-thief must not see the master-merchant look")
	}
	// The same thief while a bot plays their seat: the look is the bot's decision,
	// so neither half is shown to them.
	iv := x.ViewExtIdle(p).(*ExtView)
	if iv.MasterMerchant != nil {
		t.Errorf("a bot-held seat must not be shown the look its bot opened: %+v", iv.MasterMerchant)
	}
	if iv.Players[q].Commodities != nil {
		t.Errorf("a bot-held seat must not be shown the victim's commodities: %+v", iv.Players[q].Commodities)
	}
	if iv.Players[p].Commodities == nil {
		t.Errorf("a seat handed to a bot still sees its own commodities")
	}

	// Take 1 resource + 1 commodity from the combined pool.
	step(t, s, engine.Command{Player: p, Type: CmdMasterMerchantPick,
		Data: mustJSON(t, map[string]any{"cards": engine.Hand{board.Ore: 1}, "coms": CommodityHand{Coin: 1}})})

	if s.Players[p].Hand[board.Ore] != 1 {
		t.Errorf("did not take the resource: %v", s.Players[p].Hand)
	}
	if x.Players[p].Commodities[Coin] != 1 || x.Players[q].Commodities[Coin] != 1 {
		t.Errorf("commodity not moved: p=%v q=%v", x.Players[p].Commodities, x.Players[q].Commodities)
	}
	if x.MMThief != engine.NoPlayer {
		t.Errorf("look not cleared after commodity-only take")
	}
}

// TestMasterMerchantAutoPick: on timeout the look auto-resolves, taking 2 cards
// from the victim's combined hand (resources first).
func TestMasterMerchantAutoPick(t *testing.T) {
	s, _ := newGame(t, 15, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	x.Players[p].Progress = []ProgressCard{CardMasterMerchant}
	q := (p + 1) % engine.PlayerID(len(s.Players))
	makeCity(s, q)
	s.Players[p].Hand = engine.Hand{} // zero the thief's hand for absolute assertions
	s.Players[q].Hand = engine.Hand{board.Ore: 3}
	if s.PublicVP(q) <= s.PublicVP(p) {
		fixtureGone(t, "victim does not out-score the player on this seed")
	}
	step(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardMasterMerchant, "victim": q})})

	cmd, ok := (Module{}).auto(s, engine.NoPlayer)
	if !ok || cmd.Type != CmdMasterMerchantPick || cmd.Player != p {
		t.Fatalf("expected an auto master-merchant pick for the thief, got %+v ok=%v", cmd, ok)
	}
	step(t, s, cmd)
	if s.Players[p].Hand[board.Ore] != 2 || s.Players[q].Hand[board.Ore] != 1 {
		t.Errorf("auto-take should move 2 ore: p=%v q=%v", s.Players[p].Hand, s.Players[q].Hand)
	}
}

func TestWeddingPaidInCommodities(t *testing.T) {
	s, _ := newGame(t, 15, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	x.Players[p].Progress = []ProgressCard{CardWedding}
	q := (p + 1) % engine.PlayerID(len(s.Players))
	makeCity(s, q) // out-score p
	s.Players[q].Hand = engine.Hand{}
	x.Players[q].Commodities = CommodityHand{Paper: 3} // only commodities to give
	// Zero p's commodities so the assertion does not depend on what the opening
	// roll produced.
	x.Players[p].Commodities = CommodityHand{}
	if s.PublicVPWithModules(q) <= s.PublicVPWithModules(p) {
		fixtureGone(t, "victim does not out-score the player on this seed")
	}

	step(t, s, engine.Command{Player: p, Type: CmdPlayProgress, Data: mustJSON(t, map[string]any{"card": CardWedding})})
	if x.PendingGive[q] != 2 {
		t.Fatalf("expected q to owe 2: %v", x.PendingGive)
	}
	// Auto-resolve the give; it must pay commodities and clear the debt.
	for i := 0; len(x.PendingGive) > 0; i++ {
		if i > 4 {
			t.Fatal("wedding give never cleared (commodity give loops)")
		}
		cmd, ok := engine.AutoCommand(s)
		if !ok {
			t.Fatal("no auto command for pending wedding give")
		}
		step(t, s, cmd)
	}
	if x.Players[p].Commodities[Paper] != 2 || x.Players[q].Commodities[Paper] != 1 {
		t.Errorf("wedding commodities not transferred: p=%v q=%v", x.Players[p].Commodities, x.Players[q].Commodities)
	}
}

// A Wedding giver whose hand emptied after the card counted it still settles
// the debt, so the game cannot stall on PendingGive (under cak+explorers the
// Explorers pirate can steal the giver's last card).
func TestWeddingEmptyHandedGiverSettles(t *testing.T) {
	s, _ := newGame(t, 15, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	q := (p + 1) % engine.PlayerID(len(s.Players))
	// The Wedding counted one card; it has gone since.
	x.PendingGive = map[engine.PlayerID]int{q: 1}
	x.WeddingTo = p
	s.Players[q].Hand = engine.Hand{}
	x.Players[q].Commodities = CommodityHand{}

	cmd, ok := engine.AutoCommandFor(s, q)
	if !ok || cmd.Type != CmdGiveCards {
		t.Fatalf("no give owed by the empty-handed seat: %+v ok=%v", cmd, ok)
	}
	if evs := step(t, s, cmd); len(evs) == 0 {
		t.Fatal("empty give emitted no events")
	}
	if _, owed := x.PendingGive[q]; owed || x.WeddingTo != engine.NoPlayer {
		t.Fatalf("the debt survived an empty give: pending=%v to=%v", x.PendingGive, x.WeddingTo)
	}
}

func TestAqueductWithoutProduction(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	x.Players[p].Improve[Science] = 3

	// A non-7 roll that granted p nothing must owe p an Aqueduct pick.
	out := (Module{}).onEvents(s, []engine.Event{
		engine.NewEvent(engine.EvDiceRolled, engine.DiceRolledData{Player: p, D1: 1, D2: 2}),
		engine.NewEvent(engine.EvResDistributed, engine.ResDistributedData{Gains: nil}),
	})
	var owed *engine.Event
	for i := range out {
		if out[i].Type == EvAqueductOwed {
			owed = &out[i]
		}
	}
	if owed == nil {
		t.Fatal("expected an Aqueduct grant for the Science-3 player")
	}
	owed.Seq = s.NextSeq
	if err := engine.Apply(s, *owed); err != nil {
		t.Fatal(err)
	}
	if len(x.Aqueduct) != 1 || x.Aqueduct[0] != p {
		t.Fatalf("aqueduct owed set wrong: %v", x.Aqueduct)
	}

	// The grant blocks the turn until resolved; the player picks a resource.
	if _, err := engine.Decide(s, engine.Command{Player: p, Type: engine.CmdEndTurn}); !errors.Is(err, engine.ErrModulePending) {
		t.Errorf("aqueduct grant should block end turn, err = %v", err)
	}
	before := s.Players[p].Hand[board.Wood]
	bank := s.Bank[board.Wood]
	step(t, s, engine.Command{Player: p, Type: CmdAqueductPick, Data: mustJSON(t, map[string]any{"res": board.Wood})})
	if s.Players[p].Hand[board.Wood] != before+1 {
		t.Errorf("aqueduct did not grant wood: %d", s.Players[p].Hand[board.Wood])
	}
	if s.Bank[board.Wood] != bank-1 {
		t.Errorf("bank not drawn for aqueduct: %d", s.Bank[board.Wood])
	}
	if len(x.Aqueduct) != 0 {
		t.Errorf("aqueduct debt not cleared: %v", x.Aqueduct)
	}
}

func TestCommodityPlayerTrade(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	rolled(t, s)
	p := s.Cur
	q := (p + 1) % engine.PlayerID(len(s.Players))
	x := ext(s)
	x.Players[p].Commodities = CommodityHand{Cloth: 1}
	s.Players[p].Hand = engine.Hand{}
	s.Players[q].Hand = engine.Hand{board.Wood: 1}
	x.Players[q].Commodities = CommodityHand{}

	// Offering a commodity you do not hold is rejected.
	if _, err := engine.Decide(s, engine.Command{Player: p, Type: engine.CmdOfferTrade,
		Data: mustJSON(t, map[string]any{"give": engine.Hand{}, "want": engine.Hand{board.Wood: 1}, "give_com": CommodityHand{Paper: 1}})}); err == nil {
		t.Fatal("offering a commodity you lack should fail")
	}

	// p offers 1 cloth for 1 wood; q accepts; p executes.
	step(t, s, engine.Command{Player: p, Type: engine.CmdOfferTrade,
		Data: mustJSON(t, map[string]any{"give": engine.Hand{}, "want": engine.Hand{board.Wood: 1}, "give_com": CommodityHand{Cloth: 1}})})
	step(t, s, engine.Command{Player: q, Type: engine.CmdRespondTrade, Data: mustJSON(t, map[string]any{"accept": true})})
	step(t, s, engine.Command{Player: p, Type: engine.CmdExecuteTrade, Data: mustJSON(t, map[string]any{"with": q})})

	if x.Players[p].Commodities[Cloth] != 0 || x.Players[q].Commodities[Cloth] != 1 {
		t.Errorf("cloth not transferred: p=%v q=%v", x.Players[p].Commodities, x.Players[q].Commodities)
	}
	if s.Players[p].Hand[board.Wood] != 1 || s.Players[q].Hand[board.Wood] != 0 {
		t.Errorf("wood not transferred: p=%v q=%v", s.Players[p].Hand, s.Players[q].Hand)
	}
}

func TestCommodityForCommodityTrade(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	rolled(t, s)
	p := s.Cur
	q := (p + 1) % engine.PlayerID(len(s.Players))
	x := ext(s)
	x.Players[p].Commodities = CommodityHand{Cloth: 1}
	x.Players[q].Commodities = CommodityHand{Coin: 1}
	s.Players[p].Hand, s.Players[q].Hand = engine.Hand{}, engine.Hand{}

	// p gives cloth, wants coin (commodity-for-commodity, no resources).
	step(t, s, engine.Command{Player: p, Type: engine.CmdOfferTrade,
		Data: mustJSON(t, map[string]any{"give": engine.Hand{}, "want": engine.Hand{},
			"give_com": CommodityHand{Cloth: 1}, "want_com": CommodityHand{Coin: 1}})})
	step(t, s, engine.Command{Player: q, Type: engine.CmdRespondTrade, Data: mustJSON(t, map[string]any{"accept": true})})
	step(t, s, engine.Command{Player: p, Type: engine.CmdExecuteTrade, Data: mustJSON(t, map[string]any{"with": q})})

	if x.Players[p].Commodities[Coin] != 1 || x.Players[p].Commodities[Cloth] != 0 {
		t.Errorf("p commodities wrong: %v", x.Players[p].Commodities)
	}
	if x.Players[q].Commodities[Cloth] != 1 || x.Players[q].Commodities[Coin] != 0 {
		t.Errorf("q commodities wrong: %v", x.Players[q].Commodities)
	}
}

// TestSpyLooksAndChooses guards the Spy rule: the thief sees the victim's
// progress hand (and only the thief does) and chooses which card to take.
func TestSpyLooksAndChooses(t *testing.T) {
	s, _ := newGame(t, 9, nil)
	rolled(t, s)
	p := s.Cur
	q := (p + 1) % engine.PlayerID(len(s.Players))
	x := ext(s)
	x.Players[p].Progress = []ProgressCard{CardSpy}
	x.Players[q].Progress = []ProgressCard{CardBishop, CardMedicine, CardWarlord}

	step(t, s, engine.Command{Player: p, Type: CmdPlayProgress, Data: mustJSON(t, map[string]any{"card": CardSpy, "victim": q})})
	if x.SpyThief != p || x.SpyVictim != q {
		t.Fatalf("spy look not opened: thief=%d victim=%d", x.SpyThief, x.SpyVictim)
	}
	// The thief sees the victim's hand; no one else does.
	if tv := x.ViewExt(p).(*ExtView); tv.Spy == nil || len(tv.Spy.Cards) != 3 {
		t.Fatalf("thief should see the victim's 3 cards: %+v", tv.Spy)
	}
	if ov := x.ViewExt(q).(*ExtView); ov.Spy != nil {
		t.Errorf("the victim must not see the spy reveal")
	}
	if sv := x.ViewExt(engine.PlayerID(-1)).(*ExtView); sv.Spy != nil {
		t.Errorf("a spectator must not see the spy reveal")
	}
	// Nor the thief while a bot plays their seat.
	if iv := x.ViewExtIdle(p).(*ExtView); iv.Spy != nil {
		t.Errorf("a bot-held seat must not see the spy reveal its bot opened: %+v", iv.Spy)
	}
	// The thief chooses Medicine specifically (not random).
	step(t, s, engine.Command{Player: p, Type: CmdSpyPick, Data: mustJSON(t, map[string]any{"card": CardMedicine})})
	if !holdsCard(x.Players[p].Progress, CardMedicine) {
		t.Errorf("thief did not receive the chosen card: %v", x.Players[p].Progress)
	}
	if holdsCard(x.Players[q].Progress, CardMedicine) {
		t.Errorf("victim still holds the stolen card: %v", x.Players[q].Progress)
	}
	if x.SpyThief != engine.NoPlayer || x.SpyVictim != engine.NoPlayer {
		t.Errorf("spy state not cleared after pick: %d %d", x.SpyThief, x.SpyVictim)
	}
}

// TestOverLimitCanPlayDownToLimit: when over the 4-card progress limit on your
// own turn you may play a card down to 4, not only discard.
func TestOverLimitCanPlayDownToLimit(t *testing.T) {
	s, _ := newGame(t, 8, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	x.Players[p].Progress = []ProgressCard{CardWarlord, CardSpy, CardBishop, CardWedding, CardMedicine}

	// A sleeping knight gives the Warlord something to do; a no-effect card is
	// refused (ErrCardNoEffect) whatever the hand size.
	x.Knights[knightSpotFor(t, s, p)] = Knight{Owner: p, Level: 1}

	// Over the limit (5); playing a no-arg card must be allowed, not rejected.
	step(t, s, engine.Command{Player: p, Type: CmdPlayProgress, Data: mustJSON(t, map[string]any{"card": CardWarlord})})
	if len(x.Players[p].Progress) != 4 {
		t.Errorf("expected 4 progress cards after playing one over the limit, got %d", len(x.Players[p].Progress))
	}
}

// TestOverLimitWithOnlyDeadCardsCanStillDiscard: refusing no-effect plays must
// not trap a player over the hand limit; discarding still works.
func TestOverLimitWithOnlyDeadCardsCanStillDiscard(t *testing.T) {
	s, _ := newGame(t, 8, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	for v, k := range x.Knights {
		if k.Owner == p {
			delete(x.Knights, v)
		}
	}
	x.Players[p].Progress = []ProgressCard{CardWarlord, CardWarlord, CardWarlord, CardWarlord, CardWarlord}
	reject(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardWarlord})}, ErrCardNoEffect)
	step(t, s, engine.Command{Player: p, Type: CmdDiscardProgress,
		Data: mustJSON(t, map[string]any{"card": CardWarlord})})
	if n := len(x.Players[p].Progress); n != 4 {
		t.Fatalf("progress hand after discard = %d, want 4", n)
	}
}

// TestProgressDiscardHidesCard: an over-limit progress discard is face-down,
// visible only to the discarder, with the card stripped for everyone else.
func TestProgressDiscardHidesCard(t *testing.T) {
	s, _ := newGame(t, 8, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	x.Players[p].Progress = []ProgressCard{CardSpy, CardBishop, CardWedding, CardMedicine, CardMining}

	evs, err := engine.Decide(s, engine.Command{Player: p, Type: CmdDiscardProgress,
		Data: mustJSON(t, map[string]any{"card": CardSpy})})
	if err != nil {
		t.Fatal(err)
	}
	if len(evs) != 1 || evs[0].Type != EvProgressDiscard {
		t.Fatalf("unexpected events: %+v", evs)
	}
	if len(evs[0].Visible) != 1 || evs[0].Visible[0] != p {
		t.Errorf("progress discard not scoped to the discarder: %v", evs[0].Visible)
	}
	red, ok := engine.RedactorFor(EvProgressDiscard)
	if !ok {
		t.Fatal("no redactor registered for EvProgressDiscard")
	}
	var m map[string]any
	if err := json.Unmarshal(red(evs[0]), &m); err != nil {
		t.Fatal(err)
	}
	if _, leaked := m["card"]; leaked {
		t.Errorf("redacted progress discard still leaks the card: %v", m)
	}
}

func TestBarbarianDowngradeWithNoSettlementSupply(t *testing.T) {
	s, _ := newGame(t, 13, nil)
	p := s.Cur
	// Give p a city and exhaust their settlement supply.
	makeCity(s, p)
	var city board.Vertex
	for v, b := range s.Buildings {
		if b.Owner == p && b.City {
			city = v
			break
		}
	}
	s.Players[p].SettlementsLeft = 0

	ev := engine.NewEvent(EvBarbarianAttack, barbarianAttackData{
		Win:        false,
		Defender:   engine.NoPlayer,
		Downgraded: []downgrade{{Player: p, V: city}},
	})
	ev.Seq = s.NextSeq
	if err := engine.Apply(s, ev); err != nil {
		t.Fatal(err)
	}

	if s.Players[p].SettlementsLeft != 0 {
		t.Fatalf("settlements = %d, want 0 (city laid on its side, none drawn from supply)", s.Players[p].SettlementsLeft)
	}
	// With no settlement piece left, the city is laid on its side as a settlement
	// on the same vertex, not removed.
	b, ok := s.Buildings[city]
	if !ok {
		t.Fatalf("pillaged city should remain as a settlement, not be removed")
	}
	if b.City || b.Owner != p {
		t.Errorf("downgraded building = %+v, want a settlement owned by %d", b, p)
	}
	// It must be upgraded before any other settlement of that player.
	if v, must := (Module{}).mustUpgradeFirst(s, p); !must || v != city {
		t.Errorf("must-upgrade-first = (%v,%v), want (%v,true)", v, must, city)
	}
}

// A laid-on-side city must be upgraded before any other settlement of that
// player; upgrading a different settlement first is illegal.
func TestMustUpgradeLaidCityFirst(t *testing.T) {
	s, _ := newGame(t, 15, nil)
	clearStartingCities(s) // leaves p with two settlements
	rolled(t, s)
	p := s.Cur
	x := ext(s)

	var laid, other board.Vertex
	n := 0
	for v, b := range s.Buildings {
		if b.Owner == p && !b.City {
			if n == 0 {
				laid = v
			} else {
				other = v
			}
			n++
		}
	}
	if n < 2 {
		fixtureGone(t, "need two settlements for p")
	}
	x.Players[p].LaidCity = laid
	x.Players[p].LaidCityActive = true
	s.Players[p].Hand = engine.CostCity
	s.Players[p].CitiesLeft = 2

	reject(t, s, engine.Command{Player: p, Type: engine.CmdBuildCity,
		Data: mustJSON(t, map[string]any{"v": other})}, engine.ErrBadPlacement)
	step(t, s, engine.Command{Player: p, Type: engine.CmdBuildCity,
		Data: mustJSON(t, map[string]any{"v": laid})})
	if !s.Buildings[laid].City {
		t.Errorf("laid city was not upgraded")
	}
	if v, must := (Module{}).mustUpgradeFirst(s, p); must {
		t.Errorf("constraint should be lifted after upgrade, still pins %v", v)
	}
}

// While a laid-on-side city is pinned, LegalCities must offer only it, since
// decideBuild refuses every other vertex and bots pick from LegalTargets.
func TestLegalCitiesHonourTheLaidCityPin(t *testing.T) {
	s, _ := newGame(t, 15, nil)
	clearStartingCities(s)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	var laid board.Vertex
	n := 0
	for v, b := range s.Buildings {
		if b.Owner == p && !b.City {
			if n == 0 {
				laid = v
			}
			n++
		}
	}
	if n < 2 {
		fixtureGone(t, "need two settlements for p")
	}
	s.Players[p].CitiesLeft = 2
	if got := s.LegalCities(p); len(got) != n {
		t.Fatalf("unpinned: LegalCities = %v, want all %d settlements", got, n)
	}
	x.Players[p].LaidCity = laid
	x.Players[p].LaidCityActive = true
	got := s.LegalCities(p)
	if len(got) != 1 || got[0] != laid {
		t.Fatalf("pinned to %v: LegalCities = %v, want only the laid city", laid, got)
	}
	if lt := s.LegalTargetsFor(p); len(lt.Cities) != 1 || lt.Cities[0] != laid {
		t.Errorf("pinned to %v: LegalTargets offers cities %v", laid, lt.Cities)
	}
}

func TestBarbarianDowngradeWithSettlementSupply(t *testing.T) {
	s, _ := newGame(t, 14, nil)
	p := s.Cur
	makeCity(s, p)
	var city board.Vertex
	for v, b := range s.Buildings {
		if b.Owner == p && b.City {
			city = v
			break
		}
	}
	s.Players[p].SettlementsLeft = 1

	ev := engine.NewEvent(EvBarbarianAttack, barbarianAttackData{
		Win:        false,
		Defender:   engine.NoPlayer,
		Downgraded: []downgrade{{Player: p, V: city}},
	})
	ev.Seq = s.NextSeq
	if err := engine.Apply(s, ev); err != nil {
		t.Fatal(err)
	}
	b, ok := s.Buildings[city]
	if !ok || b.City {
		t.Errorf("city should have become a settlement, got %+v ok=%v", b, ok)
	}
	if s.Players[p].SettlementsLeft != 0 {
		t.Errorf("settlements = %d, want 0 (one placed)", s.Players[p].SettlementsLeft)
	}
}

func TestWeddingPendingFlow(t *testing.T) {
	s, _ := newGame(t, 11, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	x.Players[p].Progress = []ProgressCard{CardWedding}
	q := (p + 1) % engine.PlayerID(len(s.Players))
	// Make q richer in VP and cards.
	makeCity(s, q)
	s.Players[q].Hand = engine.Hand{board.Ore: 3}

	step(t, s, engine.Command{Player: p, Type: CmdPlayProgress, Data: mustJSON(t, map[string]any{"card": CardWedding})})
	if len(x.PendingGive) == 0 {
		fixtureGone(t, "no player out-VPs the current player on this seed")
	}
	if _, err := engine.Decide(s, engine.Command{Player: p, Type: engine.CmdEndTurn}); !errors.Is(err, engine.ErrModulePending) {
		t.Errorf("wedding should block, err = %v", err)
	}
	// Wrong giver / wrong size rejected; auto resolves.
	if _, err := engine.Decide(s, engine.Command{Player: q, Type: CmdGiveCards, Data: mustJSON(t, map[string]any{"cards": engine.Hand{board.Ore: 1}})}); !errors.Is(err, ErrBadGive) {
		t.Errorf("short give err = %v", err)
	}
	before := s.Players[p].Hand.Count()
	cmd, ok := engine.AutoCommand(s)
	if !ok || cmd.Type != CmdGiveCards {
		t.Fatalf("auto = %+v", cmd)
	}
	step(t, s, cmd)
	if len(x.PendingGive) != 0 && s.Players[p].Hand.Count() == before {
		t.Error("wedding gift not delivered")
	}
}

func TestKnightsVictoryComposition(t *testing.T) {
	s, _ := newGame(t, 12, nil)
	p := engine.PlayerID(0)
	x := ext(s)
	base := s.PublicVP(p)

	x.Players[p].Metropolis[Trade] = true
	x.Players[p].DefenderVP = 1
	x.Players[p].ExtraVP = 1
	if got := (Module{}).victory(s, p); got != metropolisVP+2 {
		t.Errorf("module VP = %d, want %d", got, metropolisVP+2)
	}
	_ = base
}

// TestCraneFirstImprovementFree: Crane makes the level 0->1 city improvement
// cost 0 commodities.
func TestCraneFirstImprovementFree(t *testing.T) {
	s, _ := newGame(t, 30, nil)
	rolled(t, s)
	p := s.Cur
	makeCity(s, p)
	x := ext(s)
	x.Players[p].Progress = []ProgressCard{CardCrane}
	x.Players[p].Commodities = CommodityHand{} // no commodities at all

	track := Trade
	events := step(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardCrane, "track": track})})

	var improved bool
	for _, e := range events {
		if e.Type == EvImproved {
			d := engine.DecodeEvent[improvedData](e)
			if d.Cost != 0 {
				t.Errorf("crane first improvement cost = %d, want 0", d.Cost)
			}
			improved = true
		}
	}
	if !improved {
		t.Fatalf("crane did not improve the city: %+v", events)
	}
	if x.Players[p].Improve[track] != 1 {
		t.Errorf("improve level = %d, want 1", x.Players[p].Improve[track])
	}
}

// TestProgressPlayBlockedByPendingGive: a pending Harbor/Wedding give blocks
// progress-card play.
func TestProgressPlayBlockedByPendingGive(t *testing.T) {
	s, _ := newGame(t, 31, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	x.Players[p].Progress = []ProgressCard{CardWarlord}

	// Stand up a pending give as if a Wedding is unresolved.
	q := (p + 1) % engine.PlayerID(len(s.Players))
	x.PendingGive[q] = 1
	x.WeddingTo = p

	if _, err := engine.Decide(s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardWarlord})}); !errors.Is(err, engine.ErrModulePending) {
		t.Errorf("progress play under pending give err = %v, want ErrModulePending", err)
	}
}

// TestDeserterVictimChoosesThenTakerPlaces drives the full Deserter: the victim
// picks which knight to surrender (the weaker one here), then the taker places
// an equal-strength replacement.
func TestDeserterVictimChoosesThenTakerPlaces(t *testing.T) {
	s, _ := newGame(t, 32, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	q := (p + 1) % engine.PlayerID(len(s.Players))

	// Victim q fields a strong (3) and a weak (1) knight.
	strong := board.Vertex{Q: 2, R: -1, Side: board.N}
	weak := board.Vertex{Q: 3, R: -1, Side: board.N}
	x.Knights[strong] = Knight{Owner: q, Level: 3}
	x.Knights[weak] = Knight{Owner: q, Level: 1}
	x.Players[p].Progress = []ProgressCard{CardDeserter}

	// p plays Deserter naming q. This opens the interaction, removing nothing yet.
	step(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardDeserter, "victim": q})})
	if x.DeserterVictim != q {
		t.Fatalf("expected q to owe a surrender, got %d", x.DeserterVictim)
	}
	if _, ok := x.Knights[strong]; !ok {
		t.Error("no knight should be removed before the victim chooses")
	}

	// q chooses to surrender the weak knight.
	step(t, s, engine.Command{Player: q, Type: CmdDeserterSurrender, Data: mustJSON(t, map[string]any{"v": weak})})
	if _, ok := x.Knights[weak]; ok {
		t.Error("surrendered (weak) knight should be gone")
	}
	if _, ok := x.Knights[strong]; !ok {
		t.Error("the strong knight the victim kept should remain")
	}
	if x.DeserterLevel != 1 || x.DeserterTaker != p {
		t.Fatalf("taker should owe a level-1 placement, got level=%d taker=%d", x.DeserterLevel, x.DeserterTaker)
	}

	// p places the equal-strength (level-1) replacement, inactive.
	spot := knightSpotFor(t, s, p)
	step(t, s, engine.Command{Player: p, Type: CmdDeserterPlace, Data: mustJSON(t, map[string]any{"v": spot})})
	k, ok := x.Knights[spot]
	if !ok || k.Owner != p || k.Level != 1 || k.Active {
		t.Errorf("replacement = %+v, want owner=%d level=1 inactive", k, p)
	}
	if x.DeserterLevel != 0 || x.DeserterTaker != engine.NoPlayer || x.DeserterVictim != engine.NoPlayer {
		t.Error("interaction should be fully cleared after placement")
	}
}

// TestMetropolisCitySurvivesDowngrade: with two cities, one holding a
// metropolis, a barbarian downgrade spares the metropolis city.
func TestMetropolisCitySurvivesDowngrade(t *testing.T) {
	s, _ := newGame(t, 33, nil)
	p := s.Cur
	x := ext(s)

	// Give p two cities by upgrading every building p owns (Knights setup already
	// deals one city).
	var cities []board.Vertex
	for v, b := range s.Buildings {
		if b.Owner == p {
			s.Buildings[v] = engine.Building{Owner: p, City: true}
			cities = append(cities, v)
		}
	}
	if len(cities) < 2 {
		t.Fatalf("player %d holds %d buildings after setup, need 2 to make two cities", p, len(cities))
	}

	// The metropolis goes on the first city in board order, which downgradableCity
	// would otherwise pick.
	first, _ := (Module{}).firstFreeCity(s, x, p)
	x.Players[p].Metropolis[Trade] = true
	x.Players[p].MetropolisAt[Trade] = first

	v, ok := (Module{}).downgradableCity(s, x, p)
	if !ok {
		t.Fatal("expected a downgradable (non-metropolis) city")
	}
	if v == first {
		t.Errorf("downgrade picked the metropolis city %v; it must be spared", first)
	}
}

func TestKnightsReplayEqualsLive(t *testing.T) {
	s, log := newGame(t, 13, nil)
	for i := 0; i < 60 && s.Phase != engine.PhaseFinished; i++ {
		cmd, ok := engine.AutoCommand(s)
		if !ok {
			break
		}
		log = append(log, step(t, s, cmd)...)
	}
	replayed, err := engine.Replay(log)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(s, replayed) {
		t.Errorf("cak replay diverged")
	}
}
