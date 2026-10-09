package server

import (
	"net/http"
	"testing"

	"github.com/ftqo/costan.io/engine/board"
)

// oneHarbourBoard is a solid radius-2 map carrying exactly one harbour, on an
// outer edge: the one authored map Harbormaster refuses (a harbourless map is
// dealt a full set at start).
func oneHarbourBoard(t *testing.T) *board.Board {
	t.Helper()
	b := shapeBoard(2)
	for _, h := range board.HexesInRadius(2) {
		for _, e := range h.Edges() {
			hs := board.EdgeHexes(e)
			if _, in := b.Tiles[hs[0]]; in {
				if _, in := b.Tiles[hs[1]]; in {
					continue
				}
			}
			b.Harbors = []board.Harbor{{Verts: [2]board.Vertex{e.A, e.B}, Ratio: 3}}
			return b
		}
	}
	t.Fatal("no outer edge on a radius-2 board")
	return nil
}

// Harbormaster on a map with fewer than two harbours is refused with a code
// that names the reason and the minimum, not the generic BAD_CONFIG. It covers
// a create, an update to an open table, and the preview.
func TestHarbormasterOneHarbourRefused(t *testing.T) {
	e := newEnv(t)
	_, cookie := e.discordUser(t, "hmh1", "Host")
	b := oneHarbourBoard(t)

	check := func(what string, resp *http.Response, body map[string]any) {
		t.Helper()
		if resp.StatusCode != http.StatusBadRequest || body["code"] != "HARBORMASTER_NEEDS_HARBOURS" {
			t.Fatalf("%s: %d %v, want 400 HARBORMASTER_NEEDS_HARBOURS", what, resp.StatusCode, body)
		}
		params, _ := body["params"].(map[string]any)
		if params["min"] != float64(2) {
			t.Errorf("%s: params %v, want min 2", what, body["params"])
		}
	}

	resp, body := e.req(t, "POST", "/api/games", cookie, map[string]any{
		"config": map[string]any{"players": 4, "ruleset": "base+harbormaster", "board": b},
	})
	check("create", resp, body)

	// The same map is fine without the module, and switching it on is refused.
	resp, body = e.req(t, "POST", "/api/games", cookie, map[string]any{
		"config": map[string]any{"players": 4, "ruleset": "base", "board": b},
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("base create = %d %v", resp.StatusCode, body)
	}
	game, _ := body["game"].(map[string]any)
	id, _ := game["id"].(string)
	resp, body = e.req(t, "POST", "/api/games/"+id+"/config", cookie,
		map[string]any{"players": 4, "ruleset": "base+harbormaster", "board": b})
	check("config update", resp, body)

	resp, body = e.postPreview(t, cookie, map[string]any{"ruleset": "base+harbormaster", "seed": "1", "board": b})
	check("preview", resp, body)
}
