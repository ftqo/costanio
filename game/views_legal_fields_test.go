package game

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// Every list engine.LegalTargets can hand a seat must reach the wire. The
// structural check (a LegalView field of the same type for each) is
// TestLegalViewCarriesEveryEngineList; this checks the copy fills them, and
// that a seat owed only module targets still gets a legal block (the len()
// gate in newFullViewLegal).
func TestFullViewCopiesModuleLegalLists(t *testing.T) {
	events, err := engine.New(engine.GameConfig{Players: 3, Ruleset: "base"}, engine.SeedsFrom(3))
	if err != nil {
		t.Fatal(err)
	}
	s, err := engine.Replay(events)
	if err != nil {
		t.Fatal(err)
	}
	v0 := board.Vertex{Q: 1, R: 0, Side: 0}
	e0 := board.NewEdge(board.Vertex{Q: 0, R: 0, Side: 0}, board.Vertex{Q: 0, R: -1, Side: 1})
	want := engine.LegalTargets{
		WagonSteps:     []board.Vertex{v0},
		BarbarianEdges: []board.Edge{e0},
		Harbours:       []board.Vertex{v0},
		ExplorerShips:  []engine.ExplorerShipTargets{{Ship: 1, From: e0, Left: 2}},
	}
	v := newFullViewLegal(s, 0, true, func(engine.PlayerID) engine.LegalTargets { return want })
	if v.Legal == nil {
		t.Fatal("a seat owed only module targets got no legal block at all")
	}
	if len(v.Legal.WagonSteps) != 1 || len(v.Legal.BarbarianEdges) != 1 ||
		len(v.Legal.Harbours) != 1 || len(v.Legal.ExplorerShips) != 1 {
		t.Fatalf("module legal lists dropped on the wire: %+v", v.Legal)
	}
}
