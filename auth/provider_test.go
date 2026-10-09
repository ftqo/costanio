package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/ftqo/costan.io/store"
)

type fakeProvider struct{ id Identity }

func (f fakeProvider) Name() string { return "fake" }
func (f fakeProvider) AuthCodeURL(state, redirect, codeChallenge string) string {
	return "https://fake/auth?state=" + state
}
func (f fakeProvider) Exchange(ctx context.Context, code, redirect, codeVerifier string) (Identity, PostLogin, error) {
	return f.id, nil, nil
}

func TestRedirectURI(t *testing.T) {
	s := &Service{Config: Config{BaseURL: "https://costan.io/"}}
	if got := s.redirectURI("google"); got != "https://costan.io/auth/google/callback" {
		t.Fatalf("redirectURI = %q", got)
	}
}

func TestProviderResolvesDiscord(t *testing.T) {
	s := &Service{Config: Config{ClientID: "x", ClientSecret: "y", BaseURL: "https://costan.io"}}
	if p := s.provider("discord"); p == nil || p.Name() != "discord" {
		t.Fatalf("discord provider not resolved: %v", p)
	}
	if p := s.provider("nope"); p != nil {
		t.Fatalf("unknown provider should be nil")
	}
}

func TestHandleAuthStartLinkRequiresLogin(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	s := &Service{Store: st, Config: Config{BaseURL: "http://localhost"}}
	s.testProviders = map[string]Provider{"fake": fakeProvider{id: Identity{ProviderID: "f-1", Name: "Fay"}}}

	r := httptest.NewRequest(http.MethodGet, "/auth/fake/link", nil)
	r.SetPathValue("provider", "fake")
	// No authenticated user in context: ctxKey is absent.
	w := httptest.NewRecorder()
	s.HandleAuthStart(w, r)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
}

// A guest may not start the link flow: linking would attach an identity to the
// is_guest=1 row and a later self-merge would delete the account. Guests
// promote via the normal /auth/{provider} flow.
func TestHandleAuthStartLinkRejectsGuest(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	s := &Service{Store: st, Config: Config{BaseURL: "http://localhost"}}
	s.testProviders = map[string]Provider{"fake": fakeProvider{id: Identity{ProviderID: "f-1", Name: "Fay"}}}

	guest, _ := st.CreateGuest("")
	r := httptest.NewRequest(http.MethodGet, "/auth/fake/link", nil)
	r.SetPathValue("provider", "fake")
	r = r.WithContext(context.WithValue(r.Context(), ctxKey{}, guest))
	w := httptest.NewRecorder()
	s.HandleAuthStart(w, r)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401 for guest link", w.Code)
	}
	// And no identity row may have been written for the guest.
	if ids, _ := st.IdentitiesForUser(guest.ID); len(ids) != 0 {
		t.Fatalf("guest gained identities = %+v, want none", ids)
	}
}
