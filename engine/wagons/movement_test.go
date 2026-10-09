package wagons

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// --- what a path costs -----------------------------------------------------

// Conformance: "MP costs 2 / 1 / 1+1 gold / +2 barbarian, exactly."
//
//	no road on it                            2 MP
//	one of your roads                        1 MP
//	another player's road                    1 MP and 1 gold, to that player
//	any of the above, with a barbarian on it +2 MP, the toll unchanged
func TestPathPrices(t *testing.T) {
	s, x := opened(t, 4, "base+wagons")
	me, them := engine.PlayerID(0), engine.PlayerID(1)
	// A path with two ordinary endpoints, away from any trade hex, so nothing
	// about the fixture's shape is doing the work.
	at := centre
	var path board.Edge
	for _, e := range at.Edges() {
		if s.Board.LandEdge(e) && !blockedEdgeOn(s.Board, x.Trade, e) {
			path = e
			break
		}
	}
	if path == (board.Edge{}) {
		t.Fatal("fixture: centre has no ordinary path")
	}
	st := step{To: path.Other(at), E: path}

	cases := []struct {
		name     string
		road     *engine.PlayerID
		barb     bool
		wantMP   int
		wantToll int
		wantPaid engine.PlayerID
	}{
		{"bare path", nil, false, 2, 0, engine.NoPlayer},
		{"your own road", &me, false, 1, 0, engine.NoPlayer},
		{"another player's road", &them, false, 1, 1, them},
		{"bare path under a barbarian", nil, true, 4, 0, engine.NoPlayer},
		{"your own road under a barbarian", &me, true, 3, 0, engine.NoPlayer},
		{"their road under a barbarian", &them, true, 3, 1, them},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			delete(s.Roads, path)
			if tc.road != nil {
				s.Roads[path] = *tc.road
			}
			x.Barb[0] = board.Edge{}
			if tc.barb {
				x.Barb[0] = path
			}
			mp, toll, paid := price(s, x, me, st)
			if mp != tc.wantMP || toll != tc.wantToll || paid != tc.wantPaid {
				t.Fatalf("priced %d MP / %d gold to %v, want %d / %d to %v",
					mp, toll, paid, tc.wantMP, tc.wantToll, tc.wantPaid)
			}
		})
	}
}

// A spoke always costs the bare-path rate and never pays a toll: no road can
// stand on one while the trade-hex tile and its board-level plaza are deferred.
// See the Decision in board.go and in the spec.
func TestSpokeCostsTheBareRateAndPaysNoToll(t *testing.T) {
	s, x := opened(t, 4, "base+wagons")
	corner := aLandCornerOf(t, s, x, 0, 0)
	var spoke step
	for _, st := range steps(s, x, corner) {
		if st.Spoke {
			spoke = st
		}
	}
	if !spoke.Spoke {
		t.Fatal("the land corner has no spoke into its plaza")
	}
	mp, toll, paid := price(s, x, 0, spoke)
	if mp != bareMP || toll != 0 || paid != engine.NoPlayer {
		t.Fatalf("a spoke priced %d MP / %d gold to %v, want %d / 0 / none", mp, toll, paid, bareMP)
	}
	// It is not a board edge, so board.Edge.Valid refuses a road on it without
	// the base game knowing what a spoke is.
	e := board.NewEdge(corner, spoke.To)
	if e.Valid() {
		t.Fatalf("spoke %v is a valid board edge", e)
	}
	refuse(t, s, cmd(s.Cur, engine.CmdBuildRoad, map[string]any{"e": e}), engine.ErrBadPlacement)
}

// --- the allowance ---------------------------------------------------------

// Conformance: "MP allowance 4/5/6/7/7 at radius 2, +2 per ring beyond it."
func TestAllowanceTrackAndRingScaling(t *testing.T) {
	// The board's radius comes from the player count: 2 at 2-4 seats, 3 at 5-6,
	// 4 at 7-10. Each ring beyond 2 adds 2 MP at every level.
	for _, tc := range []struct {
		players int
		radius  int
		want    [5]int
	}{
		{4, 2, [5]int{4, 5, 6, 7, 7}},
		{6, 3, [5]int{6, 7, 8, 9, 9}},
		{8, 4, [5]int{8, 9, 10, 11, 11}},
	} {
		s := newGame(t, tc.players, "base+wagons")
		if s.Board.Radius != tc.radius {
			t.Fatalf("%dp board radius %d, want %d", tc.players, s.Board.Radius, tc.radius)
		}
		for level := 1; level <= maxLevel; level++ {
			if got := allowance(s, level); got != tc.want[level-1] {
				t.Fatalf("%dp level %d: allowance %d, want %d", tc.players, level, got, tc.want[level-1])
			}
		}
	}
}

// A path must be paid in full to enter it, and MP left over at the end of the
// turn is lost.
func TestPathMustBePaidInFull(t *testing.T) {
	s, x := opened(t, 4, "base+wagons")
	p := s.Cur
	at := centre
	park(x, p, at, 1, 0, CargoNone)
	// Level 1 at radius 2 is 4 MP: two bare paths and no more.
	first := reachable(s, x, p)
	if len(first) == 0 {
		t.Fatal("fixture: no move from the centre")
	}
	do(t, s, cmd(p, CmdMove, map[string]any{"to": first[0].To}))
	if x.MP != 2 {
		t.Fatalf("after one bare path the wagon has %d MP, want 2", x.MP)
	}
	second := reachable(s, x, p)
	if len(second) == 0 {
		t.Fatal("nowhere to go with 2 MP left")
	}
	do(t, s, cmd(p, CmdMove, map[string]any{"to": second[0].To}))
	if x.MP != 0 {
		t.Fatalf("after two bare paths the wagon has %d MP, want 0", x.MP)
	}
	// Nothing is affordable now, and asking anyway is refused.
	if got := reachable(s, x, p); len(got) != 0 {
		t.Fatalf("%d paths offered at 0 MP, want 0", len(got))
	}
	third := steps(s, x, x.Wagon[p])
	if len(third) == 0 {
		t.Fatal("the wagon is somewhere with no paths at all")
	}
	refuse(t, s, cmd(p, CmdMove, map[string]any{"to": third[0].To}), ErrNoMovement)
	// The next turn starts at the allowance; the leftover is not banked.
	fire(t, s, []engine.Event{engine.NewEvent(EvTurn, turnData{Player: p})})
	if x.MP != 0 || x.MoveOpen {
		t.Fatalf("a new turn started with %d MP and MoveOpen=%v, want a closed action at 0", x.MP, x.MoveOpen)
	}
	park(x, p, x.Wagon[p], 1, 0, CargoNone)
	if got := openMP(s, x, p); got != 4 {
		t.Fatalf("next action opened at %d MP, want 4", got)
	}
}

// A toll that cannot be paid makes the path illegal, not free, so a wagon can
// be walled in by other players' roads.
func TestUnpaidTollMakesPathIllegal(t *testing.T) {
	s, x := opened(t, 4, "base+wagons")
	p, them := s.Cur, engine.PlayerID(1)
	at := centre
	park(x, p, at, 1, 0, CargoNone) // no gold at all
	// Wall every path off it with an opponent's road.
	var walled []board.Vertex
	for _, st := range steps(s, x, at) {
		if st.Spoke {
			continue
		}
		s.Roads[st.E] = them
		walled = append(walled, st.To)
	}
	if len(walled) == 0 {
		t.Fatal("fixture: nothing to wall")
	}
	if got := reachable(s, x, p); len(got) != 0 {
		t.Fatalf("%d paths offered to a wagon with no gold behind a wall of tolls", len(got))
	}
	refuse(t, s, cmd(p, CmdMove, map[string]any{"to": walled[0]}), ErrNoGold)
	// One gold opens exactly one crossing, and it is paid to the road's owner.
	x.Gold[p] = 1
	before := x.Gold[them]
	do(t, s, cmd(p, CmdMove, map[string]any{"to": walled[0]}))
	if x.Gold[p] != 0 {
		t.Fatalf("the mover has %d gold, want 0 after paying the toll", x.Gold[p])
	}
	if x.Gold[them] != before+1 {
		t.Fatalf("the road's owner has %d gold, want %d", x.Gold[them], before+1)
	}
}

// Conformance: "One grain (or 2 fish under Fishermen) for +2 MP, once per
// movement action, allowed after MPs are already spent."
//
// Ruling: once per movement action. A Swift Journey's second trip may buy it
// again, so a turn holds at most two.
func TestGrainBuysTwoMovementOncePerTrip(t *testing.T) {
	s, x := opened(t, 4, "base+wagons")
	p := s.Cur
	park(x, p, centre, 1, 0, CargoNone)
	s.Players[p].Hand = engine.Hand{board.Wheat: 3}
	// After the whole allowance is spent.
	x.MoveOpen, x.MP = true, 0
	bank := s.Bank[board.Wheat]
	do(t, s, cmd(p, CmdBoost, nil))
	if x.MP != boostMP {
		t.Fatalf("the boost left %d MP, want %d", x.MP, boostMP)
	}
	if s.Players[p].Hand[board.Wheat] != 2 || s.Bank[board.Wheat] != bank+1 {
		t.Fatalf("grain not paid to the bank: hand %d, bank %d",
			s.Players[p].Hand[board.Wheat], s.Bank[board.Wheat])
	}
	refuse(t, s, cmd(p, CmdBoost, nil), ErrMovementOver)
	// A Swift Journey's second trip may buy it once more.
	x.Swift[p] = 1
	x.Moved, x.MoveDone, x.MoveOpen = true, true, false
	do(t, s, cmd(p, CmdSwift, nil))
	if x.Boosted {
		t.Fatal("second trip kept the first trip's grain purchase")
	}
	do(t, s, cmd(p, CmdBoost, nil))
	want := allowance(s, x.Level[p]) + boostMP
	if x.MP != want {
		t.Fatalf("the second trip's boost left %d MP, want the fresh allowance plus %d = %d",
			x.MP, boostMP, want)
	}
	if s.Players[p].Hand[board.Wheat] != 1 || s.Bank[board.Wheat] != bank+2 {
		t.Fatalf("second grain not paid to the bank: hand %d, bank %d",
			s.Players[p].Hand[board.Wheat], s.Bank[board.Wheat])
	}
	// Still once per trip.
	refuse(t, s, cmd(p, CmdBoost, nil), ErrMovementOver)
}

// --- plazas, delivery and loading ------------------------------------------

// Conformance: "mandatory stop on entering a plaza", and "a wagon cannot deliver
// at two plazas in one movement action, because entering a plaza ends the
// movement".
func TestEnteringAPlazaEndsTheMovement(t *testing.T) {
	s, x := opened(t, 4, "base+wagons")
	p := s.Cur
	corner := aLandCornerOf(t, s, x, 0, 0)
	park(x, p, corner, maxLevel, 0, CargoNone) // 7 MP: plenty left over
	plaza := plazaOf(x.Trade[0])
	do(t, s, cmd(p, CmdMove, map[string]any{"to": plaza}))
	if x.Wagon[p] != plaza {
		t.Fatalf("the wagon is at %v, want the plaza %v", x.Wagon[p], plaza)
	}
	if x.MoveOpen || !x.MoveDone || x.MP != 0 {
		t.Fatalf("after entering a plaza: open=%v done=%v mp=%d, want closed, done and 0",
			x.MoveOpen, x.MoveDone, x.MP)
	}
	// The movement is over, so there is no second plaza this action.
	for _, st := range steps(s, x, plaza) {
		refuse(t, s, cmd(p, CmdMove, map[string]any{"to": st.To}), ErrMovementOver)
		break
	}
}

// Conformance: "The first load of the game is a plain pick-up: a wagon that has
// never carried anything drives to whichever of the three plazas its owner
// likes, delivers nothing, earns no gold, and draws its first token."
func TestTheFirstLoadIsAPlainPickUp(t *testing.T) {
	s, x := opened(t, 4, "base+wagons")
	p := s.Cur
	corner := aLandCornerOf(t, s, x, 1, 0)
	park(x, p, corner, 1, 0, CargoNone)
	goldBefore, vpBefore := x.Gold[p], x.Landed[p]
	evs := do(t, s, cmd(p, CmdMove, map[string]any{"to": plazaOf(x.Trade[1])}))
	kinds := map[engine.EventType]int{}
	for _, e := range evs {
		kinds[e.Type]++
	}
	if kinds[EvDelivered] != 0 {
		t.Fatal("an empty wagon's first stop delivered something")
	}
	if kinds[EvLoaded] != 1 {
		t.Fatalf("the first stop drew %d tokens, want exactly 1", kinds[EvLoaded])
	}
	if x.Gold[p] != goldBefore || x.Landed[p] != vpBefore {
		t.Fatal("the first pick-up paid gold or scored a point")
	}
	if x.Cargo[p] == CargoNone {
		t.Fatal("the wagon left the plaza empty")
	}
	// The drawn token is one this hex ships, never one it accepts.
	if hexAccepts(x, 1, x.Cargo[p]) {
		t.Fatalf("hex 1 dealt cargo %d that it also accepts", x.Cargo[p])
	}
}

// Conformance: "Delivery flips the token (1 VP, permanent), pays the level's
// gold, then draws when the wagon is empty."
func TestDeliveryScoresPaysAndReloads(t *testing.T) {
	s, x := opened(t, 4, "base+wagons")
	p := s.Cur
	// Construct the arrival: the wagon carries something the castle accepts and
	// is standing on one of its corners.
	castle := -1
	for i, r := range x.Roles {
		if r == RoleCastle {
			castle = i
		}
	}
	if castle < 0 {
		t.Fatal("no castle on this board")
	}
	corner := aLandCornerOf(t, s, x, castle, 0)
	const level = 3
	park(x, p, corner, level, 0, CargoMarble)
	vpBefore := victoryOfSeat(s, p)
	do(t, s, cmd(p, CmdMove, map[string]any{"to": plazaOf(x.Trade[castle])}))
	if x.Landed[p] != 1 {
		t.Fatalf("delivered tokens %d, want 1", x.Landed[p])
	}
	if x.Gold[p] != level {
		t.Fatalf("the delivery paid %d gold, want the level's %d", x.Gold[p], level)
	}
	if got := victoryOfSeat(s, p); got != vpBefore+1 {
		t.Fatalf("victory points went %d to %d, want +1 for the delivered token", vpBefore, got)
	}
	if x.Cargo[p] == CargoNone {
		t.Fatal("the wagon did not draw its next load after delivering")
	}
	// The point is permanent; reloading does not undo it.
	if x.Landed[p] != 1 {
		t.Fatal("the delivered token stopped counting")
	}
}

// Conformance: "Arriving with the wrong cargo does nothing and still ends the
// movement." It is a real mistake a player can make.
func TestWrongPlazaEndsMovement(t *testing.T) {
	s, x := opened(t, 4, "base+wagons")
	p := s.Cur
	// The quarry accepts tools only, so marble is the wrong cargo for it.
	quarry := -1
	for i, r := range x.Roles {
		if r == RoleQuarry {
			quarry = i
		}
	}
	corner := aLandCornerOf(t, s, x, quarry, 0)
	park(x, p, corner, maxLevel, 0, CargoMarble)
	evs := do(t, s, cmd(p, CmdMove, map[string]any{"to": plazaOf(x.Trade[quarry])}))
	for _, e := range evs {
		if e.Type == EvDelivered || e.Type == EvLoaded {
			t.Fatalf("arriving with the wrong cargo produced %s", e.Type)
		}
	}
	if x.Cargo[p] != CargoMarble {
		t.Fatal("the wagon lost its cargo at a hex that does not accept it")
	}
	if x.Landed[p] != 0 || x.Gold[p] != 0 {
		t.Fatal("the wrong plaza scored or paid")
	}
	if !x.MoveDone {
		t.Fatal("the movement continued past a plaza")
	}
}

// Conformance: "any number of wagons per intersection; buildings and wagons
// never block".
func TestWagonsShareAnIntersectionAndBlockNothing(t *testing.T) {
	s, x := opened(t, 4, "base+wagons")
	at := centre
	for p := range engine.PlayerID(4) {
		x.Wagon[p] = at
	}
	// Every seat's wagon is on the same corner and each can still leave it.
	for p := range engine.PlayerID(4) {
		park(x, p, at, 1, 5, CargoNone)
		x.OnBoard[p] = true
		if len(reachable(s, x, p)) == 0 {
			t.Fatalf("seat %d's wagon is stuck on a shared intersection", p)
		}
	}
	// A building on the vertex does not stop a wagon either.
	s.Buildings[at] = engine.Building{Owner: 1}
	park(x, 0, at, 1, 5, CargoNone)
	if len(reachable(s, x, 0)) == 0 {
		t.Fatal("an opponent's building stopped a wagon leaving the vertex")
	}
	// A wagon on a vertex does not stop anyone building there.
	delete(s.Buildings, at)
	blocked := false
	for _, m := range s.Modules() {
		if h := m.Hooks().BlocksVertex; h != nil && h(s, at, 0) {
			blocked = true
		}
	}
	if blocked {
		t.Fatal("a vertex carrying four wagons is reported as blocked for building")
	}
}

// victoryOfSeat is a seat's whole victory total, module contributions included.
func victoryOfSeat(s *engine.State, p engine.PlayerID) int {
	vp := s.VP(p)
	for _, m := range s.Modules() {
		if h := m.Hooks().VictoryCheck; h != nil {
			vp += h(s, p)
		}
	}
	return vp
}

// Building and trading close while the wagon is on the move ("after you finish
// trading and building during your turn, you may move your wagon"), otherwise a
// seat could lay a road mid-move and cross it at 1 MP instead of 2. The wagon's
// own commands and ending the turn stay open, and building reopens once the
// movement action is over.
func TestBuildingClosesWhileTheWagonIsMoving(t *testing.T) {
	s, x := opened(t, 4, "base+wagons")
	p := s.Cur
	park(x, p, centre, maxLevel, 4, CargoNone)
	rich := engine.Hand{board.Wood: 5, board.Brick: 5, board.Sheep: 5, board.Wheat: 5, board.Ore: 5}
	s.Players[p].Hand = rich
	road := func() engine.Command {
		roads := s.LegalRoads(p)
		if len(roads) == 0 {
			t.Fatal("no legal road for the seat on turn")
		}
		return cmd(p, engine.CmdBuildRoad, map[string]any{"e": roads[0]})
	}
	trade := cmd(p, engine.CmdBankTrade, map[string]any{"give": board.Wood, "get": board.Ore})
	buy := cmd(p, engine.CmdBuyDevCard, nil)
	// Before the wagon sets off, everything is open.
	for _, c := range []engine.Command{road(), trade, buy} {
		if _, err := engine.Decide(s, c); err != nil {
			t.Fatalf("%s before the wagon moved: %v", c.Type, err)
		}
	}
	first := reachable(s, x, p)
	if len(first) == 0 {
		t.Fatal("fixture: no move from the centre")
	}
	do(t, s, cmd(p, CmdMove, map[string]any{"to": first[0].To}))
	if !x.MoveOpen {
		t.Fatal("fixture: first step ended the movement")
	}
	for _, c := range []engine.Command{road(), trade, buy} {
		refuse(t, s, c, engine.ErrBuildingOver)
	}
	// The wagon's own commands are not building.
	if _, err := engine.Decide(s, cmd(p, CmdBuy, map[string]any{"res": board.Wood})); err != nil {
		t.Fatalf("a gold purchase mid-drive: %v", err)
	}
	if len(reachable(s, x, p)) == 0 {
		t.Fatal("no second step to take")
	}
	do(t, s, cmd(p, CmdHalt, nil))
	for _, c := range []engine.Command{road(), trade, buy} {
		if _, err := engine.Decide(s, c); err != nil {
			t.Fatalf("%s after the wagon stopped: %v", c.Type, err)
		}
	}
	if _, err := engine.Decide(s, engine.Command{Player: p, Type: engine.CmdEndTurn}); err != nil {
		t.Fatalf("the turn could not end after the wagon stopped: %v", err)
	}
}
