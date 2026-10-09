package lobby

import (
	"errors"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/store"
)

func TestSpectateFreesSeat(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "d1", "host")
	alice := discordUser(t, st, "d2", "alice")
	sum, _ := l.Create(host, engine.GameConfig{Players: 4}, false)
	id := sum.Game.ID
	if _, err := l.Join(alice, id, ""); err != nil {
		t.Fatal(err)
	}
	if err := l.Spectate(alice, id); err != nil {
		t.Fatalf("Spectate: %v", err)
	}
	if _, err := st.SeatForUser(id, alice.ID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("seat should be freed after opting out, got err=%v", err)
	}
}

func TestSpectateUnseatedIsNoop(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "d1", "host")
	bob := discordUser(t, st, "d3", "bob")
	sum, _ := l.Create(host, engine.GameConfig{Players: 4}, false)
	if err := l.Spectate(bob, sum.Game.ID); err != nil {
		t.Fatalf("Spectate on an unseated user should be a no-op, got %v", err)
	}
}

// TestRematchDoesNotAutoSeatSpectators: a spectator (a follower who never held
// a seat) is not auto-seated on rematch, and can then claim an open seat.
func TestRematchDoesNotAutoSeatSpectators(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "h", "host")
	alice := discordUser(t, st, "a", "alice")
	watcher := discordUser(t, st, "w", "watcher") // follows but never seats
	sum, _ := l.Create(host, engine.GameConfig{Players: 4, Ruleset: "base"}, false)
	gid := sum.Game.ID
	if _, err := l.Join(alice, gid, ""); err != nil {
		t.Fatal(err)
	}
	if err := st.SetGameStatus(gid, "finished"); err != nil {
		t.Fatal(err)
	}

	// Followers (= present) include the spectator, but only old seat-holders are
	// reseated, so the spectator stays unseated and a slot stays open.
	present := map[int64]bool{host.ID: true, alice.ID: true, watcher.ID: true}
	rs, err := l.Rematch(host, gid, present)
	if err != nil {
		t.Fatal(err)
	}
	if seatByUser(rs, watcher.ID) != nil {
		t.Fatal("spectator was auto-seated on rematch; should stay a spectator")
	}
	if len(rs.Seats) != 2 {
		t.Fatalf("rematch seats = %d, want 2 (host + alice)", len(rs.Seats))
	}

	// The spectator opts in by claiming an open seat via the normal join flow.
	if _, err := l.Join(watcher, rs.Game.ID, ""); err != nil {
		t.Fatalf("spectator claiming an open seat: %v", err)
	}
	after, _ := l.Summary(rs.Game.ID)
	if seatByUser(after, watcher.ID) == nil {
		t.Fatal("spectator should hold a seat after opting in")
	}
}

// TestRematchKeepsSpectatingHostUnseated: a host who opted out of their seat
// (hosting an all-bot/other-player table while watching) must stay a spectator
// on rematch; they keep lobby ownership but are not forced back into a seat.
func TestRematchKeepsSpectatingHostUnseated(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "h", "host")
	alice := discordUser(t, st, "a", "alice")
	bob := discordUser(t, st, "b", "bob")
	sum, _ := l.Create(host, engine.GameConfig{Players: 4, Ruleset: "base"}, false)
	gid := sum.Game.ID
	if _, err := l.Join(alice, gid, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := l.Join(bob, gid, ""); err != nil {
		t.Fatal(err)
	}
	// Host opts out of their seat before the game runs, then it finishes.
	if err := l.Spectate(host, gid); err != nil {
		t.Fatalf("Spectate: %v", err)
	}
	if err := st.SetGameStatus(gid, "finished"); err != nil {
		t.Fatal(err)
	}

	present := map[int64]bool{host.ID: true, alice.ID: true, bob.ID: true}
	rs, err := l.Rematch(host, gid, present)
	if err != nil {
		t.Fatal(err)
	}
	if seatByUser(rs, host.ID) != nil {
		t.Fatal("spectating host was auto-seated on rematch; should stay a spectator")
	}
	if len(rs.Seats) != 2 {
		t.Fatalf("rematch seats = %d, want 2 (alice + bob)", len(rs.Seats))
	}
	if rs.Game.CreatedBy != host.ID {
		t.Fatal("host should remain the lobby owner on rematch")
	}
}

func TestSpectateHostAllowed(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "d1", "host")
	sum, _ := l.Create(host, engine.GameConfig{Players: 4}, false)
	id := sum.Game.ID
	if err := l.Spectate(host, id); err != nil {
		t.Fatalf("host should be able to opt out, got %v", err)
	}
	if _, err := st.SeatForUser(id, host.ID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("host seat should be freed, got %v", err)
	}
	g, _ := st.GameByID(id)
	if g.CreatedBy != host.ID {
		t.Fatal("host should remain the lobby owner after opting out")
	}
}

// TestHostCanRunMultipleGames: a host (e.g. a tournament organizer) may start
// and run more than one game at a time; there is no one-active-game cap.
func TestHostCanRunMultipleGames(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "d1", "host")
	for g := range 2 {
		s, _ := l.Create(host, engine.GameConfig{Players: 3}, false)
		for range 2 {
			if _, err := l.AddBot(host, s.Game.ID); err != nil {
				t.Fatal(err)
			}
		}
		if err := l.Start(host, s.Game.ID); err != nil {
			t.Fatalf("start game %d: %v", g, err)
		}
	}
}
