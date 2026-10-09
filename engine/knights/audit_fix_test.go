package knights

import (
	"bytes"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// buildChain lays a simple connected chain of n road edges for player p on a
// (cleared) board, returning the edges in path order and whether it fit. Unlike
// chainFor it never calls t.Skip, so it is safe to call inside a seed loop.
func buildChain(s *engine.State, p engine.PlayerID, start board.Vertex, n int) ([]board.Edge, bool) {
	var out []board.Edge
	at := start
	for len(out) < n {
		var next *board.Edge
		for _, e := range at.Edges() {
			if _, taken := s.Roads[e]; taken || !s.Board.LandEdge(e) {
				continue
			}
			if !s.Board.LandVertex(e.Other(at)) {
				continue
			}
			ee := e
			next = &ee
			break
		}
		if next == nil {
			return nil, false
		}
		s.Roads[*next] = p
		out = append(out, *next)
		at = next.Other(at)
	}
	return out, true
}

// interiorJointWithFreeEdge finds an interior joint of the chain (a vertex
// shared by two consecutive chain edges) that also has a free land edge,
// returning the joint, that edge and its far endpoint: what a foreign road
// needs so its knight can sit on the joint and split the chain.
func interiorJointWithFreeEdge(s *engine.State, edges []board.Edge) (joint board.Vertex, free board.Edge, far board.Vertex, ok bool) {
	for i := 0; i+1 < len(edges); i++ {
		var jv board.Vertex
		shared := false
		for _, v := range []board.Vertex{edges[i].A, edges[i].B} {
			if edges[i+1].Touches(v) {
				jv, shared = v, true
				break
			}
		}
		if !shared {
			continue
		}
		for _, e := range jv.Edges() {
			if _, taken := s.Roads[e]; taken || !s.Board.LandEdge(e) {
				continue
			}
			w := e.Other(jv)
			if !s.Board.LandVertex(w) {
				continue
			}
			return jv, e, w, true
		}
	}
	return board.Vertex{}, board.Edge{}, board.Vertex{}, false
}

// TestLongestRoadRecomputesAfterRelocation: EvRoadRelocated (Diplomat) and
// EvKnightRelocated are registered route events, so Longest Road is recomputed
// when they change a player's route length.
func TestLongestRoadRecomputesAfterRelocation(t *testing.T) {
	t.Run("diplomat road relocation strips the title", func(t *testing.T) {
		for seed := uint64(1); seed < 120; seed++ {
			s, _ := newGame(t, seed, nil)
			rolled(t, s)
			p := s.Cur
			op := (p + 1) % engine.PlayerID(len(s.Players))

			s.Roads = map[board.Edge]engine.PlayerID{}
			s.Buildings = map[board.Vertex]engine.Building{}

			edges, ok := buildChain(s, op, board.Vertex{Q: 0, R: 0, Side: board.N}, 5)
			if !ok || engine.LongestRoadLength(s, op) != 5 {
				continue
			}
			s.LongestRoadHolder = op
			giveCard(s, p, CardDiplomat)

			// Free op's open tip road, dropping its route to 4 (below the title).
			tip := edges[len(edges)-1]
			if !openRoad(s, tip, op) {
				continue
			}
			events, err := engine.Decide(s, engine.Command{Player: p, Type: CmdPlayProgress,
				Data: rawJSON(map[string]any{"card": CardDiplomat, "e": tip})})
			if err != nil {
				continue
			}
			for _, e := range events {
				if err := engine.Apply(s, e); err != nil {
					t.Fatalf("apply %s: %v", e.Type, err)
				}
			}
			if got := engine.LongestRoadLength(s, op); got != 4 {
				t.Fatalf("seed %d: op route after Diplomat = %d, want 4", seed, got)
			}
			if s.LongestRoadHolder == op {
				t.Fatalf("seed %d: Diplomat road relocation dropped op to 4 but the "+
					"Longest Road title was not recomputed (still held by op)", seed)
			}
			return
		}
		fixtureGone(t, "no seed produced a clean 5-road Diplomat scenario")
	})

	t.Run("knight relocation splitting a road strips the title", func(t *testing.T) {
		for seed := uint64(1); seed < 200; seed++ {
			s, _ := newGame(t, seed, nil)
			rolled(t, s)
			cur := s.Cur
			op := (cur + 1) % engine.PlayerID(len(s.Players))

			s.Roads = map[board.Edge]engine.PlayerID{}
			s.Buildings = map[board.Vertex]engine.Building{}
			x := ext(s)
			x.Knights = map[board.Vertex]Knight{}

			edges, ok := buildChain(s, op, board.Vertex{Q: 0, R: 0, Side: board.N}, 5)
			if !ok || engine.LongestRoadLength(s, op) != 5 {
				continue
			}
			s.LongestRoadHolder = op

			joint, free, far, ok := interiorJointWithFreeEdge(s, edges)
			if !ok {
				continue
			}
			// cur owns a road into the joint, and a displaced knight of cur's is
			// waiting to be relocated; the joint is reachable along cur's roads.
			s.Roads[free] = cur
			x.RelocPlayer = cur
			x.RelocFrom = far
			x.RelocLevel = 1
			x.RelocActive = true

			events, err := engine.Decide(s, engine.Command{Player: cur, Type: CmdRelocateKnight,
				Data: rawJSON(map[string]any{"to": joint})})
			if err != nil {
				continue
			}
			for _, e := range events {
				if err := engine.Apply(s, e); err != nil {
					t.Fatalf("apply %s: %v", e.Type, err)
				}
			}
			if k, ok := x.Knights[joint]; !ok || k.Owner != cur {
				t.Fatalf("seed %d: knight not relocated onto the joint: %+v", seed, x.Knights[joint])
			}
			if got := engine.LongestRoadLength(s, op); got >= 5 {
				t.Fatalf("seed %d: enemy knight should split op below 5, got %d", seed, got)
			}
			if s.LongestRoadHolder == op {
				t.Fatalf("seed %d: knight relocation split op's road but the Longest "+
					"Road title was not recomputed (still held by op)", seed)
			}
			return
		}
		fixtureGone(t, "no seed produced a clean 5-road knight-split scenario")
	})
}

// TestHarborGivenRedactionHidesCommodity: non-parties see only that a
// Commercial Harbor exchange happened, not the commodity surrendered (Com).
func TestHarborGivenRedactionHidesCommodity(t *testing.T) {
	redact, ok := engine.RedactorFor(EvHarborGiven)
	if !ok {
		t.Fatal("no redactor registered for EvHarborGiven")
	}
	out := redact(engine.NewEvent(EvHarborGiven, harborGivenData{
		Taker: 0, Giver: 1, Res: board.Wood, Com: Coin,
	}))
	if bytes.Contains(out, []byte("com")) {
		t.Errorf("redacted harbor payload leaks the commodity field: %s", out)
	}
	// The public parts of the exchange are still conveyed.
	for _, want := range []string{"taker", "giver", "res"} {
		if !bytes.Contains(out, []byte(want)) {
			t.Errorf("redacted harbor payload dropped public field %q: %s", want, out)
		}
	}
}

// TestWallBuildsOnChosenCity: a wall lands on the city the player designates,
// not just the first unwalled city in board order.
func TestWallBuildsOnChosenCity(t *testing.T) {
	// twoCities strips p's buildings and plants two cities on distinct empty land
	// vertices, returning them in board-scan order (vs[0] is firstUnwalledCity).
	twoCities := func(t *testing.T, s *engine.State, p engine.PlayerID) []board.Vertex {
		t.Helper()
		for v, b := range s.Buildings {
			if b.Owner == p {
				delete(s.Buildings, v)
			}
		}
		var vs []board.Vertex
		seen := map[board.Vertex]bool{}
		for _, h := range board.HexesInRadius(s.Board.Radius) {
			for _, v := range h.Vertices() {
				if v.Side > board.S || !s.Board.LandVertex(v) || seen[v] {
					continue
				}
				if _, taken := s.Buildings[v]; taken {
					continue
				}
				seen[v] = true
				vs = append(vs, v)
				if len(vs) == 2 {
					break
				}
			}
			if len(vs) == 2 {
				break
			}
		}
		if len(vs) < 2 {
			fixtureGone(t, "board too small for two cities")
		}
		for _, v := range vs {
			s.Buildings[v] = engine.Building{Owner: p, City: true}
		}
		return vs
	}

	// Choosing either city must wall exactly that one; chosen=1 differs from the
	// first board-order city.
	for _, chosen := range []int{0, 1} {
		name := "chosen index 0 (== board-order first)"
		if chosen == 1 {
			name = "chosen index 1 (overrides board-order first)"
		}
		t.Run(name, func(t *testing.T) {
			s, _ := newGame(t, 30, nil)
			clearStartingCities(s)
			rolled(t, s)
			p := s.Cur
			vs := twoCities(t, s, p)
			x := ext(s)

			s.Players[p].Hand = costWall
			step(t, s, engine.Command{Player: p, Type: CmdBuildWall,
				Data: mustJSON(t, map[string]any{"v": vs[chosen]})})

			if !x.Walled[vs[chosen]] {
				t.Errorf("wall did not land on the chosen city %v: walled=%v", vs[chosen], x.Walled)
			}
			if x.Walled[vs[1-chosen]] {
				t.Errorf("wall landed on the unchosen city %v", vs[1-chosen])
			}
		})
	}

	t.Run("empty vertex falls back to first unwalled city", func(t *testing.T) {
		s, _ := newGame(t, 30, nil)
		clearStartingCities(s)
		rolled(t, s)
		p := s.Cur
		vs := twoCities(t, s, p)
		x := ext(s)
		first, ok := firstUnwalledCity(s, x, p)
		if !ok {
			t.Fatal("expected an unwalled city")
		}

		s.Players[p].Hand = costWall
		step(t, s, engine.Command{Player: p, Type: CmdBuildWall, Data: mustJSON(t, nil)})

		if !x.Walled[first] {
			t.Errorf("empty-vertex wall should fall back to first unwalled city %v: walled=%v", first, x.Walled)
		}
		_ = vs
	})

	t.Run("rejects non-city vertex", func(t *testing.T) {
		s, _ := newGame(t, 30, nil)
		clearStartingCities(s)
		rolled(t, s)
		p := s.Cur
		_ = twoCities(t, s, p)

		// An empty (cityless) land vertex is not a legal wall target.
		var empty board.Vertex
		found := false
		for _, h := range board.HexesInRadius(s.Board.Radius) {
			for _, v := range h.Vertices() {
				if v.Side > board.S || !s.Board.LandVertex(v) {
					continue
				}
				if _, taken := s.Buildings[v]; taken {
					continue
				}
				empty, found = v, true
				break
			}
			if found {
				break
			}
		}
		if !found {
			fixtureGone(t, "no empty vertex available")
		}
		s.Players[p].Hand = costWall
		reject(t, s, engine.Command{Player: p, Type: CmdBuildWall,
			Data: mustJSON(t, map[string]any{"v": empty})}, engine.ErrBadPlacement)
	})
}
