package game

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/knights"
)

// TestFullViewCarriesMetropolisPickTargets: the metropolis city choice must
// reach the wire (see TestFullViewCarriesBarbarianDowngradeTargets). This
// checks the wire shape (engine/knights covers the rules): the seat that earned the
// metropolis sees its eligible cities in view.Legal and the pending pick in the
// module's ext view, and nobody else sees the targets.
func TestFullViewCarriesMetropolisPickTargets(t *testing.T) {
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

	const holder engine.PlayerID = 1
	s.Cur = holder

	// Two metropolis-free cities, so the placement is a real choice; with one
	// the engine never asks.
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
			s.Buildings[v] = engine.Building{Owner: holder, City: true}
			s.Players[holder].CitiesLeft--
			planted = append(planted, v)
		}
	}
	if len(planted) != 2 {
		t.Fatalf("could not plant 2 cities for seat %d (got %d)", holder, len(planted))
	}

	// Seed the obligation as a level-4 improvement does.
	pend := engine.NewEvent(knights.EvMetropolisPending, map[string]any{
		"track": int(knights.Trade), "holder": holder, "prev": engine.NoPlayer,
	})
	pend.Seq = s.NextSeq
	if err := engine.Apply(s, pend); err != nil {
		t.Fatalf("seed pending metropolis: %v", err)
	}
	if _, cities, ok := knights.MetropolisChoice(s, holder); !ok || len(cities) < 2 {
		t.Fatalf("engine offers ok=%v %d eligible cities, want at least 2", ok, len(cities))
	}

	v := NewFullView(s, holder)
	if v.Legal == nil {
		t.Fatal("no Legal block for the seat placing the metropolis")
	}
	if len(v.Legal.MetropolisCities) < 2 {
		t.Fatalf("view offers %d cities for the metropolis, want at least 2", len(v.Legal.MetropolisCities))
	}
	for _, want := range planted {
		if !containsVertex(v.Legal.MetropolisCities, want) {
			t.Errorf("city %+v is eligible but not offered in the view", want)
		}
	}

	// The pending pick is public, so the client can arm the pick mode and the
	// table can see who is holding things up.
	ext, ok := v.Ext[knights.Name].(*knights.ExtView)
	if !ok || ext.MetropolisPick == nil {
		t.Fatalf("ext view carries no pending metropolis pick: %+v", v.Ext[knights.Name])
	}
	if ext.MetropolisPick.Player != holder || ext.MetropolisPick.Track != knights.Trade {
		t.Errorf("pending pick = %+v, want player %d on Trade", ext.MetropolisPick, holder)
	}

	// Nobody else is deciding, so nobody else is offered the targets.
	for _, other := range []engine.PlayerID{0, 2, Spectator} {
		ov := NewFullView(s, other)
		if ov.Legal != nil && len(ov.Legal.MetropolisCities) > 0 {
			t.Errorf("viewer %d sees seat %d's metropolis targets", other, holder)
		}
	}
}
