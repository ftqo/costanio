package bot

import (
	"sort"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// Deterministic ordering for candidate enumeration. The bot must make identical
// decisions on identical states (for reproducibility and replay verification),
// so candidate sets are materialized into slices sorted by a total order before
// scoring, never iterated straight from a Go map.

func vertexLess(a, b board.Vertex) bool {
	if a.Q != b.Q {
		return a.Q < b.Q
	}
	if a.R != b.R {
		return a.R < b.R
	}
	return a.Side < b.Side
}

// edgeLess orders edges by endpoints. Edges are normalized (A < B) at
// construction, so comparing A then B is a total order.
func edgeLess(a, b board.Edge) bool {
	if a.A != b.A {
		return vertexLess(a.A, b.A)
	}
	return vertexLess(a.B, b.B)
}

func sortVertices(vs []board.Vertex) {
	sort.Slice(vs, func(i, j int) bool { return vertexLess(vs[i], vs[j]) })
}

func sortEdges(es []board.Edge) {
	sort.Slice(es, func(i, j int) bool { return edgeLess(es[i], es[j]) })
}

// roadCount and buildingCount report how many roads / buildings a seat owns.
// Used to keep the road network proportional to settlements (anti-sprawl).
func roadCount(s *engine.State, seat engine.PlayerID) int {
	n := 0
	for _, owner := range s.Roads {
		if owner == seat {
			n++
		}
	}
	return n
}

func buildingCount(s *engine.State, seat engine.PlayerID) int {
	n := 0
	for _, bld := range s.Buildings {
		if bld.Owner == seat {
			n++
		}
	}
	return n
}

// ownSettlements returns the seat's upgradeable (non-city) buildings in a
// deterministic order, so city-upgrade choices don't depend on map iteration.
func ownSettlements(s *engine.State, seat engine.PlayerID) []board.Vertex {
	// Deferred to the engine so a module that bars an upgrade (an Explorers
	// harbour settlement) bars it here too.
	out := s.LegalCities(seat)
	sortVertices(out)
	return out
}
