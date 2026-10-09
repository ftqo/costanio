package server

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
)

// stateSeatDeadlines pulls the seat_deadlines map out of a captured "state"
// frame's full view. Returns nil when the field is absent (omitempty + empty).
func stateSeatDeadlines(t *testing.T, f map[string]any) map[string]any {
	t.Helper()
	full, ok := f["full"].(map[string]any)
	if !ok {
		t.Fatalf("state frame missing full view: %v", f)
	}
	sd, _ := full["seat_deadlines"].(map[string]any)
	return sd
}

// TestReconnectToSuspendedGameShowsTurnTimer: when the last human leaves, the
// game is suspended and its deadlines cleared. On reconnect the `state` frame
// must still carry the turn timer, so the game must resume before the view is
// built.
func TestReconnectToSuspendedGameShowsTurnTimer(t *testing.T) {
	e := newEnv(t)
	host, hostC := e.discordUser(t, "h", "host")
	// Playing alone against bots is a supporter perk.
	if err := e.st.SetSupporter(host.ID, true, false, false, false, false, 0); err != nil {
		t.Fatal(err)
	}

	g, err := e.srv.lobby.Create(host, engine.GameConfig{Players: 3}, false)
	if err != nil {
		t.Fatal(err)
	}
	id := g.Game.ID
	if _, err := e.srv.lobby.AddBot(host, id); err != nil {
		t.Fatal(err)
	}
	if _, err := e.srv.lobby.AddBot(host, id); err != nil {
		t.Fatal(err)
	}
	if err := e.srv.lobby.Start(host, id); err != nil {
		t.Fatal(err)
	}

	// First connect: game active, host present -> the state frame carries the
	// timer. This is the sanity baseline (the timer works at all).
	c1 := dialWS(t, e.ts, hostC)
	c1.send(map[string]any{"t": "sub", "game": id})
	s1 := c1.waitFrame(func(f map[string]any) bool { return f["t"] == "state" }, "first state")
	if len(stateSeatDeadlines(t, s1)) == 0 {
		t.Fatal("baseline: first state frame should carry seat_deadlines (timer is on)")
	}

	// Simulate every human leaving: the game suspends, clearing live deadlines.
	e.srv.mgr.SuspendGame(id)

	// Reconnect. The reconnect state frame must carry the timer too.
	c2 := dialWS(t, e.ts, hostC)
	c2.send(map[string]any{"t": "sub", "game": id})
	s2 := c2.waitFrame(func(f map[string]any) bool { return f["t"] == "state" }, "reconnect state")
	if len(stateSeatDeadlines(t, s2)) == 0 {
		t.Fatal("reconnect state frame has no seat_deadlines")
	}
}
