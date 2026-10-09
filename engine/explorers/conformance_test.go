package explorers

import (
	"slices"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// The Engine conformance checklist of docs/rules/explorers.md, one test per
// bullet.
//
// Every state is constructed rather than found by seed search, so no test can
// silently start skipping when the generator changes. Games are set up normally
// and the module's ext is then written directly (a lair with two crews, a ship
// beside a farm, a pirate on a shoal); the tests assert the rules that read it.

// playing returns a game in its play phase, with the dice already rolled for
// seat 0 and no interrupt outstanding, plus its ext for direct construction.
func playing(t *testing.T, players int, seed uint64) (*engine.State, *Ext) {
	t.Helper()
	s := newGame(t, players, seed)
	runSetup(t, s)
	forceRoll(t, s, 3, 5)
	return s, ext(s)
}

// forceRoll folds a chosen roll rather than taking whatever the dice gave, so a
// test about production or a 7 is a test about the rule and not about a seed.
func forceRoll(t *testing.T, s *engine.State, d1, d2 int) {
	t.Helper()
	e := engine.NewEvent(engine.EvDiceRolled, engine.DiceRolledData{Player: s.Cur, D1: d1, D2: d2})
	e.Seq = s.NextSeq
	if err := engine.Apply(s, e); err != nil {
		t.Fatalf("force roll: %v", err)
	}
}

// enterMovement moves the active seat into the Movement phase.
func enterMovement(t *testing.T, s *engine.State) {
	t.Helper()
	apply(t, s, engine.Command{Player: s.Cur, Type: CmdEnterMovement})
}

// placeShip puts a ship of p on edge e with the given hold, straight into the
// ext. Returns its id.
func placeShip(x *Ext, p engine.PlayerID, e board.Edge, hold Cargo) int {
	id := x.NextShip
	x.addShip(Ship{ID: id, Owner: p, E: e, Hold: hold})
	return id
}

// revealAll marks every pool hex explored, for tests about what happens after
// the fog is gone.
func revealAll(x *Ext) {
	for _, p := range x.Pool {
		x.Revealed[p.H] = true
		switch p.Kind {
		case SpecialGold:
			if x.LairCrew[p.H] == nil {
				x.LairCrew[p.H] = make([]int, len(x.Seats))
			}
		case SpecialSpice:
			if x.FarmCrew[p.H] == nil {
				x.FarmCrew[p.H] = make([]bool, len(x.Seats))
				x.FarmSack[p.H] = make([]bool, len(x.Seats))
			}
		case SpecialNone, SpecialShoal:
		}
	}
}

// firstPool finds a pool hex of the given kind. The derivation guarantees three
// of each per region, so it fails rather than skipping.
func firstPool(t *testing.T, x *Ext, kind Special) PoolHex {
	t.Helper()
	for _, p := range x.Pool {
		if p.Kind == kind {
			return p
		}
	}
	t.Fatalf("no pool hex of kind %v", kind)
	return PoolHex{}
}

// seaEdgeOf is an edge of hex h that a ship may stand on, with both ends clear
// of the fog.
func seaEdgeOf(t *testing.T, s *engine.State, x *Ext, h board.Hex) board.Edge {
	t.Helper()
	for _, e := range h.Edges() {
		if sailable(s, x, e) && !vertexTouchesFog(x, e.A) && !vertexTouchesFog(x, e.B) {
			return e
		}
	}
	t.Fatalf("hex %v has no clear sea edge", h)
	return board.Edge{}
}

// ---- turn structure and economy ---------------------------------------------

// TestMovementPhaseIsOneWay: no building and no trading once Movement begins,
// and no way back to the Action phase.
func TestMovementPhaseIsOneWay(t *testing.T) {
	s, _ := playing(t, 3, 21)
	seat := s.Cur
	s.Players[seat].Hand = engine.Hand{board.Wood: 4, board.Brick: 4, board.Sheep: 4, board.Wheat: 4, board.Ore: 4}

	// Before the door: a road is legal.
	roads := s.LegalRoads(seat)
	if len(roads) == 0 {
		t.Fatal("the seat has no legal road")
	}
	road := engine.Command{Player: seat, Type: engine.CmdBuildRoad, Data: raw(map[string]any{"e": roads[0]})}
	if _, err := engine.Decide(s, road); err != nil {
		t.Fatalf("a road before the Movement phase: %v", err)
	}

	enterMovement(t, s)
	if x := ext(s); !x.Movement {
		t.Fatal("entering the Movement phase did not set the flag")
	}
	for _, cmd := range []engine.Command{
		road,
		{Player: seat, Type: engine.CmdBankTrade, Data: raw(map[string]any{"give": board.Wood, "get": board.Ore})},
		{Player: seat, Type: engine.CmdOfferTrade, Data: raw(map[string]any{
			"give": engine.Hand{board.Wood: 1}, "want": engine.Hand{board.Ore: 1}})},
		{Player: seat, Type: CmdBuildShip, Data: raw(map[string]any{"e": roads[0]})},
		{Player: seat, Type: CmdEnterMovement},
	} {
		if _, err := engine.Decide(s, cmd); err == nil {
			t.Errorf("%s was accepted during the Movement phase", cmd.Type)
		}
	}
	// Ending the turn must still work from the Movement phase.
	if _, err := engine.Decide(s, engine.Command{Player: seat, Type: engine.CmdEndTurn}); err != nil {
		t.Errorf("the turn could not be ended from the Movement phase: %v", err)
	}
}

// TestBankTradeThreeToOne, for every resource, with no ports generated
// and no 2:1 dock rate anywhere.
func TestBankTradeThreeToOne(t *testing.T) {
	s, _ := playing(t, 3, 22)
	seat := s.Cur
	for _, r := range board.Resources {
		if got := s.BankRatios(seat)[r]; got != BankRatio {
			t.Errorf("bank ratio for %v is %d, want %d", r, got, BankRatio)
		}
	}
	s.Players[seat].Hand = engine.Hand{board.Wood: 3}
	apply(t, s, engine.Command{Player: seat, Type: engine.CmdBankTrade,
		Data: raw(map[string]any{"give": board.Wood, "get": board.Ore})})
	if got := s.Players[seat].Hand; got[board.Wood] != 0 || got[board.Ore] != 1 {
		t.Errorf("after a 3:1 trade the hand is %v", got)
	}
	// And the gold lane: three identical cards buy one gold.
	s.Players[seat].Hand = engine.Hand{board.Brick: 3}
	before := ext(s).Seats[seat].Gold
	apply(t, s, engine.Command{Player: seat, Type: CmdBankGold, Data: raw(map[string]any{"res": board.Brick})})
	if got := ext(s).Seats[seat].Gold; got != before+1 {
		t.Errorf("three bricks bought %d gold, want 1", got-before)
	}
}

// TestGoldBuysTwiceATurn and no more, and Fast Gold is additive to it rather
// than instead of it.
func TestGoldBuysTwiceATurn(t *testing.T) {
	s, x := playing(t, 3, 23)
	seat := s.Cur
	x.Seats[seat].Gold = 20
	for i := range GoldBuysPerTurn {
		apply(t, s, engine.Command{Player: seat, Type: CmdGoldBuy, Data: raw(map[string]any{"res": board.Ore})})
		if got := ext(s).Seats[seat].GoldBuys; got != i+1 {
			t.Fatalf("after %d purchases the counter reads %d", i+1, got)
		}
	}
	if _, err := engine.Decide(s, engine.Command{Player: seat, Type: CmdGoldBuy,
		Data: raw(map[string]any{"res": board.Ore})}); err == nil {
		t.Error("a third 2-gold purchase was allowed in one turn")
	}
	// Fast Gold sells, and it is a different counter.
	x = ext(s)
	x.Seats[seat].Villages[VillageGold][RegionNorth] = true
	s.Players[seat].Hand[board.Wood] = 1
	apply(t, s, engine.Command{Player: seat, Type: CmdGoldSell, Data: raw(map[string]any{"res": board.Wood})})
	if _, err := engine.Decide(s, engine.Command{Player: seat, Type: CmdGoldSell,
		Data: raw(map[string]any{"res": board.Wood})}); err == nil {
		t.Error("a second Fast Gold sale was allowed with only one village")
	}
	x = ext(s)
	x.Seats[seat].Villages[VillageGold][RegionSouth] = true
	s.Players[seat].Hand[board.Wood] = 1
	if _, err := engine.Decide(s, engine.Command{Player: seat, Type: CmdGoldSell,
		Data: raw(map[string]any{"res": board.Wood})}); err != nil {
		t.Errorf("both Fast Gold villages did not buy a second sale: %v", err)
	}
}

// TestPerTurnCountersResetAtTurnStart: the five counters the spec names are all
// cleared by the same event.
func TestPerTurnCountersResetAtTurnStart(t *testing.T) {
	s, x := playing(t, 2, 24)
	seat := s.Cur
	x.Seats[seat].GoldBuys = GoldBuysPerTurn
	x.Seats[seat].FastGold = 2
	x.FishRolled = true
	x.Movement = true
	x.Tribute[1] = true
	id := placeShip(x, seat, seaEdgeOf(t, s, x, x.Council), Cargo{})
	sh := x.Ships[id]
	sh.Used, sh.Bonus, sh.Moved, sh.Done, sh.Fought = 3, 2, true, true, true
	x.Ships[id] = sh

	apply(t, s, engine.Command{Player: seat, Type: engine.CmdEndTurn})
	x = ext(s)
	if x.Seats[seat].GoldBuys != 0 || x.Seats[seat].FastGold != 0 {
		t.Errorf("gold counters survived the turn: buys=%d fast=%d", x.Seats[seat].GoldBuys, x.Seats[seat].FastGold)
	}
	if x.FishRolled || x.Movement || len(x.Tribute) != 0 {
		t.Errorf("phase state survived the turn: fish=%v movement=%v tribute=%d", x.FishRolled, x.Movement, len(x.Tribute))
	}
	got := x.Ships[id]
	if got.Used != 0 || got.Bonus != 0 || got.Moved || got.Done || got.Fought {
		t.Errorf("ship state survived the turn: %+v", got)
	}
}

// TestNoResourcesPaysGold.
func TestNoResourcesPaysGold(t *testing.T) {
	s := newGame(t, 3, 25)
	runSetup(t, s)
	before := make([]int, len(s.Players))
	for p := range s.Players {
		before[p] = ext(s).Seats[p].Gold
	}
	// 1 + 1 is the smallest real roll and rarely pays anybody. The check is per
	// seat against what that seat received.
	evs, err := engine.Decide(s, engine.Command{Player: s.Cur, Type: engine.CmdRollDice})
	if err != nil {
		t.Fatal(err)
	}
	gained := map[engine.PlayerID]bool{}
	for _, e := range evs {
		if e.Type == engine.EvResDistributed {
			for _, g := range engine.DecodeEvent[engine.ResDistributedData](e).Gains {
				if g.Gain.Count() > 0 {
					gained[g.Player] = true
				}
			}
		}
		if err := engine.Apply(s, e); err != nil {
			t.Fatal(err)
		}
	}
	x := ext(s)
	for p := range s.Players {
		seat := engine.PlayerID(p)
		want := before[p]
		if !gained[seat] {
			want++
		}
		if got := x.Seats[p].Gold; got != want {
			t.Errorf("seat %d: gold %d, want %d (received resources: %v)", p, got, want, gained[seat])
		}
	}
}

// TestGoldNotDiscardedOnSeven: gold is never counted toward the hand limit
// and never discarded.
func TestGoldNotDiscardedOnSeven(t *testing.T) {
	s := newGame(t, 3, 26)
	runSetup(t, s)
	x := ext(s)
	x.Seats[0].Gold = 50
	s.Players[0].Hand = engine.Hand{board.Wood: 3, board.Brick: 3} // six cards: under the limit
	forceRoll(t, s, 3, 4)
	if n, owed := s.PendingDiscards[0]; owed {
		t.Errorf("seat 0 owes %d discards with six cards and fifty gold (gold counted as cards)", n)
	}
	if got := ext(s).Seats[0].Gold; got != 50 {
		t.Errorf("gold moved on a 7: %d", got)
	}
}

// ---- building ---------------------------------------------------------------

// TestNoBuildIntoFog, on a gold field before its lair falls, or on a
// spice farm this seat has not befriended; the farm rule is per player.
func TestNoBuildIntoFog(t *testing.T) {
	_, x := playing(t, 4, 27)
	fogHex := x.Pool[0].H
	for _, v := range fogHex.Vertices() {
		if buildableVertex(x, v, 0) {
			t.Errorf("vertex %v shares an unexplored hex and is buildable", v)
		}
	}

	gold := firstPool(t, x, SpecialGold)
	revealAll(x)
	for _, v := range gold.H.Vertices() {
		if buildableVertex(x, v, 0) {
			t.Errorf("vertex %v is on an uncaptured pirate lair and is buildable", v)
		}
	}
	x.Captured[gold.H] = true
	open := false
	for _, v := range gold.H.Vertices() {
		if buildableVertex(x, v, 0) {
			open = true
		}
	}
	if !open {
		t.Error("a captured gold field is still closed to building")
	}

	farm := firstPool(t, x, SpecialSpice)
	for _, v := range farm.H.Vertices() {
		if buildableVertex(x, v, 0) {
			t.Errorf("vertex %v is on an unbefriended spice farm and is buildable for seat 0", v)
		}
	}
	x.FarmCrew[farm.H][0] = true
	openFor0, openFor1 := false, false
	for _, v := range farm.H.Vertices() {
		if buildableVertex(x, v, 0) {
			openFor0 = true
		}
		if buildableVertex(x, v, 1) {
			openFor1 = true
		}
	}
	if !openFor0 {
		t.Error("a farm the seat has crewed is still closed to it")
	}
	if openFor1 {
		t.Error("a farm crewed by seat 0 is open to seat 1")
	}
}

// TestCoastalEdgeCapacity. The opposite of the Islands rule:
// Islands ships claim their edge, Explorers ships are vehicles and do not.
func TestCoastalEdgeCapacity(t *testing.T) {
	s, x := playing(t, 3, 28)
	seat := s.Cur
	harbour, ok := ownHarbour(s, x, seat)
	if !ok {
		t.Fatal("the seat has no harbour settlement")
	}
	var coastal board.Edge
	for _, e := range harbour.Edges() {
		if e.Valid() && s.Board.LandEdge(e) && sailable(s, x, e) {
			coastal = e
		}
	}
	if coastal == (board.Edge{}) {
		t.Fatal("the harbour settlement has no edge that is both land and sea")
	}
	// A road first.
	s.Players[seat].Hand = engine.Hand{board.Wood: 9, board.Brick: 9, board.Sheep: 9, board.Wheat: 9, board.Ore: 9}
	if _, taken := s.Roads[coastal]; !taken {
		apply(t, s, engine.Command{Player: seat, Type: engine.CmdBuildRoad,
			Data: raw(map[string]any{"e": coastal})})
	}
	// Then two ships on the same edge.
	for i := range ShipsPerEdge {
		if _, err := engine.Decide(s, engine.Command{Player: seat, Type: CmdBuildShip,
			Data: raw(map[string]any{"e": coastal})}); err != nil {
			t.Fatalf("ship %d on a road's edge: %v", i+1, err)
		}
		apply(t, s, engine.Command{Player: seat, Type: CmdBuildShip, Data: raw(map[string]any{"e": coastal})})
	}
	if n := len(shipsOnEdge(ext(s), coastal)); n != ShipsPerEdge {
		t.Fatalf("%d ships on the edge, want %d", n, ShipsPerEdge)
	}
	// A third does not fit.
	if _, err := engine.Decide(s, engine.Command{Player: seat, Type: CmdBuildShip,
		Data: raw(map[string]any{"e": coastal})}); err == nil {
		t.Error("a third ship was built on an edge that holds two")
	}
	// And the road is still there, unmoved.
	if owner, ok := s.Roads[coastal]; !ok || owner != seat {
		t.Error("the road did not survive the ships sharing its edge")
	}
	// The module must not implement OccupiesEdge, which would make the base
	// road build refuse the edge.
	if (Module{}).Hooks().OccupiesEdge != nil {
		t.Error("Explorers implements OccupiesEdge")
	}
}

func shipsOnEdge(x *Ext, e board.Edge) []Ship {
	var out []Ship
	for _, sh := range x.Ships {
		if sh.E == e {
			out = append(out, sh)
		}
	}
	return out
}

// TestShipsBuildBesideHarbourSettlement, never with an end looking into the
// fog, and recycling a ship destroys its cargo.
func TestShipsBuildBesideHarbourSettlement(t *testing.T) {
	s, x := playing(t, 3, 29)
	seat := s.Cur
	s.Players[seat].Hand = engine.Hand{board.Wood: 9, board.Sheep: 9}

	// A plain settlement is not a shipyard.
	plain, ok := ownSettlement(s, x, seat)
	if !ok {
		t.Fatal("the seat has no plain settlement")
	}
	for _, e := range plain.Edges() {
		if !e.Valid() || !sailable(s, x, e) {
			continue
		}
		if _, at := shipAtHarbour(x, e, seat); at {
			continue
		}
		if _, err := engine.Decide(s, engine.Command{Player: seat, Type: CmdBuildShip,
			Data: raw(map[string]any{"e": e})}); err == nil {
			t.Errorf("a ship was built on %v, which touches no harbour settlement of the seat's", e)
		}
	}

	// Recycling: fill the supply, then rebuild over a loaded hull.
	spots := shipBuildSpots(s, x, seat)
	if len(spots) == 0 {
		t.Fatal("no legal ship spot beside the seat's harbour settlement")
	}
	for x.Seats[seat].ShipsLeft > 0 {
		apply(t, s, engine.Command{Player: seat, Type: CmdBuildShip, Data: raw(map[string]any{"e": spots[0]})})
		x = ext(s)
		spots = shipBuildSpots(s, x, seat)
		if len(spots) == 0 {
			break
		}
	}
	if x.Seats[seat].ShipsLeft != 0 {
		t.Fatalf("the supply still holds %d ships after building until it ran out, want 0", x.Seats[seat].ShipsLeft)
	}
	loaded := -1
	for _, sh := range ShipsOf(x, seat) {
		sh.Hold = Cargo{Crew: 2}
		x.Ships[sh.ID] = sh
		loaded = sh.ID
		break
	}
	// The legal list is a union over replacement choices. Select a spot
	// compatible with the particular loaded ship chosen above.
	spots = slices.DeleteFunc(spots, func(e board.Edge) bool { return shipSpotOK(s, x, e, seat, loaded) != nil })
	if len(spots) == 0 {
		t.Fatal("no replacement spot for the selected ship")
	}
	crewsBefore := x.Seats[seat].CrewsLeft
	apply(t, s, engine.Command{Player: seat, Type: CmdBuildShip,
		Data: raw(map[string]any{"e": spots[0], "recycled": loaded})})
	x = ext(s)
	if _, still := x.Ships[loaded]; still {
		t.Error("the recycled ship is still on the board")
	}
	if got := x.Seats[seat].CrewsLeft; got != crewsBefore+2 {
		t.Errorf("the recycled hull's two crews came back as %d, want %d", got-crewsBefore, 2)
	}
}

// TestHarbourSettlementUpgrade, cap at four, and return the
// settlement piece to the supply.
func TestHarbourSettlementUpgrade(t *testing.T) {
	s, x := playing(t, 3, 30)
	seat := s.Cur
	plain, ok := ownSettlement(s, x, seat)
	if !ok {
		t.Fatal("the seat has no plain settlement")
	}
	if !coastal(s, x, plain) {
		// Move the seat's round-2 settlement to a coastal corner of the island
		// rather than relying on the draft having placed it there.
		moved := false
		for _, h := range x.Home {
			for _, v := range h.Vertices() {
				if !coastal(s, x, v) || checkStartSpot(s, x, v, true) != nil {
					continue
				}
				delete(s.Buildings, plain)
				s.Buildings[v] = engine.Building{Owner: seat}
				plain, moved = v, true
				break
			}
			if moved {
				break
			}
		}
		if !moved {
			t.Fatal("the home island has no free coastal intersection")
		}
	}
	s.Players[seat].Hand = engine.Hand{board.Wheat: 2, board.Ore: 2}
	vpBefore := s.VP(seat) + victoryCheck(s, seat)
	settleBefore := s.Players[seat].SettlementsLeft
	apply(t, s, engine.Command{Player: seat, Type: CmdBuildHarbour, Data: raw(map[string]any{"v": plain})})
	x = ext(s)
	if got := s.VP(seat) + victoryCheck(s, seat); got != vpBefore+1 {
		t.Errorf("the upgrade moved the score by %d, want 1", got-vpBefore)
	}
	if got := s.Players[seat].SettlementsLeft; got != settleBefore+1 {
		t.Errorf("the settlement piece did not come back: %d, want %d", got, settleBefore+1)
	}
	if x.Harbours[plain] != seat {
		t.Error("the vertex is not recorded as a harbour settlement")
	}
	// It still produces one resource: it is a base settlement in
	// State.Buildings, never a city.
	if b := s.Buildings[plain]; b.City {
		t.Error("a harbour settlement was folded as a city")
	}
	// The cap.
	if x.Seats[seat].HarboursLeft != MaxHarbours-2 {
		t.Errorf("harbours left %d, want %d (one at setup, one now)", x.Seats[seat].HarboursLeft, MaxHarbours-2)
	}
}

// TestUpgradeOwnCoastalSettlementOnly.
func TestUpgradeOwnCoastalSettlementOnly(t *testing.T) {
	s, x := playing(t, 3, 31)
	seat := s.Cur
	s.Players[seat].Hand = engine.Hand{board.Wheat: 2, board.Ore: 2}
	other := engine.NoPlayer
	var theirs board.Vertex
	for v, b := range s.Buildings {
		if b.Owner != seat {
			other, theirs = b.Owner, v
			break
		}
	}
	if other == engine.NoPlayer {
		t.Fatal("no opponent building to try")
	}
	if _, err := engine.Decide(s, engine.Command{Player: seat, Type: CmdBuildHarbour,
		Data: raw(map[string]any{"v": theirs})}); err == nil {
		t.Error("an opponent's settlement was upgraded")
	}
	// And an inland vertex is refused for want of water.
	for v, b := range s.Buildings {
		if b.Owner == seat && !coastal(s, x, v) {
			if _, err := engine.Decide(s, engine.Command{Player: seat, Type: CmdBuildHarbour,
				Data: raw(map[string]any{"v": v})}); err == nil {
				t.Error("an inland settlement became a harbour settlement")
			}
		}
	}
}

// ---- movement ---------------------------------------------------------------

// TestShipMovementPoints: 4 base, +1 or +2 from Swift Voyage, +2
// for one wool once per ship per turn, capped at 8.
func TestShipMovementPoints(t *testing.T) {
	s, x := playing(t, 2, 32)
	seat := s.Cur
	id := placeShip(x, seat, seaEdgeOf(t, s, x, x.Council), Cargo{})
	for _, tc := range []struct {
		north, south bool
		bonus, want  int
	}{
		{false, false, 0, ShipMP},
		{true, false, 0, ShipMP + 1},
		{true, true, 0, ShipMP + 2},
		{false, false, WoolMP, ShipMP + WoolMP},
		{true, true, WoolMP, MaxMP},
	} {
		x.Seats[seat].Villages[VillageSwift][RegionNorth] = tc.north
		x.Seats[seat].Villages[VillageSwift][RegionSouth] = tc.south
		sh := x.Ships[id]
		sh.Bonus = tc.bonus
		x.Ships[id] = sh
		if got := shipMP(x, sh); got != tc.want {
			t.Errorf("swift %v/%v bonus %d: %d movement points, want %d", tc.north, tc.south, tc.bonus, got, tc.want)
		}
	}
}

// TestOneWoolPerShipPerTurn.
func TestOneWoolPerShipPerTurn(t *testing.T) {
	s, x := playing(t, 2, 33)
	seat := s.Cur
	id := placeShip(x, seat, seaEdgeOf(t, s, x, x.Council), Cargo{})
	enterMovement(t, s)
	s.Players[seat].Hand = engine.Hand{board.Sheep: 5}
	apply(t, s, engine.Command{Player: seat, Type: CmdSpeedShip, Data: raw(map[string]any{"ship_id": id})})
	if got := ext(s).Ships[id].Bonus; got != WoolMP {
		t.Fatalf("one wool bought %d movement points, want %d", got, WoolMP)
	}
	sped := false
	for _, ship := range x.ViewExt(seat).(*ExtView).Ships {
		if ship.ID == id {
			sped = ship.Sped
		}
	}
	if !sped {
		t.Fatal("view permits spending wool a second time")
	}
	if _, err := engine.Decide(s, engine.Command{Player: seat, Type: CmdSpeedShip,
		Data: raw(map[string]any{"ship_id": id})}); err == nil {
		t.Error("a second wool was spent on the same ship in one turn")
	}
}

// TestTwoShipsPerEdge: a ship may move past a full edge and
// may not end on one.
func TestTwoShipsPerEdge(t *testing.T) {
	s, x := playing(t, 3, 34)
	seat := s.Cur
	start := seaEdgeOf(t, s, x, x.Council)
	mover := placeShip(x, seat, start, Cargo{})
	// Fill an adjacent edge with two other ships.
	var full board.Edge
	for _, e := range nextEdges(s, x, start) {
		if len(fogAt(x, e)) == 0 {
			full = e
			break
		}
	}
	if full == (board.Edge{}) {
		t.Fatal("no clear edge beside the Council to fill")
	}
	placeShip(x, 1, full, Cargo{})
	placeShip(x, 2, full, Cargo{})
	enterMovement(t, s)

	if _, err := engine.Decide(s, engine.Command{Player: seat, Type: CmdMoveShip,
		Data: raw(map[string]any{"ship_id": mover, "path": []board.Edge{full}})}); err == nil {
		t.Error("a ship ended its movement on a full edge")
	}
	// Through it and out the other side is fine.
	var beyond board.Edge
	for _, e := range nextEdges(s, x, full) {
		if e != start && len(fogAt(x, e)) == 0 && roomOn(x, e, mover) {
			beyond = e
			break
		}
	}
	if beyond == (board.Edge{}) {
		t.Fatal("nowhere to pass through to")
	}
	if _, err := engine.Decide(s, engine.Command{Player: seat, Type: CmdMoveShip,
		Data: raw(map[string]any{"ship_id": mover, "path": []board.Edge{full, beyond}})}); err != nil {
		t.Errorf("a ship could not pass THROUGH a full edge: %v", err)
	}
}

// TestShipsMoveOneAtATime: movement is not interleaved.
func TestShipsMoveOneAtATime(t *testing.T) {
	s, x := playing(t, 2, 35)
	seat := s.Cur
	start := seaEdgeOf(t, s, x, x.Council)
	a := placeShip(x, seat, start, Cargo{})
	b := placeShip(x, seat, start, Cargo{})
	enterMovement(t, s)
	x = ext(s)

	stepA := oneStep(t, s, x, a)
	apply(t, s, engine.Command{Player: seat, Type: CmdMoveShip,
		Data: raw(map[string]any{"ship_id": a, "path": []board.Edge{stepA}})})
	x = ext(s)
	if mpLeft(x, x.Ships[a]) == 0 {
		t.Fatal("ship A had no points left after one step")
	}
	stepB := oneStep(t, s, x, b)
	apply(t, s, engine.Command{Player: seat, Type: CmdMoveShip,
		Data: raw(map[string]any{"ship_id": b, "path": []board.Edge{stepB}})})
	x = ext(s)
	if !x.Ships[a].Done {
		t.Error("ship A is still movable after ship B started")
	}
	if got := mpLeft(x, x.Ships[a]); got != 0 {
		t.Errorf("ship A has %d movement points left after ship B started", got)
	}
	if _, err := engine.Decide(s, engine.Command{Player: seat, Type: CmdMoveShip,
		Data: raw(map[string]any{"ship_id": a, "path": []board.Edge{stepA}})}); err == nil {
		t.Error("ship A moved again after ship B had started")
	}
}

func oneStep(t *testing.T, s *engine.State, x *Ext, id int) board.Edge {
	t.Helper()
	sh := x.Ships[id]
	for _, e := range nextEdges(s, x, sh.E) {
		if len(fogAt(x, e)) == 0 && roomOn(x, e, id) {
			return e
		}
	}
	t.Fatalf("ship %d has nowhere clear to step", id)
	return board.Edge{}
}

// TestRevealEndsMovementAndPays: the reveal is mandatory, every
// qualifying hex is revealed, each pays its own reward, and remaining movement
// points are forfeited.
func TestRevealEndsMovementAndPays(t *testing.T) {
	s, x := playing(t, 4, 36)
	seat := s.Cur
	// Find a clear edge whose next step touches the fog.
	var from, into board.Edge
	var fogs []board.Hex
	for _, sh := range []board.Edge{} {
		_ = sh
	}
	for _, e := range allSeaEdges(s, x) {
		if len(fogAt(x, e)) > 0 {
			continue
		}
		for _, n := range nextEdges(s, x, e) {
			if f := fogAt(x, n); len(f) > 0 && roomOn(x, n, 0) {
				from, into, fogs = e, n, f
				break
			}
		}
		if into != (board.Edge{}) {
			break
		}
	}
	if into == (board.Edge{}) {
		t.Fatal("no edge one step from the fog")
	}
	id := placeShip(x, seat, from, Cargo{})
	enterMovement(t, s)

	// A path that carries on past the reveal is refused outright.
	beyond := append([]board.Edge{into}, nextEdges(s, ext(s), into)[0])
	if _, err := engine.Decide(s, engine.Command{Player: seat, Type: CmdMoveShip,
		Data: raw(map[string]any{"ship_id": id, "path": beyond})}); err == nil {
		t.Error("a path continued past the hex it revealed")
	}

	goldBefore := ext(s).Seats[seat].Gold
	evs := apply(t, s, engine.Command{Player: seat, Type: CmdMoveShip,
		Data: raw(map[string]any{"ship_id": id, "path": []board.Edge{into}})})
	x = ext(s)
	revealed := map[board.Hex]bool{}
	for _, e := range evs {
		if e.Type == EvHexRevealed {
			revealed[engine.DecodeEvent[revealData](e).H] = true
		}
	}
	if len(revealed) != len(fogs) {
		t.Errorf("%d hexes revealed, want %d (every qualifying hex, not one)", len(revealed), len(fogs))
	}
	for _, h := range fogs {
		if !revealed[h] {
			t.Errorf("hex %v was touched and not revealed", h)
		}
		if !x.Revealed[h] {
			t.Errorf("hex %v is not marked explored", h)
		}
	}
	if !x.Ships[id].Done || mpLeft(x, x.Ships[id]) != 0 {
		t.Error("the ship's movement did not end when it found something")
	}
	// Each hex paid: gold for water and specials, a resource for producing land.
	paidGold, paidRes := 0, 0
	for _, h := range fogs {
		p, _ := poolOf(x, h)
		if p.Kind == SpecialNone && s.Board.Tiles[h].Res.Producing() {
			paidRes++
		} else {
			paidGold += RevealGold
		}
	}
	if got := x.Seats[seat].Gold - goldBefore; got != paidGold {
		t.Errorf("the reveals paid %d gold, want %d", got, paidGold)
	}
	if paidRes > 0 {
		total := 0
		for _, e := range evs {
			if e.Type == EvHexRevealed {
				total += engine.DecodeEvent[revealData](e).Gain.Count()
			}
		}
		if total != paidRes {
			t.Errorf("the reveals paid %d resource cards, want %d", total, paidRes)
		}
	}
}

func allSeaEdges(s *engine.State, x *Ext) []board.Edge {
	seen := map[board.Edge]bool{}
	var out []board.Edge
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, e := range h.Edges() {
			if seen[e] || !sailable(s, x, e) {
				continue
			}
			seen[e] = true
			out = append(out, e)
		}
	}
	slices.SortFunc(out, func(a, b board.Edge) int {
		if edgeLess(a, b) {
			return -1
		}
		return 1
	})
	return out
}

// TestRevealedLandTakesNextChit, in order, from that region's stack.
func TestRevealedLandTakesNextChit(t *testing.T) {
	s, x := playing(t, 4, 37)
	seat := s.Cur
	// A producing-land pool hex, and a ship one step from it.
	var target PoolHex
	for _, p := range x.Pool {
		if p.Kind == SpecialNone && s.Board.Tiles[p.H].Res.Producing() {
			target = p
			break
		}
	}
	if target.H == (board.Hex{}) {
		t.Fatal("the pool has no producing land")
	}
	want := x.Chits[target.Region][x.ChitsUsed[target.Region]]

	// Reveal it directly through the fold, which is what a move does.
	e := engine.NewEvent(EvHexRevealed, revealData{
		Player: seat, H: target.H, Region: target.Region,
		Res: s.Board.Tiles[target.H].Res, Number: want,
	})
	e.Seq = s.NextSeq
	if err := engine.Apply(s, e); err != nil {
		t.Fatal(err)
	}
	x = ext(s)
	if got := s.Board.Tiles[target.H].Number; got != want {
		t.Errorf("the revealed hex carries chit %d, want the stack's top %d", got, want)
	}
	if x.ChitsUsed[target.Region] != 1 {
		t.Errorf("the region's stack was not consumed: used %d", x.ChitsUsed[target.Region])
	}
}

// ---- the pirate --------------------------------------------------------------

// TestPirateLegalHexes: any revealed sea hex, shoals included, except one
// adjacent to the home island. The rim is legal.
func TestPirateLegalHexes(t *testing.T) {
	s, x := playing(t, 3, 38)
	revealAll(x)
	legal := legalPirateHexes(s, x, 0)
	set := map[board.Hex]bool{}
	for _, h := range legal {
		set[h] = true
	}
	if len(legal) == 0 {
		t.Fatal("no legal pirate hex at all")
	}
	for _, h := range legal {
		if !s.Board.IsSea(h) {
			t.Errorf("hex %v is not sea and is offered to the pirate", h)
		}
		if slices.Contains(x.Waters, h) {
			t.Errorf("home-water hex %v is offered to the pirate", h)
		}
		// The rule is adjacency, which is larger than home-water membership: a
		// rim hex can touch the island without being in home waters.
		for _, n := range h.Neighbors() {
			if slices.Contains(x.Home, n) {
				t.Errorf("hex %v touches the home island at %v and is offered to the pirate", h, n)
			}
		}
	}
	for _, h := range x.Waters {
		if set[h] {
			t.Errorf("home water %v is legal", h)
		}
	}
	if set[x.Council] {
		t.Error("the Council hex is legal for the pirate")
	}
	rim := 0
	for _, h := range legal {
		if dist(h) == s.Board.Radius {
			rim++
		}
	}
	if rim == 0 {
		t.Error("no rim hex is legal for the pirate")
	}
	// An unrevealed pool hex is never legal whatever it turns out to be.
	s2, x2 := playing(t, 3, 38)
	for _, h := range legalPirateHexes(s2, x2, 0) {
		if isFog(x2, h) {
			t.Errorf("unexplored hex %v is offered to the pirate", h)
		}
	}
}

// TestPirateActivationRules: place when none is out, move when it is your own,
// displace and replace when it is an opponent's.
func TestPirateActivationRules(t *testing.T) {
	s, x := playing(t, 3, 39)
	revealAll(x)
	seat := s.Cur
	x.PiratePending = true
	x.PirateBy = seat
	legal := legalPirateHexes(s, x, seat)
	if len(legal) < 2 {
		t.Fatal("fewer than two legal pirate hexes")
	}
	apply(t, s, engine.Command{Player: seat, Type: CmdMovePirate, Data: raw(map[string]any{"h": legal[0]})})
	x = ext(s)
	if !x.HasPirate || x.Pirate != legal[0] || x.PirateOwner != seat {
		t.Fatalf("the pirate did not land: %v owner %d", x.Pirate, x.PirateOwner)
	}
	if x.PiratePending {
		t.Error("the activation is still owed after it was answered")
	}

	// Your own pirate may not stay.
	x.PiratePending = true
	x.PirateBy = seat
	if _, err := engine.Decide(s, engine.Command{Player: seat, Type: CmdMovePirate,
		Data: raw(map[string]any{"h": legal[0]})}); err == nil {
		t.Error("a seat left its own pirate ship where it was")
	}
	apply(t, s, engine.Command{Player: seat, Type: CmdMovePirate, Data: raw(map[string]any{"h": legal[1]})})
	x = ext(s)

	// An opponent's is returned and yours goes on a different hex
	// (TestDisplacedPirateMovesHex covers the refusal; this
	// is the landing).
	other := engine.PlayerID((int(seat) + 1) % len(s.Players))
	x.PiratePending = true
	x.PirateBy = other
	evs := apply(t, s, engine.Command{Player: other, Type: CmdMovePirate, Data: raw(map[string]any{"h": legal[0]})})
	x = ext(s)
	if x.PirateOwner != other || x.Pirate != legal[0] {
		t.Errorf("the displacing pirate did not land: owner %d at %v", x.PirateOwner, x.Pirate)
	}
	if x.Seats[seat].PirateOnBoard {
		t.Error("the displaced seat still shows a pirate ship on the board")
	}
	found := false
	for _, e := range evs {
		if e.Type == EvPirateMoved {
			if d := engine.DecodeEvent[pirateData](e); d.Displaced != nil && *d.Displaced == seat {
				found = true
			}
		}
	}
	if !found {
		t.Error("the event did not record whose pirate ship was returned")
	}
}

// TestPirateSteal.
func TestPirateSteal(t *testing.T) {
	s, x := playing(t, 3, 40)
	revealAll(x)
	seat, victim := s.Cur, engine.PlayerID(1)
	if seat == victim {
		victim = 2
	}
	target := legalPirateHexes(s, x, seat)[0]
	placeShip(x, victim, seaEdgeOf(t, s, x, target), Cargo{})
	x.PiratePending = true
	x.PirateBy = seat

	// A victim with cards loses a card, and the event is visible only to the two.
	s.Players[victim].Hand = engine.Hand{board.Ore: 3}
	evs := apply(t, s, engine.Command{Player: seat, Type: CmdMovePirate,
		Data: raw(map[string]any{"h": target, "victim": victim})})
	if got := s.Players[victim].Hand.Count(); got != 2 {
		t.Errorf("the victim holds %d cards, want 2", got)
	}
	for _, e := range evs {
		if e.Type != EvPirateMoved {
			continue
		}
		if e.Visible == nil || !slices.Contains(e.Visible, seat) || !slices.Contains(e.Visible, victim) {
			t.Errorf("the steal is visible to %v, want exactly the thief and the victim", e.Visible)
		}
	}

	// A victim with no cards may lose one gold instead; this is the only way
	// gold is stolen.
	x = ext(s)
	x.PiratePending = true
	x.PirateBy = seat
	s.Players[victim].Hand = engine.Hand{}
	x.Seats[victim].Gold = 4
	x.Seats[seat].Gold = 0
	next := legalPirateHexes(s, x, seat)
	var to board.Hex
	for _, h := range next {
		if h != x.Pirate && len(pirateVictims(x, h, seat)) > 0 {
			to = h
			break
		}
	}
	if to == (board.Hex{}) {
		to = target // the victim's ship is here; the pirate must move away and back
		x.Pirate = next[len(next)-1]
	}
	apply(t, s, engine.Command{Player: seat, Type: CmdMovePirate,
		Data: raw(map[string]any{"h": to, "victim": victim})})
	x = ext(s)
	if x.Seats[victim].Gold != 3 || x.Seats[seat].Gold != 1 {
		t.Errorf("gold after the steal: victim %d, thief %d; want 3 and 1", x.Seats[victim].Gold, x.Seats[seat].Gold)
	}
}

// TestPirateOnShoalRemovesHaul.
func TestPirateOnShoalRemovesHaul(t *testing.T) {
	s, x := playing(t, 3, 41)
	revealAll(x)
	shoal := firstPool(t, x, SpecialShoal)
	x.Hauls[shoal.H] = true
	x.HaulsLeft--
	left := x.HaulsLeft
	x.PiratePending = true
	x.PirateBy = s.Cur
	apply(t, s, engine.Command{Player: s.Cur, Type: CmdMovePirate, Data: raw(map[string]any{"h": shoal.H})})
	x = ext(s)
	if x.Hauls[shoal.H] {
		t.Error("the haul survived a pirate ship landing on its shoal")
	}
	if x.HaulsLeft != left+1 {
		t.Errorf("the haul did not go back to the supply: %d, want %d", x.HaulsLeft, left+1)
	}
}

// TestTributeOneGoldPerShip: charged on movement, never on
// construction, never paid by the pirate's owner, and an unpayable tribute
// closes those edges.
func TestTributeOneGoldPerShip(t *testing.T) {
	s, x := playing(t, 3, 42)
	revealAll(x)
	seat := s.Cur
	owner := engine.PlayerID((int(seat) + 1) % len(s.Players))
	var pirateHex board.Hex
	for _, h := range legalPirateHexes(s, x, owner) {
		if dist(h) < s.Board.Radius {
			pirateHex = h
			break
		}
	}
	if pirateHex == (board.Hex{}) {
		t.Fatal("no interior sea hex for the pirate")
	}
	x.Pirate, x.PirateOwner, x.HasPirate = pirateHex, owner, true

	edges := pirateHex.Edges()
	var from, to board.Edge
	for _, e := range edges {
		if !sailable(s, x, e) || len(fogAt(x, e)) > 0 {
			continue
		}
		for _, n := range nextEdges(s, x, e) {
			if bordersPirate(x, n) && len(fogAt(x, n)) == 0 {
				from, to = e, n
				break
			}
		}
		if to != (board.Edge{}) {
			break
		}
	}
	if to == (board.Edge{}) {
		t.Fatal("could not find two clear edges of the pirate's hex")
	}
	id := placeShip(x, seat, from, Cargo{})
	enterMovement(t, s)
	x = ext(s)

	// No gold: those edges are simply unusable. Not a debt, and no forced sale.
	x.Seats[seat].Gold = 0
	if _, err := engine.Decide(s, engine.Command{Player: seat, Type: CmdMoveShip,
		Data: raw(map[string]any{"ship_id": id, "path": []board.Edge{to}})}); err == nil {
		t.Error("a ship with no gold used the pirate's edges")
	}
	// One gold, once.
	x.Seats[seat].Gold = 5
	apply(t, s, engine.Command{Player: seat, Type: CmdMoveShip,
		Data: raw(map[string]any{"ship_id": id, "path": []board.Edge{to}})})
	x = ext(s)
	if got := x.Seats[seat].Gold; got != 4 {
		t.Errorf("gold after the first move is %d, want 4", got)
	}
	if !x.Tribute[id] {
		t.Error("the ship is not recorded as having paid")
	}
	if mpLeft(x, x.Ships[id]) > 0 {
		apply(t, s, engine.Command{Player: seat, Type: CmdMoveShip,
			Data: raw(map[string]any{"ship_id": id, "path": []board.Edge{from}})})
		if got := ext(s).Seats[seat].Gold; got != 4 {
			t.Errorf("the ship paid twice in one turn: gold %d, want 4", got)
		}
	}
	// The pirate's own owner never pays.
	x = ext(s)
	own := placeShip(x, owner, from, Cargo{})
	if tributeDue(x, x.Ships[own], []board.Edge{to}) {
		t.Error("the pirate's owner was charged tribute")
	}
}

// TestChaseRules.
func TestChaseRules(t *testing.T) {
	s, x := playing(t, 3, 43)
	revealAll(x)
	seat := s.Cur
	owner := engine.PlayerID((int(seat) + 1) % len(s.Players))
	pirateHex := legalPirateHexes(s, x, owner)[0]
	x.Pirate, x.PirateOwner, x.HasPirate = pirateHex, owner, true
	e := seaEdgeOf(t, s, x, pirateHex)
	a := placeShip(x, seat, e, Cargo{})
	b := placeShip(x, seat, e, Cargo{})
	enterMovement(t, s)
	x = ext(s)

	if got := battleReady(x, seat); len(got) != 2 {
		t.Fatalf("%d battle-ready ships, want 2", len(got))
	}
	// A ship that has moved is not battle-ready.
	sh := x.Ships[b]
	sh.Moved = true
	x.Ships[b] = sh
	if got := battleReady(x, seat); len(got) != 1 || got[0] != a {
		t.Errorf("battle-ready after a move: %v, want just ship %d", got, a)
	}
	sh.Moved = false
	x.Ships[b] = sh

	// The nominated order is the roll order, and rolling stops at the first
	// success: never more rolls than ships, and a win is always the last roll.
	evs := apply(t, s, engine.Command{Player: seat, Type: CmdChasePirate,
		Data: raw(map[string]any{"ships": []int{b, a}})})
	var d chaseData
	for _, ev := range evs {
		if ev.Type == EvPirateChased {
			d = engine.DecodeEvent[chaseData](ev)
		}
	}
	if len(d.Rolls) == 0 || len(d.Rolls) > 2 {
		t.Fatalf("%d dice thrown for two ships", len(d.Rolls))
	}
	if d.Need != 6 {
		t.Errorf("the chase needs a %d with no Pirate Bonus village, want 6", d.Need)
	}
	if d.Won != slices.Contains(d.Hits, d.Rolls[len(d.Rolls)-1]) {
		t.Errorf("rolls %v marked won=%v against faces %v", d.Rolls, d.Won, d.Hits)
	}
	if d.Won && len(d.Rolls) == 2 && slices.Contains(d.Hits, d.Rolls[0]) {
		t.Error("a second die was thrown after the first had already driven the pirate off")
	}
	x = ext(s)
	if d.Won {
		if x.HasPirate {
			t.Error("the pirate stayed on the board after a successful chase")
		}
		if !x.PiratePending || x.PirateBy != seat {
			t.Error("a successful chase did not owe the winner their own activation")
		}
	}
}

// The Pirate Bonus faces are pinned by TestPirateBonusChaseNumbers
// (chase_literal_test.go).

// ---- missions -----------------------------------------------------------------

// TestMissionTrackScoring: S then seven spaces worth 1/1/2/2/2/3/3, progress
// past space 7 discarded, the leader holds a 1 VP tile, and a tie on the leading
// space goes to whoever got there first.
func TestMissionTrackScoring(t *testing.T) {
	_, x := playing(t, 3, 45)
	for pos, want := range TrackVP {
		x.Seats[0].Track[TrackFish] = pos
		got := trackVP(pos)
		if got != want {
			t.Errorf("space %d is worth %d, want %d", pos, got, want)
		}
	}
	// Past the end: the marker stays and keeps scoring 3.
	x.Seats[0].Track[TrackFish] = TrackSpaces
	x.advance(0, TrackFish)
	if got := x.Seats[0].Track[TrackFish]; got != TrackSpaces {
		t.Errorf("a marker on the last space moved to %d", got)
	}
	// The tile: seat 0 arrived first, so it keeps it when seat 1 draws level.
	for i := range x.Seats {
		x.Seats[i] = Seat{}
	}
	x.Clock = 0
	x.advance(0, TrackLairs)
	x.advance(1, TrackLairs)
	if got := missionLeader(x, TrackLairs); got != 0 {
		t.Errorf("the tile went to seat %d on a tie, want the seat that arrived first", got)
	}
	x.advance(1, TrackLairs)
	if got := missionLeader(x, TrackLairs); got != 1 {
		t.Errorf("the tile did not move when seat 1 overtook: leader %d", got)
	}
	if got := MissionVP(x, 1); got != TrackVP[2]+BonusTileVP {
		t.Errorf("seat 1 on space 2 with the tile scores %d, want %d", got, TrackVP[2]+BonusTileVP)
	}
}

// TestLairFallsOnThirdCrew: every involved seat
// takes 2 gold and a space, the hero takes one more and one crew back, and the
// chit is flipped.
func TestLairFallsOnThirdCrew(t *testing.T) {
	s, x := playing(t, 3, 46)
	revealAll(x)
	lair := firstPool(t, x, SpecialGold)
	seat := s.Cur
	other := engine.PlayerID((int(seat) + 1) % len(s.Players))
	x.LairCrew[lair.H][seat] = 2
	x.LairCrew[lair.H][other] = 1
	goldBefore := []int{x.Seats[0].Gold, x.Seats[1].Gold, x.Seats[2].Gold}
	crewsBefore := []int{x.Seats[0].CrewsLeft, x.Seats[1].CrewsLeft, x.Seats[2].CrewsLeft}

	// It does not resolve on the third crew: it waits for the end of the active
	// player's Movement phase, here the end of the turn.
	if x.Captured[lair.H] {
		t.Fatal("the lair fell before the Movement phase ended")
	}
	evs := apply(t, s, engine.Command{Player: seat, Type: engine.CmdEndTurn})
	var d lairData
	for _, e := range evs {
		if e.Type == EvLairResolved {
			d = engine.DecodeEvent[lairData](e)
		}
	}
	x = ext(s)
	if !x.Captured[lair.H] {
		t.Fatal("the lair did not fall at the end of the Movement phase")
	}
	if len(d.Involved) != 2 {
		t.Fatalf("%d involved seats, want 2", len(d.Involved))
	}
	if d.Involved[0] != seat {
		t.Errorf("the order starts with seat %d, want the active player %d", d.Involved[0], seat)
	}
	for _, p := range d.Involved {
		if got := x.Seats[p].Gold - goldBefore[p]; got != LairGold {
			t.Errorf("seat %d took %d gold, want %d", p, got, LairGold)
		}
	}
	if d.Hero == engine.NoPlayer {
		t.Fatal("no hero of the battle")
	}
	if got := x.Seats[d.Hero].Track[TrackLairs]; got != 2 {
		t.Errorf("the hero is on space %d, want 2 (one for taking part, one for winning)", got)
	}
	loser := d.Involved[0]
	if loser == d.Hero {
		loser = d.Involved[1]
	}
	if got := x.Seats[loser].Track[TrackLairs]; got != 1 {
		t.Errorf("an involved non-hero is on space %d, want 1", got)
	}
	if got := x.Seats[d.Hero].CrewsLeft - crewsBefore[d.Hero]; got != 1 {
		t.Errorf("the hero got %d crews back, want 1", got)
	}
	if got := s.Board.Tiles[lair.H].Number; got == 0 || got != d.Number {
		t.Errorf("the flipped lair shows chit %d, the event says %d", got, d.Number)
	}
	if !buildableVertex(x, lair.H.Vertices()[0], seat) {
		t.Error("the captured gold field is still closed to building")
	}
}

// TestCapturedGoldFieldPays and an uncaptured one pays
// nothing.
func TestCapturedGoldFieldPays(t *testing.T) {
	s, x := playing(t, 3, 47)
	revealAll(x)
	lair := firstPool(t, x, SpecialGold)
	seat := s.Cur
	// Put a building of the seat's on one of its corners and give it a number.
	v := lair.H.Vertices()[0]
	s.Buildings[v] = engine.Building{Owner: seat}
	setTile(s, lair.H, board.Tile{Res: board.Gold, Number: 5})

	gains := productionGold(s, x, 5, nil)
	total := 0
	for _, e := range gains {
		for _, g := range engine.DecodeEvent[goldData](e).Gains {
			if g.Player == seat && g.Reason == GoldField {
				total += g.Amount
			}
		}
	}
	if total != 0 {
		t.Errorf("an UNcaptured gold field paid %d gold", total)
	}
	x.Captured[lair.H] = true
	total = 0
	for _, e := range productionGold(s, x, 5, nil) {
		for _, g := range engine.DecodeEvent[goldData](e).Gains {
			if g.Player == seat && g.Reason == GoldField {
				total += g.Amount
			}
		}
	}
	if total != GoldFieldYield {
		t.Errorf("a captured gold field paid %d gold per building, want %d", total, GoldFieldYield)
	}
}

// TestSpicePerPlayerPerFarm, the crew is permanent, and the
// advantage lands immediately.
func TestSpicePerPlayerPerFarm(t *testing.T) {
	s, x := playing(t, 3, 48)
	revealAll(x)
	farm := firstPool(t, x, SpecialSpice)
	seat := s.Cur
	id := placeShip(x, seat, seaEdgeOf(t, s, x, farm.H), Cargo{Crew: 1})
	enterMovement(t, s)

	apply(t, s, engine.Command{Player: seat, Type: CmdLandCrew,
		Data: raw(map[string]any{"ship_id": id, "h": farm.H})})
	x = ext(s)
	if !x.FarmCrew[farm.H][seat] || !x.FarmSack[farm.H][seat] {
		t.Fatal("the crew and the sack were not recorded")
	}
	if got := x.Ships[id].Hold; got.Crew != 0 || got.Spice != 1 {
		t.Errorf("the hold reads %+v, want the crew gone and one sack aboard", got)
	}
	if !x.Seats[seat].Villages[farm.Village][farm.Region] {
		t.Error("the advantage did not land the moment the crew did")
	}
	// A second visit is refused, and the crew is not recoverable.
	sh := x.Ships[id]
	sh.Hold = Cargo{Crew: 1}
	x.Ships[id] = sh
	if _, err := engine.Decide(s, engine.Command{Player: seat, Type: CmdLandCrew,
		Data: raw(map[string]any{"ship_id": id, "h": farm.H})}); err == nil {
		t.Error("a second sack was taken from the same village")
	}
	if _, err := engine.Decide(s, engine.Command{Player: seat, Type: CmdTakeCrew,
		Data: raw(map[string]any{"ship_id": id, "h": farm.H})}); err == nil {
		t.Error("a crew was picked back up off a spice farm")
	}
}

// TestDeliveryAtEitherAnchor.
func TestDeliveryAtEitherAnchor(t *testing.T) {
	for _, anchor := range []int{0, 1} {
		s, x := playing(t, 3, 49)
		// The Council's anchors flank its seaward face, so one normally looks
		// into the pool; a ship reaching it would reveal that hex and stop
		// there. Reveal everything first to isolate the delivery rule.
		revealAll(x)
		seat := s.Cur
		// A sea edge with one end on the chosen anchor.
		var berth board.Edge
		for _, e := range x.Anchors[anchor].Edges() {
			if e.Valid() && sailable(s, x, e) && len(fogAt(x, e)) == 0 {
				berth = e
				break
			}
		}
		if berth == (board.Edge{}) {
			t.Fatalf("anchor %d has no clear berth", anchor)
		}
		id := placeShip(x, seat, berth, Cargo{Spice: 2})
		enterMovement(t, s)
		apply(t, s, engine.Command{Player: seat, Type: CmdDeliver, Data: raw(map[string]any{"ship_id": id})})
		x = ext(s)
		if got := x.Seats[seat].Track[TrackSpice]; got != 2 {
			t.Errorf("anchor %d: two sacks moved the spice marker to %d, want 2", anchor, got)
		}
		if !x.Ships[id].Hold.Empty() {
			t.Errorf("anchor %d: the hold is not empty after delivery", anchor)
		}
	}
}

// TestFishRollOncePerPhase.
func TestFishRollOncePerPhase(t *testing.T) {
	s, _ := playing(t, 3, 50)
	seat := s.Cur
	enterMovement(t, s)
	// Nothing is revealed, so no roll can land a haul.
	apply(t, s, engine.Command{Player: seat, Type: CmdFishRoll})
	x := ext(s)
	if len(x.Hauls) != 0 {
		t.Error("a haul was placed on an unexplored shoal")
	}
	if !x.FishRolled {
		t.Error("the roll did not count against the one-per-phase cap")
	}
	if _, err := engine.Decide(s, engine.Command{Player: seat, Type: CmdFishRoll}); err == nil {
		t.Error("a second fishing die was rolled in one Movement phase")
	}
}

// TestHaulIsLargePiece: the ship must be otherwise empty to load one.
func TestHaulIsLargePiece(t *testing.T) {
	s, x := playing(t, 3, 51)
	revealAll(x)
	shoal := firstPool(t, x, SpecialShoal)
	x.Hauls[shoal.H] = true
	seat := s.Cur
	e := seaEdgeOf(t, s, x, shoal.H)
	full := placeShip(x, seat, e, Cargo{Crew: 1})
	empty := placeShip(x, seat, e, Cargo{})
	enterMovement(t, s)
	if _, err := engine.Decide(s, engine.Command{Player: seat, Type: CmdLoadHaul,
		Data: raw(map[string]any{"ship_id": full, "h": shoal.H})}); err == nil {
		t.Error("a haul was loaded into a hold that already carries a crew")
	}
	apply(t, s, engine.Command{Player: seat, Type: CmdLoadHaul,
		Data: raw(map[string]any{"ship_id": empty, "h": shoal.H})})
	if got := ext(s).Ships[empty].Hold.Haul; got != 1 {
		t.Errorf("the empty ship carries %d hauls", got)
	}
}

// ---- founding overseas --------------------------------------------------------

// TestFoundingSpendsSettlerAndShip, needs only the distance rule, and
// returns both pieces to the supply.
func TestFoundingSpendsSettlerAndShip(t *testing.T) {
	s, x := playing(t, 3, 52)
	revealAll(x)
	seat := s.Cur
	// A revealed land hex with a free corner, and a ship on one of its edges.
	var spot board.Vertex
	var e board.Edge
	for _, p := range x.Pool {
		if !s.Board.Land(p.H) || p.Kind != SpecialNone {
			continue
		}
		for _, v := range p.H.Vertices() {
			if foundSpotOK(s, x, v, seat) != nil {
				continue
			}
			for _, ve := range v.Edges() {
				if ve.Valid() && sailable(s, x, ve) {
					spot, e = v, ve
					break
				}
			}
		}
		if e != (board.Edge{}) {
			break
		}
	}
	if e == (board.Edge{}) {
		t.Fatal("no revealed land corner reachable by sea")
	}
	id := placeShip(x, seat, e, Cargo{Settler: 1})
	x.Seats[seat].SettlersLeft--
	x.Seats[seat].ShipsLeft--
	shipsBefore, settlersBefore := x.Seats[seat].ShipsLeft, x.Seats[seat].SettlersLeft
	settleBefore := s.Players[seat].SettlementsLeft
	enterMovement(t, s)

	apply(t, s, engine.Command{Player: seat, Type: CmdFound,
		Data: raw(map[string]any{"ship_id": id, "v": spot})})
	x = ext(s)
	if b, ok := s.Buildings[spot]; !ok || b.Owner != seat || b.City {
		t.Fatalf("no settlement of the seat's at %v", spot)
	}
	if _, still := x.Ships[id]; still {
		t.Error("the ship was left behind")
	}
	if x.Seats[seat].ShipsLeft != shipsBefore+1 {
		t.Errorf("the ship did not come back to the supply: %d", x.Seats[seat].ShipsLeft)
	}
	if x.Seats[seat].SettlersLeft != settlersBefore+1 {
		t.Errorf("the settler did not come back to the supply: %d", x.Seats[seat].SettlersLeft)
	}
	if s.Players[seat].SettlementsLeft != settleBefore-1 {
		t.Error("the settlement piece was not spent")
	}
}

// ---- holds --------------------------------------------------------------------

// TestHoldCapacity: one large piece or two small ones, and no combination that
// breaks it.
func TestHoldCapacity(t *testing.T) {
	for _, tc := range []struct {
		c    Cargo
		fits bool
	}{
		{Cargo{}, true},
		{Cargo{Settler: 1}, true},
		{Cargo{Haul: 1}, true},
		{Cargo{Crew: 1}, true},
		{Cargo{Crew: 2}, true},
		{Cargo{Crew: 1, Spice: 1}, true},
		{Cargo{Spice: 2}, true},
		{Cargo{Settler: 1, Crew: 1}, false},
		{Cargo{Haul: 1, Spice: 1}, false},
		{Cargo{Settler: 1, Haul: 1}, false},
		{Cargo{Crew: 3}, false},
		{Cargo{Crew: 2, Spice: 1}, false},
		{Cargo{Crew: -1}, false},
	} {
		if got := tc.c.Fits(); got != tc.fits {
			t.Errorf("%+v fits = %v, want %v", tc.c, got, tc.fits)
		}
	}
}

// TestShipToShipTransferRefused: a piece crosses only through a shared harbour
// settlement.
func TestShipToShipTransferRefused(t *testing.T) {
	s, x := playing(t, 3, 53)
	seat := s.Cur
	harbour, ok := ownHarbour(s, x, seat)
	if !ok {
		t.Fatal("no harbour settlement")
	}
	var at, away board.Edge
	for _, e := range harbour.Edges() {
		if e.Valid() && sailable(s, x, e) && len(fogAt(x, e)) == 0 {
			at = e
			break
		}
	}
	if at == (board.Edge{}) {
		t.Fatal("the harbour settlement has no clear sea edge")
	}
	for _, e := range nextEdges(s, x, at) {
		if _, isAt := shipAtHarbour(x, e, seat); !isAt && len(fogAt(x, e)) == 0 {
			away = e
			break
		}
	}
	if away == (board.Edge{}) {
		t.Fatal("no edge away from the harbour settlement")
	}
	docked := placeShip(x, seat, at, Cargo{Crew: 1})
	adrift := placeShip(x, seat, away, Cargo{})
	enterMovement(t, s)

	// The relay: unload into the basin, then the other ship comes and loads it.
	apply(t, s, engine.Command{Player: seat, Type: CmdUnload,
		Data: raw(map[string]any{"ship_id": docked, "cargo": Cargo{Crew: 1}})})
	x = ext(s)
	if got := x.Basins[harbour].Crew; got != 1 {
		t.Fatalf("the basin holds %d crews after the unload", got)
	}
	// The ship that is not at the harbour settlement cannot reach the basin.
	if _, err := engine.Decide(s, engine.Command{Player: seat, Type: CmdLoad,
		Data: raw(map[string]any{"ship_id": adrift, "cargo": Cargo{Crew: 1}})}); err == nil {
		t.Error("a ship away from the harbour settlement loaded from its basin")
	}
	// And loading back is fine for the docked one.
	if _, err := engine.Decide(s, engine.Command{Player: seat, Type: CmdLoad,
		Data: raw(map[string]any{"ship_id": docked, "cargo": Cargo{Crew: 1}})}); err != nil {
		t.Errorf("the docked ship could not load from its own basin: %v", err)
	}
}

// ---- victory --------------------------------------------------------------------

// TestVictoryTargetSeventeen, from settlements, harbour settlements,
// mission position and mission tiles only.
func TestVictoryTargetSeventeen(t *testing.T) {
	for _, players := range []int{2, 4, 6, 8, 10} {
		s := newGame(t, players, 54)
		if got := s.Config.TargetVP; got != TargetVP {
			t.Errorf("%d players: target %d, want %d", players, got, TargetVP)
		}
		runSetup(t, s)
		for p := range s.Players {
			if got := engine.WinThreshold(s, engine.PlayerID(p)); got != TargetVP {
				t.Errorf("%d players: seat %d needs %d", players, p, got)
			}
		}
	}
}

// TestSettlerInHoldScoresNothing.
func TestSettlerInHoldScoresNothing(t *testing.T) {
	s, x := playing(t, 3, 55)
	seat := s.Cur
	before := s.VP(seat) + victoryCheck(s, seat)
	placeShip(x, seat, seaEdgeOf(t, s, x, x.Council), Cargo{Settler: 1})
	if got := s.VP(seat) + victoryCheck(s, seat); got != before {
		t.Errorf("a settler aboard moved the score from %d to %d", before, got)
	}
}

// TestNoLongestRoadEverAwarded, however long a road network gets.
func TestNoLongestRoadEverAwarded(t *testing.T) {
	s, _ := playing(t, 2, 56)
	seat := s.Cur
	s.Players[seat].Hand = engine.Hand{board.Wood: 15, board.Brick: 15}
	for range 12 {
		roads := s.LegalRoads(seat)
		if len(roads) == 0 {
			break
		}
		if _, err := engine.Decide(s, engine.Command{Player: seat, Type: engine.CmdBuildRoad,
			Data: raw(map[string]any{"e": roads[0]})}); err != nil {
			break
		}
		apply(t, s, engine.Command{Player: seat, Type: engine.CmdBuildRoad,
			Data: raw(map[string]any{"e": roads[0]})})
		s.Players[seat].Hand = engine.Hand{board.Wood: 15, board.Brick: 15}
	}
	if s.LongestRoadHolder != engine.NoPlayer {
		t.Errorf("the Longest Route was awarded to seat %d in a ruleset that has no such card", s.LongestRoadHolder)
	}
	if engine.LongestRouteLength(s, seat) > 0 && s.LongestRoadHolder != engine.NoPlayer {
		t.Error("a route was measured and awarded")
	}
}

// TestRecyclingNeedsAnEmptySupply: a ship may be returned to supply before
// building only when all three are on the board. Otherwise recycling would be a
// cheap teleport that ignores movement points.
func TestRecyclingNeedsAnEmptySupply(t *testing.T) {
	s, x := playing(t, 3, 28)
	seat := s.Cur
	harbour, ok := ownHarbour(s, x, seat)
	if !ok {
		t.Fatal("the seat has no harbour settlement")
	}
	var coastal board.Edge
	for _, e := range harbour.Edges() {
		if e.Valid() && s.Board.LandEdge(e) && sailable(s, x, e) {
			coastal = e
		}
	}
	if coastal == (board.Edge{}) {
		t.Fatal("the harbour settlement has no edge that is both land and sea")
	}
	s.Players[seat].Hand = engine.Hand{board.Wood: 9, board.Brick: 9, board.Sheep: 9, board.Wheat: 9, board.Ore: 9}

	// One ship of this seat's on the board, and hulls still in supply.
	afloat := placeShip(x, seat, coastal, Cargo{})
	if x.Seats[seat].ShipsLeft == 0 {
		t.Fatal("the fixture has no hull left in supply")
	}
	if _, err := engine.Decide(s, engine.Command{Player: seat, Type: CmdBuildShip,
		Data: raw(map[string]any{"e": coastal, "recycled": afloat})}); err == nil {
		t.Error("a ship was recycled with hulls still in supply")
	}

	// Supply empty: now it is the rule, and it works.
	x.Seats[seat].ShipsLeft = 0
	if _, err := engine.Decide(s, engine.Command{Player: seat, Type: CmdBuildShip,
		Data: raw(map[string]any{"e": coastal, "recycled": afloat})}); err != nil {
		t.Errorf("recycling with an empty supply was refused: %v", err)
	}
	// And an empty supply with nothing named is still refused for want of a piece.
	if _, err := engine.Decide(s, engine.Command{Player: seat, Type: CmdBuildShip,
		Data: raw(map[string]any{"e": coastal})}); err == nil {
		t.Error("a ship was built out of an empty supply with nothing recycled")
	}
}

func TestRecyclingPublishesFullOwnedEdges(t *testing.T) {
	s, x := playing(t, 3, 29)
	p := s.Cur
	spots := shipBuildSpots(s, x, p)
	if len(spots) == 0 {
		t.Fatal("no shipyard")
	}
	e := spots[0]
	x.Ships = map[int]Ship{}
	first := placeShip(x, p, e, Cargo{})
	placeShip(x, p, e, Cargo{})
	x.Seats[p].ShipsLeft = 0
	if !slices.Contains(shipBuildSpots(s, x, p), e) {
		t.Fatal("full owned edge absent from replacement targets")
	}
	s.Players[p].Hand = engine.Hand{board.Wood: 1, board.Sheep: 1}
	apply(t, s, engine.Command{Player: p, Type: CmdBuildShip, Data: raw(map[string]any{"e": e, "recycled": first})})
	if len(shipsOnEdge(x, e)) != 2 {
		t.Fatal("replacement changed edge capacity")
	}
}
