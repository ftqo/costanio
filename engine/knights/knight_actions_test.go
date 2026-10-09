package knights

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// TestSmithRespectsKnightCap: Smith promotes up to two knights free but must
// still honour the 2-pieces-per-tier supply.
func TestSmithRespectsKnightCap(t *testing.T) {
	s, _ := newGame(t, 41, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)

	vs := nFreeVertices(s, x, board.Vertex{}, 3)
	if len(vs) < 3 {
		fixtureGone(t, "board too small")
	}
	x.Knights[vs[0]] = Knight{Owner: p, Level: 1}
	x.Knights[vs[1]] = Knight{Owner: p, Level: 1}
	x.Knights[vs[2]] = Knight{Owner: p, Level: 2} // one strong already on the board
	x.Players[p].Progress = []ProgressCard{CardSmith}

	step(t, s, engine.Command{Player: p, Type: CmdPlayProgress, Data: mustJSON(t, map[string]any{"card": CardSmith})})

	if got := knightCount(x, p, 2); got != 2 {
		t.Errorf("strong knights = %d, want 2 (Smith must not exceed the 2-per-tier cap)", got)
	}
	if got := knightCount(x, p, 1); got != 1 {
		t.Errorf("basic knights = %d, want 1 (only one basic could be promoted into the free strong slot)", got)
	}
}

// TestDisplacedKnightRemovedWhenNoAdjacentSpot: a displaced knight relocates
// only to an intersection reachable from the contested vertex along its
// owner's routes, and is removed if none is free. It must not jump to a
// disjoint stretch of the owner's roads.
func TestDisplacedKnightRemovedWhenNoAdjacentSpot(t *testing.T) {
	s, _ := newGame(t, 43, nil)
	x := ext(s)
	s.Roads = map[board.Edge]engine.PlayerID{}
	s.Buildings = map[board.Vertex]engine.Building{}
	for k := range x.Knights {
		delete(x.Knights, k)
	}
	owner := engine.PlayerID(1)

	center := board.Vertex{Q: 0, R: 0, Side: board.N}
	// Owner roads to every neighbour of center, each neighbour occupied, so there
	// is no adjacent empty spot.
	for _, e := range center.Edges() {
		if !s.Board.LandEdge(e) {
			continue
		}
		s.Roads[e] = owner
		s.Buildings[e.Other(center)] = engine.Building{Owner: owner}
	}
	// A far, disjoint owner road with empty endpoints, which must not be a
	// relocation target.
	placed := false
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, v := range h.Vertices() {
			for _, e := range v.Edges() {
				if !s.Board.LandEdge(e) || e.Touches(center) {
					continue
				}
				if _, taken := s.Roads[e]; taken {
					continue
				}
				if _, b := s.Buildings[e.A]; b {
					continue
				}
				if _, b := s.Buildings[e.B]; b {
					continue
				}
				s.Roads[e] = owner
				placed = true
			}
		}
	}
	if !placed {
		fixtureGone(t, "no far edge available on this seed")
	}

	if _, ok := (Module{}).firstReachableSpot(s, x, owner, center); ok {
		t.Error("displaced knight relocated to a disjoint road, want removed")
	}
}

// TestDisplacedKnightRelocatesAlongRoutes: when an empty intersection is
// reachable along the owner's routes, the displaced knight relocates there
// (any distance along the route, not only an adjacent step).
func TestDisplacedKnightRelocatesAlongRoutes(t *testing.T) {
	s, _ := newGame(t, 44, nil)
	x := ext(s)
	s.Roads = map[board.Edge]engine.PlayerID{}
	s.Buildings = map[board.Vertex]engine.Building{}
	for k := range x.Knights {
		delete(x.Knights, k)
	}
	owner := engine.PlayerID(1)

	center := board.Vertex{Q: 0, R: 0, Side: board.N}
	chainFor(t, s, owner, center, 3) // owner roads radiating from center

	spot, ok := (Module{}).firstReachableSpot(s, x, owner, center)
	if !ok {
		t.Fatal("expected a route-connected relocation spot")
	}
	if !knightReachable(s, x, center, spot, owner) {
		t.Errorf("relocation spot %v is not reachable along %d's routes from %v", spot, owner, center)
	}
}
