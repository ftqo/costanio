package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/ftqo/costan.io/auth"
	"github.com/ftqo/costan.io/game"
	"github.com/ftqo/costan.io/lobby"
	"github.com/ftqo/costan.io/store"
)

const sessionCookie = "costan_session"

type testEnv struct {
	st  *store.Store
	srv *Server
	ts  *httptest.Server
}

func newEnv(t *testing.T) *testEnv {
	t.Helper()
	// The database goes in a directory this env owns rather than t.TempDir(),
	// whose cleanup fails if the directory is not empty. A store read still in
	// flight after st.Close() can recreate the -wal/-shm files. Server goroutines
	// are joined by srv.Close now, so that shouldn't happen, but RemoveAll costs
	// nothing.
	dir, err := os.MkdirTemp("", "costan-server-test")
	if err != nil {
		t.Fatal(err)
	}
	st, err := store.Open(filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	mgr := game.NewManager(st, nil)
	lb := lobby.New(st, mgr)
	authSvc := &auth.Service{Store: st}
	srv := New(st, authSvc, lb, mgr)
	ts := httptest.NewServer(srv.Handler())
	t.Cleanup(func() {
		// Production shutdown order (cmd/costan/main.go): close-frame the sockets,
		// join the connection goroutines, stop the games, close the store.
		// srv.Close blocks until connection goroutines exit, so it must follow
		// DrainConns, which unblocks a read loop parked in ws.Read.
		srv.DrainConns()
		srv.Close()
		ts.Close()
		mgr.StopAll()
		st.Close()
		_ = os.RemoveAll(dir)
	})
	return &testEnv{st: st, srv: srv, ts: ts}
}

func (e *testEnv) discordUser(t *testing.T, id, name string) (*store.User, *http.Cookie) {
	t.Helper()
	u, err := e.st.UpsertDiscordUser(id, name, "")
	if err != nil {
		t.Fatal(err)
	}
	return u, e.cookieFor(t, u)
}

func (e *testEnv) guest(t *testing.T, name string) (*store.User, *http.Cookie) {
	t.Helper()
	u, err := e.st.CreateGuest(name)
	if err != nil {
		t.Fatal(err)
	}
	return u, e.cookieFor(t, u)
}

func (e *testEnv) cookieFor(t *testing.T, u *store.User) *http.Cookie {
	t.Helper()
	tok, err := e.st.CreateSession(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	return &http.Cookie{Name: sessionCookie, Value: tok}
}

// req performs a JSON request with an optional session cookie.
func (e *testEnv) req(t *testing.T, method, path string, cookie *http.Cookie, body any) (*http.Response, map[string]any) {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		json.NewEncoder(&buf).Encode(body)
	}
	req, err := http.NewRequest(method, e.ts.URL+path, &buf)
	if err != nil {
		t.Fatal(err)
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	var out map[string]any
	json.NewDecoder(resp.Body).Decode(&out)
	return resp, out
}

func TestCreateRequiresAuth(t *testing.T) {
	e := newEnv(t)
	resp, _ := e.req(t, "POST", "/api/games", nil, map[string]any{"config": map[string]any{"players": 3}})
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", resp.StatusCode)
	}
}

func TestGameLifecycleOverHTTP(t *testing.T) {
	e := newEnv(t)
	_, hostC := e.discordUser(t, "d1", "host")
	_, aliceC := e.discordUser(t, "d2", "alice")
	_, bobC := e.discordUser(t, "d3", "bob")
	_, guestC := e.guest(t, "guesty")

	// Create a private 4p game.
	resp, created := e.req(t, "POST", "/api/games", hostC, map[string]any{
		"config": map[string]any{"players": 4}, "private": true,
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create = %d: %v", resp.StatusCode, created)
	}
	g := created["game"].(map[string]any)
	id := g["id"].(string)
	invite := g["invite_code"].(string)
	if invite == "" {
		t.Fatal("creator should see the invite code")
	}

	// Non-participants can't see a private game's metadata at all: the
	// summary is withheld, not just the invite code.
	resp, peeked := e.req(t, "GET", "/api/games/"+id, aliceC, nil)
	if resp.StatusCode != http.StatusForbidden {
		t.Errorf("non-member private get = %d, want 403", resp.StatusCode)
	}
	if peeked["game"] != nil {
		t.Errorf("private metadata leaked to non-member: %v", peeked)
	}

	// Guest joins with the invite; discord users too.
	if resp, out := e.req(t, "POST", "/api/games/"+id+"/join", guestC, map[string]any{"invite": invite}); resp.StatusCode != http.StatusOK {
		t.Fatalf("guest join = %d: %v", resp.StatusCode, out)
	}
	if resp, _ := e.req(t, "POST", "/api/games/"+id+"/join", aliceC, map[string]any{"invite": "wrong"}); resp.StatusCode != http.StatusForbidden {
		t.Errorf("bad invite join = %d, want 403", resp.StatusCode)
	}
	e.req(t, "POST", "/api/games/"+id+"/join", aliceC, map[string]any{"invite": invite})
	e.req(t, "POST", "/api/games/"+id+"/join", bobC, map[string]any{"invite": invite})

	// Non-host can't start.
	if resp, _ := e.req(t, "POST", "/api/games/"+id+"/start", aliceC, nil); resp.StatusCode != http.StatusForbidden {
		t.Errorf("non-host start = %d, want 403", resp.StatusCode)
	}
	if resp, _ := e.req(t, "POST", "/api/games/"+id+"/start", hostC, nil); resp.StatusCode != http.StatusNoContent {
		t.Errorf("host start = %d, want 204", resp.StatusCode)
	}

	// Replay not available while active.
	if resp, _ := e.req(t, "GET", "/api/games/"+id+"/replay", hostC, nil); resp.StatusCode != http.StatusConflict {
		t.Errorf("active replay = %d, want 409", resp.StatusCode)
	}
}

func TestPublicJoinRules(t *testing.T) {
	e := newEnv(t)
	_, hostC := e.discordUser(t, "d1", "host")
	_, guestC := e.guest(t, "guesty")

	resp, created := e.req(t, "POST", "/api/games", hostC, map[string]any{"config": map[string]any{"players": 3}})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create = %d", resp.StatusCode)
	}
	id := created["game"].(map[string]any)["id"].(string)

	// Guests cannot join public games.
	if resp, _ := e.req(t, "POST", "/api/games/"+id+"/join", guestC, nil); resp.StatusCode != http.StatusForbidden {
		t.Errorf("guest public join = %d, want 403", resp.StatusCode)
	}

	// Browse lists it.
	_, browse := e.req(t, "GET", "/api/games", nil, nil)
	if games := browse["games"].([]any); len(games) != 1 {
		t.Errorf("browse = %d games", len(games))
	}
}

func TestInviteResolve(t *testing.T) {
	e := newEnv(t)
	_, hostC := e.discordUser(t, "d1", "host")
	_, guestC := e.guest(t, "guesty")

	_, created := e.req(t, "POST", "/api/games", hostC, map[string]any{
		"config": map[string]any{"players": 3}, "private": true,
	})
	invite := created["game"].(map[string]any)["invite_code"].(string)

	resp, resolved := e.req(t, "GET", "/api/invites/"+invite, guestC, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("resolve = %d", resp.StatusCode)
	}
	if resolved["game"].(map[string]any)["invite_code"] != invite {
		t.Error("invite resolve should include the code")
	}
	if resp, _ := e.req(t, "GET", "/api/invites/nope1234", guestC, nil); resp.StatusCode != http.StatusNotFound {
		t.Errorf("bad invite resolve = %d", resp.StatusCode)
	}
}

func TestFriendsEndpoint(t *testing.T) {
	e := newEnv(t)
	me, meC := e.discordUser(t, "d1", "me")
	friend, _ := e.discordUser(t, "d2", "pal")
	e.discordUser(t, "d3", "stranger")

	if err := e.st.ReplaceFriends(me.ID, []string{"d2", "d-no-account"}); err != nil {
		t.Fatal(err)
	}

	_, out := e.req(t, "GET", "/api/social/friends", meC, nil)
	friends := out["friends"].([]any)
	if len(friends) != 1 {
		t.Fatalf("friends = %v", friends)
	}
	f := friends[0].(map[string]any)
	if int64(f["id"].(float64)) != friend.ID || f["online"] != false {
		t.Errorf("friend = %v", f)
	}

	// Guests get an empty list.
	_, guestC := e.guest(t, "g")
	_, gout := e.req(t, "GET", "/api/social/friends", guestC, nil)
	if friends, ok := gout["friends"].([]any); ok && len(friends) != 0 {
		t.Errorf("guest friends = %v", friends)
	}
}

func TestGuestRateLimit(t *testing.T) {
	e := newEnv(t)
	var last int
	for i := range 15 {
		resp, _ := e.req(t, "POST", "/auth/guest", nil, map[string]any{"name": fmt.Sprintf("g%d", i)})
		last = resp.StatusCode
	}
	if last != http.StatusTooManyRequests {
		t.Errorf("15th guest = %d, want 429", last)
	}
}

func TestProfileEndpoints(t *testing.T) {
	e := newEnv(t)
	u, c := e.discordUser(t, "d1", "me")

	_, me := e.req(t, "GET", "/api/users/me", c, nil)
	if me["name"] != "me" || me["guest"] != false {
		t.Errorf("me = %v", me)
	}
	resp, _ := e.req(t, "GET", fmt.Sprintf("/api/users/%d", u.ID), nil, nil)
	if resp.StatusCode != http.StatusOK {
		t.Errorf("public profile = %d", resp.StatusCode)
	}
	resp, _ = e.req(t, "GET", "/api/users/99999", nil, nil)
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("missing profile = %d", resp.StatusCode)
	}

	_, lb := e.req(t, "GET", "/api/leaderboard", nil, nil)
	if lb["ruleset"] != "base" {
		t.Errorf("leaderboard = %v", lb)
	}
}

func TestMeReportsSeatedGameStatus(t *testing.T) {
	e := newEnv(t)
	u, c := e.discordUser(t, "d1", "me")

	// No seat: game empty, status empty.
	_, me := e.req(t, "GET", "/api/users/me", c, nil)
	if me["game"] != "" || me["game_status"] != "" {
		t.Errorf("no seat: game=%v status=%v, want empty", me["game"], me["game_status"])
	}

	// Seated in an in-progress game: status reported as "active".
	g := &store.Game{ID: "g_active", Ruleset: "base", Config: []byte("{}"), CreatedBy: u.ID}
	if err := e.st.CreateGame(g); err != nil {
		t.Fatal(err)
	}
	e.st.SetGameStatus("g_active", "active")
	if err := e.st.AddSeat("g_active", 0, u.ID); err != nil {
		t.Fatal(err)
	}
	_, me = e.req(t, "GET", "/api/users/me", c, nil)
	if me["game"] != "g_active" || me["game_status"] != "active" {
		t.Errorf("seated active: game=%v status=%v, want g_active/active", me["game"], me["game_status"])
	}
}

func TestMeIncludesIdentities(t *testing.T) {
	e := newEnv(t)
	u, c := e.discordUser(t, "d1", "me")

	_, me := e.req(t, "GET", "/api/users/me", c, nil)

	// identities must be present and contain the discord entry.
	raw, ok := me["identities"]
	if !ok {
		t.Fatalf("GET /api/users/me missing 'identities' key; got %v", me)
	}
	ids, ok := raw.([]any)
	if !ok {
		t.Fatalf("identities is not an array: %T %v", raw, raw)
	}
	if len(ids) == 0 {
		t.Fatalf("identities is empty for discord user %d", u.ID)
	}
	entry, ok := ids[0].(map[string]any)
	if !ok {
		t.Fatalf("identities[0] is not an object: %T", ids[0])
	}
	if entry["provider"] != "discord" {
		t.Errorf("identities[0].provider = %v, want discord", entry["provider"])
	}
	// email must not be present.
	if _, has := entry["email"]; has {
		t.Errorf("identities[0] must not expose email, got %v", entry)
	}
	// provider_id must not be present.
	if _, has := entry["provider_id"]; has {
		t.Errorf("identities[0] must not expose provider_id, got %v", entry)
	}

	// Public profile must not include identities.
	_, pub := e.req(t, "GET", fmt.Sprintf("/api/users/%d", u.ID), nil, nil)
	if _, has := pub["identities"]; has {
		t.Errorf("public profile must not expose identities, got %v", pub)
	}
}

func TestBrowseRateLimit(t *testing.T) {
	e := newEnv(t)
	var last int
	for range 12 {
		resp, _ := e.req(t, "GET", "/api/games", nil, nil)
		last = resp.StatusCode
	}
	if last != http.StatusTooManyRequests {
		t.Errorf("12th browse = %d, want 429 (per-IP burst exhausted)", last)
	}
}
