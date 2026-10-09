package knights

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// TestPillageAllMetropolises: a metropolis city is
// never pillaged, and a seat whose only cities carry one is left out of the
// ranking (docs/rules/knights.md), so when every city carries a metropolis
// nobody loses anything. The control case frees one city and checks its owner
// is hit, so the test cannot pass on an attack that never pillages.
func TestPillageAllMetropolises(t *testing.T) {
	setup := func(t *testing.T) (*engine.State, *Ext) {
		s, _ := newGame(t, 33, nil)
		x := ext(s)
		x.Knights = map[board.Vertex]Knight{} // no defence at all: the attack is lost
		// One city per seat (setup deals exactly that), each with a metropolis on a
		// distinct track where there are tracks to go round.
		for v, b := range s.Buildings {
			if b.City {
				p := b.Owner
				tr := Track(int(p) % int(trackKinds))
				x.Players[p].Metropolis[tr] = true
				x.Players[p].MetropolisAt[tr] = v
			}
		}
		return s, x
	}

	t.Run("every city a metropolis", func(t *testing.T) {
		s, x := setup(t)
		for p := range s.Players {
			if _, ok := (Module{}).downgradableCity(s, x, engine.PlayerID(p)); ok {
				t.Fatalf("seat %d still has a city without a metropolis; fixture is wrong", p)
			}
		}
		evs, _ := (Module{}).attackEvents(s, x)
		d := engine.DecodeEvent[barbarianAttackData](evs[0])
		if d.Win {
			t.Fatalf("attack %d vs defence %d was repelled; fixture is wrong", d.Cities, d.Strength)
		}
		if len(d.Downgraded) != 0 || len(d.Pending) != 0 {
			t.Fatalf("a metropolis-only board lost a city: downgraded %v, pending %v", d.Downgraded, d.Pending)
		}
	})

	t.Run("one plain city", func(t *testing.T) {
		s, x := setup(t)
		victim := s.Cur
		for tr := range trackKinds {
			x.Players[victim].Metropolis[tr] = false
		}
		evs, _ := (Module{}).attackEvents(s, x)
		d := engine.DecodeEvent[barbarianAttackData](evs[0])
		hit := len(d.Pending) == 1 && d.Pending[0] == victim
		for _, dg := range d.Downgraded {
			hit = hit || dg.Player == victim
		}
		if !hit || len(d.Downgraded)+len(d.Pending) != 1 {
			t.Fatalf("want exactly seat %d hit: downgraded %v, pending %v", victim, d.Downgraded, d.Pending)
		}
	})
}
