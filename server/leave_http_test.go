package server

import (
	"net/http"
	"testing"

	"github.com/ftqo/costan.io/engine"
)

func TestHandleLeaveLobby(t *testing.T) {
	e := newEnv(t)
	host, hostC := e.discordUser(t, "d1", "host")
	alice, aliceC := e.discordUser(t, "d2", "alice")

	sum, err := e.srv.lobby.Create(host, engine.GameConfig{Players: 4}, false)
	if err != nil {
		t.Fatal(err)
	}
	id := sum.Game.ID
	if _, err := e.srv.lobby.Join(alice, id, ""); err != nil {
		t.Fatal(err)
	}

	// Alice (non-host) leaves the lobby -> 204, seat gone, table stays open.
	if resp, _ := e.req(t, "POST", "/api/games/"+id+"/leave", aliceC, nil); resp.StatusCode != http.StatusNoContent {
		t.Errorf("alice leave = %d, want 204", resp.StatusCode)
	}
	if _, err := e.st.SeatForUser(id, alice.ID); err == nil {
		t.Error("alice still seated after leaving")
	}
	if g, _ := e.st.GameByID(id); g.Status != "lobby" {
		t.Errorf("status = %s, want lobby", g.Status)
	}

	// Host leaves -> table closes (abandoned).
	if resp, _ := e.req(t, "POST", "/api/games/"+id+"/leave", hostC, nil); resp.StatusCode != http.StatusNoContent {
		t.Errorf("host leave = %d, want 204", resp.StatusCode)
	}
	if g, _ := e.st.GameByID(id); g.Status != "abandoned" {
		t.Errorf("status after host leave = %s, want abandoned", g.Status)
	}
}

func TestHandleLeaveMissingGame(t *testing.T) {
	e := newEnv(t)
	_, c := e.discordUser(t, "d1", "me")
	if resp, _ := e.req(t, "POST", "/api/games/nope/leave", c, nil); resp.StatusCode != http.StatusNotFound {
		t.Errorf("leave missing game = %d, want 404", resp.StatusCode)
	}
}

func TestHandleLeaveActiveGame(t *testing.T) {
	e := newEnv(t)
	host, hostC := e.discordUser(t, "d1", "host")
	alice, aliceC := e.discordUser(t, "d2", "alice")
	bob, bobC := e.discordUser(t, "d3", "bob")

	sum, err := e.srv.lobby.Create(host, engine.GameConfig{Players: 3}, false)
	if err != nil {
		t.Fatal(err)
	}
	id := sum.Game.ID
	e.srv.lobby.Join(alice, id, "")
	e.srv.lobby.Join(bob, id, "")
	if err := e.srv.lobby.Start(host, id); err != nil {
		t.Fatal(err)
	}

	// Keep humans present so the game stays active when alice leaves her seat.
	e.srv.hub.add(&Conn{srv: e.srv, userID: host.ID, gameID: id})
	e.srv.hub.add(&Conn{srv: e.srv, userID: bob.ID, gameID: id})

	// A seated player leaving an active game -> 204, seat botified reversibly.
	if resp, _ := e.req(t, "POST", "/api/games/"+id+"/leave", aliceC, nil); resp.StatusCode != http.StatusNoContent {
		t.Errorf("alice active leave = %d, want 204", resp.StatusCode)
	}
	// Reversible: alice still owns her store seat.
	if seat, err := e.st.SeatForUser(id, alice.ID); err != nil || seat.UserID != alice.ID {
		t.Errorf("alice's seat = %+v err=%v, want reversibly kept", seat, err)
	}
	if g, _ := e.st.GameByID(id); g.Status != "active" {
		t.Errorf("status = %s, want active (others present)", g.Status)
	}

	// A non-seated spectator hitting leave on an active game -> 404 (not seated).
	_, watcherC := e.discordUser(t, "d4", "watcher")
	if resp, _ := e.req(t, "POST", "/api/games/"+id+"/leave", watcherC, nil); resp.StatusCode != http.StatusNotFound {
		t.Errorf("spectator active leave = %d, want 404", resp.StatusCode)
	}
	_ = hostC
	_ = bobC
}
