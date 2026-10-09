package knights

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// chainFor lays down a connected chain of n road edges for player p starting at
// a vertex, returning the edges used. Direct state surgery for tests.
func chainFor(t *testing.T, s *engine.State, p engine.PlayerID, start board.Vertex, n int) []board.Edge {
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
			fixtureGone(t, "board too cramped for the chain on this seed")
		}
		s.Roads[*next] = p
		out = append(out, *next)
		at = next.Other(at)
	}
	return out
}

// TestKnightCutsLongestRoad: an opponent's knight on a player's road chain
// breaks the route through that intersection, shortening it and removing the
// longest-road title, as an opponent's building would.
func TestKnightCutsLongestRoad(t *testing.T) {
	s, _ := newGame(t, 7, nil)
	rolled(t, s)
	cur := s.Cur
	op := engine.PlayerID((int(cur) + 1) % len(s.Players))

	// Clean slate so the chain stands alone.
	s.Roads = map[board.Edge]engine.PlayerID{}
	s.Buildings = map[board.Vertex]engine.Building{}

	// op holds a 6-road chain and the longest-road title.
	edges := chainFor(t, s, op, board.Vertex{Q: 0, R: 0, Side: board.N}, 6)
	s.LongestRoadHolder = op
	if got := engine.LongestRoadLength(s, op); got != 6 {
		t.Fatalf("setup: op length = %d, want 6", got)
	}

	// Find an interior joint of the chain that has a free land edge for cur's
	// road (the knight must sit on cur's own network).
	var joint, curEdge = board.Vertex{}, board.Edge{}
	found := false
	for i := 1; i < len(edges)-1 && !found; i++ {
		jv := edges[i].A
		if !edges[i+1].Touches(jv) {
			jv = edges[i].B
		}
		for _, e := range jv.Edges() {
			if _, taken := s.Roads[e]; taken || !s.Board.LandEdge(e) {
				continue
			}
			joint, curEdge, found = jv, e, true
			break
		}
	}
	if !found {
		fixtureGone(t, "no interior joint with a free edge on this seed")
	}
	s.Roads[curEdge] = cur
	s.Players[cur].Hand = engine.Hand{board.Sheep: 1, board.Ore: 1}

	step(t, s, engine.Command{Player: cur, Type: CmdBuildKnight, Data: mustJSON(t, knightData{V: joint})})

	if got := engine.LongestRoadLength(s, op); got >= 6 {
		t.Errorf("enemy knight should cut op's road below 6, got %d", got)
	}
	if s.LongestRoadHolder == op {
		t.Error("enemy knight on the road should strip op's longest-road title")
	}
}
