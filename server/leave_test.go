package server

import (
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/store"
)

// fakeLeaveClock records the timers armed by the grace path so a test can fire
// them on demand instead of waiting out the real window.
type fakeLeaveClock struct {
	mu     sync.Mutex
	timers []*fakeTimer
}

type fakeTimer struct {
	f       func()
	stopped bool
}

func (c *fakeLeaveClock) AfterFunc(_ time.Duration, f func()) leaveTimer {
	c.mu.Lock()
	defer c.mu.Unlock()
	t := &fakeTimer{f: f}
	c.timers = append(c.timers, t)
	return t
}

func (t *fakeTimer) Stop() bool {
	if t.stopped {
		return false
	}
	t.stopped = true
	return true
}

// fire runs every timer that's still live, mimicking the grace window elapsing.
func (c *fakeLeaveClock) fire() {
	c.mu.Lock()
	live := make([]*fakeTimer, 0, len(c.timers))
	for _, t := range c.timers {
		if !t.stopped {
			live = append(live, t)
		}
	}
	c.mu.Unlock()
	for _, t := range live {
		t.f()
	}
}

// seedLobby creates a host-owned lobby with the given extra players joined.
func seedLobby(t *testing.T, e *testEnv, host *store.User, players ...*store.User) string {
	t.Helper()
	sum, err := e.srv.lobby.Create(host, engine.GameConfig{Players: 4}, false)
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range players {
		if _, err := e.srv.lobby.Join(p, sum.Game.ID, ""); err != nil {
			t.Fatal(err)
		}
	}
	return sum.Game.ID
}

func TestGracedLobbyLeave(t *testing.T) {
	t.Run("player disconnect vacates seat after grace", func(t *testing.T) {
		e := newEnv(t)
		clk := &fakeLeaveClock{}
		e.srv.clock = clk
		host, _ := e.discordUser(t, "h", "host")
		alice, _ := e.discordUser(t, "a", "alice")
		gid := seedLobby(t, e, host, alice)

		e.srv.scheduleLobbyLeave(gid, alice.ID)
		// Still seated while the grace window is open.
		if _, err := e.st.SeatForUser(gid, alice.ID); err != nil {
			t.Fatalf("alice should still be seated during grace: %v", err)
		}
		clk.fire()
		if _, err := e.st.SeatForUser(gid, alice.ID); !errors.Is(err, store.ErrNotFound) {
			t.Errorf("alice still seated after grace fired (err=%v)", err)
		}
		// The table itself is untouched: a non-host leaving doesn't close it.
		if g, _ := e.st.GameByID(gid); g.Status != "lobby" {
			t.Errorf("status = %s, want lobby", g.Status)
		}
	})

	t.Run("reconnect cancels the pending leave", func(t *testing.T) {
		e := newEnv(t)
		clk := &fakeLeaveClock{}
		e.srv.clock = clk
		host, _ := e.discordUser(t, "h", "host")
		alice, _ := e.discordUser(t, "a", "alice")
		gid := seedLobby(t, e, host, alice)

		e.srv.scheduleLobbyLeave(gid, alice.ID)
		e.srv.cancelLobbyLeave(gid, alice.ID) // they came back (re-subscribed)
		clk.fire()
		if _, err := e.st.SeatForUser(gid, alice.ID); err != nil {
			t.Errorf("alice lost her seat despite reconnecting: %v", err)
		}
	})

	t.Run("present in another tab keeps the seat", func(t *testing.T) {
		e := newEnv(t)
		clk := &fakeLeaveClock{}
		e.srv.clock = clk
		host, _ := e.discordUser(t, "h", "host")
		alice, _ := e.discordUser(t, "a", "alice")
		gid := seedLobby(t, e, host, alice)

		// A second live connection for alice still following the game.
		e.srv.hub.add(&Conn{srv: e.srv, userID: alice.ID, gameID: gid})

		e.srv.scheduleLobbyLeave(gid, alice.ID)
		clk.fire()
		if _, err := e.st.SeatForUser(gid, alice.ID); err != nil {
			t.Errorf("alice lost her seat while still present elsewhere: %v", err)
		}
	})

	t.Run("any live connection keeps the seat", func(t *testing.T) {
		e := newEnv(t)
		clk := &fakeLeaveClock{}
		e.srv.clock = clk
		host, _ := e.discordUser(t, "h", "host")
		alice, _ := e.discordUser(t, "a", "alice")
		gid := seedLobby(t, e, host, alice)

		// Alice is still connected but not following the game (e.g. she's in the
		// map builder). Membership is tied to having the site open, so her seat
		// must survive even though no connection is following the table.
		e.srv.hub.add(&Conn{srv: e.srv, userID: alice.ID})

		e.srv.scheduleLobbyLeave(gid, alice.ID)
		clk.fire()
		if _, err := e.st.SeatForUser(gid, alice.ID); err != nil {
			t.Errorf("alice lost her seat while still connected: %v", err)
		}
	})

	t.Run("host disconnect transfers the host", func(t *testing.T) {
		e := newEnv(t)
		clk := &fakeLeaveClock{}
		e.srv.clock = clk
		host, _ := e.discordUser(t, "h", "host")
		alice, _ := e.discordUser(t, "a", "alice")
		gid := seedLobby(t, e, host, alice)

		e.srv.scheduleLobbyLeave(gid, host.ID)
		clk.fire()
		g, err := e.st.GameByID(gid)
		if err != nil {
			t.Fatal(err)
		}
		// An eligible human (alice) remains, so the table survives and the host
		// role moves to her instead of closing.
		if g.Status != "lobby" {
			t.Errorf("status = %s, want lobby", g.Status)
		}
		if g.CreatedBy != alice.ID {
			t.Errorf("new host = %d, want %d (alice)", g.CreatedBy, alice.ID)
		}
		if _, err := e.st.SeatForUser(gid, host.ID); !errors.Is(err, store.ErrNotFound) {
			t.Errorf("departing host should have vacated their seat, err=%v", err)
		}
	})
}
