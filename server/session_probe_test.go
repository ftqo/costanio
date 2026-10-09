package server

import (
	"net/http"
	"testing"
)

// A visitor with no session is not an error. The frontend asks "who am I" on
// every page load, and a 401 would log a console error the page can't suppress.
// GET /api/session answers 204 for nobody and the /api/users/me profile for
// everyone else; /api/users/me keeps its 401 for callers that require a user.
func TestSessionProbeIsQuietForAVisitor(t *testing.T) {
	e := newEnv(t)

	resp, _ := e.req(t, "GET", "/api/session", nil, nil)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("visitor probe = %d, want 204", resp.StatusCode)
	}

	_, c := e.discordUser(t, "d1", "me")
	resp, me := e.req(t, "GET", "/api/session", c, nil)
	if resp.StatusCode != http.StatusOK || me["name"] != "me" || me["guest"] != false {
		t.Fatalf("signed-in probe = %d %v", resp.StatusCode, me)
	}
	// The same body /api/users/me serves, identities included.
	if _, ok := me["identities"]; !ok {
		t.Errorf("probe body is not the profile: %v", me)
	}

	_, g := e.guest(t, "")
	resp, gm := e.req(t, "GET", "/api/session", g, nil)
	if resp.StatusCode != http.StatusOK || gm["guest"] != true {
		t.Fatalf("guest probe = %d %v", resp.StatusCode, gm)
	}

	// Unchanged: the strict endpoint still refuses nobody.
	resp, _ = e.req(t, "GET", "/api/users/me", nil, nil)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("/api/users/me for nobody = %d, want 401", resp.StatusCode)
	}
}
