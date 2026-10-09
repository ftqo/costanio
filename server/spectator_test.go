package server

import (
	"net/http"
	"testing"
	"time"
)

// publicGame creates a public (no-invite) lobby hosted by a fresh Discord user
// and returns its id plus the host's cookie.
func publicGame(t *testing.T, e *testEnv, host string) (string, *http.Cookie) {
	t.Helper()
	_, hostCookie := e.discordUser(t, "host-"+host, host)
	resp, created := e.req(t, "POST", "/api/games", hostCookie, map[string]any{
		"config": map[string]any{"players": 3}, "private": false,
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create public game = %d %v", resp.StatusCode, created)
	}
	g := created["game"].(map[string]any)
	return g["id"].(string), hostCookie
}

// TestSpectateGuestRejectedOnPublicGame: a guest with no invite cannot watch a
// public game (same gating as joining; guests need an invite link).
func TestSpectateGuestRejectedOnPublicGame(t *testing.T) {
	e := newEnv(t)
	id, _ := publicGame(t, e, "pub")

	_, guestCookie := e.guest(t, "watcher")
	c := dialWS(t, e.ts, guestCookie)
	c.send(map[string]any{"t": "sub", "id": "s1", "game": id})
	f := c.waitFrame(func(f map[string]any) bool { return f["t"] == "err" }, "forbidden err")
	if f["code"] != "GUEST_NEEDS_INVITE" {
		t.Fatalf("want GUEST_NEEDS_INVITE, got %v", f["code"])
	}
}

// TestSpectateDiscordAllowedOnPublicGame: a logged-in Discord user may watch a
// public game without an invite.
func TestSpectateDiscordAllowedOnPublicGame(t *testing.T) {
	e := newEnv(t)
	id, _ := publicGame(t, e, "pub")

	_, watcher := e.discordUser(t, "d-watch", "watcher")
	c := dialWS(t, e.ts, watcher)
	c.send(map[string]any{"t": "sub", "id": "s1", "game": id})
	c.waitFrame(func(f map[string]any) bool { return f["t"] == "lobby" }, "spectator lobby frame")
}

// TestSpectateEndpointFreesSeat: a seated lobby player can opt out via the
// /spectate endpoint, freeing their slot.
func TestSpectateEndpointFreesSeat(t *testing.T) {
	e := newEnv(t)
	id, _ := publicGame(t, e, "pub")
	alice, aliceCookie := e.discordUser(t, "d-alice", "alice")
	if resp, out := e.req(t, "POST", "/api/games/"+id+"/join", aliceCookie, nil); resp.StatusCode != http.StatusOK {
		t.Fatalf("join = %d %v", resp.StatusCode, out)
	}
	if resp, _ := e.req(t, "POST", "/api/games/"+id+"/spectate", aliceCookie, nil); resp.StatusCode != http.StatusOK {
		t.Fatalf("spectate = %d", resp.StatusCode)
	}
	if _, err := e.st.SeatForUser(id, alice.ID); err == nil {
		t.Fatal("alice's seat should be freed after opting out")
	}
}

// TestSpectateReturnsUpdatedSummary: the /spectate response carries the shrunk
// lobby summary, so the client can apply it immediately instead of waiting for
// the websocket broadcast.
func TestSpectateReturnsUpdatedSummary(t *testing.T) {
	e := newEnv(t)
	id, hostCookie := publicGame(t, e, "pub") // host is seated in seat 0
	resp, out := e.req(t, "POST", "/api/games/"+id+"/spectate", hostCookie, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("spectate = %d %v", resp.StatusCode, out)
	}
	seats, ok := out["seats"].([]any)
	if !ok && out["seats"] != nil {
		t.Fatalf("spectate response missing seats array: %v", out)
	}
	if len(seats) != 0 {
		t.Fatalf("want 0 seats in spectate summary (host dropped), got %d: %v", len(seats), out)
	}
}

// TestPresenceListsSpectators: when a watcher subscribes, followers receive a
// presence frame naming the spectator.
func TestPresenceListsSpectators(t *testing.T) {
	e := newEnv(t)
	id, hostCookie := publicGame(t, e, "pub")

	// Host subscribes (seated) and watches for presence updates.
	host := dialWS(t, e.ts, hostCookie)
	host.send(map[string]any{"t": "sub", "id": "h", "game": id})
	host.waitFrame(func(f map[string]any) bool { return f["t"] == "lobby" }, "host lobby frame")

	// A Discord watcher joins as a spectator.
	watcher, watcherCookie := e.discordUser(t, "d-watch", "Watcher")
	_ = watcher
	wc := dialWS(t, e.ts, watcherCookie)
	wc.send(map[string]any{"t": "sub", "id": "w", "game": id})

	f := host.waitFrame(func(f map[string]any) bool {
		if f["t"] != "presence" {
			return false
		}
		specs, ok := f["spectators"].([]any)
		return ok && len(specs) == 1
	}, "presence frame with one spectator")
	specs := f["spectators"].([]any)
	first := specs[0].(map[string]any)
	if first["name"] != "Watcher" {
		t.Fatalf("want spectator name Watcher, got %v", first["name"])
	}
}

// TestPresenceSentToArrivingPlayer: a seated player newly following a game that
// already has watchers gets the current list once, on subscribe. The client
// clears its watcher list on every subscription swap, so without this frame the
// lobby would show nobody watching until the next arrival or departure.
func TestPresenceSentToArrivingPlayer(t *testing.T) {
	e := newEnv(t)
	id, hostCookie := publicGame(t, e, "pub")

	// A watcher is already following before the host's client subscribes.
	watcher, watcherCookie := e.discordUser(t, "d-watch", "Watcher")
	wc := dialWS(t, e.ts, watcherCookie)
	wc.send(map[string]any{"t": "sub", "id": "w", "game": id})
	waitFollower(t, e, id, watcher.ID)

	host := dialWS(t, e.ts, hostCookie)
	host.send(map[string]any{"t": "sub", "id": "h", "game": id})
	f := host.waitFrame(func(f map[string]any) bool {
		return f["t"] == "presence"
	}, "presence frame on a seated player's first subscribe")
	specs, _ := f["spectators"].([]any)
	if len(specs) != 1 || specs[0].(map[string]any)["name"] != "Watcher" {
		t.Fatalf("want the one watcher in the initial presence frame, got %v", f["spectators"])
	}
}

// TestSpectatorCapRejects: past the per-game spectator cap, further watchers are
// turned away with a clear error (never a disconnect).
func TestSpectatorCapRejects(t *testing.T) {
	e := newEnv(t)
	e.srv.maxSpectators = 1
	id, _ := publicGame(t, e, "pub")

	_, w1 := e.discordUser(t, "d-w1", "w1")
	c1 := dialWS(t, e.ts, w1)
	c1.send(map[string]any{"t": "sub", "id": "s1", "game": id})
	c1.waitFrame(func(f map[string]any) bool { return f["t"] == "lobby" }, "first spectator ok")

	_, w2 := e.discordUser(t, "d-w2", "w2")
	c2 := dialWS(t, e.ts, w2)
	c2.send(map[string]any{"t": "sub", "id": "s2", "game": id})
	f := c2.waitFrame(func(f map[string]any) bool { return f["t"] == "err" }, "cap err")
	if f["code"] != "SPECTATORS_FULL" {
		t.Fatalf("want SPECTATORS_FULL, got %v", f["code"])
	}
}

// botTable spins up an all-bot active table whose host has opted out: host
// opts out (frees seat 0), three bots fill the seats, then it starts.
func botTable(t *testing.T, e *testEnv, host string) (string, *http.Cookie, int64) {
	t.Helper()
	hostUser, hostCookie := e.discordUser(t, "host-"+host, host)
	// Starting an all-bot table (no second human) is a supporter perk; this
	// helper exists to exercise such tables, so mark the host an active supporter.
	if err := e.st.SetSupporter(hostUser.ID, true, false, false, false, false, 0); err != nil {
		t.Fatal(err)
	}
	resp, created := e.req(t, "POST", "/api/games", hostCookie, map[string]any{
		"config": map[string]any{"players": 3}, "private": false,
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create = %d %v", resp.StatusCode, created)
	}
	id := created["game"].(map[string]any)["id"].(string)
	if resp, _ := e.req(t, "POST", "/api/games/"+id+"/spectate", hostCookie, nil); resp.StatusCode != http.StatusOK {
		t.Fatal("host spectate")
	}
	for i := range 3 {
		if resp, out := e.req(t, "POST", "/api/games/"+id+"/bots", hostCookie, nil); resp.StatusCode != http.StatusOK {
			t.Fatalf("add bot %d = %d %v", i, resp.StatusCode, out)
		}
	}
	if resp, out := e.req(t, "POST", "/api/games/"+id+"/start", hostCookie, nil); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("start = %d %v", resp.StatusCode, out)
	}
	return id, hostCookie, hostUser.ID
}

// waitFollower blocks until userID is registered as following gameID.
func waitFollower(t *testing.T, e *testEnv, gameID string, userID int64) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if e.srv.hub.GameFollowers(gameID)[userID] {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("user %d never registered as a follower of %s", userID, gameID)
}

// TestHostSpectatesOwnPrivateGame: the creator may follow their own private
// game after dropping their seat, without the invite code, rather than being
// rejected as "private game" and bounced out.
func TestHostSpectatesOwnPrivateGame(t *testing.T) {
	e := newEnv(t)
	_, hostCookie := e.discordUser(t, "d-host", "host")
	resp, created := e.req(t, "POST", "/api/games", hostCookie, map[string]any{
		"config": map[string]any{"players": 3}, "private": true,
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create private = %d %v", resp.StatusCode, created)
	}
	id := created["game"].(map[string]any)["id"].(string)
	if r, _ := e.req(t, "POST", "/api/games/"+id+"/spectate", hostCookie, nil); r.StatusCode != http.StatusOK {
		t.Fatal("host spectate")
	}
	// Host subscribes to their own private game without the invite code.
	c := dialWS(t, e.ts, hostCookie)
	c.send(map[string]any{"t": "sub", "id": "h", "game": id})
	c.waitFrame(func(f map[string]any) bool { return f["t"] == "lobby" }, "host gets their own private game (not FORBIDDEN)")
}

// TestSpectatePrivateGameRequiresInvite: a non-host Discord user can spectate a
// private game only with the invite code, as a Discord Activity overflow opener
// does (activity tables are private). Without it the WS sub is FORBIDDEN; with
// it the spectator gets the lobby frame.
func TestSpectatePrivateGameRequiresInvite(t *testing.T) {
	e := newEnv(t)
	_, hostCookie := e.discordUser(t, "d-host", "host")
	resp, created := e.req(t, "POST", "/api/games", hostCookie, map[string]any{
		"config": map[string]any{"players": 3}, "private": true,
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create private = %d %v", resp.StatusCode, created)
	}
	g := created["game"].(map[string]any)
	id := g["id"].(string)
	invite := g["invite_code"].(string)
	if invite == "" {
		t.Fatal("private game has no invite code")
	}

	// A different Discord user (not host, not seated) without the invite: rejected.
	_, watcher := e.discordUser(t, "d-watch", "watcher")
	c := dialWS(t, e.ts, watcher)
	c.send(map[string]any{"t": "sub", "id": "s1", "game": id})
	f := c.waitFrame(func(f map[string]any) bool { return f["t"] == "err" }, "private without invite -> err")
	if f["code"] != "PRIVATE_GAME" {
		t.Fatalf("want PRIVATE_GAME, got %v", f["code"])
	}

	// Same posture, but presenting the invite: allowed through as a spectator.
	c2 := dialWS(t, e.ts, watcher)
	c2.send(map[string]any{"t": "sub", "id": "s2", "game": id, "invite": invite})
	c2.waitFrame(func(f map[string]any) bool { return f["t"] == "lobby" }, "private with invite -> lobby frame")
}

// TestCreatorPresenceKeepsBotGameAlive: a following creator counts as present
// (so reconcile resumes/keeps the all-bot table rather than suspending it),
// even though they hold no seat.
func TestCreatorPresenceKeepsBotGameAlive(t *testing.T) {
	e := newEnv(t)
	id, hostCookie, hostID := botTable(t, e, "pub")

	// Nobody following the seated-human-free table -> not present.
	if e.srv.anyHumanPresent(id) {
		t.Fatal("no followers should mean not present")
	}
	// The creator follows as a spectator -> present.
	host := dialWS(t, e.ts, hostCookie)
	host.send(map[string]any{"t": "sub", "id": "h", "game": id})
	waitFollower(t, e, id, hostID)
	if !e.srv.anyHumanPresent(id) {
		t.Fatal("a following creator should keep their own table present")
	}
}

// TestNonCreatorSpectatorDoesNotKeepAlive: an ordinary spectator never keeps a
// seated-human-free game alive; only the creator does.
func TestNonCreatorSpectatorDoesNotKeepAlive(t *testing.T) {
	e := newEnv(t)
	id, _, _ := botTable(t, e, "pub")

	watcher, wc := e.discordUser(t, "d-watch", "watcher")
	conn := dialWS(t, e.ts, wc)
	conn.send(map[string]any{"t": "sub", "id": "w", "game": id})
	waitFollower(t, e, id, watcher.ID)
	if e.srv.anyHumanPresent(id) {
		t.Fatal("a non-creator spectator must not keep a seated-human-free game alive")
	}
}

// A finished game does not turn watchers away: it starts no actor, subscription
// or forwarder, just a scoreboard read, and old Discord watch links keep reaching
// it.
func TestSpectatorCapDoesNotApplyToAFinishedGame(t *testing.T) {
	e := newEnv(t)
	e.srv.maxSpectators = 1
	host, _ := e.discordUser(t, "d-h", "host")
	member, _ := e.discordUser(t, "d-m", "member")
	id := finishedRealGame(t, e, host, member, "")
	if err := e.st.SetGamePublic(id, true); err != nil {
		t.Fatal(err)
	}

	// The cap is 1, so the second of these is the one the cap would refuse.
	for i, who := range []string{"w1", "w2", "w3"} {
		_, cookie := e.discordUser(t, "d-"+who, who)
		c := dialWS(t, e.ts, cookie)
		c.send(map[string]any{"t": "sub", "id": who, "game": id})
		f := c.waitFrame(func(f map[string]any) bool {
			return f["t"] == "postgame" || f["t"] == "err"
		}, "postgame or err for watcher "+who)
		if f["t"] == "err" {
			t.Fatalf("watcher %d (%s) was turned away from a finished game: %v", i+1, who, f["code"])
		}
	}
}
