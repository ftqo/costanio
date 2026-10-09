package server

import (
	"net/http"
	"testing"
)

// Islands on a map with no open water is refused with its own code, not the
// generic BAD_CONFIG, so the host knows to pick a different map. Covers every
// path to the check: no board (the lobby invents a solid hexagon), a
// solid-land preset, and updating a table that is already open.
func TestIslandsWithoutSeaRefused(t *testing.T) {
	e := newEnv(t)
	_, cookie := e.discordUser(t, "ins1", "Host")

	for name, cfg := range map[string]map[string]any{
		"no board":  {"players": 4, "ruleset": "base+islands"},
		"preset":    {"players": 4, "ruleset": "base+islands", "preset": "beginner"},
		"solid map": {"players": 4, "ruleset": "base+islands", "board": shapeBoard(2)},
	} {
		resp, body := e.req(t, "POST", "/api/games", cookie, map[string]any{"config": cfg})
		if resp.StatusCode != http.StatusBadRequest || body["code"] != "ISLANDS_NEEDS_SEA" {
			t.Errorf("%s: %d %v, want 400 ISLANDS_NEEDS_SEA", name, resp.StatusCode, body)
		}
	}

	// A base game with no board is still fine, and switching it to Islands
	// over the solid hexagon it was given is the same refusal.
	resp, body := e.req(t, "POST", "/api/games", cookie, map[string]any{
		"config": map[string]any{"players": 4, "ruleset": "base"},
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("base create = %d %v", resp.StatusCode, body)
	}
	game, _ := body["game"].(map[string]any)
	id, _ := game["id"].(string)
	resp, body = e.req(t, "POST", "/api/games/"+id+"/config", cookie, map[string]any{"players": 4, "ruleset": "base+islands"})
	if resp.StatusCode != http.StatusBadRequest || body["code"] != "ISLANDS_NEEDS_SEA" {
		t.Errorf("config update: %d %v, want 400 ISLANDS_NEEDS_SEA", resp.StatusCode, body)
	}
}
