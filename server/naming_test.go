package server

import (
	"net/http"
	"strings"
	"testing"
)

func createGame(t *testing.T, e *testEnv, cookie *http.Cookie) string {
	t.Helper()
	resp, out := e.req(t, "POST", "/api/games", cookie, map[string]any{
		"config": map[string]any{"players": 4}, "private": false,
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create game status = %d", resp.StatusCode)
	}
	return out["game"].(map[string]any)["id"].(string)
}

func TestSetSeatNameHTTP(t *testing.T) {
	e := newEnv(t)
	_, hostC := e.discordUser(t, "d1", "Bob")
	gid := createGame(t, e, hostC)

	resp, out := e.req(t, "POST", "/api/games/"+gid+"/name", hostC, map[string]any{"name": "Alice"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("set name status = %d: %v", resp.StatusCode, out)
	}
	seats := out["seats"].([]any)
	if name := seats[0].(map[string]any)["user_name"].(string); name != "Alice" {
		t.Errorf("seat name = %q, want Alice", name)
	}

	// Over-long names are rejected at the boundary.
	resp, _ = e.req(t, "POST", "/api/games/"+gid+"/name", hostC, map[string]any{"name": strings.Repeat("x", 33)})
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("over-long status = %d, want 400", resp.StatusCode)
	}

	// A user with no seat in the game cannot rename a seat.
	_, strangerC := e.discordUser(t, "d2", "Stranger")
	resp, _ = e.req(t, "POST", "/api/games/"+gid+"/name", strangerC, map[string]any{"name": "X"})
	if resp.StatusCode != http.StatusConflict {
		t.Errorf("non-seated status = %d, want 409", resp.StatusCode)
	}
}

func TestUpdateMeHTTP(t *testing.T) {
	e := newEnv(t)
	user, c := e.discordUser(t, "d1", "Bob")

	resp, out := e.req(t, "PATCH", "/api/users/me", c, map[string]any{"name": "Robert"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d: %v", resp.StatusCode, out)
	}
	if out["name"] != "Robert" {
		t.Errorf("returned name = %v, want Robert", out["name"])
	}
	if got, _ := e.st.UserByID(user.ID); got.Name != "Robert" {
		t.Errorf("stored name = %q, want Robert", got.Name)
	}

	// Guests have no persistent settings.
	_, gc := e.guest(t, "")
	resp, _ = e.req(t, "PATCH", "/api/users/me", gc, map[string]any{"name": "X"})
	if resp.StatusCode != http.StatusForbidden {
		t.Errorf("guest patch status = %d, want 403", resp.StatusCode)
	}

	// Empty / whitespace names are rejected.
	resp, _ = e.req(t, "PATCH", "/api/users/me", c, map[string]any{"name": "   "})
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("empty name status = %d, want 400", resp.StatusCode)
	}
}

func TestNameFilterSeatName(t *testing.T) {
	e := newEnv(t)
	user, c := e.discordUser(t, "d1", "Bob")
	gid := createGame(t, e, c)

	// A clean seat name works.
	if resp, out := e.req(t, "POST", "/api/games/"+gid+"/name", c, map[string]any{"name": "Alice"}); resp.StatusCode != http.StatusOK {
		t.Fatalf("clean name status = %d: %v", resp.StatusCode, out)
	}

	// A reserved impersonation name is rejected (400) but does not lock.
	if resp, _ := e.req(t, "POST", "/api/games/"+gid+"/name", c, map[string]any{"name": "Admin"}); resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("reserved name status = %d, want 400", resp.StatusCode)
	}
	if locked, _ := e.st.IsNameLocked(user.ID); locked {
		t.Fatal("a reserved name must not lock the account")
	}

	// A slur is rejected (403) and locks the account.
	if resp, _ := e.req(t, "POST", "/api/games/"+gid+"/name", c, map[string]any{"name": "chink"}); resp.StatusCode != http.StatusForbidden {
		t.Fatalf("slur status = %d, want 403", resp.StatusCode)
	}
	if locked, _ := e.st.IsNameLocked(user.ID); !locked {
		t.Fatal("a slur must lock the account")
	}

	// While locked, even a clean rename is refused.
	if resp, _ := e.req(t, "POST", "/api/games/"+gid+"/name", c, map[string]any{"name": "Cleanname"}); resp.StatusCode != http.StatusForbidden {
		t.Fatalf("locked rename status = %d, want 403", resp.StatusCode)
	}

	// A moderator unlock restores the ability to rename.
	if err := e.st.UnlockName(user.ID); err != nil {
		t.Fatal(err)
	}
	if resp, _ := e.req(t, "POST", "/api/games/"+gid+"/name", c, map[string]any{"name": "Cleanname"}); resp.StatusCode != http.StatusOK {
		t.Fatalf("after unlock status = %d, want 200", resp.StatusCode)
	}
}

func TestNameFilterUpdateMe(t *testing.T) {
	e := newEnv(t)
	user, c := e.discordUser(t, "d1", "Bob")

	// Zero-width characters are stripped; the cleaned name is stored.
	if resp, out := e.req(t, "PATCH", "/api/users/me", c, map[string]any{"name": "Ro\u200bbert"}); resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d: %v", resp.StatusCode, out)
	}
	if got, _ := e.st.UserByID(user.ID); got.Name != "Robert" {
		t.Errorf("stored name = %q, want Robert (zero-width stripped)", got.Name)
	}

	// A slur locks the account and leaves the stored name unchanged.
	if resp, _ := e.req(t, "PATCH", "/api/users/me", c, map[string]any{"name": "chink"}); resp.StatusCode != http.StatusForbidden {
		t.Fatalf("slur status = %d, want 403", resp.StatusCode)
	}
	if got, _ := e.st.UserByID(user.ID); got.Name != "Robert" {
		t.Errorf("name changed to %q after slur; want unchanged Robert", got.Name)
	}
	if locked, _ := e.st.IsNameLocked(user.ID); !locked {
		t.Fatal("a slur must lock the account")
	}
}
