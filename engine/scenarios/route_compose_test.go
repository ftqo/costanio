package scenarios

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/islands"
)

// TestRouteComposesShipsAndCamels: under base+islands+caravans one route is a
// road chain a camel doubles, then (through an own building) a ship chain. The
// engine walks one network the modules contribute edges and weights to, so two
// camel-doubled roads and three ships score 7, not the larger of two separate
// measurements.
//
// The state is constructed: the camel chain on caravan 0's arrow, a road chain
// from its far end to the coast, and ships leaving an own settlement there.
func TestRouteComposesShipsAndCamels(t *testing.T) {
	s, _ := newGame(t, "base+islands+caravans", 3)
	const p = engine.PlayerID(0)
	s.Buildings = map[board.Vertex]engine.Building{}
	s.Roads = map[board.Edge]engine.PlayerID{}
	x := caravansExt(s)
	if !x.HasOasis {
		t.Fatal("no oasis derived on this board")
	}
	// The islands ext is stored lazily by its first fold, which a setup with
	// no ship never runs; install an empty one so the hook has state to read
	// and CloneExt has maps to copy.
	ix := &islands.Ext{
		Ships:       map[board.Edge]engine.PlayerID{},
		ShipsLeft:   make([]int, len(s.Players)),
		BuiltTurn:   map[board.Edge]bool{},
		PendingGold: map[engine.PlayerID]int{},
		Reached:     map[engine.PlayerID]map[int]bool{},
		IslandVP:    map[engine.PlayerID]int{},
	}
	s.Ext[islands.Name] = ix

	// Two camels on caravan 0, and the placer's roads underneath both.
	arrow := x.Arrows[0]
	if arrow == (board.Edge{}) {
		t.Fatal("no arrow for caravan 0")
	}
	x.Chains[0] = []board.Edge{arrow}
	x.Occupied[arrow] = true
	exts := (Caravans{}).caravanFrontEdges(x, s, 0)
	if len(exts) == 0 {
		t.Fatal("no extension path from the arrow")
	}
	second := exts[0]
	x.Chains[0] = append(x.Chains[0], second)
	x.Occupied[second] = true
	s.Roads[arrow] = p
	s.Roads[second] = p
	camelRoads := 2

	// Vertices the route has already used. The ship and road chains avoid
	// them so the network is one simple path and its length is the
	// arithmetic below.
	used := map[board.Vertex]bool{x.ArrowCorner[0]: true, sharedVertex(arrow, second): true}
	front := caravanFront(x, 0)
	used[front] = true

	// A plain road chain from the caravan front to the nearest vertex with a
	// free sea edge (BFS over unoccupied land edges, avoiding used vertices).
	type step struct {
		v    board.Vertex
		via  board.Edge
		prev int
	}
	queue := []step{{v: front, prev: -1}}
	seen := map[board.Vertex]bool{front: true}
	coast := -1
	for i := 0; i < len(queue) && coast < 0; i++ {
		at := queue[i].v
		for _, e := range at.Edges() {
			if s.Board.SeaEdge(e) && !used[e.Other(at)] && i > 0 {
				coast = i
				break
			}
		}
		if coast >= 0 {
			break
		}
		for _, e := range at.Edges() {
			nv := e.Other(at)
			if seen[nv] || used[nv] || x.Occupied[e] || !s.Board.LandEdge(e) {
				continue
			}
			seen[nv] = true
			queue = append(queue, step{v: nv, via: e, prev: i})
		}
	}
	if coast < 0 {
		t.Fatal("no land path from the caravan front to a coast on this board")
	}
	plainRoads := 0
	for i := coast; queue[i].prev >= 0; i = queue[i].prev {
		s.Roads[queue[i].via] = p
		used[queue[i].v] = true
		plainRoads++
	}
	junction := queue[coast].v
	s.Buildings[junction] = engine.Building{Owner: p}

	// Three ships out of the junction settlement over sea edges.
	ships := 0
	at := junction
	for ships < 3 {
		extended := false
		for _, e := range at.Edges() {
			nv := e.Other(at)
			if used[nv] || !s.Board.SeaEdge(e) {
				continue
			}
			if _, taken := ix.Ships[e]; taken {
				continue
			}
			if _, taken := s.Roads[e]; taken {
				continue
			}
			ix.Ships[e] = p
			used[nv] = true
			at = nv
			ships++
			extended = true
			break
		}
		if !extended {
			break
		}
	}
	if ships < 3 {
		t.Fatalf("only %d ships chained from the coast", ships)
	}

	want := 2*camelRoads + plainRoads + ships
	got := engine.LongestRouteLength(s, p)
	if got != want {
		t.Errorf("composed route = %d, want %d (%d camel roads doubled + %d plain roads + %d ships)",
			got, want, camelRoads, plainRoads, ships)
	}
	// The defect's signature: either module alone reads the route shorter.
	if got <= camelRoads+plainRoads+ships {
		t.Errorf("route %d, want more than the weight-1 walk %d", got, camelRoads+plainRoads+ships)
	}
	if got <= 2*camelRoads+plainRoads {
		t.Errorf("route %d, want more than the roads-only walk %d", got, 2*camelRoads+plainRoads)
	}

	// Without the junction settlement the ship leg is severed from the roads.
	delete(s.Buildings, junction)
	if got := engine.LongestRouteLength(s, p); got != 2*camelRoads+plainRoads {
		t.Errorf("route without the junction building = %d, want %d", got, 2*camelRoads+plainRoads)
	}
	s.Buildings[junction] = engine.Building{Owner: p}

	// A ship a camel walks beside counts double too, by this pairing's
	// rule: a ship is equivalent to a road for Longest Road.
	//
	// This is why the hooks run in two passes: "caravans" sorts before
	// "islands", so a reweight in the edge pass would run before any ship
	// is in the network. A camel on a ship edge grows the route by one.
	var shipEdge board.Edge
	for e := range ix.Ships {
		shipEdge = e
		break
	}
	x.Occupied[shipEdge] = true
	if got, want := engine.LongestRouteLength(s, p), 2*camelRoads+plainRoads+ships+1; got != want {
		t.Errorf("route with a camel on a ship = %d, want %d", got, want)
	}
}
