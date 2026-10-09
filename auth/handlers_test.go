package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ftqo/costan.io/store"
)

// authedReq builds a request whose context already carries u, simulating a
// request that has passed through Middleware with a valid session.
func authedReq(method, target string, body string, u *store.User) *http.Request {
	var req *http.Request
	if body == "" {
		req = httptest.NewRequest(method, target, nil)
	} else {
		req = httptest.NewRequest(method, target, strings.NewReader(body))
	}
	if u != nil {
		req = req.WithContext(context.WithValue(req.Context(), ctxKey{}, u))
	}
	return req
}

// RequireUser.

func TestRequireUserRejectsAnon(t *testing.T) {
	called := false
	h := RequireUser(func(w http.ResponseWriter, r *http.Request) { called = true })

	rec := httptest.NewRecorder()
	h(rec, httptest.NewRequest(http.MethodGet, "/protected", nil))

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", rec.Code)
	}
	if called {
		t.Error("wrapped handler must not run for anon request")
	}
	if !strings.Contains(rec.Body.String(), "UNAUTHENTICATED") {
		t.Errorf("body = %s, want UNAUTHENTICATED code", rec.Body)
	}
}

func TestRequireUserAllowsAuthed(t *testing.T) {
	called := false
	h := RequireUser(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})

	rec := httptest.NewRecorder()
	h(rec, authedReq(http.MethodGet, "/protected", "", &store.User{ID: 7}))

	if !called {
		t.Error("wrapped handler must run for authed request")
	}
	if rec.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", rec.Code)
	}
}

// Middleware: bearer token + invalid token.

func TestMiddlewareResolvesBearerToken(t *testing.T) {
	svc := newTestService(t)
	u, _ := svc.Store.UpsertDiscordUser("disc-bearer", "Hdr", "")
	tok, _ := svc.Store.CreateSession(u.ID)

	req := httptest.NewRequest(http.MethodGet, "/whoami", nil)
	req.Header.Set("Authorization", "Bearer "+tok)

	var got *store.User
	svc.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = UserFrom(r.Context())
	})).ServeHTTP(httptest.NewRecorder(), req)

	if got == nil || got.ID != u.ID {
		t.Fatalf("middleware user = %+v, want id %d via bearer header", got, u.ID)
	}
}

func TestMiddlewareIgnoresInvalidToken(t *testing.T) {
	svc := newTestService(t)

	// Both a bogus cookie and a bogus bearer header must leave the request anon.
	for _, tc := range []struct {
		name string
		set  func(*http.Request)
	}{
		{"cookie", func(r *http.Request) { r.AddCookie(&http.Cookie{Name: cookieName, Value: "nope"}) }},
		{"bearer", func(r *http.Request) { r.Header.Set("Authorization", "Bearer nope") }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/whoami", nil)
			tc.set(req)
			var got *store.User
			svc.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				got = UserFrom(r.Context())
			})).ServeHTTP(httptest.NewRecorder(), req)
			if got != nil {
				t.Errorf("invalid %s token should leave request anon, got %+v", tc.name, got)
			}
		})
	}
}

func TestUserFromEmptyContext(t *testing.T) {
	if u := UserFrom(context.Background()); u != nil {
		t.Errorf("UserFrom(empty) = %+v, want nil", u)
	}
}

// HandleGuest error branches.

func TestHandleGuestStoreFailure(t *testing.T) {
	svc := newTestService(t)
	svc.Store.Close() // CreateGuest now fails

	rec := httptest.NewRecorder()
	svc.HandleGuest(rec, httptest.NewRequest(http.MethodPost, "/auth/guest", nil))

	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want 500 when guest creation fails", rec.Code)
	}
}

func TestHandleGuestReturnsJSON(t *testing.T) {
	svc := newTestService(t)
	rec := httptest.NewRecorder()
	svc.HandleGuest(rec, httptest.NewRequest(http.MethodPost, "/auth/guest", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", ct)
	}
	var out struct {
		ID    int64 `json:"id"`
		Guest bool  `json:"guest"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if out.ID == 0 || !out.Guest {
		t.Errorf("guest payload = %+v, want non-zero id and guest=true", out)
	}
}

// HandleDevLogin / devAuthEnabled.

func TestDevLoginDisabledByDefault(t *testing.T) {
	svc := newTestService(t) // DevAuth false
	rec := httptest.NewRecorder()
	svc.HandleDevLogin(rec, httptest.NewRequest(http.MethodGet, "/auth/dev", nil))
	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404 when DevAuth off", rec.Code)
	}
}

func TestDevLoginForceDisabledOnSecureCookie(t *testing.T) {
	// A secure (TLS) deployment overrides the DevAuth opt-in.
	for _, tc := range []struct {
		name   string
		secure bool
		base   string
	}{
		{"explicit-secure-flag", true, "http://localhost"},
		{"https-base-url", false, "https://costan.test"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			svc := newTestService(t)
			svc.DevAuth = true
			svc.Secure = tc.secure
			svc.Config = Config{BaseURL: tc.base}

			if svc.devAuthEnabled() {
				t.Fatal("devAuthEnabled() must be false on a secure deployment")
			}
			rec := httptest.NewRecorder()
			svc.HandleDevLogin(rec, httptest.NewRequest(http.MethodGet, "/auth/dev", nil))
			if rec.Code != http.StatusNotFound {
				t.Errorf("status = %d, want 404 (dev login invisible on TLS)", rec.Code)
			}
		})
	}
}

func TestDevLoginSuccess(t *testing.T) {
	svc := newTestService(t)
	svc.DevAuth = true
	svc.Config = Config{BaseURL: "http://localhost:9091"} // plain http -> not secure

	if !svc.devAuthEnabled() {
		t.Fatal("devAuthEnabled() should be true for opt-in + http")
	}

	rec := httptest.NewRecorder()
	svc.Middleware(http.HandlerFunc(svc.HandleDevLogin)).
		ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/auth/dev", nil))

	if rec.Code != http.StatusFound {
		t.Fatalf("status = %d, want 302 redirect, body = %s", rec.Code, rec.Body)
	}
	if loc := rec.Header().Get("Location"); loc != "/" {
		t.Errorf("redirect Location = %q, want /", loc)
	}
	// A registered (non-guest) account is minted and a session cookie set.
	var sessionTok string
	for _, c := range rec.Result().Cookies() {
		if c.Name == cookieName {
			sessionTok = c.Value
		}
	}
	if sessionTok == "" {
		t.Fatal("dev login must set a session cookie")
	}
	u, err := svc.Store.UserBySession(sessionTok)
	if err != nil {
		t.Fatalf("session not resolvable: %v", err)
	}
	if u.IsGuest || u.DiscordID != "dev-tester" {
		t.Errorf("dev user = %+v, want registered dev-tester", u)
	}

	// Repeated dev logins reuse the same stable account.
	rec2 := httptest.NewRecorder()
	svc.Middleware(http.HandlerFunc(svc.HandleDevLogin)).
		ServeHTTP(rec2, httptest.NewRequest(http.MethodGet, "/auth/dev", nil))
	var tok2 string
	for _, c := range rec2.Result().Cookies() {
		if c.Name == cookieName {
			tok2 = c.Value
		}
	}
	u2, _ := svc.Store.UserBySession(tok2)
	if u2 == nil || u2.ID != u.ID {
		t.Errorf("dev login should reuse account id %d, got %+v", u.ID, u2)
	}
}

func TestDevLoginAlreadyAuthedRedirects(t *testing.T) {
	svc := newTestService(t)
	svc.DevAuth = true
	svc.Config = Config{BaseURL: "http://localhost:9091"}

	rec := httptest.NewRecorder()
	req := authedReq(http.MethodGet, "/auth/dev", "", &store.User{ID: 99})
	svc.HandleDevLogin(rec, req)

	if rec.Code != http.StatusFound {
		t.Fatalf("status = %d, want 302", rec.Code)
	}
	if loc := rec.Header().Get("Location"); loc != "/" {
		t.Errorf("Location = %q, want /", loc)
	}
	// Already authed: must not mint a new session.
	for _, c := range rec.Result().Cookies() {
		if c.Name == cookieName {
			t.Errorf("must not set a session cookie when already authed: %+v", c)
		}
	}
}

func TestDevLoginStoreFailure(t *testing.T) {
	svc := newTestService(t)
	svc.DevAuth = true
	svc.Config = Config{BaseURL: "http://localhost:9091"}
	svc.Store.Close() // UpsertDiscordUser now fails

	rec := httptest.NewRecorder()
	svc.HandleDevLogin(rec, httptest.NewRequest(http.MethodGet, "/auth/dev", nil))

	if rec.Code != http.StatusInternalServerError {
		t.Errorf("status = %d, want 500 when dev user upsert fails", rec.Code)
	}
}

// HandleLogout no-cookie path.

func TestLogoutNoCookieStillClears(t *testing.T) {
	svc := newTestService(t)
	rec := httptest.NewRecorder()
	svc.HandleLogout(rec, httptest.NewRequest(http.MethodPost, "/auth/logout", nil))

	if rec.Code != http.StatusNoContent {
		t.Errorf("status = %d, want 204 even without a session cookie", rec.Code)
	}
	// The clearing cookie (MaxAge<0) is still emitted.
	var cleared bool
	for _, c := range rec.Result().Cookies() {
		if c.Name == cookieName && c.MaxAge < 0 {
			cleared = true
		}
	}
	if !cleared {
		t.Error("logout must emit a clearing session cookie")
	}
}
