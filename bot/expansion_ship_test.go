package bot

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/islands"
)

// TestExpansionCountsShipReachedSpots: expansionPotential must seed from ships
// as well as roads, since reachableProduction skips d = 0 and a spot at the end
// of our own ship would otherwise be priced by neither term.
func TestExpansionCountsShipReachedSpots(t *testing.T) {
	events, err := engine.New(engine.GameConfig{Players: 4, Ruleset: "base+islands"}, engine.SeedsFrom(5))
	if err != nil {
		t.Fatal(err)
	}
	s := engine.Empty()
	for _, e := range events {
		if err := engine.Apply(s, e); err != nil {
			t.Fatal(err)
		}
	}
	s.Phase = engine.PhasePlay
	s.Cur = 0
	s.Rolled = true
	// The setup log never touches module state (no ship built yet), so the
	// extension does not exist until something writes one (same reason
	// knightsExtOf exists in knights_test.go).
	x, ok := islands.StateExt(s)
	if !ok {
		x = &islands.Ext{
			Ships:       map[board.Edge]engine.PlayerID{},
			BuiltTurn:   map[board.Edge]bool{},
			PendingGold: map[engine.PlayerID]int{},
			Reached:     map[engine.PlayerID]map[int]bool{},
			IslandVP:    map[engine.PlayerID]int{},
		}
		s.Ext[islands.Name] = x
	}
	b := NewStrong()
	// islandsActive also requires somewhere to sail to, and a generated board is
	// one landmass. Force the memo: the seeding is under test, not the gate.
	on := true
	b.islandsOn = &on

	// A sea edge with a legal, producing settlement spot at one end.
	var target board.Vertex
	found := false
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, v := range h.Vertices() {
			for _, e := range v.Edges() {
				if !e.Valid() || s.Board.LandEdge(e) {
					continue
				}
				for _, end := range []board.Vertex{e.A, e.B} {
					if engine.CheckSettlementSpot(s, end) != nil || vertexPips(s, end) <= 0 {
						continue
					}
					x.Ships[e] = 0
					target, found = end, true
					break
				}
				if found {
					break
				}
			}
			if found {
				break
			}
		}
		if found {
			break
		}
	}
	if !found {
		t.Fatal("no sea edge reaching an open producing spot on this board")
	}

	if got := b.expansionPotential(s, 0); got <= 0 {
		t.Errorf("expansionPotential is %.2f with a ship on an open %.2f-pip spot, want it counted", got, vertexPips(s, target))
	}
}
