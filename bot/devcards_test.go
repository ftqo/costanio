package bot

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// Monopoly targets the resource opponents are most likely to hold, estimated
// from public information: card counts spread across what their buildings
// produce. The test seeds production rather than hands.
func TestMonopolyPicksMostLikelyHeld(t *testing.T) {
	s := newBaseGame(t, 41)
	s.Phase = engine.PhasePlay
	s.Cur = 0
	s.Rolled = true
	b := NewStrong()
	s.Players[0].DevCards[engine.DevMonopoly] = 1
	s.Players[1].Hand = engine.Hand{board.Wheat: 4, board.Wood: 2}

	// Derive the expected answer from the public estimate, weighted by
	// usefulness, rather than assume it from the fixture (a vertex touches
	// several hexes).
	phase := gamePhase(s, 0)
	want, wantVal := board.Wood, -1.0
	for _, r := range board.Resources {
		total := 0.0
		for p := range s.Players {
			if engine.PlayerID(p) == 0 {
				continue
			}
			total += publicHandEstimate(s, engine.PlayerID(p))[r]
		}
		if v := total * (b.resourceWeight(r, phase) + 0.1); v > wantVal {
			want, wantVal = r, v
		}
	}

	res, ok := b.monopolyResource(s, 0)
	if !ok {
		t.Fatal("monopoly should pick a resource when opponents hold cards")
	}
	if res != want {
		t.Errorf("monopoly picked %v, want %v (argmax of the public estimate)", res, want)
	}
}

// The bot must not be able to see hidden hands: two opponents with identical
// public footprints but different actual cards must produce the same choice.
func TestMonopolyIgnoresHiddenHandContents(t *testing.T) {
	pick := func(h engine.Hand) (board.Resource, bool) {
		s := newBaseGame(t, 41)
		s.Phase = engine.PhasePlay
		s.Cur = 0
		s.Rolled = true
		s.Players[0].DevCards[engine.DevMonopoly] = 1
		s.Players[1].Hand = h
		return NewStrong().monopolyResource(s, 0)
	}
	// Same card count, different composition.
	a, aok := pick(engine.Hand{board.Wheat: 6})
	c, cok := pick(engine.Hand{board.Ore: 6})
	if aok != cok || a != c {
		t.Errorf("monopoly choice depends on hidden hand contents (%v/%v vs %v/%v)", a, aok, c, cok)
	}
}

func TestYearOfPlentyTakesNeeded(t *testing.T) {
	s := newBaseGame(t, 42)
	s.Phase = engine.PhasePlay
	s.Cur = 0
	s.Rolled = true
	s.Players[0].CitiesLeft = 4
	b := NewStrong()

	s.Players[0].DevCards[engine.DevYearOfPlenty] = 1
	s.Bank = engine.Hand{board.Wood: 5, board.Brick: 5, board.Sheep: 5, board.Wheat: 5, board.Ore: 5}
	// Own an upgradeable settlement so a city is a real target.
	var own board.Vertex
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, v := range h.Vertices() {
			own = v
			break
		}
		if (own != board.Vertex{}) {
			break
		}
	}
	s.Buildings[own] = engine.Building{Owner: 0}
	// One ore and one wheat short of the city (3 ore + 2 wheat).
	s.Players[0].Hand = engine.Hand{board.Ore: 2, board.Wheat: 1}

	gain, ok := b.yearOfPlentyGain(s, 0)
	if !ok {
		t.Fatal("YoP should choose two cards")
	}
	if gain.Count() != 2 {
		t.Fatalf("YoP gain count = %d, want 2", gain.Count())
	}
	// Completing the city needs exactly the missing ore + wheat.
	if gain[board.Ore] < 1 || gain[board.Wheat] < 1 {
		t.Errorf("YoP gain = %v, want the ore+wheat that completes the city", gain)
	}
}

func TestRoadBuildingSkipsWhenNoSpot(t *testing.T) {
	s := newBaseGame(t, 43)
	s.Phase = engine.PhasePlay
	s.Cur = 0
	s.Rolled = true
	b := NewStrong()
	s.Players[0].DevCards[engine.DevRoadBuilding] = 1
	for e := range s.Roads {
		delete(s.Roads, e)
	}
	if b.shouldPlayRoadBuilding(s, 0) {
		t.Error("Road Building should be skipped when no settlement spot is reachable")
	}
}
