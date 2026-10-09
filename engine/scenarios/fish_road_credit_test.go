package scenarios

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/knights"
)

// TestFishRoadCreditSurvivesRoadBuilding: the five-fish road is its own purchase,
// so a Road Building card played while that credit is unspent adds its two roads
// rather than replacing it (three roads to place, not two).
func TestFishRoadCreditSurvivesRoadBuilding(t *testing.T) {
	s, _ := newGame(t, "base+fishermen", 2)
	rolled(t, s)
	p := s.Cur
	setHeld(fishExt(s), p, [3]int{0, 0, 5})
	s.Players[p].DevCards[engine.DevRoadBuilding] = 1

	step(t, s, engine.Command{Player: p, Type: CmdSpendFish,
		Data: mustJSON(t, map[string]any{"use": FishFreeRoad, "e": legalRoadEdge(t, s, p)})})
	if s.FreeRoads != 1 {
		t.Fatalf("free roads after the fish spend = %d, want 1", s.FreeRoads)
	}
	step(t, s, engine.Command{Player: p, Type: engine.CmdPlayDevCard,
		Data: mustJSON(t, map[string]any{"card": engine.DevRoadBuilding})})
	want := min(s.Players[p].RoadsLeft, 3)
	if s.FreeRoads != want {
		t.Fatalf("free roads after Road Building on top of a fish credit = %d, want %d", s.FreeRoads, want)
	}
}

// TestFishRoadCreditKnightsRoadBuilding is the same seam under
// Knights, whose Road Building is a progress card with its own credit event.
func TestFishRoadCreditKnightsRoadBuilding(t *testing.T) {
	s, _ := newGame(t, "base+cak+fishermen", 2)
	s.FreeRoads = 1 // a five-fish road bought earlier this turn
	ev := engine.NewEvent(knights.EvFreeRoads, map[string]any{"player": s.Cur, "count": 2})
	ev.Seq = s.NextSeq
	if err := engine.Apply(s, ev); err != nil {
		t.Fatal(err)
	}
	if s.FreeRoads != 3 {
		t.Fatalf("free roads after the Knights Road Building on top of a fish credit = %d, want 3", s.FreeRoads)
	}
}
