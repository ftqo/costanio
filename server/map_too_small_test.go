package server

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/ftqo/costan.io/engine/board"
)

// A table asked to seat more than its map holds is refused with a code that
// says so and carries both numbers, not the generic BAD_CONFIG.
func TestConfigBeyondMapCapacityRefused(t *testing.T) {
	e := newEnv(t)
	_, cookie := e.discordUser(t, "mts1", "Host")

	small := &board.Board{Radius: 2, Tiles: map[board.Hex]board.Tile{}}
	for _, h := range board.HexesInRadius(2) {
		small.Tiles[h] = board.Tile{Res: board.ResLand}
	}
	raw, err := json.Marshal(small)
	if err != nil {
		t.Fatal(err)
	}
	var boardJSON any
	if err := json.Unmarshal(raw, &boardJSON); err != nil {
		t.Fatal(err)
	}

	resp, body := e.req(t, "POST", "/api/games", cookie, map[string]any{
		"config": map[string]any{"players": 8, "ruleset": "base", "board": boardJSON},
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (body %v)", resp.StatusCode, body)
	}
	if body["code"] != "MAP_TOO_SMALL" {
		t.Fatalf("code = %v, want MAP_TOO_SMALL (body %v)", body["code"], body)
	}
	params, _ := body["params"].(map[string]any)
	if params["max"] != float64(4) || params["players"] != float64(8) {
		t.Errorf("params = %v, want max 4 and players 8", params)
	}
}
