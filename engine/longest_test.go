package engine

import (
	"math/rand/v2"
	"testing"

	"github.com/ftqo/costan.io/engine/board"
)

// refLongestRoadLength is a straightforward map-based reference implementation,
// used to cross-check the compiled-graph DFS.
func refLongestRoadLength(s *State, p PlayerID) int {
	var own []board.Edge
	for e, owner := range s.Roads {
		if owner == p {
			own = append(own, e)
		}
	}
	best := 0
	visited := map[board.Edge]bool{}
	var dfs func(at board.Vertex, length int)
	dfs = func(at board.Vertex, length int) {
		if length > best {
			best = length
		}
		if b, ok := s.Buildings[at]; ok && b.Owner != p {
			return
		}
		if s.vertexBlocked(at, p) {
			return
		}
		for _, e := range at.Edges() {
			if visited[e] {
				continue
			}
			if owner, ok := s.Roads[e]; !ok || owner != p {
				continue
			}
			visited[e] = true
			dfs(e.Other(at), length+1)
			visited[e] = false
		}
	}
	for _, e := range own {
		for _, start := range []board.Vertex{e.A, e.B} {
			dfs(start, 0)
		}
	}
	return best
}

// TestLongestRoadMatchesReference stamps many random road and building layouts
// and asserts the compiled-graph DFS matches the reference for every seat.
func TestLongestRoadMatchesReference(t *testing.T) {
	s, _ := newGame(t, 3, 71)
	runSetup(t, s)
	allEdges := make([]board.Edge, 0, len(s.Roads)*4)
	seen := map[board.Edge]bool{}
	for h := range s.Board.Tiles {
		for _, e := range h.Edges() {
			if e.Valid() && !seen[e] {
				seen[e] = true
				allEdges = append(allEdges, e)
			}
		}
	}
	verts := make([]board.Vertex, 0, len(allEdges))
	vseen := map[board.Vertex]bool{}
	for _, e := range allEdges {
		for _, v := range []board.Vertex{e.A, e.B} {
			if !vseen[v] {
				vseen[v] = true
				verts = append(verts, v)
			}
		}
	}

	rng := rand.New(rand.NewPCG(99, 7))
	for trial := range 400 {
		s.Roads = map[board.Edge]PlayerID{}
		s.Buildings = map[board.Vertex]Building{}
		for _, e := range allEdges {
			if rng.IntN(3) == 0 { // ~1/3 of edges get a road
				s.Roads[e] = PlayerID(rng.IntN(3))
			}
		}
		for _, v := range verts {
			if rng.IntN(8) == 0 { // sparse opponent/own buildings cut paths
				s.Buildings[v] = Building{Owner: PlayerID(rng.IntN(3))}
			}
		}
		for p := range s.Players {
			pid := PlayerID(p)
			if got, want := longestRoadLength(s, pid), refLongestRoadLength(s, pid); got != want {
				t.Fatalf("trial %d seat %d: optimized=%d reference=%d", trial, p, got, want)
			}
		}
	}
}

// chainFrom builds a connected chain of n road edges for a player starting at
// a vertex, returning the edges used. Test-only direct state surgery.
func chainFrom(t *testing.T, s *State, p PlayerID, start board.Vertex, n int) []board.Edge {
	t.Helper()
	var out []board.Edge
	at := start
	for len(out) < n {
		var next *board.Edge
		for _, e := range at.Edges() {
			if _, taken := s.Roads[e]; taken || !s.Board.LandEdge(e) {
				continue
			}

			next = &e
			break
		}
		if next == nil {
			t.Fatalf("only %d of %d chain edges laid from %v", len(out), n, start)
		}
		s.Roads[*next] = p
		out = append(out, *next)
		at = next.Other(at)
	}
	return out
}

func TestLongestRoadLength(t *testing.T) {
	s := playState(t, 40)
	// Clear setup roads for a clean slate.
	s.Roads = map[board.Edge]PlayerID{}
	s.Buildings = map[board.Vertex]Building{}

	start := board.Vertex{Q: 0, R: 0, Side: board.N}
	chainFrom(t, s, 0, start, 5)
	if got := longestRoadLength(s, 0); got != 5 {
		t.Errorf("length = %d, want 5", got)
	}
	if got := longestRoadLength(s, 1); got != 0 {
		t.Errorf("player 1 length = %d, want 0", got)
	}
}

// In a base-only game there is no RouteEdges module hook, so the combined
// route length must equal the roads-only length for every seat.
func TestLongestRouteLength(t *testing.T) {
	s := playState(t, 40)
	s.Roads = map[board.Edge]PlayerID{}
	s.Buildings = map[board.Vertex]Building{}

	chainFrom(t, s, 0, board.Vertex{Q: 0, R: 0, Side: board.N}, 5)
	for p := range s.Players {
		pid := PlayerID(p)
		if route, road := LongestRouteLength(s, pid), LongestRoadLength(s, pid); route != road {
			t.Errorf("seat %d: route %d != road %d (base game)", p, route, road)
		}
	}
	if got := LongestRouteLength(s, 0); got != 5 {
		t.Errorf("length = %d, want 5", got)
	}
}

func TestOpponentBuildingCutsRoad(t *testing.T) {
	s := playState(t, 41)
	s.Roads = map[board.Edge]PlayerID{}
	s.Buildings = map[board.Vertex]Building{}

	start := board.Vertex{Q: 0, R: 0, Side: board.N}
	edges := chainFrom(t, s, 0, start, 6)
	if got := longestRoadLength(s, 0); got != 6 {
		t.Fatalf("length = %d, want 6", got)
	}
	// Opponent settlement on the chain's third joint cuts it.
	joint := edges[2].A
	if !edges[3].Touches(joint) {
		joint = edges[2].B
	}
	s.Buildings[joint] = Building{Owner: 1}
	got := longestRoadLength(s, 0)
	if got >= 6 {
		t.Errorf("cut road length = %d, want < 6", got)
	}
}

func TestLongestRoadTitleFlow(t *testing.T) {
	s := playState(t, 42)
	s.Roads = map[board.Edge]PlayerID{}
	s.Buildings = map[board.Vertex]Building{}
	s.LongestRoadHolder = NoPlayer

	// Player 0 reaches 5: takes the title.
	chainFrom(t, s, 0, board.Vertex{Q: 0, R: 0, Side: board.N}, 5)
	after := s.Clone()
	events := longestRoadEvents(after, longestRoadLength)
	if len(events) != 1 {
		t.Fatalf("events = %+v", events)
	}
	if d := decode[TitleData](events[0]); d.Holder != 0 {
		t.Errorf("holder = %d", d.Holder)
	}
	s.LongestRoadHolder = 0

	// Player 1 matches 5: holder keeps on tie.
	chainFrom(t, s, 1, board.Vertex{Q: -1, R: 2, Side: board.S}, 5)
	if events := longestRoadEvents(s.Clone(), longestRoadLength); len(events) != 0 {
		t.Errorf("tie should not move the title: %+v", events)
	}

	// Player 1 reaches 6: takes it.
	if longestRoadLength(s, 1) == 5 {
		chainFromEnd(t, s, 1)
		if longestRoadLength(s, 1) >= 6 {
			events = longestRoadEvents(s.Clone(), longestRoadLength)
			if len(events) != 1 {
				t.Fatalf("events = %+v", events)
			}
			if d := decode[TitleData](events[0]); d.Holder != 1 {
				t.Errorf("holder = %d, want 1", d.Holder)
			}
		}
	}
}

// chainFromEnd extends any of player p's road ends by one edge.
func chainFromEnd(t *testing.T, s *State, p PlayerID) {
	t.Helper()
	for e, owner := range s.Roads {
		if owner != p {
			continue
		}
		for _, v := range []board.Vertex{e.A, e.B} {
			for _, ne := range v.Edges() {
				if _, taken := s.Roads[ne]; !taken && s.Board.LandEdge(ne) {
					s.Roads[ne] = p
					return
				}
			}
		}
	}
	t.Fatalf("player %d has no extendable road end", p)
}

func TestVPComposition(t *testing.T) {
	s := playState(t, 43)
	base := s.PublicVP(0) // setup settlements

	s.LongestRoadHolder = 0
	s.LargestArmyHolder = 0
	if got := s.PublicVP(0); got != base+4 {
		t.Errorf("public VP with both titles = %d, want %d", got, base+4)
	}
	s.Players[0].DevCards[DevVictoryPoint] = 2
	if got := s.VP(0); got != base+6 {
		t.Errorf("full VP = %d, want %d", got, base+6)
	}
	if got := s.PublicVP(0); got != base+4 {
		t.Errorf("VP cards leaked into public VP: %d", got)
	}
}
