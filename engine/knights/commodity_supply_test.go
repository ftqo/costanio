package knights

import (
	"bytes"
	"encoding/json"
	"errors"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// applyRaw folds a hand-built event, stamping the sequence number the state
// expects. These tests construct events directly because the paths under test
// are fold-side ledger moves, not command validation.
func applyRaw(t *testing.T, s *engine.State, e engine.Event) {
	t.Helper()
	e.Seq = s.NextSeq
	if err := engine.Apply(s, e); err != nil {
		t.Fatal(err)
	}
}

// Commodity stacks are a finite shared supply, so these tests mirror the bank
// shortage rule: a lone claimant takes what is left, a contested stack that
// cannot pay everyone pays nobody, and every card a player gives up returns.

// commodityScene builds a state with one commodity-producing hex, a chosen
// number on it, and one city per named owner around it, then runs the
// production hook for that roll and returns the adjust events. It calls the
// hook directly because the hook owns the shortage decision and the RNG would
// have to be coaxed into the right roll.
func commodityScene(t *testing.T, res board.Resource, supply int, owners []engine.PlayerID) []commodityAdjustData {
	t.Helper()
	s, _ := newGame(t, 1, nil)

	// Find a hex of the wanted terrain and clear every building so only this
	// scene's cities claim from it.
	var hex board.Hex
	found := false
	for h, tile := range s.Board.Tiles {
		if tile.Res == res {
			hex, found = h, true
			break
		}
	}
	if !found {
		fixtureGone(t, "no %v hex on this board", res)
	}
	const roll = 5
	tile := s.Board.Tiles[hex]
	tile.Number = roll
	s.Board.Tiles[hex] = tile
	if s.Board.Robber == hex {
		for h := range s.Board.Tiles {
			if h != hex {
				s.Board.Robber = h
				break
			}
		}
	}
	s.Buildings = map[board.Vertex]engine.Building{}

	verts := hex.Vertices()
	if len(owners) > len(verts) {
		t.Fatalf("scene wants %d cities on a hex with %d corners", len(owners), len(verts))
	}
	// Hand each owner what the bank would have paid (two of the resource), since
	// the hook swaps one per city for the commodity.
	granted := map[engine.PlayerID]engine.Hand{}
	for i, p := range owners {
		s.Buildings[verts[i]] = engine.Building{Owner: p, City: true}
		h := granted[p]
		h[res] += 2
		granted[p] = h
	}

	x := ext(s)
	com, ok := commodityFor(res)
	if !ok {
		t.Fatalf("%v is not a commodity terrain", res)
	}
	x.CommoditySupply[com] = supply

	var gains []engine.PlayerGain
	for p, h := range granted {
		gains = append(gains, engine.PlayerGain{Player: p, Gain: h})
	}
	in := []engine.Event{
		engine.NewEvent(engine.EvDiceRolled, engine.DiceRolledData{D1: 2, D2: 3}),
		engine.NewEvent(engine.EvResDistributed, engine.ResDistributedData{Gains: gains}),
	}
	var out []commodityAdjustData
	for _, e := range (Module{}).onEvents(s, in) {
		if e.Type == EvCommodityAdjust {
			out = append(out, engine.DecodeEvent[commodityAdjustData](e))
		}
	}
	return out
}

func TestCommodityProductionShortage(t *testing.T) {
	// One city per owner, so every claimant is owed exactly one commodity.
	tests := []struct {
		name    string
		supply  int
		owners  []engine.PlayerID
		wantGot map[engine.PlayerID]int // commodities actually received
	}{
		{
			name:    "supply covers a lone claimant",
			supply:  5,
			owners:  []engine.PlayerID{0},
			wantGot: map[engine.PlayerID]int{0: 1},
		},
		{
			name:    "empty stack pays a lone claimant nothing",
			supply:  0,
			owners:  []engine.PlayerID{0},
			wantGot: map[engine.PlayerID]int{0: 0},
		},
		{
			name:    "supply covers every claimant",
			supply:  5,
			owners:  []engine.PlayerID{0, 1, 2},
			wantGot: map[engine.PlayerID]int{0: 1, 1: 1, 2: 1},
		},
		{
			name:    "contested stack that cannot pay all pays none",
			supply:  2,
			owners:  []engine.PlayerID{0, 1, 2},
			wantGot: map[engine.PlayerID]int{0: 0, 1: 0, 2: 0},
		},
		{
			name:    "contested stack pays all when it exactly covers them",
			supply:  3,
			owners:  []engine.PlayerID{0, 1, 2},
			wantGot: map[engine.PlayerID]int{0: 1, 1: 1, 2: 1},
		},
		{
			name:    "empty stack with several claimants pays none",
			supply:  0,
			owners:  []engine.PlayerID{0, 1},
			wantGot: map[engine.PlayerID]int{0: 0, 1: 0},
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			adjs := commodityScene(t, board.Sheep, tc.supply, tc.owners)
			got := map[engine.PlayerID]int{}
			for _, a := range adjs {
				// The resource half always goes back: a pasture city owes one wool and one
				// cloth, so an unpaid cloth must not become a second wool.
				if a.Count != 1 {
					t.Errorf("player %d: Count = %d, want 1 (the resource is always taken back)", a.Player, a.Count)
				}
				got[a.Player] = a.Count - a.Short
			}
			for p, want := range tc.wantGot {
				if got[p] != want {
					t.Errorf("player %d received %d commodities, want %d", p, got[p], want)
				}
			}
		})
	}
}

// TestCommodityShortageLoneClaimant: a single player owed more
// than the stack holds takes what is left.
func TestCommodityShortageLoneClaimant(t *testing.T) {
	// Two cities for one player on the same hex: two commodities owed, one left.
	adjs := commodityScene(t, board.Sheep, 1, []engine.PlayerID{0, 0})
	total, short := 0, 0
	for _, a := range adjs {
		total += a.Count
		short += a.Short
	}
	if total != 2 {
		t.Fatalf("resources taken back = %d, want 2", total)
	}
	if got := total - short; got != 1 {
		t.Errorf("lone claimant received %d commodities, want 1 (the remainder)", got)
	}
}

// TestCommodityAdjustOldEventFolds: events logged before the supply existed
// carry no "short" field and must fold as before, granting the full count.
func TestCommodityAdjustOldEventFolds(t *testing.T) {
	s, _ := newGame(t, 1, nil)
	x := ext(s)
	before := x.CommoditySupply[Cloth]
	s.Players[0].Hand[board.Sheep] = 2

	// A payload as it appears in a log written before this change: no "short".
	applyRaw(t, s, engine.Event{
		Type: EvCommodityAdjust,
		Data: json.RawMessage(`{"player":0,"res":"sheep","commodity":0,"count":2}`),
	})
	if got := x.Players[0].Commodities[Cloth]; got != 2 {
		t.Errorf("old event granted %d cloth, want 2 (unchanged fold)", got)
	}
	if got := x.CommoditySupply[Cloth]; got != before-2 {
		t.Errorf("supply = %d, want %d", got, before-2)
	}
	// The resource half must be unchanged: the two wool the base fold paid are
	// taken back in full.
	if got := s.Players[0].Hand[board.Sheep]; got != 0 {
		t.Errorf("old event left %d wool, want 0 (both were swapped)", got)
	}
}

// TestWithheldCommodityDoesNotBecomeAResource: the base fold pays a city two
// of its resource and this module swaps one for the commodity. If the stack
// cannot pay, the swap's resource must still be returned. A pasture city with
// the cloth stack empty yields 1 wool and nothing else.
func TestWithheldCommodityDoesNotBecomeAResource(t *testing.T) {
	s, _ := newGame(t, 1, nil)
	x := ext(s)
	x.CommoditySupply[Cloth] = 0

	// What the base fold just paid a single pasture city.
	s.Players[0].Hand[board.Sheep] = 2
	bankBefore := s.Bank[board.Sheep]

	// Count is the resource taken back, Short is how much of it bought nothing.
	applyRaw(t, s, engine.NewEvent(EvCommodityAdjust, commodityAdjustData{
		Player: 0, Res: board.Sheep, Commodity: Cloth, Count: 1, Short: 1,
	}))

	if got := s.Players[0].Hand[board.Sheep]; got != 1 {
		t.Errorf("wool = %d, want 1: the withheld cloth must not become a second wool", got)
	}
	if got := x.Players[0].Commodities[Cloth]; got != 0 {
		t.Errorf("cloth = %d, want 0 (the stack was empty)", got)
	}
	if got := s.Bank[board.Sheep]; got != bankBefore+1 {
		t.Errorf("bank wool = %d, want %d: the swapped resource goes back to the bank", got, bankBefore+1)
	}
	if got := x.CommoditySupply[Cloth]; got != 0 {
		t.Errorf("cloth supply = %d, want 0: an empty stack cannot go negative", got)
	}
}

// TestCommodityAdjustShortIsOmittedWhenZero: Short must be absent from the JSON
// when 0, so new events match ones written before the field existed.
func TestCommodityAdjustShortIsOmittedWhenZero(t *testing.T) {
	e := engine.NewEvent(EvCommodityAdjust, commodityAdjustData{
		Player: 0, Res: board.Sheep, Commodity: Cloth, Count: 2,
	})
	if bytes.Contains(e.Data, []byte("short")) {
		t.Errorf("a full grant wrote a short field: %s", e.Data)
	}
	// And present once non-zero, so the shortage survives a round trip.
	e = engine.NewEvent(EvCommodityAdjust, commodityAdjustData{
		Player: 0, Res: board.Sheep, Commodity: Cloth, Count: 2, Short: 1,
	})
	if !bytes.Contains(e.Data, []byte(`"short":1`)) {
		t.Errorf("a short grant did not record it: %s", e.Data)
	}
}

// TestCommoditySupplyStartsFull pins the stack sizes, including scaling past
// four players.
func TestCommoditySupplyStartsFull(t *testing.T) {
	tests := []struct {
		players int
		want    int
	}{
		{3, 12}, {4, 12}, // the base set: 36 cards, 12 per stack
		{5, 18}, {6, 18}, // plus the 18 the 5-6 extension adds, 6 per stack
		{7, 24}, {8, 24},
		{9, 30}, {10, 30},
	}
	for _, tc := range tests {
		if got := CommodityPerType(tc.players); got != tc.want {
			t.Errorf("CommodityPerType(%d) = %d, want %d", tc.players, got, tc.want)
		}
		x := freshExt(tc.players, "base+cak")
		for c := range x.CommoditySupply {
			if x.CommoditySupply[c] != tc.want {
				t.Errorf("%d players: stack %d starts at %d, want %d", tc.players, c, x.CommoditySupply[c], tc.want)
			}
		}
	}
}

// TestCommoditySupplySurvivesClone: Decide runs on a clone, so a supply
// dropped by CloneExt reads as empty stacks and withholds every commodity
// without breaking any conservation check.
func TestCommoditySupplySurvivesClone(t *testing.T) {
	s, _ := newGame(t, 1, nil)
	x := ext(s)
	x.CommoditySupply = CommodityHand{7, 8, 9}
	clone := s.Clone()
	cx, ok := StateExt(clone)
	if !ok {
		t.Fatal("clone lost the module state")
	}
	if cx.CommoditySupply != (CommodityHand{7, 8, 9}) {
		t.Errorf("cloned supply = %v, want [7 8 9]", cx.CommoditySupply)
	}
}

// TestCommoditySpendReturnsToSupply covers the return half of the ledger: every
// commodity a player gives up goes back on its stack.
func TestCommoditySpendReturnsToSupply(t *testing.T) {
	s, _ := newGame(t, 1, nil)
	x := ext(s)
	start := x.CommoditySupply

	t.Run("discard over the hand limit", func(t *testing.T) {
		x.Players[0].Commodities[Cloth] = 3
		x.CommoditySupply[Cloth] = start[Cloth] - 3
		applyRaw(t, s, engine.NewEvent(EvCommodityDiscarded, commodityDiscardData{
			Player: 0, Cards: CommodityHand{Cloth: 2},
		}))
		if got := x.CommoditySupply[Cloth]; got != start[Cloth]-1 {
			t.Errorf("supply after discard = %d, want %d", got, start[Cloth]-1)
		}
	})

	t.Run("city improvement", func(t *testing.T) {
		x.Players[0].Commodities[Coin] = 4
		x.CommoditySupply[Coin] = start[Coin] - 4
		applyRaw(t, s, engine.NewEvent(EvImproved, improvedData{Player: 0, Track: Politics, Cost: 3}))
		if got := x.CommoditySupply[Coin]; got != start[Coin]-1 {
			t.Errorf("supply after improvement = %d, want %d", got, start[Coin]-1)
		}
	})

	t.Run("supply trade", func(t *testing.T) {
		x.Players[0].Commodities[Paper] = 4
		x.CommoditySupply[Paper] = start[Paper] - 4
		x.CommoditySupply[Cloth] = start[Cloth]
		applyRaw(t, s, engine.NewEvent(EvCommodityTraded, commodityTradeData{
			Player: 0, GiveIsCom: true, GiveCom: Paper, GiveN: 4,
			GetIsCom: true, GetCom: Cloth, Count: 1,
			GiveRes: board.ResNone, GetRes: board.ResNone,
		}))
		if got := x.CommoditySupply[Paper]; got != start[Paper] {
			t.Errorf("paper supply = %d, want %d (all four returned)", got, start[Paper])
		}
		if got := x.CommoditySupply[Cloth]; got != start[Cloth]-1 {
			t.Errorf("cloth supply = %d, want %d", got, start[Cloth]-1)
		}
	})
}

// TestCommodityTradeRefusedWhenStackEmpty: a shortfall makes the command
// illegal (error, state untouched) rather than pausing the game.
func TestCommodityTradeRefusedWhenStackEmpty(t *testing.T) {
	s, _ := newGame(t, 1, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	x.Players[p].Commodities[Paper] = 8
	x.CommoditySupply[Cloth] = 0

	cmd := engine.Command{Player: p, Type: CmdCommodityTrade, Data: mustJSON(t, map[string]any{
		"give_com": Paper,
		"get_com":  Cloth,
		"count":    1,
	})}
	if _, err := engine.Decide(s, cmd); !errors.Is(err, ErrComSupplyEmpty) {
		t.Fatalf("Decide err = %v, want ErrComSupplyEmpty", err)
	}
	if x.Players[p].Commodities[Paper] != 8 {
		t.Error("a refused trade changed the player's hand")
	}

	// One card back on the stack and the same trade is legal again.
	x.CommoditySupply[Cloth] = 1
	if _, err := engine.Decide(s, cmd); err != nil {
		t.Fatalf("trade with one card on the stack: %v", err)
	}
}

// TestTradingHouseRefusedWhenStackEmpty: the same check on the Trade-track
// level-3 lane.
func TestTradingHouseRefusedWhenStackEmpty(t *testing.T) {
	s, _ := newGame(t, 1, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)
	x.Players[p].Improve[Trade] = 3
	x.Players[p].Commodities[Paper] = 2
	x.CommoditySupply[Cloth] = 0

	com := Cloth
	cmd := engine.Command{Player: p, Type: CmdTradingHouse, Data: mustJSON(t, map[string]any{
		"give":    Paper,
		"get_com": com,
	})}
	if _, err := engine.Decide(s, cmd); !errors.Is(err, ErrComSupplyEmpty) {
		t.Fatalf("Decide err = %v, want ErrComSupplyEmpty", err)
	}

	x.CommoditySupply[Cloth] = 1
	if _, err := engine.Decide(s, cmd); err != nil {
		t.Fatalf("trading house with one card on the stack: %v", err)
	}
}
