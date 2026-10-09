package bot

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// roadedBaseGame gives seat 0 a settlement and a two-road chain off it, which is
// the shortest network that leaves an open, legal settlement spot at its end.
func roadedBaseGame(t *testing.T, seed uint64) *engine.State {
	t.Helper()
	s := newBaseGame(t, seed)
	s.Phase = engine.PhasePlay
	s.Cur = 0
	s.Rolled = true

	for _, h := range board.HexesInRadius(s.Board.Radius) {
		tl, ok := s.Board.Tiles[h]
		if !ok || !tl.Res.Producing() || h == s.Board.Robber {
			continue
		}
		v := h.Vertices()[0]
		for _, e1 := range v.Edges() {
			if !e1.Valid() || !s.Board.LandEdge(e1) {
				continue
			}
			w := e1.A
			if w == v {
				w = e1.B
			}
			for _, e2 := range w.Edges() {
				if !e2.Valid() || e2 == e1 || !s.Board.LandEdge(e2) {
					continue
				}
				u := e2.A
				if u == w {
					u = e2.B
				}
				if u == v {
					continue
				}
				s.Buildings[v] = engine.Building{Owner: 0}
				s.Roads[e1] = 0
				s.Roads[e2] = 0
				if engine.CheckSettlementSpot(s, u) != nil {
					delete(s.Buildings, v)
					delete(s.Roads, e1)
					delete(s.Roads, e2)
					continue
				}
				return s
			}
		}
	}
	t.Fatal("no settlement-plus-two-roads fixture on this board")
	return nil
}

// TestFreeRoadCreditIsScored: a road already paid for (State.FreeRoads) but not
// yet placed must be worth something to the evaluator.
func TestFreeRoadCreditIsScored(t *testing.T) {
	s := roadedBaseGame(t, 43)
	b := NewStrong()
	before := b.eval(s, 0)
	s.FreeRoads = 2
	after := b.eval(s, 0)
	if after <= before {
		t.Errorf("two pending free roads scored %.6f, none scored %.6f, want higher", after, before)
	}
}

// TestRoadBuildingBeatsStandingPat: bestPlay takes a dev play only if it beats
// standing pat. Playing Road Building moves no piece, so it must score above
// zero through the free-road credit or it is never played.
func TestRoadBuildingBeatsStandingPat(t *testing.T) {
	s := roadedBaseGame(t, 43)
	s.Players[0].DevCards[engine.DevRoadBuilding] = 1
	b := NewStrong()
	if !b.shouldPlayRoadBuilding(s, 0) {
		t.Fatal("fixture has no reachable spot")
	}
	base := b.eval(s, 0)
	cmd, sc, ok := b.bestDevPlay(s, 0)
	if !ok {
		t.Fatal("no dev play offered")
	}
	var d struct {
		Card engine.DevCard `json:"card"`
	}
	mustUnmarshal(t, cmd.Data, &d)
	if d.Card != engine.DevRoadBuilding {
		t.Fatalf("expected the Road Building play, got %v", d.Card)
	}
	if sc <= base+1e-9 {
		t.Errorf("Road Building scores %.6f, baseline %.6f, want higher", sc, base)
	}
}

// TestFreeRoadsAreSpentWithAFrontierOpen: the anti-sprawl road gate closes when
// an open settlement spot is reachable, which is where Road Building is played.
// Granted roads cost nothing and expire, so they must bypass the gate.
func TestFreeRoadsAreSpentWithAFrontierOpen(t *testing.T) {
	s := roadedBaseGame(t, 43)
	s.Players[0].Hand = engine.Hand{} // nothing else is affordable
	b := NewStrong()
	if len(b.frontierVertices(s, 0)) == 0 {
		t.Fatal("fixture has an empty frontier")
	}
	s.FreeRoads = 2
	cmd, ok := b.bestPlay(s, 0)
	if !ok || cmd.Type != engine.CmdBuildRoad {
		t.Errorf("two free roads pending: bestPlay chose %+v ok=%v, want a road", cmd, ok)
	}
}
