package knights

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/islands"
)

// Knights at sea has four combination rules, pinned here:
//
//   - Rules in Knights that apply to roads also apply to ships.
//   - Move a knight: knights move along continuous routes of roads and ships,
//     and may end their move on an empty intersection of sea hexes.
//   - Move a ship: knights must always stay connected to a route of their
//     colour, so a ship that would break that connection may not move.
//   - Chase away the pirate: knights on a sea-hex intersection chase away the
//     pirate just as knights on land chase away the robber.

// seaGame builds a base+islands+cak game past setup, on the first seed whose
// board offers the geometry a caller needs. The search has a hard budget and
// ends in t.Fatal, never t.Skip.
func seaGame(t *testing.T, want func(*engine.State) bool) *engine.State {
	t.Helper()
	for seed := uint64(1); seed <= 60; seed++ {
		s := newSeaGame(t, seed)
		if want(s) {
			return s
		}
	}
	t.Fatal("no seed in 1..60 deals the needed coastal geometry")
	return nil
}

func newSeaGame(t *testing.T, seed uint64) *engine.State {
	t.Helper()
	log, err := engine.New(engine.GameConfig{
		Players: 3, Ruleset: engine.CanonicalRuleset("base+islands+cak"),
	}, engine.SeedsFrom(seed))
	if err != nil {
		t.Fatal(err)
	}
	s := engine.Empty()
	for _, e := range log {
		if err := engine.Apply(s, e); err != nil {
			t.Fatal(err)
		}
	}
	for {
		if s.Phase != engine.PhaseSetup {
			// Gold picks owed during Islands setup block the first turn until made.
			x, ok := s.Ext[islands.Name].(*islands.Ext)
			if !ok || len(x.PendingGold) == 0 {
				break
			}
		}
		cmd, ok := engine.AutoCommand(s)
		if !ok {
			t.Fatal("setup stuck")
		}
		step(t, s, cmd)
	}
	return s
}

func islandsExt(t *testing.T, s *engine.State) *islands.Ext {
	t.Helper()
	x, ok := s.Ext[islands.Name].(*islands.Ext)
	if !ok {
		t.Fatal("no islands ext on a base+islands+cak game")
	}
	return x
}

// coastSpot is the shape every test below is built on:
//
//	inland -(road)- shore -(ship)- offshore
//
// `shore` is a free coastal land vertex (a building there joins the two
// networks), `road` is a land-only edge and `ship` a sea-only edge, so neither
// piece could be the other. `offshore` is a pure sea intersection: a legal end
// of a knight's move and an illegal spot for a new knight.
type coastSpot struct {
	inland, shore, offshore board.Vertex
	road, ship              board.Edge
}

func findCoastSpot(s *engine.State) (coastSpot, bool) {
	freeV := func(v board.Vertex) bool {
		if _, ok := s.Buildings[v]; ok {
			return false
		}
		_, k := ext(s).Knights[v]
		return !k
	}
	freeE := func(e board.Edge) bool {
		if !e.Valid() {
			return false
		}
		if _, ok := s.Roads[e]; ok {
			return false
		}
		_, sh := islandsShips(s)[e]
		return !sh
	}
	seen := map[board.Vertex]bool{}
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, shore := range h.Vertices() {
			if seen[shore] {
				continue
			}
			seen[shore] = true
			if !s.Board.LandVertex(shore) || !freeV(shore) {
				continue
			}
			// A building will stand on `shore`, so the distance rule must hold there.
			clear := true
			for _, e := range shore.Edges() {
				if _, taken := s.Buildings[e.Other(shore)]; taken {
					clear = false
				}
			}
			if !clear {
				continue
			}
			for _, se := range shore.Edges() {
				// Sea-only (SeaEdge and not LandEdge), so its far end is a pure sea
				// intersection.
				if !freeE(se) || !s.Board.SeaEdge(se) || s.Board.LandEdge(se) {
					continue
				}
				offshore := se.Other(shore)
				if !freeV(offshore) {
					continue
				}
				for _, re := range shore.Edges() {
					if re == se || !freeE(re) || !s.Board.LandEdge(re) || s.Board.SeaEdge(re) {
						continue
					}
					inland := re.Other(shore)
					if !freeV(inland) {
						continue
					}
					return coastSpot{inland: inland, shore: shore, offshore: offshore, road: re, ship: se}, true
				}
			}
		}
	}
	return coastSpot{}, false
}

func islandsShips(s *engine.State) map[board.Edge]engine.PlayerID {
	x, ok := s.Ext[islands.Name].(*islands.Ext)
	if !ok || x.Ships == nil {
		return map[board.Edge]engine.PlayerID{}
	}
	return x.Ships
}

// settle puts p's pieces down directly as a fixture; the commands that build
// them have their own tests.
func settle(t *testing.T, s *engine.State, p engine.PlayerID, spot coastSpot, withBuilding bool) {
	t.Helper()
	if withBuilding {
		s.Buildings[spot.shore] = engine.Building{Owner: p}
	}
	s.Roads[spot.road] = p
	islandsExt(t, s).Ships[spot.ship] = p
}

func moveKnight(from, to board.Vertex) json.RawMessage {
	raw, _ := json.Marshal(map[string]any{"from": from, "to": to})
	return raw
}

// TestKnightMovesAlongShipsThroughOwnBuilding: knights move along continuous
// routes of roads and ships and may end on an empty sea intersection. The
// knight walks its road to its settlement, where road and ship networks join,
// and sails on to stop at sea.
func TestKnightMovesAlongShipsThroughOwnBuilding(t *testing.T) {
	var spot coastSpot
	s := seaGame(t, func(s *engine.State) bool {
		var ok bool
		spot, ok = findCoastSpot(s)
		return ok
	})
	p := s.Cur
	rolled(t, s)
	settle(t, s, p, spot, true)
	ext(s).Knights[spot.inland] = Knight{Owner: p, Level: 1, Active: true}

	if s.Board.LandVertex(spot.offshore) {
		t.Fatal("fixture: destination is not a sea intersection")
	}
	step(t, s, engine.Command{Player: p, Type: CmdMoveKnight,
		Data: moveKnight(spot.inland, spot.offshore)})
	if k, ok := ext(s).Knights[spot.offshore]; !ok || k.Owner != p {
		t.Fatalf("knight did not end its move on the sea intersection: %v", ext(s).Knights)
	}
	if _, still := ext(s).Knights[spot.inland]; still {
		t.Error("knight is still standing where it started")
	}
}

// TestKnightNeedsABuildingToChangeNetworks: a land road network joins a sea
// shipping network only at a settlement where they meet. Without the
// settlement the road and ship are two routes and the knight may not cross.
func TestKnightNeedsABuildingToChangeNetworks(t *testing.T) {
	var spot coastSpot
	s := seaGame(t, func(s *engine.State) bool {
		var ok bool
		spot, ok = findCoastSpot(s)
		return ok
	})
	p := s.Cur
	rolled(t, s)
	settle(t, s, p, spot, false) // no building at the junction
	ext(s).Knights[spot.inland] = Knight{Owner: p, Level: 1, Active: true}

	_, err := engine.Decide(s, engine.Command{Player: p, Type: CmdMoveKnight,
		Data: moveKnight(spot.inland, spot.offshore)})
	if !errors.Is(err, engine.ErrBadPlacement) {
		t.Fatalf("road to ship with no building between: got %v, want ErrBadPlacement", err)
	}
	// A knight standing on the junction may set out on either network, since it
	// has no mode until it steps onto a piece.
	delete(ext(s).Knights, spot.inland)
	ext(s).Knights[spot.shore] = Knight{Owner: p, Level: 1, Active: true}
	step(t, s, engine.Command{Player: p, Type: CmdMoveKnight,
		Data: moveKnight(spot.shore, spot.offshore)})
	if _, ok := ext(s).Knights[spot.offshore]; !ok {
		t.Error("a knight standing at the junction could not set out along its own ship")
	}
}

// TestKnightBuildsAtTheEndOfItsOwnShip: rules for roads apply to ships, so a
// coastal intersection at the end of your own ship takes a new knight like the
// end of your road. The sea intersection beyond takes a moved knight, not a
// new one.
func TestKnightBuildsAtTheEndOfItsOwnShip(t *testing.T) {
	var spot coastSpot
	s := seaGame(t, func(s *engine.State) bool {
		var ok bool
		spot, ok = findCoastSpot(s)
		return ok
	})
	p := s.Cur
	rolled(t, s)
	// A ship reaching `shore` and nothing else of p's anywhere near it.
	islandsExt(t, s).Ships[spot.ship] = p
	s.Players[p].Hand = engine.Hand{board.Sheep: 1, board.Ore: 1}

	step(t, s, engine.Command{Player: p, Type: CmdBuildKnight,
		Data: mustJSON(t, map[string]any{"v": spot.shore})})
	if _, ok := ext(s).Knights[spot.shore]; !ok {
		t.Fatal("a knight could not be raised at the end of its owner's own ship")
	}

	s.Players[p].Hand = engine.Hand{board.Sheep: 1, board.Ore: 1}
	_, err := engine.Decide(s, engine.Command{Player: p, Type: CmdBuildKnight,
		Data: mustJSON(t, map[string]any{"v": spot.offshore})})
	if !errors.Is(err, engine.ErrBadPlacement) {
		t.Fatalf("a NEW knight on a sea intersection: got %v, want ErrBadPlacement", err)
	}
}

// TestShipCannotBeMovedOutFromUnderAKnight: knights must stay connected to a
// route of their colour, so a ship that would break that may not move. Islands
// states it as closure: a shipping route is closed once it connects two
// settlements, cities or (with Knights) knights.
func TestShipCannotBeMovedOutFromUnderAKnight(t *testing.T) {
	var spot coastSpot
	s := seaGame(t, func(s *engine.State) bool {
		var ok bool
		spot, ok = findCoastSpot(s)
		return ok
	})
	p := s.Cur
	rolled(t, s)
	settle(t, s, p, spot, true)
	ix := islandsExt(t, s)

	// With nothing on the far end the ship is open and may be moved (the baseline
	// for the assertion).
	target, ok := freeSeaEdgeAt(s, spot.shore, spot.ship)
	if !ok {
		t.Fatal("fixture: no second free sea edge")
	}
	if _, err := engine.Decide(s, engine.Command{Player: p, Type: islands.CmdMoveShip,
		Data: mustJSON(t, map[string]any{"from": spot.ship, "to": target})}); err != nil {
		t.Fatalf("premise: an open ship should move, got %v", err)
	}

	// Now the knight is out at sea, and the ship is its only way home.
	ext(s).Knights[spot.offshore] = Knight{Owner: p, Level: 1, Active: true}
	_, err := engine.Decide(s, engine.Command{Player: p, Type: islands.CmdMoveShip,
		Data: mustJSON(t, map[string]any{"from": spot.ship, "to": target})})
	if err == nil {
		t.Fatal("a ship was moved out from under its owner's knight")
	}
	_ = ix
}

// freeSeaEdgeAt finds another empty sea edge touching v, excluding `excl`.
func freeSeaEdgeAt(s *engine.State, v board.Vertex, excl board.Edge) (board.Edge, bool) {
	for _, e := range v.Edges() {
		if e == excl || !e.Valid() || !s.Board.SeaEdge(e) {
			continue
		}
		if _, road := s.Roads[e]; road {
			continue
		}
		if _, ship := islandsShips(s)[e]; ship {
			continue
		}
		return e, true
	}
	return board.Edge{}, false
}

// TestKnightAtSeaChasesThePirate is the fourth rule: "Knights on a sea hex
// intersection may chase away the pirate just like knights on land chase away
// the robber."
func TestKnightAtSeaChasesThePirate(t *testing.T) {
	var spot coastSpot
	s := seaGame(t, func(s *engine.State) bool {
		sp, ok := findCoastSpot(s)
		if !ok {
			return false
		}
		spot = sp
		// The offshore intersection has to touch a sea hex the pirate can sit
		// on, and there must be a second sea hex to push it to.
		return len(seaHexesAt(s, sp.offshore)) > 0 && countSeaHexes(s) >= 2
	})
	p := s.Cur
	rolled(t, s)
	settle(t, s, p, spot, true)
	ext(s).Knights[spot.offshore] = Knight{Owner: p, Level: 1, Active: true}

	// The robber, and with it the pirate, is out of play until the first barbarian
	// landfall, so give the game one before chasing.
	ext(s).Attacks = 1

	ix := islandsExt(t, s)
	ix.HasPirate = true
	ix.Pirate = seaHexesAt(s, spot.offshore)[0]
	dest, ok := otherSeaHex(s, ix.Pirate)
	if !ok {
		t.Fatal("fixture: only one sea hex")
	}

	step(t, s, engine.Command{Player: p, Type: CmdChaseRobber,
		Data: mustJSON(t, map[string]any{"v": spot.offshore, "hex": dest})})
	if got := islandsExt(t, s).Pirate; got != dest {
		t.Errorf("pirate is on %v, want %v", got, dest)
	}
	if k := ext(s).Knights[spot.offshore]; k.Active {
		t.Error("a knight that took an action must stand down")
	}
}

func seaHexesAt(s *engine.State, v board.Vertex) []board.Hex {
	var out []board.Hex
	for _, h := range v.Hexes() {
		if s.Board.IsSea(h) {
			out = append(out, h)
		}
	}
	return out
}

func countSeaHexes(s *engine.State) int {
	n := 0
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		if s.Board.IsSea(h) {
			n++
		}
	}
	return n
}

func otherSeaHex(s *engine.State, not board.Hex) (board.Hex, bool) {
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		if s.Board.IsSea(h) && h != not {
			return h, true
		}
	}
	return board.Hex{}, false
}

// TestSeaKnightLegalSetMatchesTheValidator: the legal set never offers a spot
// the validator refuses, checked over sea moves, where reachable vertices need
// not be land or next to a road. The enumerator prunes with touchesOwnRoute,
// which the validator does not use, so the two must be checked against each
// other.
func TestSeaKnightLegalSetMatchesTheValidator(t *testing.T) {
	var spot coastSpot
	s := seaGame(t, func(s *engine.State) bool {
		var ok bool
		spot, ok = findCoastSpot(s)
		return ok
	})
	p := s.Cur
	rolled(t, s)
	settle(t, s, p, spot, true)
	ext(s).Knights[spot.inland] = Knight{Owner: p, Level: 1, Active: true}

	lt := s.LegalTargetsFor(p)
	var group *engine.KnightMoveTargets
	for i := range lt.KnightMoves {
		if lt.KnightMoves[i].From == spot.inland {
			group = &lt.KnightMoves[i]
		}
	}
	if group == nil {
		t.Fatal("knight has no offered moves")
	}
	offered := map[board.Vertex]bool{}
	for _, v := range group.To {
		offered[v] = true
	}
	if !offered[spot.offshore] {
		t.Error("the sea intersection the knight can reach is not offered")
	}

	// Every vertex on the board, both directions: offered implies accepted and
	// accepted implies offered.
	seen := map[board.Vertex]bool{}
	checked := 0
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, v := range h.Vertices() {
			if seen[v] {
				continue
			}
			seen[v] = true
			_, err := engine.Decide(s, engine.Command{Player: p, Type: CmdMoveKnight,
				Data: moveKnight(spot.inland, v)})
			if offered[v] != (err == nil) {
				t.Errorf("knight move %v->%v offered=%v validator=%v (err=%v)",
					spot.inland, v, offered[v], err == nil, err)
			}
			checked++
		}
	}
	if checked == 0 {
		t.Fatal("no vertex was checked")
	}
}

// TestChasePirateHexesAreSeaAndNotThePirates mirrors the chase-robber assertion
// in legal_invariant_test.go for the other blocker.
func TestChasePirateHexesAreSeaAndNotThePirates(t *testing.T) {
	var spot coastSpot
	s := seaGame(t, func(s *engine.State) bool {
		sp, ok := findCoastSpot(s)
		if !ok {
			return false
		}
		spot = sp
		return len(seaHexesAt(s, sp.offshore)) > 0 && countSeaHexes(s) >= 2
	})
	p := s.Cur
	rolled(t, s)
	settle(t, s, p, spot, true)
	ext(s).Knights[spot.offshore] = Knight{Owner: p, Level: 1, Active: true}
	ext(s).Attacks = 1
	ix := islandsExt(t, s)
	ix.HasPirate = true
	ix.Pirate = seaHexesAt(s, spot.offshore)[0]

	lt := s.LegalTargetsFor(p)
	if len(lt.ChasePirateHexes) == 0 {
		t.Fatal("knight beside the pirate has no chase targets")
	}
	for _, h := range lt.ChasePirateHexes {
		if !s.Board.IsSea(h) || h == ix.Pirate {
			t.Errorf("chase-pirate offered %v (sea=%v pirate=%v)", h, s.Board.IsSea(h), ix.Pirate)
		}
		if _, err := engine.Decide(s, engine.Command{Player: p, Type: CmdChaseRobber,
			Data: mustJSON(t, map[string]any{"v": spot.offshore, "hex": h})}); err != nil {
			t.Errorf("chase-pirate offered %v but the validator refuses it: %v", h, err)
		}
	}
	// And no land hex is in it; those belong in the robber's list.
	for _, h := range lt.ChaseRobberHexes {
		if s.Board.IsSea(h) {
			t.Errorf("chase-robber offered the sea hex %v", h)
		}
	}
}

// TestIntrigueReachesAKnightOnYourShip: Intrigue targets a knight "on an
// intersection connected to at least one of your roads or shipping routes", so
// a ship of yours reaching it is enough, with no road or knight of yours
// nearby.
func TestIntrigueReachesAKnightOnYourShip(t *testing.T) {
	var spot coastSpot
	s := seaGame(t, func(s *engine.State) bool {
		var ok bool
		spot, ok = findCoastSpot(s)
		return ok
	})
	p := s.Cur
	enemy := engine.PlayerID((int(p) + 1) % len(s.Players))
	rolled(t, s)
	// A ship of p's reaching `shore`, an enemy knight there, and nothing else of
	// p's within reach.
	islandsExt(t, s).Ships[spot.ship] = p
	ext(s).Knights[spot.shore] = Knight{Owner: enemy, Level: 1}
	ext(s).Players[p].Progress = []ProgressCard{CardIntrigue}

	play := engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardIntrigue, "v": spot.shore})}
	if _, err := engine.Decide(s, play); err != nil {
		t.Fatalf("Intrigue against a knight standing on our own ship: %v", err)
	}
	// And the offered set agrees, so the client is not hiding the play.
	targets := s.LegalTargetsFor(p).ProgressTargets[string(CardIntrigue)]
	found := false
	for _, v := range targets.Vertices {
		if v == spot.shore {
			found = true
		}
	}
	if !found {
		t.Errorf("Intrigue's offered vertices %v omit the reachable knight at %v", targets.Vertices, spot.shore)
	}

	// The negative: take the ship away and the same play is refused.
	delete(islandsExt(t, s).Ships, spot.ship)
	if _, err := engine.Decide(s, play); !errors.Is(err, engine.ErrBadPlacement) {
		t.Fatalf("Intrigue with nothing of ours touching the knight: got %v, want ErrBadPlacement", err)
	}
}
