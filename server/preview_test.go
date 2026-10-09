package server

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/ftqo/costan.io/engine/board"
)

// The builder preview's contract: the envelope a renderer needs, a distinct
// code for each refusal, and the seed beside a board dealing that board again.

// shapeBoard is what the builder's Shape mode emits: a hexagon of generic land
// with no resources, numbers, ports or sea, everything left for the roll.
func shapeBoard(radius int) *board.Board {
	b := &board.Board{Radius: radius, Tiles: map[board.Hex]board.Tile{}}
	for _, h := range board.HexesInRadius(radius) {
		b.Tiles[h] = board.Tile{Res: board.ResLand}
	}
	b.Robber = board.Hex{}
	return b
}

// islandShape is a shape whose land sits in two pieces: a Shape-mode map with
// Water painted through it, which is what makes a builder map an Islands map.
func islandShape() *board.Board {
	b := shapeBoard(3)
	for h := range b.Tiles {
		if h.Q == 0 {
			delete(b.Tiles, h)
		}
	}
	b.Robber = board.Hex{Q: 1, R: 0}
	return b
}

func (e *testEnv) postPreview(t *testing.T, c *http.Cookie, body map[string]any) (*http.Response, map[string]any) {
	t.Helper()
	return e.req(t, "POST", "/api/preview", c, body)
}

// The preview deals the builder's own board: a bare shape comes back
// resolved, numbered and ported, with the seed that dealt it.
func TestPreviewBoardDealsTheBuildersShape(t *testing.T) {
	e := newEnv(t)
	_, c := e.discordUser(t, "d0", "builder")

	resp, out := e.postPreview(t, c, map[string]any{"ruleset": "base+rivers", "seed": "777", "board": shapeBoard(2), "players": 3})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("preview = %d (%v)", resp.StatusCode, out)
	}
	if out["seed"] != "777" {
		t.Errorf("seed = %#v, want \"777\" echoed back", out["seed"])
	}
	raw, _ := json.Marshal(out["board"])
	var b board.Board
	if err := json.Unmarshal(raw, &b); err != nil {
		t.Fatalf("board decode: %v", err)
	}
	numbered := 0
	for _, tile := range b.Tiles {
		if tile.Res == board.ResLand {
			t.Fatal("generic land survived the deal")
		}
		if tile.Number != 0 {
			numbered++
		}
	}
	if numbered == 0 || len(b.Harbors) == 0 {
		t.Errorf("dealt board has %d numbers and %d harbors; want a complete board", numbered, len(b.Harbors))
	}
	// The module layer is the half the builder cannot show on its own canvas.
	if ext, ok := out["ext"].(map[string]any); !ok || ext["rivers"] == nil {
		t.Errorf("ext has no rivers entry: %v", out["ext"])
	}
	if cfg, ok := out["config"].(map[string]any); !ok || cfg["players"] != float64(3) {
		t.Errorf("config players = %v, want the 3 the builder asked for", out["config"])
	}
}

// The same shape under the same seed deals the same board.
func TestPreviewBoardIsDeterministic(t *testing.T) {
	e := newEnv(t)
	_, c := e.discordUser(t, "d0", "builder")
	deal := func() string {
		resp, out := e.postPreview(t, c, map[string]any{"ruleset": "base+fishermen", "seed": "4242", "board": shapeBoard(2)})
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("preview = %d (%v)", resp.StatusCode, out)
		}
		raw, _ := json.Marshal(map[string]any{"board": out["board"], "ext": out["ext"]})
		return string(raw)
	}
	if a, b := deal(), deal(); a != b {
		t.Fatal("two deals of one seed on one shape differ")
	}
	resp, out := e.postPreview(t, c, map[string]any{"ruleset": "base+fishermen", "seed": "4243", "board": shapeBoard(2)})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("preview = %d (%v)", resp.StatusCode, out)
	}
	raw, _ := json.Marshal(map[string]any{"board": out["board"], "ext": out["ext"]})
	if string(raw) == deal() {
		t.Fatal("a different seed dealt the same board")
	}
}

// Islands is allowed: a builder map whose land sits in two pieces is an
// Islands map, and the preview shows the sea Frame gives it. A solid hexagon
// under Islands has no water and gets the lobby's refusal from the engine.
func TestPreviewBoardIslands(t *testing.T) {
	e := newEnv(t)
	_, c := e.discordUser(t, "d0", "builder")

	resp, out := e.postPreview(t, c, map[string]any{"ruleset": "base+islands", "seed": "1", "board": islandShape()})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("islands preview = %d (%v)", resp.StatusCode, out)
	}
	raw, _ := json.Marshal(out["board"])
	var b board.Board
	if err := json.Unmarshal(raw, &b); err != nil {
		t.Fatalf("board decode: %v", err)
	}
	sea := 0
	for _, tile := range b.Tiles {
		if tile.Res == board.Sea {
			sea++
		}
	}
	if sea == 0 {
		t.Error("an Islands preview came back with no sea on it")
	}

	resp, out = e.postPreview(t, c, map[string]any{"ruleset": "base+islands", "seed": "1", "board": shapeBoard(2)})
	if resp.StatusCode != http.StatusBadRequest || out["code"] != "ISLANDS_NEEDS_SEA" {
		t.Errorf("solid hexagon under islands = %d %v, want 400 ISLANDS_NEEDS_SEA", resp.StatusCode, out["code"])
	}
	resp, out = e.postPreview(t, c, map[string]any{"ruleset": "explorers", "seed": "1", "board": shapeBoard(2)})
	if resp.StatusCode != http.StatusBadRequest || out["code"] != "BAD_CONFIG" {
		t.Errorf("explorers with an authored map = %d %v, want 400 BAD_CONFIG", resp.StatusCode, out["code"])
	}
}

// The endpoint takes an arbitrary board through the validator and the solver,
// so it is behind a login like the other map tools.
func TestPreviewBoardRequiresAuth(t *testing.T) {
	e := newEnv(t)
	if resp, _ := e.postPreview(t, nil, map[string]any{"board": shapeBoard(2)}); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("anonymous POST /api/preview = %d, want 401", resp.StatusCode)
	}
	_, c := e.discordUser(t, "d0", "builder")
	if resp, out := e.postPreview(t, c, map[string]any{"ruleset": "base"}); resp.StatusCode != http.StatusBadRequest || out["code"] != "BOARD_REQUIRED" {
		t.Errorf("no board = %d %v, want 400 BOARD_REQUIRED", resp.StatusCode, out["code"])
	}
	if resp, out := e.postPreview(t, c, map[string]any{"board": shapeBoard(2), "seed": "x"}); resp.StatusCode != http.StatusBadRequest || out["code"] != "PREVIEW_BAD_SEED" {
		t.Errorf("bad seed = %d %v, want 400 PREVIEW_BAD_SEED", resp.StatusCode, out["code"])
	}
}

// Other caller mistakes, each with its own code, since the code is the only
// field the builder may branch on. An absent ruleset is not an error: the
// builder previews a base board until expansions are picked.
func TestPreviewBoardRulesetHandling(t *testing.T) {
	e := newEnv(t)
	_, c := e.discordUser(t, "d0", "builder")

	resp, out := e.postPreview(t, c, map[string]any{"board": shapeBoard(2), "seed": "5"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("no ruleset = %d (%v)", resp.StatusCode, out)
	}
	if out["ruleset"] != "base" {
		t.Errorf("ruleset = %v, want base echoed back", out["ruleset"])
	}
	// An absent seed picks one, and the response must say which, or the board
	// can't be reproduced.
	resp, out = e.postPreview(t, c, map[string]any{"board": shapeBoard(2)})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("no seed = %d (%v)", resp.StatusCode, out)
	}
	if seed, ok := out["seed"].(string); !ok || seed == "" || seed == "0" {
		t.Errorf("seed = %#v, want a random one reported back", out["seed"])
	}

	for _, tc := range []struct{ name, ruleset, code string }{
		{"unknown module", "base+nosuch", "PREVIEW_BAD_RULESET"},
		{"modules that conflict", "base+wagons+islands", "RULESET_CONFLICT"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			resp, out := e.postPreview(t, c, map[string]any{"ruleset": tc.ruleset, "board": shapeBoard(2)})
			if resp.StatusCode != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (%v)", resp.StatusCode, out)
			}
			if out["code"] != tc.code {
				t.Errorf("code = %v, want %v", out["code"], tc.code)
			}
		})
	}
}

// It creates no game; otherwise the preview button could fill the lobby.
func TestPreviewBoardPersistsNothing(t *testing.T) {
	e := newEnv(t)
	_, c := e.discordUser(t, "d0", "builder")

	before, err := e.st.ListGames("lobby", true)
	if err != nil {
		t.Fatal(err)
	}
	for range 5 {
		if resp, out := e.postPreview(t, c, map[string]any{"ruleset": "base+wagons", "board": shapeBoard(2)}); resp.StatusCode != http.StatusOK {
			t.Fatalf("preview = %d (%v)", resp.StatusCode, out)
		}
	}
	after, err := e.st.ListGames("lobby", true)
	if err != nil {
		t.Fatal(err)
	}
	if len(after) != len(before) {
		t.Errorf("preview created %d game rows, want 0", len(after)-len(before))
	}
}
