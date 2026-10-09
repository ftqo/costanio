package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestGoogleExchange(t *testing.T) {
	var gotVerifier string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/token":
			// Capture the posted PKCE code_verifier.
			gotVerifier = r.FormValue("code_verifier")
			json.NewEncoder(w).Encode(map[string]any{"access_token": "tok"})
		case "/userinfo":
			if r.Header.Get("Authorization") != "Bearer tok" {
				http.Error(w, "bad token", http.StatusUnauthorized)
				return
			}
			json.NewEncoder(w).Encode(map[string]any{
				"sub": "g-123", "name": "Gwen", "picture": "pic", "email": "gwen@example.com",
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	p := googleProvider{cfg: GoogleConfig{
		ClientID: "id", ClientSecret: "secret",
		TokenURL: srv.URL + "/token", UserinfoURL: srv.URL + "/userinfo",
	}}
	id, post, err := p.Exchange(context.Background(), "code", "https://costan.io/auth/google/callback", "verifier-xyz")
	if err != nil {
		t.Fatalf("Exchange: %v", err)
	}
	if post != nil {
		t.Fatalf("google PostLogin should be nil")
	}
	if id.ProviderID != "g-123" || id.Name != "Gwen" || id.Avatar != "pic" || id.Email != "gwen@example.com" {
		t.Fatalf("identity = %+v", id)
	}
	if gotVerifier != "verifier-xyz" {
		t.Fatalf("token request code_verifier = %q, want verifier-xyz", gotVerifier)
	}
}

// TestGoogleAuthCodeURLPKCE asserts the authorize URL carries the S256 challenge.
func TestGoogleAuthCodeURLPKCE(t *testing.T) {
	p := googleProvider{cfg: GoogleConfig{ClientID: "id"}.withDefaults()}
	raw := p.AuthCodeURL("login:st", "https://costan.io/auth/google/callback", "the-challenge")
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	q := u.Query()
	if q.Get("code_challenge") != "the-challenge" || q.Get("code_challenge_method") != "S256" {
		t.Fatalf("authorize URL missing PKCE: %s", raw)
	}
	// No challenge -> no PKCE params (proves the conditional).
	raw2 := p.AuthCodeURL("login:st", "https://costan.io/auth/google/callback", "")
	if strings.Contains(raw2, "code_challenge") {
		t.Fatalf("authorize URL should omit PKCE when no challenge: %s", raw2)
	}
}

// TestPKCEChallengeDerivation pins S256 = base64url(sha256(verifier)) no padding.
func TestPKCEChallengeDerivation(t *testing.T) {
	// RFC 7636 Appendix B test vector.
	const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
	const want = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
	if got := pkceChallenge(verifier); got != want {
		t.Fatalf("pkceChallenge = %q, want %q", got, want)
	}
	v, c := newPKCE()
	if len(v) < 43 || len(v) > 128 {
		t.Fatalf("verifier length %d out of 43..128", len(v))
	}
	if c != pkceChallenge(v) {
		t.Fatalf("newPKCE challenge mismatch")
	}
}
