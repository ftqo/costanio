package game

import (
	"slices"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/knights"
)

// TestFullViewCarriesBarbarianDowngradeTargets: the city-sacrifice choice set
// must reach the wire in view.Legal, or the client prompts for a city with
// nothing tappable until the timer picks. This checks the wire shape (engine/knights
// covers the rules): the seat owed the sacrifice sees its own cities, even when
// it is not the current player, which is the usual case.
func TestFullViewCarriesBarbarianDowngradeTargets(t *testing.T) {
	events, err := engine.New(engine.GameConfig{Players: 3, Ruleset: "base+cak"}, engine.SeedsFrom(7))
	if err != nil {
		t.Fatal(err)
	}
	s, err := engine.Replay(events)
	if err != nil {
		t.Fatal(err)
	}
	s.Phase = engine.PhasePlay
	s.Rolled = true
	s.Cur = 0 // seat 0 rolled; seat 2 is the one who owes the sacrifice

	// Two cities for seat 2, so there is a real choice; with one the engine
	// razes it without asking.
	const loser engine.PlayerID = 2
	var planted []board.Vertex
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, v := range h.Vertices() {
			if len(planted) == 2 {
				break
			}
			if _, taken := s.Buildings[v]; taken || !s.Board.LandVertex(v) {
				continue
			}
			if engine.CheckSettlementSpot(s, v) != nil {
				continue
			}
			s.Buildings[v] = engine.Building{Owner: loser, City: true}
			s.Players[loser].CitiesLeft--
			planted = append(planted, v)
		}
	}
	if len(planted) != 2 {
		t.Fatalf("could not plant 2 cities for seat %d (got %d)", loser, len(planted))
	}

	// Seed the obligation as a lost defense does.
	atk := engine.NewEvent(knights.EvBarbarianAttack, map[string]any{
		"strength": 0, "cities": 2, "win": false,
		"defender":          engine.NoPlayer,
		"pending_downgrade": []engine.PlayerID{loser},
	})
	atk.Seq = s.NextSeq
	if err := engine.Apply(s, atk); err != nil {
		t.Fatalf("seed attack: %v", err)
	}
	if got := knights.SacrificeCities(s, loser); len(got) != 2 {
		t.Fatalf("engine offers %d sacrificable cities, want 2", len(got))
	}

	v := NewFullView(s, loser)
	if v.Legal == nil {
		t.Fatal("no Legal block for the seat owing the sacrifice")
	}
	if len(v.Legal.BarbarianDowngrades) != 2 {
		t.Fatalf("view offers %d cities to sacrifice, want 2", len(v.Legal.BarbarianDowngrades))
	}
	for _, want := range planted {
		if !containsVertex(v.Legal.BarbarianDowngrades, want) {
			t.Errorf("city %+v is sacrificable but not offered in the view", want)
		}
	}

	// Nobody else is deciding, so nobody else is offered the targets.
	for _, other := range []engine.PlayerID{0, 1, Spectator} {
		ov := NewFullView(s, other)
		if ov.Legal != nil && len(ov.Legal.BarbarianDowngrades) > 0 {
			t.Errorf("viewer %d sees seat %d's sacrifice targets", other, loser)
		}
	}
}

func containsVertex(vs []board.Vertex, want board.Vertex) bool {
	return slices.Contains(vs, want)
}
