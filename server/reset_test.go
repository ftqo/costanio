package server

import (
	"net/http"
	"testing"
)

// startedGame creates a public 3-player game owned by host, seats two more
// humans, and starts it, returning the now-active game id.
func startedGame(t *testing.T, e *testEnv, hostC, aliceC, bobC *http.Cookie) string {
	t.Helper()
	resp, created := e.req(t, "POST", "/api/games", hostC, map[string]any{"config": map[string]any{"players": 3}})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create = %d: %v", resp.StatusCode, created)
	}
	id := created["game"].(map[string]any)["id"].(string)
	e.req(t, "POST", "/api/games/"+id+"/join", aliceC, nil)
	e.req(t, "POST", "/api/games/"+id+"/join", bobC, nil)
	if resp, _ := e.req(t, "POST", "/api/games/"+id+"/start", hostC, nil); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("start = %d, want 204", resp.StatusCode)
	}
	return id
}

func TestResetToLobbyOverHTTP(t *testing.T) {
	e := newEnv(t)
	host, hostC := e.discordUser(t, "d1", "host")
	_, aliceC := e.discordUser(t, "d2", "alice")
	_, bobC := e.discordUser(t, "d3", "bob")

	id := startedGame(t, e, hostC, aliceC, bobC)

	// Only the host may reset; the live game is untouched by a denied attempt.
	if resp, _ := e.req(t, "POST", "/api/games/"+id+"/reset", aliceC, nil); resp.StatusCode != http.StatusForbidden {
		t.Errorf("non-host reset = %d, want 403", resp.StatusCode)
	}
	if g, _ := e.st.GameByID(id); g.Status != "active" {
		t.Fatalf("status after denied reset = %q, want active", g.Status)
	}

	// Host resets the live game back to a fresh lobby.
	if resp, _ := e.req(t, "POST", "/api/games/"+id+"/reset", hostC, nil); resp.StatusCode != http.StatusNoContent {
		t.Errorf("host reset = %d, want 204", resp.StatusCode)
	}

	// The old game is abandoned; a new lobby game now holds the host.
	if g, _ := e.st.GameByID(id); g.Status != "abandoned" {
		t.Errorf("old game status = %q, want abandoned", g.Status)
	}
	games, err := e.st.SeatedActiveGames(host.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(games) != 1 || games[0].ID == id || games[0].Status != "lobby" {
		t.Errorf("seated games after reset = %+v, want one fresh lobby", games)
	}

	// Resetting again (the game is no longer active) is a conflict.
	if resp, _ := e.req(t, "POST", "/api/games/"+id+"/reset", hostC, nil); resp.StatusCode != http.StatusConflict {
		t.Errorf("reset of abandoned game = %d, want 409", resp.StatusCode)
	}
}
