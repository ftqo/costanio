package server

import (
	"net/http"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/store"
)

// startThreePlayerActive seeds a 3-player active game (host, alice, bob), keeps
// host+bob present as followers, and returns the game id plus alice's cookie.
func startThreePlayerActive(t *testing.T, e *testEnv) (id string, aliceID int64, aliceCookie *http.Cookie) {
	t.Helper()
	host, _ := e.discordUser(t, "d1", "host")
	alice, aliceC := e.discordUser(t, "d2", "alice")
	bob, _ := e.discordUser(t, "d3", "bob")
	sum, err := e.srv.lobby.Create(host, engine.GameConfig{Players: 3}, false)
	if err != nil {
		t.Fatal(err)
	}
	id = sum.Game.ID
	e.srv.lobby.Join(alice, id, "")
	e.srv.lobby.Join(bob, id, "")
	if err := e.srv.lobby.Start(host, id); err != nil {
		t.Fatal(err)
	}
	// Keep humans present so the game stays active when alice leaves her seat.
	e.srv.hub.add(&Conn{srv: e.srv, userID: host.ID, gameID: id})
	e.srv.hub.add(&Conn{srv: e.srv, userID: bob.ID, gameID: id})
	return id, alice.ID, aliceC
}

func TestLeaveActiveGameMarksSeatAuto(t *testing.T) {
	e := newEnv(t)
	id, aliceID, aliceC := startThreePlayerActive(t, e)

	// A follower with a drainable send channel observes the roster broadcast.
	follower := &Conn{srv: e.srv, userID: 99, gameID: id, send: make(chan []byte, 8)}
	e.srv.hub.add(follower)

	if resp, _ := e.req(t, "POST", "/api/games/"+id+"/leave", aliceC, nil); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("leave = %d, want 204", resp.StatusCode)
	}
	seat, err := e.st.SeatForUser(id, aliceID)
	if err != nil {
		t.Fatalf("SeatForUser: %v", err)
	}
	if seat.Status != "auto" {
		t.Errorf("seat status = %q, want auto", seat.Status)
	}
	if !drainHasType(follower.send, "resync") {
		t.Error("expected a resync roster broadcast to followers after leave")
	}
}

func TestReturnReclaimsSeat(t *testing.T) {
	e := newEnv(t)
	id, aliceID, aliceC := startThreePlayerActive(t, e)

	// Leave -> seat auto.
	if resp, _ := e.req(t, "POST", "/api/games/"+id+"/leave", aliceC, nil); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("leave = %d, want 204", resp.StatusCode)
	}
	// Return -> seat active again.
	if resp, _ := e.req(t, "POST", "/api/games/"+id+"/return", aliceC, nil); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("return = %d, want 204", resp.StatusCode)
	}
	seat, err := e.st.SeatForUser(id, aliceID)
	if err != nil {
		t.Fatalf("SeatForUser: %v", err)
	}
	if seat.Status != "active" {
		t.Errorf("seat status after return = %q, want active", seat.Status)
	}

	// Returning when not spectating -> 409.
	if resp, _ := e.req(t, "POST", "/api/games/"+id+"/return", aliceC, nil); resp.StatusCode != http.StatusConflict {
		t.Errorf("return when already active = %d, want 409", resp.StatusCode)
	}
}

func TestShouldReclaimOnSub(t *testing.T) {
	cases := []struct {
		name   string
		seated bool
		status string
		want   bool
	}{
		{"active seat reclaims on reconnect", true, "active", true},
		{"auto (spectating) seat does not reclaim", true, "auto", false},
		{"unseated watcher never reclaims", false, "", false},
	}
	for _, c := range cases {
		if got := shouldReclaimOnSub(c.seated, c.status); got != c.want {
			t.Errorf("%s: shouldReclaimOnSub(%v, %q) = %v, want %v", c.name, c.seated, c.status, got, c.want)
		}
	}
}

// Becoming active at another table must hand the player's seat in this active
// game to a bot and mark it "auto", as an explicit Leave & Spectate does, so
// observers see "Bot ..." and the owner spectates.
func TestDetachFromOthersMarksSeatAuto(t *testing.T) {
	e := newEnv(t)
	id, aliceID, _ := startThreePlayerActive(t, e)

	e.srv.detachFromOthers(&store.User{ID: aliceID}, "some-other-game")

	seat, err := e.st.SeatForUser(id, aliceID)
	if err != nil {
		t.Fatalf("SeatForUser: %v", err)
	}
	if seat.Status != "auto" {
		t.Errorf("seat status after detach = %q, want auto", seat.Status)
	}
}
