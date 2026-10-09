package knights

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

func rawJSON(v any) json.RawMessage { b, _ := json.Marshal(v); return b }

// allVerts enumerates each unique board vertex once.
func allVerts(s *engine.State) []board.Vertex {
	var out []board.Vertex
	forEachVertex(s, func(v board.Vertex) { out = append(out, v) })
	return out
}

// assertPendingVertexSet asserts the offered placement set for seat equals what
// the command validator accepts, over every board vertex.
func assertPendingVertexSet(t *testing.T, name string, s *engine.State, seat engine.PlayerID, offered []board.Vertex, ct engine.CommandType, key string) {
	t.Helper()
	set := map[board.Vertex]bool{}
	for _, v := range offered {
		set[v] = true
	}
	if len(offered) == 0 {
		t.Fatalf("%s: no spots offered; setup did not reach the pending state", name)
	}
	for _, v := range allVerts(s) {
		_, err := engine.Decide(s, engine.Command{Player: seat, Type: ct, Data: rawJSON(map[string]any{key: v})})
		if set[v] != (err == nil) {
			t.Errorf("%s: vertex %v offered=%v validator=%v (err=%v)", name, v, set[v], err == nil, err)
		}
	}
}

// TestDeserterPlacementLegalSetMatchesValidator constructs a Deserter-owed state
// directly and asserts LegalTargetsFor's DeserterPlacements exactly equals what
// decideDeserterPlace accepts.
func TestDeserterPlacementLegalSetMatchesValidator(t *testing.T) {
	s, _ := newGame(t, 3, nil)
	rolled(t, s)
	p := s.Cur

	x := ext(s)
	x.DeserterTaker = p
	x.DeserterLevel = 1
	x.DeserterActive = false

	lt := s.LegalTargetsFor(p)
	// While a Deserter placement is owed it must be the only thing offered.
	if len(lt.Settlements)+len(lt.Cities)+len(lt.Roads)+len(lt.Knights) > 0 {
		t.Errorf("normal builds offered while a Deserter placement is owed: %+v", lt)
	}
	assertPendingVertexSet(t, "deserter", s, p, lt.DeserterPlacements, CmdDeserterPlace, "v")
}

// TestKnightRelocationLegalSetMatchesValidator constructs a displaced-knight
// relocation state directly and asserts LegalTargetsFor's KnightRelocations
// exactly equals what decideRelocateKnight accepts.
func TestKnightRelocationLegalSetMatchesValidator(t *testing.T) {
	s, _ := newGame(t, 3, nil)
	rolled(t, s)
	p := s.Cur

	// RelocFrom must sit on p's network: use one of p's own building vertices.
	var from board.Vertex
	found := false
	for v, b := range s.Buildings {
		if b.Owner == p {
			from, found = v, true
			break
		}
	}
	if !found {
		t.Fatal("no building for the current player after setup")
	}
	x := ext(s)
	x.RelocPlayer = p
	x.RelocFrom = from

	lt := s.LegalTargetsFor(p)
	if len(lt.Settlements)+len(lt.Cities)+len(lt.Roads)+len(lt.Knights) > 0 {
		t.Errorf("normal builds offered while a relocation is owed: %+v", lt)
	}
	assertPendingVertexSet(t, "relocate", s, p, lt.KnightRelocations, CmdRelocateKnight, "to")
}

// TestMetropolisPickLegalSetMatchesValidator constructs a pending metropolis
// placement and asserts LegalTargetsFor's MetropolisCities equals exactly what
// decideMetropolisPick accepts, over every vertex on the board.
func TestMetropolisPickLegalSetMatchesValidator(t *testing.T) {
	s, _ := newGame(t, 3, nil)
	rolled(t, s)
	p := s.Cur

	// A second city, so the placement is a real choice rather than resolved.
	x := ext(s)
	for _, v := range nFreeVertices(s, x, board.Vertex{}, 1) {
		s.Buildings[v] = engine.Building{Owner: p, City: true}
		s.Players[p].CitiesLeft--
	}
	x.MetropolisPending = &MetropolisPick{Player: p, Track: Trade, Prev: engine.NoPlayer}

	lt := s.LegalTargetsFor(p)
	// While the pick is owed it must be the only thing offered.
	if len(lt.Settlements)+len(lt.Cities)+len(lt.Roads)+len(lt.Knights) > 0 {
		t.Errorf("normal builds offered while a metropolis pick is owed: %+v", lt)
	}
	assertPendingVertexSet(t, "metropolis", s, p, lt.MetropolisCities, CmdMetropolisPick, "v")
}

// TestFreeRoadBlockedByPendingMetropolis: Road Building's free roads may be
// placed when the turn is not otherwise actionable, but a pending module pick
// (a metropolis) still blocks them, matching LegalTargetsFor, which offers no
// roads then.
func TestFreeRoadBlockedByPendingMetropolis(t *testing.T) {
	s, _ := newGame(t, 3, nil)
	rolled(t, s)
	p := s.Cur

	// A free road with somewhere to go: without the pending pick this state offers
	// roads and accepts a build, so the pending case is not vacuous.
	s.FreeRoads = 2
	edges := s.LegalRoads(p)
	if len(edges) == 0 {
		t.Fatal("no legal road for the current player after setup")
	}
	road := engine.Command{Player: p, Type: engine.CmdBuildRoad, Data: rawJSON(map[string]any{"e": edges[0]})}
	if _, err := engine.Decide(s, road); err != nil {
		t.Fatalf("free road rejected with nothing pending: %v", err)
	}

	x := ext(s)
	x.MetropolisPending = &MetropolisPick{Player: p, Track: Trade, Prev: engine.NoPlayer}

	if lt := s.LegalTargetsFor(p); len(lt.Roads) != 0 {
		t.Errorf("roads offered while a metropolis pick is owed: %v", lt.Roads)
	}
	if _, err := engine.Decide(s, road); !errors.Is(err, engine.ErrModulePending) {
		t.Errorf("free road while a metropolis pick is owed: err = %v, want ErrModulePending", err)
	}
}
