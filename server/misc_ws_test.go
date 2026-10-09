package server

import (
	"net/http"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/store"
)

func TestSetDiscordAppIDAllowsActivityOrigin(t *testing.T) {
	e := newEnv(t)
	r, _ := http.NewRequest(http.MethodGet, "http://x/ws", nil)
	r.Header.Set("Origin", "https://abc123.discordsays.com")

	// Without the app id configured, the Activity iframe origin is rejected.
	if e.srv.checkOrigin(r) {
		t.Error("activity origin allowed before SetDiscordAppID")
	}
	// Configuring it opens exactly that origin.
	e.srv.SetDiscordAppID("abc123")
	if !e.srv.checkOrigin(r) {
		t.Error("activity origin rejected after SetDiscordAppID")
	}
	// A different app id is still rejected.
	r.Header.Set("Origin", "https://other.discordsays.com")
	if e.srv.checkOrigin(r) {
		t.Error("a non-matching discordsays origin was allowed")
	}
}

func TestSetSupporterRefresher(t *testing.T) {
	e := newEnv(t)
	// SetSupporterRefresher must accept a refresher without panicking and wire it
	// into the cosmetics service; a nil refresher is the documented "not
	// configured" state and the supporter endpoint must still work afterward.
	e.srv.SetSupporterRefresher(nil)
	_, c := e.discordUser(t, "d1", "me")
	if resp, _ := e.req(t, "GET", "/api/me/supporter", c, nil); resp.StatusCode != http.StatusOK {
		t.Errorf("supporter after SetSupporterRefresher = %d, want 200", resp.StatusCode)
	}
}

func TestHubAccessor(t *testing.T) {
	e := newEnv(t)
	if e.srv.Hub() == nil {
		t.Fatal("Hub() returned nil")
	}
	if e.srv.Hub() != e.srv.hub {
		t.Error("Hub() did not return the server's hub")
	}
}

func TestLobbyChatBroadcast(t *testing.T) {
	e := newEnv(t)
	alice, aC := e.discordUser(t, "d1", "alice")
	bob, bC := e.discordUser(t, "d2", "bob")

	a := dialWS(t, e.ts, aC)
	b := dialWS(t, e.ts, bC)
	// Give both connections a moment to register in the hub before broadcasting.
	waitFor(t, func() bool { return e.srv.hub.Online(alice.ID) && e.srv.hub.Online(bob.ID) }, "both online")

	a.send(map[string]any{"t": "chat", "scope": "lobby", "msg": "hi all"})
	// Lobby chat reaches every connected client, including other users.
	b.waitFrame(func(f map[string]any) bool {
		return f["t"] == "chat" && f["scope"] == "lobby" && f["msg"] == "hi all"
	}, "lobby chat broadcast")
}

func TestWSChatBadScope(t *testing.T) {
	e := newEnv(t)
	_, c := e.discordUser(t, "d1", "me")
	w := dialWS(t, e.ts, c)

	// Empty message.
	w.send(map[string]any{"t": "chat", "id": "r1", "scope": "lobby", "msg": ""})
	f := w.waitFrame(func(f map[string]any) bool { return f["t"] == "err" && f["ref"] == "r1" }, "empty msg err")
	if f["code"] != "CHAT_LENGTH" {
		t.Errorf("empty msg code = %v, want CHAT_LENGTH", f["code"])
	}

	// Unknown scope.
	w.send(map[string]any{"t": "chat", "id": "r2", "scope": "weird", "msg": "x"})
	f = w.waitFrame(func(f map[string]any) bool { return f["t"] == "err" && f["ref"] == "r2" }, "bad scope err")
	if f["code"] != "BAD_CHAT_SCOPE" {
		t.Errorf("bad scope code = %v, want BAD_CHAT_SCOPE", f["code"])
	}

	// game-scope chat when not following that game.
	w.send(map[string]any{"t": "chat", "id": "r3", "scope": "game:other", "msg": "x"})
	f = w.waitFrame(func(f map[string]any) bool { return f["t"] == "err" && f["ref"] == "r3" }, "not-in-game err")
	if f["code"] != "NOT_IN_THAT_GAME" {
		t.Errorf("game scope not-following code = %v, want NOT_IN_THAT_GAME", f["code"])
	}
}

// finishGameWithHuman seats the host plus a second human (and a bot to fill the
// 3rd seat), starts the game, then marks it finished, so a rematch vote from
// the non-host has an eligible voter.
func finishGameWithHuman(t *testing.T, e *testEnv, host, other *store.User) string {
	t.Helper()
	sum, err := e.srv.lobby.Create(host, engine.GameConfig{Players: 3}, false)
	if err != nil {
		t.Fatal(err)
	}
	id := sum.Game.ID
	if _, err := e.srv.lobby.Join(other, id, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := e.srv.lobby.AddBot(host, id); err != nil {
		t.Fatal(err)
	}
	if err := e.srv.lobby.Start(host, id); err != nil {
		t.Fatal(err)
	}
	e.srv.mgr.StopAll()
	if err := e.st.FinishGame(id, host.ID); err != nil {
		t.Fatal(err)
	}
	return id
}

func TestWSCmdIllegalMoveReturnsErr(t *testing.T) {
	e := newEnv(t)
	host, hostC := e.discordUser(t, "d1", "host")
	id := startActiveSolo(t, e, host)

	c := dialWS(t, e.ts, hostC)
	c.send(map[string]any{"t": "sub", "game": id})
	c.waitFrame(func(f map[string]any) bool { return f["t"] == "state" }, "state")

	// A structurally-bad command (no data where it's required) is rejected by the
	// engine; the conn relays an err frame whose code comes from errCode().
	c.send(map[string]any{"t": "cmd", "id": "bad", "game": id,
		"cmd": map[string]any{"type": "build_city"}})
	f := c.waitFrame(func(f map[string]any) bool { return f["t"] == "err" && f["ref"] == "bad" }, "illegal move err")
	code, _ := f["code"].(string)
	switch code {
	case "NOT_YOUR_TURN", "NO_RESOURCES", "BAD_COMMAND", "WRONG_PHASE", "PAUSED":
		// any mapped engine-error code is acceptable
	default:
		t.Errorf("illegal cmd code = %q, want a mapped engine-error code", code)
	}
}

func TestWSRematchNonHostVote(t *testing.T) {
	e := newEnv(t)
	host, hostC := e.discordUser(t, "d1", "host")
	other, otherC := e.discordUser(t, "d2", "other")
	id := finishGameWithHuman(t, e, host, other)

	hc := dialWS(t, e.ts, hostC)
	hc.send(map[string]any{"t": "sub", "game": id})
	hc.waitFrame(func(f map[string]any) bool { return f["t"] == "postgame" }, "host postgame")

	oc := dialWS(t, e.ts, otherC)
	oc.send(map[string]any{"t": "sub", "game": id})
	oc.waitFrame(func(f map[string]any) bool { return f["t"] == "postgame" }, "other postgame")

	// Non-host votes for a rematch; everyone's tally rises to want=1.
	oc.send(map[string]any{"t": "rematch", "game": id})
	f := oc.waitFrame(func(f map[string]any) bool {
		r, ok := f["rematch"].(map[string]any)
		return f["t"] == "postgame" && ok && int(r["want"].(float64)) == 1
	}, "want=1 after vote")
	r := f["rematch"].(map[string]any)
	if int(r["eligible"].(float64)) != 2 {
		t.Errorf("eligible = %v, want 2 (host + other)", r["eligible"])
	}

	// Toggling the vote off brings it back to zero.
	oc.send(map[string]any{"t": "rematch", "game": id})
	oc.waitFrame(func(f map[string]any) bool {
		r, ok := f["rematch"].(map[string]any)
		return f["t"] == "postgame" && ok && int(r["want"].(float64)) == 0
	}, "want=0 after un-vote")
}
