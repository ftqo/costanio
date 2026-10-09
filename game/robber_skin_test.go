package game

import (
	"encoding/json"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// moveRobber appends a robber_moved event by seat p and folds it, as a real
// move reaches the actor. The destination hex does not matter.
func moveRobber(t *testing.T, a *Actor, p engine.PlayerID) {
	t.Helper()
	data, err := json.Marshal(engine.RobberMovedData{Player: p, Hex: board.Hex{Q: 1, R: 0}})
	if err != nil {
		t.Fatal(err)
	}
	a.call(func() {
		if err := a.apply(engine.Event{Seq: a.state.NextSeq, Type: engine.EvRobberMoved, Data: data}); err != nil {
			t.Errorf("apply robber_moved: %v", err)
		}
	})
}

// Before anyone moves it, the robber uses the stock art.
func TestRobberSkinEmptyBeforeAnyMove(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})
	a, err := Load("g1", st, Options{
		Clock:       &fakeClock{},
		SeatRobbers: map[engine.PlayerID]string{0: "robber.test"},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(a.Stop)

	if got := a.View(Spectator).RobberSkin; got != "" {
		t.Errorf("robber skin before any move = %q, want empty", got)
	}
}

// The table, spectators included, sees the skin of whoever moved the robber.
func TestRobberSkinFollowsTheLastMover(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})
	a, err := Load("g1", st, Options{
		Clock:       &fakeClock{},
		SeatRobbers: map[engine.PlayerID]string{1: "robber.test", 2: "robber.other"},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(a.Stop)

	moveRobber(t, a, 1)
	for _, viewer := range []engine.PlayerID{Spectator, 0, 1} {
		if got := a.View(viewer).RobberSkin; got != "robber.test" {
			t.Errorf("viewer %d sees robber skin %q, want robber.test", viewer, got)
		}
	}

	// It is the last mover, not the first.
	moveRobber(t, a, 2)
	if got := a.View(Spectator).RobberSkin; got != "robber.other" {
		t.Errorf("robber skin after the second move = %q, want robber.other", got)
	}
}

// A seat with nothing equipped returns the robber to stock art. Bots own no
// cosmetics, so a bot moving it removes the last human's skin.
func TestRobberSkinResetsWhenUnequipped(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})
	a, err := Load("g1", st, Options{
		Clock:       &fakeClock{},
		SeatRobbers: map[engine.PlayerID]string{1: "robber.test"},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(a.Stop)

	moveRobber(t, a, 1)
	moveRobber(t, a, 0) // seat 0 owns nothing
	if got := a.View(Spectator).RobberSkin; got != "" {
		t.Errorf("robber skin after a bare seat moved it = %q, want empty", got)
	}
}

// A reloaded actor replays only events after its latest snapshot, so the last
// robber mover must be seeded from the event log or an evicted game comes back
// with the stock robber.
func TestRobberSkinSurvivesReload(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})
	robbers := map[engine.PlayerID]string{1: "robber.test"}

	a, err := Load("g1", st, Options{Clock: &fakeClock{}, SeatRobbers: robbers})
	if err != nil {
		t.Fatal(err)
	}
	// A real move: persisted to the log, then folded, as commit does.
	data, _ := json.Marshal(engine.RobberMovedData{Player: 1, Hex: board.Hex{Q: 1, R: 0}})
	var seq int
	a.call(func() { seq = a.state.NextSeq })
	ev := engine.Event{Seq: seq, Type: engine.EvRobberMoved, Data: data}
	if err := st.AppendEvents("g1", []engine.Event{ev}); err != nil {
		t.Fatal(err)
	}
	a.call(func() {
		if err := a.apply(ev); err != nil {
			t.Errorf("apply: %v", err)
		}
	})
	if got := a.View(Spectator).RobberSkin; got != "robber.test" {
		t.Fatalf("precondition: live skin = %q, want robber.test", got)
	}
	a.Stop()

	reloaded, err := Load("g1", st, Options{Clock: &fakeClock{}, SeatRobbers: robbers})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(reloaded.Stop)
	if got := reloaded.View(Spectator).RobberSkin; got != "robber.test" {
		t.Errorf("robber skin after reload = %q, want robber.test", got)
	}
}

// The manager builds the seat-to-skin map from the store, so a lazily loaded
// game dresses the robber with nothing else wired up.
func TestManagerLoadsSeatRobbersFromStore(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})
	seats, err := st.Seats("g1")
	if err != nil {
		t.Fatal(err)
	}
	if err := st.SetLoadoutSlot(seats[1].UserID, "robber", "robber.test"); err != nil {
		t.Fatal(err)
	}
	m := NewManager(st, &fakeClock{})
	t.Cleanup(m.StopAll)
	a, err2 := m.Get("g1")
	if err2 != nil {
		t.Fatal(err2)
	}

	moveRobber(t, a, 1)
	if got := a.View(Spectator).RobberSkin; got != "robber.test" {
		t.Errorf("robber skin = %q, want robber.test", got)
	}
}
