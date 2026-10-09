package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ftqo/costan.io/store"
)

func newAuthTest(t *testing.T) *Service {
	st, err := store.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	return &Service{Store: st, Config: Config{BaseURL: "http://localhost"}}
}

// callbackWith drives HandleAuthCallback with a matching state cookie.
func callbackWith(t *testing.T, s *Service, provider, state string, cur *store.User) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodGet, "/auth/"+provider+"/callback?code=abc&state="+state, nil)
	r.SetPathValue("provider", provider)
	r.AddCookie(&http.Cookie{Name: stateCookie, Value: state})
	if cur != nil {
		r = r.WithContext(context.WithValue(r.Context(), ctxKey{}, cur))
	}
	w := httptest.NewRecorder()
	s.HandleAuthCallback(w, r)
	return w
}

func TestCallbackRegistersNewUser(t *testing.T) {
	s := newAuthTest(t)
	s.testProviders = map[string]Provider{"fake": fakeProvider{id: Identity{ProviderID: "f-1", Name: "Fay"}}}
	w := callbackWith(t, s, "fake", "login:abc", nil)
	if w.Code != http.StatusFound {
		t.Fatalf("status = %d, want 302", w.Code)
	}
	if _, err := s.Store.UserByProvider("fake", "f-1"); err != nil {
		t.Fatalf("user not registered: %v", err)
	}
}

// A successful login must re-pull the user's Discord-role-derived status, so a
// role granted via /setrole (or removed) takes effect on next login. The hook is
// fired in the background with the resolved user id.
func TestCallbackSyncsRolesForResolvedUser(t *testing.T) {
	s := newAuthTest(t)
	s.testProviders = map[string]Provider{"fake": fakeProvider{id: Identity{ProviderID: "f-1", Name: "Fay"}}}
	got := make(chan int64, 1)
	s.SetRoleSync(func(ctx context.Context, userID int64) error { got <- userID; return nil })

	w := callbackWith(t, s, "fake", "login:abc", nil)
	if w.Code != http.StatusFound {
		t.Fatalf("status = %d, want 302", w.Code)
	}
	u, err := s.Store.UserByProvider("fake", "f-1")
	if err != nil {
		t.Fatalf("user not registered: %v", err)
	}
	select {
	case id := <-got:
		if id != u.ID {
			t.Fatalf("role sync ran for user %d, want the resolved user %d", id, u.ID)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("login did not trigger a role sync for the resolved user")
	}
}

func TestCallbackLinksToCurrentUser(t *testing.T) {
	s := newAuthTest(t)
	u, _ := s.Store.UpsertDiscordUser("disc-1", "Alice", "")
	s.testProviders = map[string]Provider{"fake": fakeProvider{id: Identity{ProviderID: "f-1", Name: "Fay"}}}
	w := callbackWith(t, s, "fake", "link:abc", u)
	if w.Code != http.StatusFound {
		t.Fatalf("status = %d, want 302", w.Code)
	}
	got, err := s.Store.UserByProvider("fake", "f-1")
	if err != nil || got.ID != u.ID {
		t.Fatalf("identity not linked to current user: %v", err)
	}
}

// A guest reaching the link callback is rejected before LinkIdentity (writing
// the identity onto its row would set up a self-merge that deletes the
// account). The handler redirects to /login.
func TestCallbackLinkRejectsGuest(t *testing.T) {
	s := newAuthTest(t)
	guest, _ := s.Store.CreateGuest("")
	s.testProviders = map[string]Provider{"fake": fakeProvider{id: Identity{ProviderID: "f-1", Name: "Fay"}}}
	w := callbackWith(t, s, "fake", "link:abc", guest)
	if w.Code != http.StatusFound {
		t.Fatalf("status = %d, want 302 redirect for guest link callback", w.Code)
	}
	if loc := w.Header().Get("Location"); loc != "/login" {
		t.Fatalf("Location = %q, want /login for guest link callback", loc)
	}
	// No identity may have been written.
	if _, err := s.Store.UserByProvider("fake", "f-1"); err == nil {
		t.Fatalf("identity was written for a guest link, must be none")
	}
	if ids, _ := s.Store.IdentitiesForUser(guest.ID); len(ids) != 0 {
		t.Fatalf("guest gained identities = %+v, want none", ids)
	}
}

// TestCallbackLinkConflict verifies that when the linking provider identity is
// already taken by another account, the callback redirects to /profile?merge=…
// so the SPA can offer the user an account-merge flow.
func TestCallbackLinkConflict(t *testing.T) {
	s := newAuthTest(t)
	u, _ := s.Store.UpsertDiscordUser("disc-1", "Alice", "")
	other, _ := s.Store.UpsertUser("fake", "f-1", "Other", "", "")
	_ = other
	s.testProviders = map[string]Provider{"fake": fakeProvider{id: Identity{ProviderID: "f-1", Name: "Fay"}}}
	w := callbackWith(t, s, "fake", "link:abc", u)
	// ErrIdentityTaken mints a merge token and redirects into the SPA.
	if w.Code != http.StatusFound {
		t.Fatalf("status = %d, want 302 redirect with merge token", w.Code)
	}
	loc := w.Header().Get("Location")
	if !strings.HasPrefix(loc, "/profile?merge=") {
		t.Fatalf("Location = %q, want /profile?merge=…", loc)
	}
}

func TestHandleUnlink(t *testing.T) {
	s := newAuthTest(t)
	u, _ := s.Store.UpsertDiscordUser("disc-1", "Alice", "")
	_ = s.Store.LinkIdentity(u.ID, store.Identity{Provider: "google", ProviderID: "g-1"})

	do := func(provider string) int {
		r := httptest.NewRequest(http.MethodDelete, "/api/users/me/identities/"+provider, nil)
		r.SetPathValue("provider", provider)
		r = r.WithContext(context.WithValue(r.Context(), ctxKey{}, u))
		w := httptest.NewRecorder()
		s.HandleUnlink(w, r)
		return w.Code
	}
	if code := do("google"); code != http.StatusNoContent {
		t.Fatalf("unlink google = %d, want 204", code)
	}
	if code := do("discord"); code != http.StatusConflict {
		t.Fatalf("unlink last = %d, want 409", code)
	}
}
