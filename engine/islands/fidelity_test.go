package islands

import (
	"errors"
	"slices"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// seaEdgeAt returns a free sea edge touching v other than `not`.
func seaEdgeAt(s *engine.State, v board.Vertex, not board.Edge) (board.Edge, bool) {
	for _, e := range v.Edges() {
		if e == not || !s.Board.SeaEdge(e) {
			continue
		}
		if _, taken := s.Roads[e]; taken {
			continue
		}
		if _, taken := ext(s).Ships[e]; taken {
			continue
		}
		return e, true
	}
	return board.Edge{}, false
}

// landEdgeAt returns a free land edge touching v, other than the ones in skip.
//
// A coastal edge is both a land edge and a sea edge (docs/rules/islands.md), so
// the first free land edge at a coastal vertex is often the edge the caller is
// about to put a ship on; skip prevents building the road onto its own ship.
func landEdgeAt(s *engine.State, v board.Vertex, skip ...board.Edge) (board.Edge, bool) {
	for _, e := range v.Edges() {
		if !s.Board.LandEdge(e) || slices.Contains(skip, e) {
			continue
		}
		if _, taken := s.Roads[e]; taken {
			continue
		}
		if _, taken := ext(s).Ships[e]; taken {
			continue
		}
		return e, true
	}
	return board.Edge{}, false
}

// TestRoadBuildingBuildsShips: under Islands the Road Building card may
// build 2 roads, 2 ships, or 1 ship and 1 road. The two free builds (FreeRoads)
// must be spendable on ships, not just roads.
func TestRoadBuildingBuildsShips(t *testing.T) {
	s, _ := rolledState(t, 2)
	p := s.Cur
	e, v := coastalSpot(t, s)
	second, ok := seaEdgeAt(s, v, e)
	if !ok {
		// Fatal, not Skip: the seed is fixed, so a missing precondition means
		// the board changed under the test.
		t.Fatalf("no second free sea edge at the coastal anchor %v", v)
	}
	s.Buildings[v] = engine.Building{Owner: p}
	s.Players[p].Hand = engine.Hand{} // no resources at all
	s.Players[p].DevCards[engine.DevRoadBuilding] = 1

	// Play the card: two free builds become available.
	step(t, s, engine.Command{Player: p, Type: engine.CmdPlayDevCard,
		Data: mustJSON(t, map[string]any{"card": engine.DevRoadBuilding})})
	if s.FreeRoads != 2 {
		t.Fatalf("FreeRoads after Road Building = %d, want 2", s.FreeRoads)
	}

	// First free build: a ship, paid for by a free build (not resources).
	step(t, s, engine.Command{Player: p, Type: CmdBuildShip, Data: mustJSON(t, map[string]any{"e": e})})
	if ext(s).Ships[e] != p {
		t.Fatalf("free ship not placed at %v: %v", e, ext(s).Ships)
	}
	if got := s.Players[p].Hand.Count(); got != 0 {
		t.Errorf("ship was not free: hand has %d cards", got)
	}
	if s.FreeRoads != 1 {
		t.Errorf("free build not consumed by ship: FreeRoads = %d, want 1", s.FreeRoads)
	}

	// Second free build: a second ship (the "2 ships" option).
	step(t, s, engine.Command{Player: p, Type: CmdBuildShip, Data: mustJSON(t, map[string]any{"e": second})})
	if ext(s).Ships[second] != p {
		t.Fatalf("second free ship not placed: %v", ext(s).Ships)
	}
	if s.FreeRoads != 0 {
		t.Errorf("second free build not consumed: FreeRoads = %d, want 0", s.FreeRoads)
	}

	// With the card spent and no resources, a third ship is rejected for cost.
	if _, err := engine.Decide(s, engine.Command{Player: p, Type: CmdBuildShip,
		Data: mustJSON(t, map[string]any{"e": second})}); err == nil {
		t.Error("third ship with no funds and no free builds should be rejected")
	}
}

// TestRoadBuildingOneShipOneRoad: the mixed "1 ship and 1 road" option.
func TestRoadBuildingOneShipOneRoad(t *testing.T) {
	s, _ := rolledState(t, 4)
	p := s.Cur
	e, v := coastalSpotWhere(t, s, func(e board.Edge, v board.Vertex) bool {
		_, ok := landEdgeAt(s, v, e)
		return ok
	})
	landE, ok := landEdgeAt(s, v, e)
	if !ok {
		// Fixed seed, so a missing precondition is a board regression.
		t.Fatalf("no free land edge at the coastal anchor %v", v)
	}
	s.Buildings[v] = engine.Building{Owner: p}
	s.Players[p].Hand = engine.Hand{}
	s.Players[p].DevCards[engine.DevRoadBuilding] = 1

	step(t, s, engine.Command{Player: p, Type: engine.CmdPlayDevCard,
		Data: mustJSON(t, map[string]any{"card": engine.DevRoadBuilding})})

	// One free ship...
	step(t, s, engine.Command{Player: p, Type: CmdBuildShip, Data: mustJSON(t, map[string]any{"e": e})})
	if s.FreeRoads != 1 {
		t.Fatalf("after ship FreeRoads = %d, want 1", s.FreeRoads)
	}
	// ...and one free road, from the same card.
	step(t, s, engine.Command{Player: p, Type: engine.CmdBuildRoad, Data: mustJSON(t, map[string]any{"e": landE})})
	if s.Roads[landE] != p {
		t.Fatalf("free road not placed at %v", landE)
	}
	if s.FreeRoads != 0 {
		t.Errorf("after ship+road FreeRoads = %d, want 0", s.FreeRoads)
	}
	if got := s.Players[p].Hand.Count(); got != 0 {
		t.Errorf("ship+road were not free: hand has %d cards", got)
	}
}

// TestShipRoadEdgeExclusive: only one ship or one road on any coastal hex side,
// in both directions: a road cannot go on an edge holding a ship, nor a ship on
// a road's edge.
func TestShipRoadEdgeExclusive(t *testing.T) {
	s, _ := rolledState(t, 3)
	p := s.Cur
	e, v := coastalSpot(t, s)
	s.Buildings[v] = engine.Building{Owner: p}

	// Place a ship on the coastal edge.
	s.Players[p].Hand = CostShip
	step(t, s, engine.Command{Player: p, Type: CmdBuildShip, Data: mustJSON(t, map[string]any{"e": e})})

	// A road on that same coastal edge must be rejected as occupied.
	s.Players[p].Hand = engine.CostRoad
	if _, err := engine.Decide(s, engine.Command{Player: p, Type: engine.CmdBuildRoad,
		Data: mustJSON(t, map[string]any{"e": e})}); !errors.Is(err, engine.ErrOccupied) {
		t.Errorf("road on a ship's coastal edge: err = %v, want ErrOccupied", err)
	}

	// The reverse direction (a ship on a road's edge) was already enforced.
	s2, _ := rolledState(t, 3)
	p2 := s2.Cur
	e2, v2 := coastalSpot(t, s2)
	s2.Buildings[v2] = engine.Building{Owner: p2}
	s2.Roads[e2] = p2
	s2.Players[p2].Hand = CostShip
	if _, err := engine.Decide(s2, engine.Command{Player: p2, Type: CmdBuildShip,
		Data: mustJSON(t, map[string]any{"e": e2})}); !errors.Is(err, engine.ErrOccupied) {
		t.Errorf("ship on a road's coastal edge: err = %v, want ErrOccupied", err)
	}
}
