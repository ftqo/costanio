package game

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
	_ "github.com/ftqo/costan.io/engine/knights"
)

// The view's discard_at must be the engine's own threshold, so the client
// never rebuilds it from config and walls.
func TestPlayerViewDiscardAtMatchesEngine(t *testing.T) {
	log, err := engine.New(engine.GameConfig{Players: 3, Ruleset: "base+cak", DiscardLimit: 9}, engine.SeedsFrom(42))
	if err != nil {
		t.Fatal(err)
	}
	s := engine.Empty()
	for _, e := range log {
		if err := engine.Apply(s, e); err != nil {
			t.Fatal(err)
		}
	}
	v := NewFullView(s, 0)
	for i := range v.Players {
		want := s.DiscardThreshold(engine.PlayerID(i))
		if v.Players[i].DiscardAt != want {
			t.Errorf("seat %d discard_at = %d, want %d", i, v.Players[i].DiscardAt, want)
		}
		if want != 9 {
			t.Errorf("seat %d threshold = %d, want the configured 9 with no walls", i, want)
		}
	}
}
