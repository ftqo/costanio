package knights

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

func applyAll(t *testing.T, s *engine.State, events []engine.Event) {
	t.Helper()
	for i := range events {
		events[i].Seq = s.NextSeq
		if err := engine.Apply(s, events[i]); err != nil {
			t.Fatalf("Apply(%s): %v", events[i].Type, err)
		}
	}
}

// TestMetropolisesOnDistinctCities: a player earning a metropolis in two
// disciplines must put them on two different cities. With two eligible cities
// the first is a player choice, so arm the pick and answer it; the second then
// has one eligible city left and lands outright.
func TestMetropolisesOnDistinctCities(t *testing.T) {
	s, _ := newGame(t, 11, nil)
	x := ext(s)
	p := engine.PlayerID(0)

	vs := nFreeVertices(s, x, board.Vertex{}, 2)
	if len(vs) < 2 {
		fixtureGone(t, "board too small for two cities")
	}
	for _, v := range vs {
		s.Buildings[v] = engine.Building{Owner: p, City: true}
	}
	// Strip the setup cities so exactly the two planted above are eligible.
	for v, b := range s.Buildings {
		if b.Owner == p && b.City && v != vs[0] && v != vs[1] {
			s.Buildings[v] = engine.Building{Owner: p}
		}
	}

	mustMetropolis := func(tr Track) []engine.Event {
		ev, err := (Module{}).metropolisEvents(s, ext(s), tr, p, metropolisLevel)
		if err != nil {
			t.Fatalf("metropolisEvents(%v): %v", tr, err)
		}
		return ev
	}
	// Trade: two eligible cities, so this arms a pick the player must answer.
	applyAll(t, s, mustMetropolis(Trade))
	if x.MetropolisPending == nil {
		t.Fatal("two eligible cities should arm a metropolis pick")
	}
	applyAll(t, s, []engine.Event{engine.NewEvent(EvMetropolis,
		metropolisData{Track: Trade, Holder: p, Prev: engine.NoPlayer, V: vs[0]})})
	// Politics: one eligible city left, so it lands outright.
	applyAll(t, s, mustMetropolis(Politics))

	pe := ext(s).Players[p]
	if !pe.Metropolis[Trade] || !pe.Metropolis[Politics] {
		t.Fatalf("expected both metropolises claimed: %+v", pe.Metropolis)
	}
	if pe.MetropolisAt[Trade] == pe.MetropolisAt[Politics] {
		t.Errorf("both metropolises pinned to the same city %v; want distinct", pe.MetropolisAt[Trade])
	}
}
