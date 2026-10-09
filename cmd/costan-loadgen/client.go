// Command costan-loadgen orchestrates bot games over the REST API and writes a
// targets.json (game ids + session tokens) for the k6 wire-capacity load test.
package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"os"
)

// Client is a thin REST client for one identity. Each Client owns a cookie jar,
// so the session cookie set by MintGuest is sent on subsequent calls.
type Client struct {
	BaseURL string
	HTTP    *http.Client
}

// NewClient builds a Client with its own cookie jar.
func NewClient(baseURL string) (*Client, error) {
	jar, err := cookiejar.New(nil)
	if err != nil {
		return nil, err
	}
	return &Client{BaseURL: baseURL, HTTP: &http.Client{Jar: jar}}, nil
}

// sessionFromCookies returns the costan_session value from a Set-Cookie list.
func sessionFromCookies(cookies []*http.Cookie) (string, bool) {
	for _, ck := range cookies {
		if ck.Name == "costan_session" {
			return ck.Value, true
		}
	}
	return "", false
}

// MintGuest creates a guest session and returns its session token (the value of
// the costan_session cookie). The cookie is also retained in the jar for reuse.
// Guests are the spectator identity: they may watch a private game with its
// invite code (public games require a registered identity).
func (c *Client) MintGuest() (string, error) {
	resp, err := c.HTTP.Post(c.BaseURL+"/auth/guest", "application/json", nil)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("guest: status %d: %s", resp.StatusCode, b)
	}
	if tok, ok := sessionFromCookies(resp.Cookies()); ok {
		return tok, nil
	}
	return "", errors.New("guest: no costan_session cookie in response")
}

// MintDev logs in as the registered dev account (GET /auth/dev) and returns its
// session token. This is the host identity: only registered accounts may create
// and host games. Requires the server to run with COSTAN_DEV_AUTH=1 (and not
// secure-cookies); a 404 means dev-auth is disabled. The dev endpoint responds
// 302 with the session cookie, so redirects are not followed here.
func (c *Client) MintDev() (string, error) {
	noRedirect := &http.Client{
		Jar:           c.HTTP.Jar,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	resp, err := noRedirect.Get(c.BaseURL + "/auth/dev")
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotFound {
		return "", errors.New("dev login: 404: server needs COSTAN_DEV_AUTH=1 (and not secure-cookies)")
	}
	if resp.StatusCode != http.StatusFound && resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("dev login: status %d: %s", resp.StatusCode, b)
	}
	if tok, ok := sessionFromCookies(resp.Cookies()); ok {
		return tok, nil
	}
	return "", errors.New("dev login: no costan_session cookie in response")
}

// GameTarget is a spectatable game: its id plus the invite code a guest needs to
// watch it (games are created private so guests can spectate via the invite).
type GameTarget struct {
	ID     string `json:"id"`
	Invite string `json:"invite"`
}

// Targets is the handoff artifact consumed by the k6 script.
type Targets struct {
	Games  []GameTarget `json:"games"`
	Tokens []string     `json:"tokens"`
}

// Save writes the targets as pretty JSON.
func (t Targets) Save(path string) error {
	b, err := json.MarshalIndent(t, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o600)
}

// LoadTargets reads a targets file.
func LoadTargets(path string) (Targets, error) {
	var t Targets
	b, err := os.ReadFile(path)
	if err != nil {
		return t, err
	}
	err = json.Unmarshal(b, &t)
	return t, err
}
