package server

import (
	"net/http"
	"strconv"
	"testing"

	"github.com/ftqo/costan.io/store"
)

// rankedGame stores a game shaped like the ranked matchmaker's: not public and
// with no invite code, so an absent invite must not match the absent code.
func rankedGame(t *testing.T, e *testEnv, id string, host *store.User) {
	t.Helper()
	if err := e.st.CreateGame(&store.Game{ID: id, Ruleset: "base", Config: []byte("{}"), CreatedBy: host.ID, Ranked: true}); err != nil {
		t.Fatal(err)
	}
	if err := e.st.SetGameStatus(id, "active"); err != nil {
		t.Fatal(err)
	}
	if err := e.st.AddSeat(id, 0, host.ID); err != nil {
		t.Fatal(err)
	}
}

// TestRankedGameRejectsCodelessSpectator: an outsider subscribing to a ranked
// game with no invite must be refused, exactly as the REST gate refuses them.
func TestRankedGameRejectsCodelessSpectator(t *testing.T) {
	e := newEnv(t)
	host, _ := e.discordUser(t, "d-host", "host")
	rankedGame(t, e, "ranked-1", host)

	_, watcher := e.discordUser(t, "d-watch", "watcher")
	c := dialWS(t, e.ts, watcher)
	c.send(map[string]any{"t": "sub", "id": "s1", "game": "ranked-1"})
	f := c.waitFrame(func(f map[string]any) bool {
		return f["t"] == "err" || f["t"] == "state" || f["t"] == "lobby"
	}, "sub answer")
	if f["t"] != "err" || f["code"] != "PRIVATE_GAME" {
		t.Fatalf("codeless sub of a ranked game: want err PRIVATE_GAME, got %v", f)
	}

	// The REST gate already refused; it must keep agreeing with the socket.
	if resp, _ := e.req(t, "GET", "/api/games/ranked-1", watcher, nil); resp.StatusCode != http.StatusForbidden {
		t.Fatalf("GET ranked game as outsider = %d, want 403", resp.StatusCode)
	}
}

// TestProfileHidesPrivateGameFromOthers: another user's profile must not name a
// private or ranked game they are seated in, since the viewer could not open it.
// The owner's own profile still carries it (the abandon guard reads it).
func TestProfileHidesPrivateGameFromOthers(t *testing.T) {
	e := newEnv(t)
	host, hostC := e.discordUser(t, "d-host", "host")
	rankedGame(t, e, "ranked-2", host)
	_, other := e.discordUser(t, "d-other", "other")

	resp, body := e.req(t, "GET", "/api/users/"+strconv.FormatInt(host.ID, 10), other, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("profile = %d", resp.StatusCode)
	}
	if g, _ := body["game"].(string); g != "" {
		t.Fatalf("other user's profile leaks ranked game id %q", g)
	}
	if s, _ := body["game_status"].(string); s != "" {
		t.Fatalf("other user's profile leaks game_status %q", s)
	}

	_, me := e.req(t, "GET", "/api/users/me", hostC, nil)
	if me["game"] != "ranked-2" || me["game_status"] != "active" {
		t.Fatalf("own profile must keep game/game_status, got %v/%v", me["game"], me["game_status"])
	}

	// A public game stays visible: anyone could open it anyway.
	pub, _ := e.discordUser(t, "d-pub", "pub")
	if err := e.st.CreateGame(&store.Game{ID: "pub-1", Ruleset: "base", Config: []byte("{}"), CreatedBy: pub.ID, Public: true}); err != nil {
		t.Fatal(err)
	}
	if err := e.st.AddSeat("pub-1", 0, pub.ID); err != nil {
		t.Fatal(err)
	}
	_, body = e.req(t, "GET", "/api/users/"+strconv.FormatInt(pub.ID, 10), other, nil)
	if body["game"] != "pub-1" {
		t.Fatalf("public game should stay on the profile, got %v", body["game"])
	}
}
