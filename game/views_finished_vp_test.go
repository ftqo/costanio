package game

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
)

// TestFinishedGameViewShowsTrueVP: once the game is over, every seat card
// shows the true total, hidden victory-point cards included, to every viewer,
// matching the end screen. The reveal happens in game/'s redaction, not in the
// client.
func TestFinishedGameViewShowsTrueVP(t *testing.T) {
	events, err := engine.New(engine.GameConfig{Players: 3}, engine.SeedsFrom(7))
	if err != nil {
		t.Fatal(err)
	}
	s, err := engine.Replay(events)
	if err != nil {
		t.Fatal(err)
	}
	s.Players[0].DevCards = engine.DevHand{engine.DevVictoryPoint: 1}
	s.Players[2].NewDevCards = engine.DevHand{engine.DevVictoryPoint: 2}

	// While the game is on, an opponent's hidden points stay hidden.
	s.Phase = engine.PhasePlay
	if v := NewFullView(s, 1); v.Players[0].VP != s.PublicVPWithModules(0) {
		t.Fatalf("live game: an opponent sees vp %d for seat 0, want the public %d", v.Players[0].VP, s.PublicVPWithModules(0))
	}

	s.Phase = engine.PhaseFinished
	for _, viewer := range []engine.PlayerID{Spectator, 0, 1, 2} {
		v := NewFullView(s, viewer)
		for i := range s.Players {
			seat := engine.PlayerID(i)
			if got, want := v.Players[i].VP, s.VPWithModules(seat); got != want {
				t.Errorf("finished game, viewer %d: seat %d vp = %d, want the true %d", viewer, i, got, want)
			}
		}
	}
}
