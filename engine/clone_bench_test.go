package engine

import "testing"

// midGameBaseState folds a base game and plays it to a mid-play position so
// Clone sees realistic map sizes (roads and buildings populated, no Ext, no
// pending discards: the common base-game shape).
func midGameBaseState(b *testing.B) *State {
	b.Helper()
	events, err := New(GameConfig{Players: 4, TargetVP: 10}, SeedsFrom(7))
	if err != nil {
		b.Fatal(err)
	}
	s := Empty()
	for _, e := range events {
		if err := Apply(s, e); err != nil {
			b.Fatal(err)
		}
	}
	// Stamp some roads/buildings to give the maps realistic mass.
	nb, nr := 0, 0
	for h := range s.Board.Tiles {
		for _, vv := range h.Vertices() {
			if nb < 16 {
				s.Buildings[vv] = Building{Owner: PlayerID(nb % 4)}
				nb++
			}
		}
		for _, ee := range h.Edges() {
			if nr < 48 {
				s.Roads[ee] = PlayerID(nr % 4)
				nr++
			}
		}
	}
	s.Phase = PhasePlay
	return s
}

func BenchmarkClone(b *testing.B) {
	s := midGameBaseState(b)
	b.ReportAllocs()
	b.ResetTimer()
	for range b.N {
		_ = s.Clone()
	}
}
