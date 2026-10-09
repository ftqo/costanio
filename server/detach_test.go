package server

import (
	"errors"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/store"
)

func TestJoinLeavesPriorLobby(t *testing.T) {
	e := newEnv(t)
	host1, _ := e.discordUser(t, "h1", "host1")
	host2, _ := e.discordUser(t, "h2", "host2")
	alice, _ := e.discordUser(t, "a", "alice")

	l1, _ := e.srv.lobby.Create(host1, engine.GameConfig{Players: 4}, false)
	l2, _ := e.srv.lobby.Create(host2, engine.GameConfig{Players: 4}, false)
	if _, err := e.srv.lobby.Join(alice, l1.Game.ID, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := e.srv.lobby.Join(alice, l2.Game.ID, ""); err != nil {
		t.Fatal(err)
	}

	// Alice is transiently in both; entering l2 must drop her from l1.
	e.srv.detachFromOthers(alice, l2.Game.ID)

	if _, err := e.st.SeatForUser(l1.Game.ID, alice.ID); !errors.Is(err, store.ErrNotFound) {
		t.Errorf("alice still seated in the old lobby: %v", err)
	}
	if _, err := e.st.SeatForUser(l2.Game.ID, alice.ID); err != nil {
		t.Errorf("alice missing from the new lobby: %v", err)
	}
	// She wasn't l1's host, so l1 stays open for the others.
	if g, _ := e.st.GameByID(l1.Game.ID); g.Status != "lobby" {
		t.Errorf("l1 status = %s, want lobby", g.Status)
	}
}

// TestLeaveActiveGameBotifiesSeatReversibly verifies that leaving an active game
// is a reversible absence: the seat is botified in memory but the store seat
// keeps the human's user_id (so they can rejoin), and the game stays active as
// long as other humans are still following it.
func TestLeaveActiveGameBotifiesSeatReversibly(t *testing.T) {
	e := newEnv(t)
	host, _ := e.discordUser(t, "h", "host")
	alice, _ := e.discordUser(t, "a", "alice")
	bob, _ := e.discordUser(t, "b", "bob")

	g1, _ := e.srv.lobby.Create(host, engine.GameConfig{Players: 3}, false)
	e.srv.lobby.Join(alice, g1.Game.ID, "")
	e.srv.lobby.Join(bob, g1.Game.ID, "")
	if err := e.srv.lobby.Start(host, g1.Game.ID); err != nil {
		t.Fatal(err)
	}

	aSeat, err := e.st.SeatForUser(g1.Game.ID, alice.ID)
	if err != nil {
		t.Fatal(err)
	}

	// Host and bob are following the game; alice is not (she's about to leave).
	e.srv.hub.add(&Conn{srv: e.srv, userID: host.ID, gameID: g1.Game.ID})
	e.srv.hub.add(&Conn{srv: e.srv, userID: bob.ID, gameID: g1.Game.ID})

	// Alice opens a new lobby while the game is in progress. Her seat is botified
	// in memory, but she keeps the store seat and the game continues because host
	// and bob are still present.
	l2, _ := e.srv.lobby.Create(alice, engine.GameConfig{Players: 4}, false)
	e.srv.detachFromOthers(alice, l2.Game.ID)

	// Reversible: alice still holds her seat (not reassigned to a bot user).
	got, err := e.st.SeatForUser(g1.Game.ID, alice.ID)
	if err != nil {
		t.Fatalf("alice lost her seat (should be reversible): %v", err)
	}
	if got.UserID != alice.ID {
		t.Errorf("alice's seat reassigned: UserID = %d, want %d", got.UserID, alice.ID)
	}
	if got.No != aSeat.No {
		t.Errorf("alice's seat number changed: %d, want %d", got.No, aSeat.No)
	}
	// Other humans present keep the game running.
	if g, _ := e.st.GameByID(g1.Game.ID); g.Status != "active" {
		t.Errorf("game status = %s, want active (host & bob present keep it running)", g.Status)
	}
}

// TestLastHumanLeaveSuspendsThenAbandons verifies that when the last following
// human leaves an active game, it is suspended (still active) and an abandon
// timer is armed; if nobody returns before the grace elapses, it is abandoned.
func TestLastHumanLeaveSuspendsThenAbandons(t *testing.T) {
	e := newEnv(t)
	clk := &fakeLeaveClock{}
	e.srv.clock = clk
	host, _ := e.discordUser(t, "h", "host")
	// Playing alone against bots is a supporter perk.
	if err := e.st.SetSupporter(host.ID, true, false, false, false, false, 0); err != nil {
		t.Fatal(err)
	}

	// A game the host plays only against bots.
	g1, _ := e.srv.lobby.Create(host, engine.GameConfig{Players: 3}, false)
	if _, err := e.srv.lobby.AddBot(host, g1.Game.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := e.srv.lobby.AddBot(host, g1.Game.ID); err != nil {
		t.Fatal(err)
	}
	if err := e.srv.lobby.Start(host, g1.Game.ID); err != nil {
		t.Fatal(err)
	}

	// Host is following the game.
	follower := &Conn{srv: e.srv, userID: host.ID, gameID: g1.Game.ID}
	e.srv.hub.add(follower)

	// Host navigates away: stop following, then reconcile presence. They were the
	// only human, so the game suspends (stays active) and arms the abandon timer.
	e.srv.hub.remove(follower)
	e.srv.reconcileGamePresence(g1.Game.ID)

	if g, _ := e.st.GameByID(g1.Game.ID); g.Status != "active" {
		t.Errorf("game status = %s, want active (suspended, not yet abandoned)", g.Status)
	}

	// Grace elapses with nobody present -> abandoned.
	clk.fire()
	if g, _ := e.st.GameByID(g1.Game.ID); g.Status != "abandoned" {
		t.Errorf("game status = %s, want abandoned (grace elapsed, no humans)", g.Status)
	}
}

// TestPresentHumanKeepsGameAlive verifies that as long as a seated human is
// still following the game, reconciling presence does not suspend it and the
// abandon timer never fires.
func TestPresentHumanKeepsGameAlive(t *testing.T) {
	e := newEnv(t)
	clk := &fakeLeaveClock{}
	e.srv.clock = clk
	host, _ := e.discordUser(t, "h", "host")
	// Playing alone against bots is a supporter perk.
	if err := e.st.SetSupporter(host.ID, true, false, false, false, false, 0); err != nil {
		t.Fatal(err)
	}

	g1, _ := e.srv.lobby.Create(host, engine.GameConfig{Players: 3}, false)
	if _, err := e.srv.lobby.AddBot(host, g1.Game.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := e.srv.lobby.AddBot(host, g1.Game.ID); err != nil {
		t.Fatal(err)
	}
	if err := e.srv.lobby.Start(host, g1.Game.ID); err != nil {
		t.Fatal(err)
	}

	// Host stays present (still following the game).
	e.srv.hub.add(&Conn{srv: e.srv, userID: host.ID, gameID: g1.Game.ID})

	e.srv.reconcileGamePresence(g1.Game.ID)
	if g, _ := e.st.GameByID(g1.Game.ID); g.Status != "active" {
		t.Errorf("game status = %s, want active (host present)", g.Status)
	}

	// Even if the clock fires, nothing was armed and the game stays active.
	clk.fire()
	if g, _ := e.st.GameByID(g1.Game.ID); g.Status != "active" {
		t.Errorf("game status = %s, want active (host kept it alive)", g.Status)
	}
}
