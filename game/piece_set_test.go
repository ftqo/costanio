package game

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
)

// Every viewer needs every seat's piece set, because each seat's buildings are
// drawn on everyone's board (unlike the robber skin, one string for the
// table).
func TestSeatPiecesReachEveryViewer(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})
	a, err := Load("g1", st, Options{
		Clock:      &fakeClock{},
		SeatPieces: map[engine.PlayerID]string{1: "pieces.cyclades"},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(a.Stop)

	for _, viewer := range []engine.PlayerID{0, 1, 2, Spectator} {
		got := a.View(viewer).SeatPieces
		if got[1] != "pieces.cyclades" {
			t.Errorf("viewer %d sees seat 1 pieces = %q, want pieces.cyclades", viewer, got[1])
		}
		// A seat with stock art has no entry, so the client treats absent and
		// stock the same.
		if _, ok := got[0]; ok {
			t.Errorf("viewer %d sees an entry for a seat with nothing equipped", viewer)
		}
	}
}

// With nothing equipped anywhere the field is omitted (omitempty), so a
// typical game costs no bytes.
func TestSeatPiecesAbsentWhenNobodyEquipped(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})
	a, err := Load("g1", st, Options{Clock: &fakeClock{}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(a.Stop)

	if got := a.View(Spectator).SeatPieces; got != nil {
		t.Errorf("SeatPieces = %v, want nil", got)
	}
}

// The equipped set comes from the seat's loadout at load, like the robber
// skin, so a purchase made between games shows in the next one.
func TestManagerLoadsSeatPiecesFromStore(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})
	seats, err := st.Seats("g1")
	if err != nil {
		t.Fatal(err)
	}
	if err := st.SetLoadoutSlot(seats[2].UserID, "pieces", "pieces.cyclades"); err != nil {
		t.Fatal(err)
	}
	m := NewManager(st, &fakeClock{})
	t.Cleanup(m.StopAll)
	a, err2 := m.Get("g1")
	if err2 != nil {
		t.Fatal(err2)
	}

	if got := a.View(Spectator).SeatPieces[2]; got != "pieces.cyclades" {
		t.Errorf("seat 2 pieces = %q, want pieces.cyclades", got)
	}
}
