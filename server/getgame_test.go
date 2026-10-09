package server

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/store"
)

// startActiveSolo creates a 3-player game (the host plus two bots), starts it,
// and returns its id. One human avoids needing a second cookie.
func startActiveSolo(t *testing.T, e *testEnv, host *store.User) string {
	t.Helper()
	return startActiveSoloPriv(t, e, host, false)
}

// startActiveSoloPriv is startActiveSolo with the table's privacy chosen by the
// caller. Tables are created private by default, so that is what a spectator
// link normally meets.
func startActiveSoloPriv(t *testing.T, e *testEnv, host *store.User, priv bool) string {
	t.Helper()
	// A solo table (host alone against bots) is a supporter perk; mark the host
	// an active supporter so the start succeeds.
	if err := e.st.SetSupporter(host.ID, true, false, false, false, false, 0); err != nil {
		t.Fatal(err)
	}
	sum, err := e.srv.lobby.Create(host, engine.GameConfig{Players: 3}, priv)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.srv.lobby.AddBot(host, sum.Game.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := e.srv.lobby.AddBot(host, sum.Game.ID); err != nil {
		t.Fatal(err)
	}
	if err := e.srv.lobby.Start(host, sum.Game.ID); err != nil {
		t.Fatal(err)
	}
	return sum.Game.ID
}

func TestGetGameEnrichedForActive(t *testing.T) {
	e := newEnv(t)
	host, hostC := e.discordUser(t, "d1", "host")
	id := startActiveSolo(t, e, host)

	// Seed a chat line so the response carries chat history.
	if _, err := e.st.SaveChat("game:"+id, host.ID, "hello"); err != nil {
		t.Fatal(err)
	}

	resp, out := e.req(t, "GET", "/api/games/"+id, hostC, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("get = %d", resp.StatusCode)
	}
	if out["view"] == nil {
		t.Error("active game response missing live view")
	}
	if out["log"] == nil {
		t.Error("active game response missing log")
	}
	chat, ok := out["chat"].([]any)
	if !ok || len(chat) != 1 {
		t.Errorf("chat = %v, want one line", out["chat"])
	} else if chat[0].(map[string]any)["msg"] != "hello" {
		t.Errorf("chat[0] = %v", chat[0])
	}
}

func TestGetGameLobbyOmitsLiveFields(t *testing.T) {
	e := newEnv(t)
	host, hostC := e.discordUser(t, "d1", "host")
	sum, err := e.srv.lobby.Create(host, engine.GameConfig{Players: 3}, false)
	if err != nil {
		t.Fatal(err)
	}
	resp, out := e.req(t, "GET", "/api/games/"+sum.Game.ID, hostC, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("get = %d", resp.StatusCode)
	}
	if out["view"] != nil || out["log"] != nil || out["chat"] != nil {
		t.Errorf("lobby game leaked live fields: %v", out)
	}
}

// logSeqs pulls the event seqs out of a getGame response, asserting the log is
// present and well-formed.
func logSeqs(t *testing.T, out map[string]any) []int {
	t.Helper()
	raw, ok := out["log"].([]any)
	if !ok {
		t.Fatalf("log missing/!array: %v", out["log"])
	}
	seqs := make([]int, len(raw))
	for i, e := range raw {
		seqs[i] = int(e.(map[string]any)["seq"].(float64))
	}
	return seqs
}

// TestGetGameLogWholeByDefault: the client keeps the full event log, so the
// enriched fetch returns the whole redacted log from seq 0, not a window of the
// last N, regardless of the server's in-memory ring size.
func TestGetGameLogWholeByDefault(t *testing.T) {
	e := newEnv(t)
	host, hostC := e.discordUser(t, "d1", "host")
	id := startActiveSolo(t, e, host)

	_, out := e.req(t, "GET", "/api/games/"+id, hostC, nil)
	seqs := logSeqs(t, out)
	if len(seqs) == 0 {
		t.Fatal("empty log")
	}
	if seqs[0] != 0 {
		t.Errorf("log starts at seq %d, want 0", seqs[0])
	}
	for i, s := range seqs {
		if s != i {
			t.Fatalf("log is not contiguous from 0: seqs[%d] = %d", i, s)
		}
	}
	view := out["view"].(map[string]any)
	// A FullView's seq is NextSeq, so the log covers every event folded into the
	// view. (It may run past it: the view is built first and a bot's event can
	// land before the log is read.)
	if want := int(view["seq"].(float64)); len(seqs) < want {
		t.Errorf("log has %d events, want at least %d (every event up to the view)", len(seqs), want)
	}
}

// TestGetGameLogSinceWindow: a client that already holds a prefix asks only for
// what it is missing, so a reconnect is a gap fill. Reading from the store, not
// the broadcast ring, makes any `since` answerable.
func TestGetGameLogSinceWindow(t *testing.T) {
	e := newEnv(t)
	host, hostC := e.discordUser(t, "d1", "host")
	id := startActiveSolo(t, e, host)

	_, full := e.req(t, "GET", "/api/games/"+id, hostC, nil)
	all := logSeqs(t, full)
	if len(all) < 2 {
		t.Fatalf("need at least two events to slice, got %d", len(all))
	}
	cut := len(all) - 1 // pretend the client holds everything but the last line

	_, partial := e.req(t, "GET", fmt.Sprintf("/api/games/%s?since=%d", id, cut), hostC, nil)
	got := logSeqs(t, partial)
	for _, s := range got {
		if s < cut {
			t.Fatalf("since=%d returned seq %d", cut, s)
		}
	}
	if got[0] != cut {
		t.Errorf("since=%d log starts at %d, want %d (no gap at the join)", cut, got[0], cut)
	}

	// Junk and negative cursors fall back to the whole log rather than erroring
	// or silently returning nothing.
	for _, q := range []string{"?since=-5", "?since=abc", "?since="} {
		_, out := e.req(t, "GET", "/api/games/"+id+q, hostC, nil)
		if s := logSeqs(t, out); s[0] != 0 {
			t.Errorf("%q log starts at %d, want the whole log", q, s[0])
		}
	}

	// A cursor past the end is legal and returns no log.
	_, beyond := e.req(t, "GET", "/api/games/"+id+"?since=999999", hostC, nil)
	if beyond["log"] != nil {
		t.Errorf("since past the end returned %v, want no log", beyond["log"])
	}
}

func TestGetGameLogRedactedForSpectator(t *testing.T) {
	e := newEnv(t)
	host, _ := e.discordUser(t, "d1", "host")
	_, specC := e.discordUser(t, "d2", "spectator") // not seated -> spectator
	id := startActiveSolo(t, e, host)

	// A spectator of an active public game gets a redacted log: every entry is
	// a valid event object and no card_stolen entry carries "res". A game with
	// no steal trivially passes.
	resp, out := e.req(t, "GET", "/api/games/"+id, specC, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("get = %d", resp.StatusCode)
	}
	log, ok := out["log"].([]any)
	if !ok {
		t.Fatalf("log missing/!array: %v", out["log"])
	}
	sawCreated := false
	for _, raw := range log {
		ev := raw.(map[string]any)
		data, _ := ev["data"].(map[string]any)
		switch ev["type"] {
		case "card_stolen":
			if _, leaked := data["res"]; leaked {
				t.Errorf("spectator received unredacted steal: %v", data)
			}
		case "game_created":
			sawCreated = true
			if _, leaked := data["seed"]; leaked {
				t.Errorf("spectator received the hidden game seed: %v", data)
			}
			if _, ok := data["seed_commit"]; !ok {
				t.Errorf("game_created data missing seed_commit (data not populated?): %v", data)
			}
		}
	}
	if !sawCreated {
		t.Error("no game_created event in the spectator log")
	}
}

// A private game is readable by someone holding its invite code and by nobody
// else. The Discord feed's watch link carries `inv` to pass the websocket gate,
// and this endpoint must agree, since the game screen fetches it on entry and
// leaves on a 4xx.
func TestGetGamePrivateSpectatorNeedsInvite(t *testing.T) {
	e := newEnv(t)
	host, _ := e.discordUser(t, "d1", "host")
	_, specC := e.discordUser(t, "d2", "spectator") // not seated -> spectator
	_, guestC := e.guest(t, "guest")
	id := startActiveSoloPriv(t, e, host, true)

	g, err := e.st.GameByID(id)
	if err != nil {
		t.Fatal(err)
	}
	if g.InviteCode == "" {
		t.Fatal("private game has no invite code")
	}

	cases := []struct {
		name   string
		path   string
		cookie *http.Cookie
		want   int
	}{
		{"no invite", "/api/games/" + id, specC, http.StatusForbidden},
		{"wrong invite", "/api/games/" + id + "?inv=nope", specC, http.StatusForbidden},
		{"right invite", "/api/games/" + id + "?inv=" + g.InviteCode, specC, http.StatusOK},
		// A guest holding the code may read it too, matching the websocket
		// gate.
		{"guest with invite", "/api/games/" + id + "?inv=" + g.InviteCode, guestC, http.StatusOK},
		{"guest without invite", "/api/games/" + id, guestC, http.StatusForbidden},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			resp, out := e.req(t, "GET", tc.path, tc.cookie, nil)
			if resp.StatusCode != tc.want {
				t.Fatalf("get = %d, want %d (%v)", resp.StatusCode, tc.want, out)
			}
			if resp.StatusCode != http.StatusOK {
				return
			}
			// The code authorizes reading, and the response must not hand it back
			// out: sanitize keeps it for the host and the seated only.
			game, ok := out["game"].(map[string]any)
			if !ok {
				t.Fatalf("no game in the response: %v", out)
			}
			if code, leaked := game["invite_code"]; leaked && code != "" {
				t.Errorf("invite code echoed to a spectator: %v", code)
			}
		})
	}
}

// A public game needs no invite, and a bogus `inv` on one is ignored.
func TestGetGamePublicIgnoresInvite(t *testing.T) {
	e := newEnv(t)
	host, _ := e.discordUser(t, "d1", "host")
	_, specC := e.discordUser(t, "d2", "spectator")
	id := startActiveSolo(t, e, host)

	for _, path := range []string{"/api/games/" + id, "/api/games/" + id + "?inv=nope"} {
		resp, out := e.req(t, "GET", path, specC, nil)
		if resp.StatusCode != http.StatusOK {
			t.Errorf("GET %s = %d, want 200 (%v)", path, resp.StatusCode, out)
		}
	}
}
