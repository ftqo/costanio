package server

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"
)

// postToken POSTs a code exchange with explicit Origin and Content-Type.
func postToken(t *testing.T, e *testEnv, origin, ctype string) int {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, e.ts.URL+"/api/token", bytes.NewBufferString(`{"code":"attacker-code"}`))
	if err != nil {
		t.Fatal(err)
	}
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	if ctype != "" {
		req.Header.Set("Content-Type", ctype)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	return resp.StatusCode
}

// TestActivityTokenRejectsCrossSiteLogin: POST /api/token mints a session (and
// merges a present guest into the code's Discord account), so a foreign page
// that can make a browser post to it can log the victim in as the attacker.
// Only our own origins, posting JSON, may reach the exchange.
func TestActivityTokenRejectsCrossSiteLogin(t *testing.T) {
	e := newEnv(t)
	// Stub Discord so a request that passes the gate fails the exchange (502)
	// instead of reaching the network; 502 is the "gate passed" signal.
	discordStub := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	t.Cleanup(discordStub.Close)
	e.srv.auth.Config.TokenURL = discordStub.URL
	e.srv.auth.Config.BaseURL = "https://costan.example"
	e.srv.SetDiscordAppID("app1")

	const json = "application/json"
	cases := []struct {
		name, origin, ctype string
		want                int
	}{
		{"foreign origin", "https://evil.example", json, http.StatusForbidden},
		{"no origin", "", json, http.StatusForbidden},
		{"other app's activity", "https://other.discordsays.com", json, http.StatusForbidden},
		{"form post from our own origin", "https://costan.example", "text/plain", http.StatusUnsupportedMediaType},
		{"form-encoded from activity", "https://app1.discordsays.com", "application/x-www-form-urlencoded", http.StatusUnsupportedMediaType},
		{"site origin, JSON", "https://costan.example", json, http.StatusBadGateway},
		{"activity origin, JSON", "https://app1.discordsays.com", json, http.StatusBadGateway},
		{"activity origin, JSON with charset", "https://app1.discordsays.com", "application/json; charset=utf-8", http.StatusBadGateway},
	}
	for _, c := range cases {
		if got := postToken(t, e, c.origin, c.ctype); got != c.want {
			t.Errorf("%s: status %d, want %d", c.name, got, c.want)
		}
	}
}

// TestCheckOriginUsesProductionInference: an https base URL is a production
// deployment even without -secure-cookies (auth.Production, cmd/costan's
// prodLike), so checkOrigin must refuse a plain-http Origin for its own host.
func TestCheckOriginUsesProductionInference(t *testing.T) {
	e := newEnv(t)
	e.srv.auth.Secure = false
	e.srv.auth.Config.BaseURL = "https://costan.example"
	r, _ := http.NewRequest(http.MethodGet, "http://costan.example/ws", nil)
	r.Host = "costan.example"
	r.Header.Set("Origin", "http://costan.example")
	if e.srv.checkOrigin(r) {
		t.Error("https deployment without the secure flag accepted an http:// origin")
	}
	r.Header.Set("Origin", "https://costan.example")
	if !e.srv.checkOrigin(r) {
		t.Error("rejected the configured https origin")
	}
}
