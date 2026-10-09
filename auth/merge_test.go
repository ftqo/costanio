package auth

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ftqo/costan.io/store"
)

// newAuthTestService builds a Service backed by a real in-memory SQLite store.
// It mirrors newAuthTest / newTestService from the other test files.
func newAuthTestService(t *testing.T) (*Service, *store.Store) {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatalf("store.Open: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	svc := &Service{Store: st, Config: Config{BaseURL: "http://localhost"}}
	return svc, st
}

// mustUser creates a user via UpsertUser and fatals on error.
func mustUser(t *testing.T, st *store.Store, provider, providerID, name string) *store.User {
	t.Helper()
	u, err := st.UpsertUser(provider, providerID, name, "", "")
	if err != nil {
		t.Fatalf("UpsertUser(%s, %s, %s): %v", provider, providerID, name, err)
	}
	return u
}

func TestMergePreviewAndConfirm(t *testing.T) {
	svc, st := newAuthTestService(t)
	surv := mustUser(t, st, "discord", "D1", "Survivor")
	vic := mustUser(t, st, "google", "G2", "Victim")

	tok := svc.mintMergeToken(surv.ID, "google", "G2")

	// preview as survivor
	req := httptest.NewRequest(http.MethodGet, "/api/merge/preview?token="+url.QueryEscape(tok), nil)
	req = req.WithContext(context.WithValue(req.Context(), ctxKey{}, surv))
	rec := httptest.NewRecorder()
	svc.HandleMergePreview(rec, req)
	if rec.Code != 200 {
		t.Fatalf("preview code=%d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "Victim") {
		t.Fatalf("preview missing victim name: %s", rec.Body.String())
	}

	// confirm
	creq := httptest.NewRequest(http.MethodPost, "/api/merge", strings.NewReader(`{"token":"`+tok+`"}`))
	creq = creq.WithContext(context.WithValue(creq.Context(), ctxKey{}, surv))
	crec := httptest.NewRecorder()
	svc.HandleMergeConfirm(crec, creq)
	if crec.Code != http.StatusNoContent {
		t.Fatalf("confirm code=%d body=%s", crec.Code, crec.Body.String())
	}
	if _, err := st.UserByID(vic.ID); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("victim not deleted: %v", err)
	}
}

func TestMergePreviewRejectsForeignToken(t *testing.T) {
	svc, st := newAuthTestService(t)
	surv := mustUser(t, st, "discord", "D1", "S")
	other := mustUser(t, st, "google", "G2", "O")
	tok := svc.mintMergeToken(surv.ID, "google", "G2")
	// a *different* current user must not be able to use survivor's token
	req := httptest.NewRequest(http.MethodGet, "/api/merge/preview?token="+url.QueryEscape(tok), nil)
	req = req.WithContext(context.WithValue(req.Context(), ctxKey{}, other))
	rec := httptest.NewRecorder()
	svc.HandleMergePreview(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d", rec.Code)
	}
}

func TestMergeTokenRoundTrip(t *testing.T) {
	s := &Service{}
	tok := s.mintMergeToken(42, "discord", "D9")
	p, ok := s.parseMergeToken(tok)
	if !ok {
		t.Fatal("valid token rejected")
	}
	if p.Survivor != 42 || p.Provider != "discord" || p.ProviderID != "D9" {
		t.Fatalf("payload mismatch: %+v", p)
	}
}

func TestMergeTokenRejectsTampering(t *testing.T) {
	s := &Service{}
	tok := s.mintMergeToken(42, "discord", "D9")
	if _, ok := s.parseMergeToken(tok + "x"); ok {
		t.Fatal("tampered token accepted")
	}
	if _, ok := s.parseMergeToken("garbage"); ok {
		t.Fatal("garbage accepted")
	}
	// a different Service has a different secret
	other := &Service{}
	if _, ok := other.parseMergeToken(tok); ok {
		t.Fatal("token verified under foreign secret")
	}
}

func TestMergeTokenExpires(t *testing.T) {
	s := &Service{}
	tok := s.mintMergeTokenAt(42, "discord", "D9", 0) // expired epoch
	if _, ok := s.parseMergeToken(tok); ok {
		t.Fatal("expired token accepted")
	}
}
