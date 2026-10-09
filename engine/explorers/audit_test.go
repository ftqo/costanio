package explorers

import (
	"slices"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// Rules where the engine disagreed with docs/rules/explorers.md. Each test
// names the rule it pins.

// dockedShip puts a ship of the active seat on a clear sea edge of its own
// harbour settlement, with the given hold, and returns it with the harbour.
func dockedShip(t *testing.T, s *engine.State, x *Ext, hold Cargo) (int, board.Vertex, board.Edge) {
	t.Helper()
	seat := s.Cur
	harbour, ok := ownHarbour(s, x, seat)
	if !ok {
		t.Fatal("no harbour settlement")
	}
	for _, e := range harbour.Edges() {
		if e.Valid() && sailable(s, x, e) && len(fogAt(x, e)) == 0 && roomOn(x, e, 0) {
			return placeShip(x, seat, e, hold), harbour, e
		}
	}
	t.Fatal("the harbour settlement has no clear sea edge")
	return 0, board.Vertex{}, board.Edge{}
}

// TestFullHoldAndBasinSwap: "Loading, unloading and swapping are all
// allowed" (docs/rules/explorers.md, Cargo). A ship carrying a settler beside
// a basin holding two crews has no free slot on either side, so the swap must
// be one command.
func TestFullHoldAndBasinSwap(t *testing.T) {
	s, x := playing(t, 3, 60)
	seat := s.Cur
	for _, sh := range ShipsOf(x, seat) {
		x.removeShip(sh.ID) // the setup ship would crowd the berth
	}
	id, harbour, _ := dockedShip(t, s, x, Cargo{Settler: 1})
	x.Basins[harbour] = Cargo{Crew: 2}
	enterMovement(t, s)

	// Load the two crews and hand the settler back, in one transfer.
	apply(t, s, engine.Command{Player: seat, Type: CmdLoad, Data: raw(map[string]any{
		"ship_id": id, "cargo": Cargo{Crew: 2}, "back": Cargo{Settler: 1},
	})})
	x = ext(s)
	if got := x.Ships[id].Hold; got != (Cargo{Crew: 2}) {
		t.Errorf("the hold after the swap is %+v, want two crews", got)
	}
	if got := x.Basins[harbour]; got != (Cargo{Settler: 1}) {
		t.Errorf("the basin after the swap is %+v, want the settler", got)
	}

	// The reverse (unload one crew, take the settler) does not fit, since the
	// settler needs both slots and a crew stays, so it is refused rather than
	// half-applied.
	if _, err := engine.Decide(s, engine.Command{Player: seat, Type: CmdUnload, Data: raw(map[string]any{
		"ship_id": id, "cargo": Cargo{Crew: 1}, "back": Cargo{Settler: 1},
	})}); err == nil {
		t.Error("a swap that leaves a crew and a settler in one hold was accepted")
	}
	// Unloading both crews for the settler is the whole swap back.
	apply(t, s, engine.Command{Player: seat, Type: CmdUnload, Data: raw(map[string]any{
		"ship_id": id, "cargo": Cargo{Crew: 2}, "back": Cargo{Settler: 1},
	})})
	x = ext(s)
	if x.Ships[id].Hold != (Cargo{Settler: 1}) || x.Basins[harbour] != (Cargo{Crew: 2}) {
		t.Errorf("the swap back left hold %+v and basin %+v", x.Ships[id].Hold, x.Basins[harbour])
	}
	// A swap cannot conjure what is not there.
	if _, err := engine.Decide(s, engine.Command{Player: seat, Type: CmdLoad, Data: raw(map[string]any{
		"ship_id": id, "cargo": Cargo{Crew: 2}, "back": Cargo{Haul: 1},
	})}); err == nil {
		t.Error("a swap handed back a fish haul the ship was not carrying")
	}
}

// TestFishRollNotMidVoyage: the fishing die is rolled before or after
// moving a ship, "not in the middle of one ship's move". A roll part-way
// through ends that ship's move, so the player cannot see the die and then
// choose where to stop. Loading the haul costs no movement, so a ship already
// beside the shoal still takes it.
func TestFishRollNotMidVoyage(t *testing.T) {
	s, x := playing(t, 3, 61)
	seat := s.Cur
	var id int
	var path []board.Edge
	for _, sh := range ShipsOf(x, seat) {
		for _, e := range nextEdges(s, x, sh.E) {
			if len(fogAt(x, e)) == 0 && roomOn(x, e, sh.ID) {
				id, path = sh.ID, []board.Edge{e}
				break
			}
		}
		if id != 0 {
			break
		}
	}
	if id == 0 {
		t.Fatal("no ship has a clear first step")
	}
	enterMovement(t, s)
	apply(t, s, engine.Command{Player: seat, Type: CmdMoveShip,
		Data: raw(map[string]any{"ship_id": id, "path": path})})
	if left := mpLeft(ext(s), ext(s).Ships[id]); left == 0 {
		t.Fatal("the ship has no movement left to test with")
	}
	apply(t, s, engine.Command{Player: seat, Type: CmdFishRoll})
	x = ext(s)
	if got := mpLeft(x, x.Ships[id]); got != 0 {
		t.Errorf("the ship still has %d movement points after the fishing roll", got)
	}
	back := []board.Edge{x.Ships[id].E}
	for _, e := range nextEdges(s, x, x.Ships[id].E) {
		if len(fogAt(x, e)) == 0 && roomOn(x, e, id) {
			back = []board.Edge{e}
			break
		}
	}
	if _, err := engine.Decide(s, engine.Command{Player: seat, Type: CmdMoveShip,
		Data: raw(map[string]any{"ship_id": id, "path": back})}); err == nil {
		t.Error("a ship carried on sailing after the fishing die was rolled mid-move")
	}
}

// TestDisplacedPirateMovesHex: activating the pirate ship
// sends an opponent's pirate ship home and places yours on a different sea
// hex. A won chase activates the winner's ship the same way, so it must also
// leave the chased ship's hex.
func TestDisplacedPirateMovesHex(t *testing.T) {
	s, x := playing(t, 3, 62)
	revealAll(x)
	seat := s.Cur
	owner := engine.PlayerID((int(seat) + 1) % len(s.Players))
	legal := legalPirateHexes(s, x, seat)
	if len(legal) < 2 {
		t.Fatal("fewer than two legal pirate hexes")
	}
	x.Pirate, x.PirateOwner, x.HasPirate = legal[0], owner, true
	x.Seats[owner].PirateOnBoard = true
	x.PiratePending, x.PirateBy = true, seat

	for _, h := range legalPirateHexes(s, x, seat) {
		if h == legal[0] {
			t.Error("the hex the opponent's pirate stands on is offered to the seat displacing it")
		}
	}
	if _, err := engine.Decide(s, engine.Command{Player: seat, Type: CmdMovePirate,
		Data: raw(map[string]any{"h": legal[0]})}); err == nil {
		t.Error("the displacing seat put its pirate on the hex the other one was sent home from")
	}
	apply(t, s, engine.Command{Player: seat, Type: CmdMovePirate, Data: raw(map[string]any{"h": legal[1]})})
	x = ext(s)
	if x.PirateOwner != seat || x.Pirate != legal[1] || x.Seats[owner].PirateOnBoard {
		t.Fatalf("the displacement did not land: owner %d at %v", x.PirateOwner, x.Pirate)
	}

	// A won chase: the chased pirate's hex is closed to the winner's own.
	x.Pirate, x.PirateOwner, x.HasPirate = legal[0], owner, true
	x.Seats[seat].PirateOnBoard = false
	x.Seats[owner].PirateOnBoard = true
	e := engine.NewEvent(EvPirateChased, chaseData{Player: seat, Ships: nil, Rolls: []int{6}, Need: 6, Won: true})
	e.Seq = s.NextSeq
	if err := engine.Apply(s, e); err != nil {
		t.Fatal(err)
	}
	x = ext(s)
	for _, h := range legalPirateHexes(s, x, seat) {
		if h == legal[0] {
			t.Error("the hex a pirate was just chased off is offered back to the chaser")
		}
	}
	if _, err := engine.Decide(s, engine.Command{Player: seat, Type: CmdMovePirate,
		Data: raw(map[string]any{"h": legal[0]})}); err == nil {
		t.Error("the chaser put its pirate straight back on the hex it chased the other off")
	}
	apply(t, s, engine.Command{Player: seat, Type: CmdMovePirate, Data: raw(map[string]any{"h": legal[1]})})
}

// TestBishopActivatesPirate: in the Knights pairing the
// Bishop activates the pirate ship instead of moving the robber, with no
// exceptions: an opponent's pirate ship goes home and yours goes on a
// different sea hex. armPirate is the hook the Bishop reaches.
func TestBishopActivatesPirate(t *testing.T) {
	s, x := playing(t, 3, 63)
	revealAll(x)
	seat := s.Cur
	owner := engine.PlayerID((int(seat) + 1) % len(s.Players))
	all := legalPirateHexes(s, x, seat)
	x.Pirate, x.PirateOwner, x.HasPirate = all[0], owner, true
	x.Seats[owner].PirateOnBoard = true
	e, ok := armPirate(s, seat)
	if !ok {
		t.Fatal("the Bishop's hook refused to arm the pirate ship")
	}
	e.Seq = s.NextSeq
	if err := engine.Apply(s, e); err != nil {
		t.Fatal(err)
	}
	if slices.Contains(legalPirateHexes(s, ext(s), seat), all[0]) {
		t.Error("the Bishop's activation offered the hex the opponent's pirate ship stands on")
	}
	if _, err := engine.Decide(s, engine.Command{Player: seat, Type: CmdMovePirate,
		Data: raw(map[string]any{"h": all[0]})}); err == nil {
		t.Error("the Bishop landed the pirate ship on the hex the opponent's holds")
	}
	apply(t, s, engine.Command{Player: seat, Type: CmdMovePirate, Data: raw(map[string]any{"h": all[1]})})
	x = ext(s)
	if x.PirateOwner != seat || x.Pirate != all[1] || x.Seats[owner].PirateOnBoard {
		t.Errorf("the Bishop did not send the other pirate ship home: owner %d at %v", x.PirateOwner, x.Pirate)
	}
}

// TestChasedShipFlaggedInView: a ship that has rolled at the pirate is
// not battle-ready again this turn, and the view must say so or the client
// offers a chase the engine refuses.
func TestChasedShipFlaggedInView(t *testing.T) {
	s, x := playing(t, 3, 64)
	revealAll(x)
	seat := s.Cur
	owner := engine.PlayerID((int(seat) + 1) % len(s.Players))
	pirateHex := legalPirateHexes(s, x, owner)[0]
	x.Pirate, x.PirateOwner, x.HasPirate = pirateHex, owner, true
	id := placeShip(x, seat, seaEdgeOf(t, s, x, pirateHex), Cargo{})
	sh := x.Ships[id]
	sh.Fought = true
	x.Ships[id] = sh
	v, ok := x.ViewExt(seat).(*ExtView)
	if !ok {
		t.Fatal("the view is not an ExtView")
	}
	for _, shv := range v.Ships {
		if shv.ID == id && !shv.Fought {
			t.Error("a ship that has rolled at the pirate is published as never having fought")
		}
	}
	if slices.Contains(battleReady(x, seat), id) {
		t.Error("a ship that has fought is still battle-ready")
	}
}

// TestPirateRobsShipsOnItsHex: the pirate robs a player with a
// ship on an edge of its hex (docs/rules/explorers.md). A ship whose edge only
// touches one of the hex's corners is beside it and not a victim. (Battle
// readiness does use the corner test: "an end adjacent to an intersection of
// the pirate ship's hex".)
func TestPirateRobsShipsOnItsHex(t *testing.T) {
	s, x := playing(t, 3, 65)
	revealAll(x)
	seat := s.Cur
	victim := engine.PlayerID((int(seat) + 1) % len(s.Players))
	for _, h := range legalPirateHexes(s, x, seat) {
		// An edge with one end at a corner of h that is not one of h's edges.
		for _, v := range h.Vertices() {
			for _, e := range v.Edges() {
				if !e.Valid() || !sailable(s, x, e) || slices.Contains(board.EdgeHexes(e), h) {
					continue
				}
				placeShip(x, victim, e, Cargo{})
				if got := pirateVictims(x, h, seat); got[victim] {
					t.Fatalf("a ship on %v, beside hex %v at one corner, is robbed as if on it", e, h)
				}
				return
			}
		}
	}
	t.Fatal("no legal pirate hex has a sea edge leaving one of its corners")
}
