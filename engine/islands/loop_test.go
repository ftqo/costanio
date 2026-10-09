package islands

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

func anyHex(s *engine.State) board.Hex {
	for h := range s.Board.Tiles { // any hex; its 6 edges form a valid ring
		return h
	}
	return board.Hex{}
}

// TestPureShipCircleAllOpen: in a ring of ships with no settlement, every ship
// is open and movable.
func TestPureShipCircleAllOpen(t *testing.T) {
	s, _ := newGame(t, 1)
	x := ext(s)
	// Start from a clean board: setup already placed starting settlements/ships.
	s.Buildings = map[board.Vertex]engine.Building{}
	x.Ships = map[board.Edge]engine.PlayerID{}
	p := engine.PlayerID(0)
	h := anyHex(s)
	for _, e := range h.Edges() {
		x.Ships[e] = p
	}
	for _, e := range h.Edges() {
		if !(Module{}).shipOpen(s, x, e, p) {
			t.Errorf("pure ship circle: edge %+v should be open/movable", e)
		}
	}
}

// TestSelfLoopThroughSettlement: in a ring that returns to a single settlement,
// only the two ships bordering that settlement are movable; the rest are
// frozen.
func TestSelfLoopThroughSettlement(t *testing.T) {
	s, _ := newGame(t, 1)
	x := ext(s)
	// Start from a clean board: setup already placed starting settlements/ships.
	s.Buildings = map[board.Vertex]engine.Building{}
	x.Ships = map[board.Edge]engine.PlayerID{}
	p := engine.PlayerID(0)
	h := anyHex(s)
	edges := h.Edges()
	verts := h.Vertices()
	for _, e := range edges {
		x.Ships[e] = p
	}
	s.Buildings[verts[0]] = engine.Building{Owner: p}
	for _, e := range edges {
		want := e.Touches(verts[0]) // the two ships at the settlement are open
		if got := (Module{}).shipOpen(s, x, e, p); got != want {
			t.Errorf("self-loop edge %+v touches settlement=%v: shipOpen=%v want %v", e, want, got, want)
		}
	}
}
