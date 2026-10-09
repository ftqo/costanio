package lobby

import (
	"errors"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/store"
)

// --- Manual host transfer -------------------------------------------------

func TestTransferHostSuccess(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "h", "host")
	alice := discordUser(t, st, "a", "alice")
	sum, _ := l.Create(host, engine.GameConfig{Players: 4}, false)
	id := sum.Game.ID
	if _, err := l.Join(alice, id, ""); err != nil {
		t.Fatal(err)
	}

	out, err := l.TransferHost(host, id, alice.ID)
	if err != nil {
		t.Fatalf("TransferHost: %v", err)
	}
	if out.Game.CreatedBy != alice.ID {
		t.Errorf("summary host = %d, want %d (alice)", out.Game.CreatedBy, alice.ID)
	}
	// Persisted, not just in the returned summary.
	g, _ := st.GameByID(id)
	if g.CreatedBy != alice.ID {
		t.Errorf("persisted host = %d, want %d (alice)", g.CreatedBy, alice.ID)
	}
	// The former host keeps their seat as a normal player.
	if seatByUser(out, host.ID) == nil {
		t.Error("former host should still hold their seat")
	}
}

func TestTransferHostOnlyHost(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "h", "host")
	alice := discordUser(t, st, "a", "alice")
	sum, _ := l.Create(host, engine.GameConfig{Players: 4}, false)
	id := sum.Game.ID
	if _, err := l.Join(alice, id, ""); err != nil {
		t.Fatal(err)
	}
	// Alice isn't the host, so she can't hand the role around.
	if _, err := l.TransferHost(alice, id, alice.ID); !errors.Is(err, ErrNotHost) {
		t.Errorf("non-host transfer err = %v, want ErrNotHost", err)
	}
}

func TestTransferHostNotInLobby(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "h", "host")
	alice := discordUser(t, st, "a", "alice")
	sum, _ := l.Create(host, engine.GameConfig{Players: 4}, false)
	id := sum.Game.ID
	if _, err := l.Join(alice, id, ""); err != nil {
		t.Fatal(err)
	}
	if err := st.SetGameStatus(id, "active"); err != nil {
		t.Fatal(err)
	}
	if _, err := l.TransferHost(host, id, alice.ID); !errors.Is(err, ErrNotInLobby) {
		t.Errorf("transfer on active game err = %v, want ErrNotInLobby", err)
	}
}

func TestTransferHostTargetNotSeated(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "h", "host")
	bob := discordUser(t, st, "b", "bob") // never joins
	sum, _ := l.Create(host, engine.GameConfig{Players: 4}, false)
	if _, err := l.TransferHost(host, sum.Game.ID, bob.ID); !errors.Is(err, ErrBadHostTarget) {
		t.Errorf("transfer to unseated user err = %v, want ErrBadHostTarget", err)
	}
}

func TestTransferHostTargetSelf(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "h", "host")
	sum, _ := l.Create(host, engine.GameConfig{Players: 4}, false)
	if _, err := l.TransferHost(host, sum.Game.ID, host.ID); !errors.Is(err, ErrBadHostTarget) {
		t.Errorf("transfer to self err = %v, want ErrBadHostTarget", err)
	}
}

func TestTransferHostTargetGuest(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "h", "host")
	guest, _ := st.CreateGuest("guesty")
	priv, _ := l.Create(host, engine.GameConfig{Players: 4}, true)
	id := priv.Game.ID
	if _, err := l.Join(guest, id, priv.Game.InviteCode); err != nil {
		t.Fatal(err)
	}
	// Guests can't host (mirrors the create-time guard).
	if _, err := l.TransferHost(host, id, guest.ID); !errors.Is(err, ErrBadHostTarget) {
		t.Errorf("transfer to guest err = %v, want ErrBadHostTarget", err)
	}
}

func TestTransferHostTargetBot(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "h", "host")
	sum, _ := l.Create(host, engine.GameConfig{Players: 4}, false)
	id := sum.Game.ID
	bot, err := l.AddBot(host, id)
	if err != nil {
		t.Fatal(err)
	}
	var botUser int64
	for _, s := range bot.Seats {
		if s.Status == "bot" {
			botUser = s.UserID
		}
	}
	if _, err := l.TransferHost(host, id, botUser); !errors.Is(err, ErrBadHostTarget) {
		t.Errorf("transfer to bot err = %v, want ErrBadHostTarget", err)
	}
}

// --- Auto-transfer on host leave ------------------------------------------

func TestLeaveHostAutoTransfers(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "h", "host")
	alice := discordUser(t, st, "a", "alice")
	bob := discordUser(t, st, "b", "bob")
	sum, _ := l.Create(host, engine.GameConfig{Players: 4}, false)
	id := sum.Game.ID
	if _, err := l.Join(alice, id, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := l.Join(bob, id, ""); err != nil {
		t.Fatal(err)
	}

	closed, err := l.Leave(host, id)
	if err != nil {
		t.Fatalf("Leave: %v", err)
	}
	if closed {
		t.Error("lobby closed; it should survive with other players present")
	}
	g, _ := st.GameByID(id)
	if g.Status != "lobby" {
		t.Errorf("game status = %q, want lobby", g.Status)
	}
	// Successor is the lowest-seat-number eligible player: alice (seat 1).
	if g.CreatedBy != alice.ID {
		t.Errorf("new host = %d, want %d (alice, lowest seat)", g.CreatedBy, alice.ID)
	}
	// The leaving host vacated their seat.
	if _, err := st.SeatForUser(id, host.ID); !errors.Is(err, store.ErrNotFound) {
		t.Errorf("host seat should be freed, got %v", err)
	}
}

func TestLeaveHostClosesWhenOnlyBotsRemain(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "h", "host")
	sum, _ := l.Create(host, engine.GameConfig{Players: 4}, false)
	id := sum.Game.ID
	if _, err := l.AddBot(host, id); err != nil {
		t.Fatal(err)
	}
	closed, err := l.Leave(host, id)
	if err != nil {
		t.Fatalf("Leave: %v", err)
	}
	if !closed {
		t.Error("lobby should close: no eligible human successor (only bots)")
	}
	g, _ := st.GameByID(id)
	if g.Status != "abandoned" {
		t.Errorf("game status = %q, want abandoned", g.Status)
	}
}

func TestLeaveHostClosesWhenOnlyGuestRemains(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "h", "host")
	guest, _ := st.CreateGuest("guesty")
	priv, _ := l.Create(host, engine.GameConfig{Players: 4}, true)
	id := priv.Game.ID
	if _, err := l.Join(guest, id, priv.Game.InviteCode); err != nil {
		t.Fatal(err)
	}
	closed, err := l.Leave(host, id)
	if err != nil {
		t.Fatalf("Leave: %v", err)
	}
	if !closed {
		t.Error("lobby should close: a guest is not an eligible host successor")
	}
	g, _ := st.GameByID(id)
	if g.Status != "abandoned" {
		t.Errorf("game status = %q, want abandoned", g.Status)
	}
}
