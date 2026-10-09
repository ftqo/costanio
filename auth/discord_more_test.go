package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ftqo/costan.io/store"
)

// activityReq posts a JSON body to the Activity token endpoint, optionally
// authenticated as a guest via context.
func activityReq(body string, u *store.User) *http.Request {
	req := httptest.NewRequest(http.MethodPost, "/auth/activity/token", strings.NewReader(body))
	if u != nil {
		req = authedReq(http.MethodPost, "/auth/activity/token", body, u)
	}
	return req
}

// HandleActivityToken.

func TestActivityTokenBadBody(t *testing.T) {
	svc := newTestService(t)
	for _, tc := range []struct{ name, body string }{
		{"not-json", "{not json"},
		{"missing-code", `{"instance_id":"i1"}`},
		{"empty-code", `{"code":""}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			svc.HandleActivityToken(rec, activityReq(tc.body, nil))
			if rec.Code != http.StatusBadRequest {
				t.Errorf("status = %d, want 400 for %s", rec.Code, tc.name)
			}
		})
	}
}

func TestActivityTokenSuccess(t *testing.T) {
	svc := newTestService(t)
	fake := fakeDiscord(t, "disc-act", "ActUser")
	svc.Config = discordConfig(fake)

	rec := httptest.NewRecorder()
	svc.HandleActivityToken(rec, activityReq(`{"code":"c1","instance_id":"i1"}`, nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q", ct)
	}
	var out struct {
		AccessToken  string `json:"access_token"`
		SessionToken string `json:"session_token"`
		User         struct {
			ID    int64  `json:"id"`
			Name  string `json:"name"`
			Guest bool   `json:"guest"`
		} `json:"user"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if out.AccessToken != "tok-abc" {
		t.Errorf("access_token = %q, want tok-abc", out.AccessToken)
	}
	if out.SessionToken == "" {
		t.Error("session_token must be returned as a bearer credential")
	}
	if out.User.Name != "ActUser" || out.User.Guest {
		t.Errorf("user = %+v, want registered ActUser", out.User)
	}
	// The session token must be usable to resolve the user (bearer path).
	if u, err := svc.Store.UserBySession(out.SessionToken); err != nil || u.ID != out.User.ID {
		t.Errorf("session_token does not resolve to user: %v %+v", err, u)
	}
	// A harmless cookie is also set.
	var cookieSet bool
	for _, c := range rec.Result().Cookies() {
		if c.Name == cookieName && c.Value != "" {
			cookieSet = true
		}
	}
	if !cookieSet {
		t.Error("activity token should also set the session cookie")
	}
}

// The Discord Activity login path must also re-pull role status, so /setrole
// takes effect for users who enter via the Embedded App SDK, not just the web
// OAuth callback.
func TestActivityTokenSyncsRoles(t *testing.T) {
	svc := newTestService(t)
	fake := fakeDiscord(t, "disc-actsync", "ActSync")
	svc.Config = discordConfig(fake)
	got := make(chan int64, 1)
	svc.SetRoleSync(func(ctx context.Context, userID int64) error { got <- userID; return nil })

	rec := httptest.NewRecorder()
	svc.HandleActivityToken(rec, activityReq(`{"code":"c1","instance_id":"i1"}`, nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body)
	}
	u, err := svc.Store.UserByProvider("discord", "disc-actsync")
	if err != nil {
		t.Fatalf("user not registered: %v", err)
	}
	select {
	case id := <-got:
		if id != u.ID {
			t.Fatalf("role sync ran for user %d, want resolved user %d", id, u.ID)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("activity login did not trigger a role sync")
	}
}

func TestActivityTokenMergesGuest(t *testing.T) {
	svc := newTestService(t)
	fake := fakeDiscord(t, "disc-actmerge", "Merged")
	svc.Config = discordConfig(fake)

	guest, _ := svc.Store.CreateGuest("g")
	rec := httptest.NewRecorder()
	svc.HandleActivityToken(rec, activityReq(`{"code":"c1"}`, guest))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body)
	}
	u, err := svc.Store.UserByID(guest.ID)
	if err != nil {
		t.Fatal(err)
	}
	if u.IsGuest || u.DiscordID != "disc-actmerge" {
		t.Errorf("guest not merged via activity token: %+v", u)
	}
}

func TestActivityTokenExchangeFails(t *testing.T) {
	svc := newTestService(t)
	// TokenURL points at a server returning 500, so exchange() fails.
	bad := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "boom", http.StatusInternalServerError)
	}))
	t.Cleanup(bad.Close)
	svc.Config = Config{ClientID: "cid", ClientSecret: "sec", TokenURL: bad.URL, BaseURL: "https://costan.test"}

	rec := httptest.NewRecorder()
	svc.HandleActivityToken(rec, activityReq(`{"code":"c1"}`, nil))
	if rec.Code != http.StatusBadGateway {
		t.Errorf("status = %d, want 502 when exchange fails", rec.Code)
	}
}

func TestActivityTokenSessionFails(t *testing.T) {
	svc := newTestService(t)
	fake := fakeDiscord(t, "disc-act", "ActUser")
	svc.Config = discordConfig(fake)
	svc.Store.Close() // exchange uses external fake; CreateSession will fail

	rec := httptest.NewRecorder()
	svc.HandleActivityToken(rec, activityReq(`{"code":"c1"}`, nil))
	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want 500 when session/upsert fails", rec.Code)
	}
}

// HandleAuthCallback remaining branches.

func TestCallbackMissingCode(t *testing.T) {
	svc := newTestService(t)
	svc.Config = Config{ClientID: "cid", BaseURL: "https://costan.test"}
	// Valid state, but no code param.
	req := httptest.NewRequest(http.MethodGet, "/auth/discord/callback?state=login:st", nil)
	req.SetPathValue("provider", "discord")
	req.AddCookie(&http.Cookie{Name: stateCookie, Value: "login:st"})
	rec := httptest.NewRecorder()
	svc.HandleAuthCallback(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400 for missing code", rec.Code)
	}
}

func TestCallbackExchangeFails(t *testing.T) {
	svc := newTestService(t)
	bad := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "boom", http.StatusInternalServerError)
	}))
	t.Cleanup(bad.Close)
	svc.Config = Config{ClientID: "cid", ClientSecret: "sec", TokenURL: bad.URL, BaseURL: "https://costan.test"}

	rec := httptest.NewRecorder()
	svc.HandleAuthCallback(rec, callbackReq("login:st", "code", "login:st"))
	if rec.Code != http.StatusBadGateway {
		t.Errorf("status = %d, want 502 when exchange fails", rec.Code)
	}
}

func TestCallbackUpsertFails(t *testing.T) {
	svc := newTestService(t)
	fake := fakeDiscord(t, "disc-up", "U")
	svc.Config = discordConfig(fake)
	svc.Store.Close() // UpsertUser fails after a successful exchange

	rec := httptest.NewRecorder()
	svc.HandleAuthCallback(rec, callbackReq("login:st", "code", "login:st"))
	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want 500 when upsert fails", rec.Code)
	}
}

func TestCallbackMergeFails(t *testing.T) {
	svc := newTestService(t)
	fake := fakeDiscord(t, "disc-mf", "U")
	svc.Config = discordConfig(fake)

	guest, _ := svc.Store.CreateGuest("g")
	guestTok, _ := svc.Store.CreateSession(guest.ID)
	svc.Store.Close() // MergeGuestIntoProvider fails

	req := callbackReq("login:st", "code", "login:st")
	req.AddCookie(&http.Cookie{Name: cookieName, Value: guestTok})
	rec := httptest.NewRecorder()
	// Manually seed the guest into context since the store is closed (middleware
	// cannot resolve the session post-close).
	req = authedReq(http.MethodGet, req.URL.String(), "", &store.User{ID: guest.ID, IsGuest: true})
	req.SetPathValue("provider", "discord")
	req.AddCookie(&http.Cookie{Name: stateCookie, Value: "login:st"})
	svc.HandleAuthCallback(rec, req)
	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want 500 when merge fails", rec.Code)
	}
}

func TestCallbackMissingStateCookie(t *testing.T) {
	svc := newTestService(t)
	svc.Config = Config{ClientID: "cid", BaseURL: "https://costan.test"}
	// state query present but no state cookie at all.
	req := httptest.NewRequest(http.MethodGet, "/auth/discord/callback?state=login:st&code=c", nil)
	req.SetPathValue("provider", "discord")
	rec := httptest.NewRecorder()
	svc.HandleAuthCallback(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400 when state cookie missing", rec.Code)
	}
}

// exchange() non-200 / empty-id branches.

func TestExchangeTokenEndpointError(t *testing.T) {
	svc := newTestService(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "denied", http.StatusForbidden)
	}))
	t.Cleanup(srv.Close)
	cfg := Config{ClientID: "c", ClientSecret: "s", TokenURL: srv.URL}.withDefaults()

	if _, _, err := svc.exchange(t.Context(), cfg, "code", ""); err == nil {
		t.Error("exchange should error on non-200 token endpoint")
	}
}

func TestExchangeIdentifyEndpointError(t *testing.T) {
	svc := newTestService(t)
	mux := http.NewServeMux()
	mux.HandleFunc("/token", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"access_token": "tok-abc"})
	})
	mux.HandleFunc("/identify", func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "nope", http.StatusUnauthorized)
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	cfg := Config{TokenURL: srv.URL + "/token", IdentifyURL: srv.URL + "/identify"}.withDefaults()

	if _, _, err := svc.exchange(t.Context(), cfg, "code", ""); err == nil {
		t.Error("exchange should error on non-200 identify endpoint")
	}
}

func TestExchangeEmptyIdentity(t *testing.T) {
	svc := newTestService(t)
	mux := http.NewServeMux()
	mux.HandleFunc("/token", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"access_token": "tok-abc"})
	})
	mux.HandleFunc("/identify", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"id": "", "username": "x"})
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	cfg := Config{TokenURL: srv.URL + "/token", IdentifyURL: srv.URL + "/identify"}.withDefaults()

	if _, _, err := svc.exchange(t.Context(), cfg, "code", ""); err == nil {
		t.Error("exchange should error when identify returns an empty id")
	}
}

func TestExchangeOmitsRedirectURIWhenEmpty(t *testing.T) {
	svc := newTestService(t)
	var sawRedirect bool
	mux := http.NewServeMux()
	mux.HandleFunc("/token", func(w http.ResponseWriter, r *http.Request) {
		r.ParseForm()
		_, sawRedirect = r.Form["redirect_uri"]
		json.NewEncoder(w).Encode(map[string]string{"access_token": "tok-abc"})
	})
	mux.HandleFunc("/identify", func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]string{"id": "x", "username": "n"})
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	cfg := Config{TokenURL: srv.URL + "/token", IdentifyURL: srv.URL + "/identify"}.withDefaults()

	if _, _, err := svc.exchange(t.Context(), cfg, "code", ""); err != nil {
		t.Fatalf("exchange: %v", err)
	}
	if sawRedirect {
		t.Error("redirect_uri must be omitted from the Activity (empty redirectURI) grant")
	}
}
