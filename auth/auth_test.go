package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ftqo/costan.io/store"
)

func newTestService(t *testing.T) *Service {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	return &Service{Store: st}
}

// fakeDiscord stubs Discord's token, identify, and relationships endpoints.
func fakeDiscord(t *testing.T, id, username string, friendIDs ...string) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/token", func(w http.ResponseWriter, r *http.Request) {
		if r.FormValue("grant_type") != "authorization_code" || r.FormValue("code") == "" {
			http.Error(w, "bad request", http.StatusBadRequest)
			return
		}
		json.NewEncoder(w).Encode(map[string]string{"access_token": "tok-abc"})
	})
	mux.HandleFunc("/identify", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer tok-abc" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		json.NewEncoder(w).Encode(map[string]string{"id": id, "username": username, "avatar": "av"})
	})
	mux.HandleFunc("/relationships", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer tok-abc" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		rels := make([]map[string]any, 0, len(friendIDs))
		for _, fid := range friendIDs {
			rels = append(rels, map[string]any{"type": 1, "user": map[string]any{"id": fid}})
		}
		// A non-friend relationship (blocked) that must be ignored.
		rels = append(rels, map[string]any{"type": 2, "user": map[string]any{"id": "blocked1"}})
		json.NewEncoder(w).Encode(rels)
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

func discordConfig(fake *httptest.Server) Config {
	return Config{
		ClientID: "cid", ClientSecret: "sec",
		TokenURL:         fake.URL + "/token",
		IdentifyURL:      fake.URL + "/identify",
		RelationshipsURL: fake.URL + "/relationships",
		BaseURL:          "https://costan.test",
	}
}

func TestAnonGuestFlow(t *testing.T) {
	svc := newTestService(t)

	// No body, no name: the anonymous guest is minted silently (no login prompt).
	req := httptest.NewRequest(http.MethodPost, "/auth/guest", nil)
	rec := httptest.NewRecorder()
	svc.Middleware(http.HandlerFunc(svc.HandleGuest)).ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body)
	}
	var cookie *http.Cookie
	for _, c := range rec.Result().Cookies() {
		if c.Name == cookieName {
			cookie = c
		}
	}
	if cookie == nil || !cookie.HttpOnly {
		t.Fatalf("missing HttpOnly session cookie: %+v", cookie)
	}

	// Cookie resolves to a nameless guest via middleware.
	req2 := httptest.NewRequest(http.MethodGet, "/whoami", nil)
	req2.AddCookie(cookie)
	var got *store.User
	svc.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = UserFrom(r.Context())
	})).ServeHTTP(httptest.NewRecorder(), req2)
	if got == nil || got.Name != "" || !got.IsGuest {
		t.Errorf("middleware user = %+v, want a nameless guest", got)
	}
}

func TestAnonGuestAlreadyAuthed(t *testing.T) {
	svc := newTestService(t)
	u, _ := svc.Store.CreateGuest("")
	tok, _ := svc.Store.CreateSession(u.ID)

	req := httptest.NewRequest(http.MethodPost, "/auth/guest", nil)
	req.AddCookie(&http.Cookie{Name: cookieName, Value: tok})
	rec := httptest.NewRecorder()
	svc.Middleware(http.HandlerFunc(svc.HandleGuest)).ServeHTTP(rec, req)

	if rec.Code != http.StatusConflict {
		t.Errorf("status = %d, want 409 when already authed", rec.Code)
	}
}

func TestDiscordRedirect(t *testing.T) {
	svc := newTestService(t)
	svc.Config = Config{ClientID: "cid", AuthorizeURL: "https://example.test/authorize", BaseURL: "https://costan.test"}

	req := httptest.NewRequest(http.MethodGet, "/auth/discord", nil)
	req.SetPathValue("provider", "discord")
	rec := httptest.NewRecorder()
	svc.HandleAuthStart(rec, req)

	if rec.Code != http.StatusFound {
		t.Fatalf("status = %d", rec.Code)
	}
	loc, _ := url.Parse(rec.Header().Get("Location"))
	if loc.Host != "example.test" || loc.Query().Get("client_id") != "cid" ||
		loc.Query().Get("scope") != "identify" || loc.Query().Get("state") == "" {
		t.Errorf("redirect = %s", loc)
	}
	if loc.Query().Get("redirect_uri") != "https://costan.test/auth/discord/callback" {
		t.Errorf("redirect_uri = %s", loc.Query().Get("redirect_uri"))
	}
}

// callbackReq builds a callback request for the generic handler with state cookie and path value.
func callbackReq(state, code string, stateCookieVal string) *http.Request {
	req := httptest.NewRequest(http.MethodGet, "/auth/discord/callback?state="+state+"&code="+code, nil)
	req.SetPathValue("provider", "discord")
	if stateCookieVal != "" {
		req.AddCookie(&http.Cookie{Name: stateCookie, Value: stateCookieVal})
	}
	return req
}

func TestDiscordCallback(t *testing.T) {
	svc := newTestService(t)
	fake := fakeDiscord(t, "disc42", "Bob")
	svc.Config = discordConfig(fake)

	rec := httptest.NewRecorder()
	svc.Middleware(http.HandlerFunc(svc.HandleAuthCallback)).ServeHTTP(rec, callbackReq("login:st1", "code1", "login:st1"))

	if rec.Code != http.StatusFound {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body)
	}
	u, err := svc.Store.UpsertDiscordUser("disc42", "Bob", "av")
	if err != nil || u.IsGuest {
		t.Fatalf("user not created: %v %+v", err, u)
	}
	var sessionSet bool
	for _, c := range rec.Result().Cookies() {
		if c.Name == cookieName && c.Value != "" {
			sessionSet = true
		}
	}
	if !sessionSet {
		t.Error("no session cookie set")
	}
}

func TestDevLoginGrantsAllCosmetics(t *testing.T) {
	svc := newTestService(t)
	svc.DevAuth = true // local dev only; lets the tester use any color/effect

	rec := httptest.NewRecorder()
	svc.HandleDevLogin(rec, httptest.NewRequest(http.MethodGet, "/auth/dev", nil))
	if rec.Code != http.StatusFound {
		t.Fatalf("dev login status = %d, body=%s", rec.Code, rec.Body)
	}

	u, err := svc.Store.UpsertDiscordUser("dev-tester", "Tester", "")
	if err != nil {
		t.Fatal(err)
	}
	sup, err := svc.Store.Supporter(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !sup.Active || !sup.Boosting {
		t.Fatalf("dev user supporter = %+v; want active+boosting (all cosmetics unlocked)", sup)
	}
	// And a Pip balance so the tester can buy purchasable cosmetics.
	bal, err := svc.Store.Balance(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if bal <= 0 {
		t.Fatalf("dev user Pip balance = %d; want a positive testing stipend", bal)
	}
}

func TestDiscordCallbackBadState(t *testing.T) {
	svc := newTestService(t)
	svc.Config = Config{ClientID: "cid", BaseURL: "https://costan.test"}
	rec := httptest.NewRecorder()
	svc.HandleAuthCallback(rec, callbackReq("login:evil", "code1", "login:good"))
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", rec.Code)
	}
}

func TestDiscordCallbackMergesGuest(t *testing.T) {
	svc := newTestService(t)
	fake := fakeDiscord(t, "disc77", "Ann")
	svc.Config = discordConfig(fake)

	guest, _ := svc.Store.CreateGuest("ann")
	guestTok, _ := svc.Store.CreateSession(guest.ID)

	req := callbackReq("login:st", "code", "login:st")
	req.AddCookie(&http.Cookie{Name: cookieName, Value: guestTok})
	rec := httptest.NewRecorder()
	svc.Middleware(http.HandlerFunc(svc.HandleAuthCallback)).ServeHTTP(rec, req)

	if rec.Code != http.StatusFound {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body)
	}
	u, err := svc.Store.UserByID(guest.ID)
	if err != nil {
		t.Fatal(err)
	}
	if u.IsGuest || u.DiscordID != "disc77" {
		t.Errorf("guest not merged: %+v", u)
	}
}

func TestDiscordCallbackCachesFriends(t *testing.T) {
	svc := newTestService(t)
	fake := fakeDiscord(t, "disc42", "Bob", "f1", "f2")
	cfg := discordConfig(fake)
	cfg.Scopes = []string{"identify", "relationships.read"} // opt into the friends feature
	svc.Config = cfg

	// f1 has a costan account, f2 does not.
	friend, _ := svc.Store.UpsertDiscordUser("f1", "Friend One", "")

	rec := httptest.NewRecorder()
	svc.Middleware(http.HandlerFunc(svc.HandleAuthCallback)).ServeHTTP(rec, callbackReq("login:st1", "code1", "login:st1"))
	if rec.Code != http.StatusFound {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body)
	}

	me, _ := svc.Store.UpsertDiscordUser("disc42", "Bob", "av")
	friends, err := svc.Store.FriendsWithAccounts(me.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(friends) != 1 || friends[0].ID != friend.ID {
		t.Errorf("friends = %+v, want just f1", friends)
	}
}

func TestDiscordCallbackFriendsFetchFailsSoft(t *testing.T) {
	svc := newTestService(t)
	fake := fakeDiscord(t, "disc42", "Bob")
	cfg := discordConfig(fake)
	cfg.Scopes = []string{"identify", "relationships.read"} // opt in, so the fetch path runs
	cfg.RelationshipsURL = fake.URL + "/missing"            // 404s: exercises the fail-soft path
	svc.Config = cfg

	rec := httptest.NewRecorder()
	svc.Middleware(http.HandlerFunc(svc.HandleAuthCallback)).ServeHTTP(rec, callbackReq("login:st1", "code1", "login:st1"))
	if rec.Code != http.StatusFound {
		t.Errorf("login must succeed despite friends failure, got %d", rec.Code)
	}
}

// The session cookie must be Secure when the server runs on https, even
// when the -secure-cookies flag (Service.Secure) is left at its false default.
func TestSessionCookieSecureFromHTTPSBaseURL(t *testing.T) {
	svc := newTestService(t)
	svc.Config = Config{BaseURL: "https://costan.test"}
	// Secure flag left at its false default.

	req := httptest.NewRequest(http.MethodPost, "/auth/guest", strings.NewReader(`{"name":"ann"}`))
	rec := httptest.NewRecorder()
	svc.HandleGuest(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body)
	}
	var cookie *http.Cookie
	for _, c := range rec.Result().Cookies() {
		if c.Name == cookieName {
			cookie = c
		}
	}
	if cookie == nil || !cookie.Secure {
		t.Fatalf("session cookie must be Secure for https BaseURL: %+v", cookie)
	}
}

// The OAuth state cookie must be Secure for an https BaseURL.
func TestStateCookieSecureFromHTTPSBaseURL(t *testing.T) {
	svc := newTestService(t)
	svc.Config = Config{ClientID: "cid", BaseURL: "https://costan.test"}

	req := httptest.NewRequest(http.MethodGet, "/auth/discord", nil)
	req.SetPathValue("provider", "discord")
	rec := httptest.NewRecorder()
	svc.HandleAuthStart(rec, req)

	var cookie *http.Cookie
	for _, c := range rec.Result().Cookies() {
		if c.Name == stateCookie {
			cookie = c
		}
	}
	if cookie == nil || !cookie.Secure {
		t.Fatalf("state cookie must be Secure for https BaseURL: %+v", cookie)
	}
}

// A plain-http BaseURL (local dev) must not force Secure, otherwise the
// browser drops the cookie and login breaks.
func TestCookieNotSecureForHTTPBaseURL(t *testing.T) {
	svc := newTestService(t)
	svc.Config = Config{BaseURL: "http://localhost:8080"}

	req := httptest.NewRequest(http.MethodPost, "/auth/guest", strings.NewReader(`{"name":"ann"}`))
	rec := httptest.NewRecorder()
	svc.HandleGuest(rec, req)
	for _, c := range rec.Result().Cookies() {
		if c.Name == cookieName && c.Secure {
			t.Fatalf("cookie must not be Secure for http BaseURL: %+v", c)
		}
	}
}

// A hung Discord token endpoint must not block the callback forever; the
// per-request context bounds the call. A canceled context must abort promptly.
func TestExchangeHonorsContext(t *testing.T) {
	released := make(chan struct{})
	mux := http.NewServeMux()
	mux.HandleFunc("/token", func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done(): // unblocks when the client cancels
		case <-released:
		}
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(func() { close(released); srv.Close() })

	svc := newTestService(t)
	cfg := Config{ClientID: "cid", ClientSecret: "sec", TokenURL: srv.URL + "/token", BaseURL: "https://costan.test"}.withDefaults()

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()

	done := make(chan error, 1)
	go func() {
		_, _, err := svc.exchange(ctx, cfg, "code", svc.redirectURI("discord"))
		done <- err
	}()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("exchange should error when context times out")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("exchange did not return after context cancellation")
	}
}

// A canceled request context must abort the friends fetch.
func TestFetchFriendsHonorsContext(t *testing.T) {
	released := make(chan struct{})
	mux := http.NewServeMux()
	mux.HandleFunc("/relationships", func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-released:
		}
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(func() { close(released); srv.Close() })

	cfg := Config{RelationshipsURL: srv.URL + "/relationships"}
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // already canceled

	done := make(chan error, 1)
	go func() {
		_, err := fetchFriendIDs(ctx, cfg, "tok")
		done <- err
	}()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("fetchFriendIDs should error on a canceled context")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("fetchFriendIDs did not honor canceled context")
	}
}

// If the server-side session delete fails, logout must report an error
// rather than a 204 that leaves the session valid.
func TestLogoutReportsDeleteError(t *testing.T) {
	svc := newTestService(t)
	u, _ := svc.Store.CreateGuest("ann")
	tok, _ := svc.Store.CreateSession(u.ID)
	// Close the store so DeleteSession fails.
	svc.Store.Close()

	req := httptest.NewRequest(http.MethodPost, "/auth/logout", nil)
	req.AddCookie(&http.Cookie{Name: cookieName, Value: tok})
	rec := httptest.NewRecorder()
	svc.HandleLogout(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want 500 when delete fails", rec.Code)
	}
}

func TestLogout(t *testing.T) {
	svc := newTestService(t)
	u, _ := svc.Store.CreateGuest("ann")
	tok, _ := svc.Store.CreateSession(u.ID)

	req := httptest.NewRequest(http.MethodPost, "/auth/logout", nil)
	req.AddCookie(&http.Cookie{Name: cookieName, Value: tok})
	rec := httptest.NewRecorder()
	svc.HandleLogout(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Errorf("status = %d", rec.Code)
	}
	if _, err := svc.Store.UserBySession(tok); err == nil {
		t.Error("session should be deleted")
	}
}
