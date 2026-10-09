package game

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
)

// TestViewCarriesSeatNamesForSpectator: a spectator (no seat) reaches a private
// game over the websocket but is refused the gated /api/games seat list, so the
// names must travel in the view itself. Assert the actor stamps SeatNames into
// every viewer's view, spectator included.
func TestViewCarriesSeatNamesForSpectator(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})
	names := map[engine.PlayerID]string{0: "Alice", 1: "Bob", 2: "Carol"}
	a, err := Load("g1", st, Options{Clock: &fakeClock{}, SeatNames: names})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(a.Stop)

	v := a.View(Spectator)
	if v == nil {
		t.Fatal("spectator view is nil")
	}
	for seat, want := range names {
		if got := v.SeatNames[seat]; got != want {
			t.Errorf("seat %d name = %q, want %q", seat, got, want)
		}
	}
	// A seated viewer sees the same roster.
	if got := a.View(1).SeatNames[0]; got != "Alice" {
		t.Errorf("seated viewer seat 0 name = %q, want Alice", got)
	}
}

// TestManagerLoadsSeatNamesFromStore: the manager builds the seat-to-name map
// from the store at load, so a spectator of a lazily loaded game sees real
// names.
func TestManagerLoadsSeatNamesFromStore(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3}) // seats are guests "host"/"p"
	m := NewManager(st, &fakeClock{})
	t.Cleanup(m.StopAll)
	a, err := m.Get("g1")
	if err != nil {
		t.Fatal(err)
	}
	v := a.View(Spectator)
	if v == nil {
		t.Fatal("spectator view is nil")
	}
	for seat := range engine.PlayerID(3) {
		if v.SeatNames[seat] == "" {
			t.Errorf("seat %d has no name in view", seat)
		}
	}
}

// TestViewOmitsSeatNamesWhenUnset: with no names supplied (tests and sims that
// load actors directly), the field stays nil and is omitted from the wire.
func TestViewOmitsSeatNamesWhenUnset(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})
	a, err := Load("g1", st, Options{Clock: &fakeClock{}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(a.Stop)
	if v := a.View(Spectator); v == nil || v.SeatNames != nil {
		t.Fatalf("SeatNames = %v, want nil", v.SeatNames)
	}
}
