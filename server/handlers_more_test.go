package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/url"
	"reflect"
	"strconv"
	"strings"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// reqRaw posts an arbitrary (possibly malformed) body, for exercising the
// invalid-JSON branches that the JSON-encoding req helper can't reach.
func (e *testEnv) reqRaw(t *testing.T, method, path string, cookie *http.Cookie, body []byte) (*http.Response, map[string]any) {
	t.Helper()
	req, err := http.NewRequest(method, e.ts.URL+path, bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	var out map[string]any
	json.NewDecoder(resp.Body).Decode(&out)
	return resp, out
}

// validBoard returns a layout that passes ValidateLayout (the beginner preset).
func validBoard(t *testing.T) *board.Board {
	t.Helper()
	b, err := board.PresetLayout("beginner")
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestSupporterAndLoadoutGET(t *testing.T) {
	e := newEnv(t)
	_, c := e.discordUser(t, "d1", "me")

	resp, out := e.req(t, "GET", "/api/me/supporter", c, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("supporter = %d", resp.StatusCode)
	}
	if resp.Header.Get("Cache-Control") != "no-store" {
		t.Errorf("supporter Cache-Control = %q, want no-store", resp.Header.Get("Cache-Control"))
	}
	if out["active"] != false {
		t.Errorf("fresh user active = %v, want false", out["active"])
	}

	resp, out = e.req(t, "GET", "/api/me/loadout", c, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("get loadout = %d", resp.StatusCode)
	}
	if _, ok := out["loadout"]; !ok {
		t.Error("get loadout missing loadout key")
	}
	if resp.Header.Get("Cache-Control") != "no-store" {
		t.Errorf("loadout Cache-Control = %q, want no-store", resp.Header.Get("Cache-Control"))
	}

	// Both require auth.
	if resp, _ := e.req(t, "GET", "/api/me/supporter", nil, nil); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("anon supporter = %d, want 401", resp.StatusCode)
	}
	if resp, _ := e.req(t, "GET", "/api/me/loadout", nil, nil); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("anon loadout = %d, want 401", resp.StatusCode)
	}
}

func TestPresetsEndpoints(t *testing.T) {
	e := newEnv(t)
	_, c := e.discordUser(t, "d1", "me")

	resp, out := e.req(t, "GET", "/api/presets", nil, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("presets = %d", resp.StatusCode)
	}
	presets, ok := out["presets"].([]any)
	if !ok || len(presets) == 0 {
		t.Fatalf("presets = %v", out["presets"])
	}

	// A known preset yields a board layout.
	resp, out = e.req(t, "GET", "/api/presets/beginner/board", c, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("preset board = %d", resp.StatusCode)
	}
	if out["board"] == nil {
		t.Error("preset board missing board")
	}

	// Unknown preset -> 404.
	if resp, _ := e.req(t, "GET", "/api/presets/nope/board", c, nil); resp.StatusCode != http.StatusNotFound {
		t.Errorf("unknown preset = %d, want 404", resp.StatusCode)
	}
	// Preset board requires auth.
	if resp, _ := e.req(t, "GET", "/api/presets/beginner/board", nil, nil); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("anon preset board = %d, want 401", resp.StatusCode)
	}
}

func TestMapsCRUD(t *testing.T) {
	e := newEnv(t)
	u, c := e.discordUser(t, "d1", "mapper")

	// Save with a missing name -> 400.
	if resp, _ := e.req(t, "POST", "/api/maps", c, map[string]any{"board": validBoard(t)}); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("save no name = %d, want 400", resp.StatusCode)
	}
	// Save with no board -> 400.
	if resp, _ := e.req(t, "POST", "/api/maps", c, map[string]any{"name": "x"}); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("save no board = %d, want 400", resp.StatusCode)
	}

	// Save a valid map.
	resp, saved := e.req(t, "POST", "/api/maps", c, map[string]any{"name": "My Map", "board": validBoard(t)})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("save map = %d: %v", resp.StatusCode, saved)
	}
	id := saved["id"].(string)
	if saved["name"] != "My Map" {
		t.Errorf("saved name = %v", saved["name"])
	}
	if int64(saved["created_by"].(float64)) != u.ID {
		t.Errorf("saved created_by = %v, want %d", saved["created_by"], u.ID)
	}

	// List shows it.
	resp, listed := e.req(t, "GET", "/api/maps", c, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("list maps = %d", resp.StatusCode)
	}
	maps := listed["maps"].([]any)
	if len(maps) != 1 {
		t.Fatalf("list = %d maps, want 1", len(maps))
	}

	// Get by id.
	resp, got := e.req(t, "GET", "/api/maps/"+id, c, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("get map = %d", resp.StatusCode)
	}
	if got["id"] != id {
		t.Errorf("get map id = %v, want %s", got["id"], id)
	}

	// Missing map -> 404.
	if resp, _ := e.req(t, "GET", "/api/maps/deadbeef", c, nil); resp.StatusCode != http.StatusNotFound {
		t.Errorf("missing map = %d, want 404", resp.StatusCode)
	}
}

func TestSaveMapRejectsInvalidLayout(t *testing.T) {
	e := newEnv(t)
	_, c := e.discordUser(t, "d1", "mapper")
	// An empty board fails ValidateLayout.
	resp, out := e.req(t, "POST", "/api/maps", c, map[string]any{
		"name": "bad", "board": &board.Board{Radius: 2},
	})
	if resp.StatusCode != http.StatusBadRequest || out["code"] != "MAP_LAYOUT_INVALID" {
		t.Errorf("invalid layout save = %d %v, want 400 MAP_LAYOUT_INVALID", resp.StatusCode, out)
	}
}

func TestSaveMapNameTooLong(t *testing.T) {
	e := newEnv(t)
	_, c := e.discordUser(t, "d1", "mapper")
	longName := ""
	var longNameSb179 strings.Builder
	for range 61 {
		longNameSb179.WriteString("x")
	}
	longName += longNameSb179.String()
	resp, _ := e.req(t, "POST", "/api/maps", c, map[string]any{"name": longName, "board": validBoard(t)})
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("long-name save = %d, want 400", resp.StatusCode)
	}
}

func TestMapEncodeDecodeRoundTrip(t *testing.T) {
	e := newEnv(t)
	_, c := e.discordUser(t, "d1", "coder")

	resp, enc := e.req(t, "POST", "/api/maps/encode", c, map[string]any{"board": validBoard(t)})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("encode = %d", resp.StatusCode)
	}
	code := enc["code"].(string)
	if code == "" {
		t.Fatal("empty map code")
	}

	resp, dec := e.req(t, "POST", "/api/maps/decode", c, map[string]any{"code": code})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("decode = %d", resp.StatusCode)
	}
	if dec["board"] == nil {
		t.Error("decode missing board")
	}

	// Encode rejects an invalid layout.
	if resp, _ := e.req(t, "POST", "/api/maps/encode", c, map[string]any{"board": &board.Board{Radius: 2}}); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("encode invalid = %d, want 400", resp.StatusCode)
	}
	// Encode with no board -> 400.
	if resp, _ := e.req(t, "POST", "/api/maps/encode", c, map[string]any{}); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("encode no board = %d, want 400", resp.StatusCode)
	}
	// Decode with no code -> 400.
	if resp, _ := e.req(t, "POST", "/api/maps/decode", c, map[string]any{}); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("decode no code = %d, want 400", resp.StatusCode)
	}
	// Decode garbage -> 400 BAD_CODE.
	if resp, out := e.req(t, "POST", "/api/maps/decode", c, map[string]any{"code": "!!!notvalid!!!"}); resp.StatusCode != http.StatusBadRequest || out["code"] != "BAD_CODE" {
		t.Errorf("decode garbage = %d %v, want 400 BAD_CODE", resp.StatusCode, out)
	}
}

func TestAddBotKickColorPrivacyConfig(t *testing.T) {
	e := newEnv(t)
	host, hostC := e.discordUser(t, "d1", "host")
	_, aliceC := e.discordUser(t, "d2", "alice")

	sum, err := e.srv.lobby.Create(host, engine.GameConfig{Players: 4}, false)
	if err != nil {
		t.Fatal(err)
	}
	id := sum.Game.ID

	// Non-host can't add a bot.
	if resp, _ := e.req(t, "POST", "/api/games/"+id+"/bots", aliceC, nil); resp.StatusCode != http.StatusForbidden {
		t.Errorf("non-host add bot = %d, want 403", resp.StatusCode)
	}

	// Host adds a bot.
	resp, out := e.req(t, "POST", "/api/games/"+id+"/bots", hostC, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("add bot = %d: %v", resp.StatusCode, out)
	}
	seats := out["seats"].([]any)
	botSeat := -1
	for _, raw := range seats {
		s := raw.(map[string]any)
		if s["status"] == "bot" {
			botSeat = int(s["no"].(float64))
		}
	}
	if botSeat < 0 {
		t.Fatalf("no bot seat after add: %v", seats)
	}

	// Kick with a bad seat value -> 400.
	if resp, _ := e.req(t, "DELETE", "/api/games/"+id+"/seats/notanumber", hostC, nil); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("kick bad seat = %d, want 400", resp.StatusCode)
	}
	// Non-host can't kick.
	if resp, _ := e.req(t, "DELETE", "/api/games/"+id+"/seats/0", aliceC, nil); resp.StatusCode != http.StatusForbidden {
		t.Errorf("non-host kick = %d, want 403", resp.StatusCode)
	}
	// Host kicks the bot.
	if resp, _ := e.req(t, "DELETE", "/api/games/"+id+"/seats/"+strconv.Itoa(botSeat), hostC, nil); resp.StatusCode != http.StatusOK {
		t.Errorf("host kick bot = %d, want 200", resp.StatusCode)
	}

	// Set seat color (host is seat 0). Invalid JSON -> 400.
	if resp, _ := e.reqRaw(t, "POST", "/api/games/"+id+"/color", hostC, []byte("{not json")); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("color bad json = %d, want 400", resp.StatusCode)
	}
	// A bogus color is rejected by the gate.
	if resp, _ := e.req(t, "POST", "/api/games/"+id+"/color", hostC, map[string]any{"color": "notacolor"}); resp.StatusCode == http.StatusOK {
		t.Error("bogus color accepted, want rejection")
	}

	// Set privacy (host only). Bad JSON -> 400.
	if resp, _ := e.reqRaw(t, "POST", "/api/games/"+id+"/privacy", hostC, []byte("{")); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("privacy bad json = %d, want 400", resp.StatusCode)
	}
	resp, _ = e.req(t, "POST", "/api/games/"+id+"/privacy", hostC, map[string]any{"private": true})
	if resp.StatusCode != http.StatusOK {
		t.Errorf("set private = %d, want 200", resp.StatusCode)
	}
	if g, _ := e.st.GameByID(id); g.InviteCode == "" {
		t.Error("game not private after privacy=true")
	}
	// Non-host can't change privacy.
	if resp, _ := e.req(t, "POST", "/api/games/"+id+"/privacy", aliceC, map[string]any{"private": false}); resp.StatusCode != http.StatusForbidden {
		t.Errorf("non-host privacy = %d, want 403", resp.StatusCode)
	}

	// Update config (host only). Bad JSON -> 400.
	if resp, _ := e.reqRaw(t, "POST", "/api/games/"+id+"/config", hostC, []byte("nope")); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("config bad json = %d, want 400", resp.StatusCode)
	}
	resp, _ = e.req(t, "POST", "/api/games/"+id+"/config", hostC, map[string]any{"players": 3, "target_vp": 8})
	if resp.StatusCode != http.StatusOK {
		t.Errorf("update config = %d, want 200", resp.StatusCode)
	}
	// Non-host can't update config.
	if resp, _ := e.req(t, "POST", "/api/games/"+id+"/config", aliceC, map[string]any{"players": 3}); resp.StatusCode != http.StatusForbidden {
		t.Errorf("non-host config = %d, want 403", resp.StatusCode)
	}
}

func TestActivityLobby(t *testing.T) {
	e := newEnv(t)
	_, c := e.discordUser(t, "d1", "player")

	// Missing instance_id -> 400.
	if resp, _ := e.req(t, "POST", "/api/activity/lobby", c, map[string]any{}); resp.StatusCode != http.StatusBadRequest {
		t.Errorf("activity no instance = %d, want 400", resp.StatusCode)
	}

	// A fresh instance creates/joins a lobby.
	resp, out := e.req(t, "POST", "/api/activity/lobby", c, map[string]any{"instance_id": "inst-123"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("activity lobby = %d: %v", resp.StatusCode, out)
	}
	if out["summary"] == nil || out["role"] == nil {
		t.Errorf("activity response missing fields: %v", out)
	}
	// Requires auth.
	if resp, _ := e.req(t, "POST", "/api/activity/lobby", nil, map[string]any{"instance_id": "x"}); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("anon activity = %d, want 401", resp.StatusCode)
	}
}

func TestLeaderboardRulesetAndLimit(t *testing.T) {
	e := newEnv(t)
	// Explicit ruleset + limit exercises the query-param parsing branches.
	resp, out := e.req(t, "GET", "/api/leaderboard?ruleset=base%2Bcak&limit=5", nil, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("leaderboard = %d", resp.StatusCode)
	}
	if out["ruleset"] != "base+cak" {
		t.Errorf("ruleset = %v, want base+cak", out["ruleset"])
	}
}

// Only the ranked queues have standings; other rulesets sit at a placeholder
// 1000, so their leaderboard is a bad request rather than a fake table.
func TestLeaderboardUnrankedRulesetRejected(t *testing.T) {
	e := newEnv(t)
	for _, rs := range []string{"base+islands", "base+fishermen", "base+caravans", "cities"} {
		resp, out := e.req(t, "GET", "/api/leaderboard?ruleset="+url.QueryEscape(rs), nil, nil)
		if resp.StatusCode != http.StatusBadRequest || out["code"] != "UNKNOWN_RULESET" {
			t.Errorf("leaderboard %q = %d %v, want 400 UNKNOWN_RULESET", rs, resp.StatusCode, out)
		}
	}
}

func TestUserProfileBadID(t *testing.T) {
	e := newEnv(t)
	if resp, out := e.req(t, "GET", "/api/users/notanumber", nil, nil); resp.StatusCode != http.StatusBadRequest || out["code"] != "BAD_USER_ID" {
		t.Errorf("bad user id = %d %v, want 400 BAD_USER_ID", resp.StatusCode, out)
	}
}

func TestUpdateMeGuestForbidden(t *testing.T) {
	e := newEnv(t)
	_, gc := e.guest(t, "guesty")
	if resp, out := e.req(t, "PATCH", "/api/users/me", gc, map[string]any{"name": "newname"}); resp.StatusCode != http.StatusForbidden || out["code"] != "GUEST_NO_SETTINGS" {
		t.Errorf("guest update-me = %d %v, want 403 GUEST_NO_SETTINGS", resp.StatusCode, out)
	}
}

func TestLintMapEndpoint(t *testing.T) {
	e := newEnv(t)
	_, c := e.discordUser(t, "d1", "linter")
	// validBoard(t) returns the beginner preset; it should lint clean of structural errors.
	resp, out := e.req(t, "POST", "/api/maps/lint", c, map[string]any{"board": validBoard(t)})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, body = %v", resp.StatusCode, out)
	}
	if _, ok := out["issues"]; !ok {
		t.Fatalf("response missing issues key: %v", out)
	}
}

// Expansion terrain the ruleset can't support (gold without Islands) is a
// blocking lint error, using the same eligibility gate as game creation.
func TestLintMapEligibilityError(t *testing.T) {
	e := newEnv(t)
	_, c := e.discordUser(t, "d1", "linter3")
	b := validBoard(t)
	// Turn one producing tile into gold, then lint under base (no Islands).
	for h, tile := range b.Tiles {
		if tile.Res.Producing() {
			b.Tiles[h] = board.Tile{Res: board.Gold, Number: tile.Number}
			break
		}
	}
	resp, out := e.req(t, "POST", "/api/maps/lint", c, map[string]any{"board": b, "ruleset": "base"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, body = %v", resp.StatusCode, out)
	}
	issues, _ := out["issues"].([]any)
	found := false
	for _, raw := range issues {
		iss, _ := raw.(map[string]any)
		if iss["code"] == "terrain_needs_module" && iss["severity"] == "error" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected a terrain_needs_module error for gold under base, got %v", issues)
	}
}

func TestLintMapBadRequest(t *testing.T) {
	e := newEnv(t)
	_, c := e.discordUser(t, "d1", "linter2")
	if resp, _ := e.req(t, "POST", "/api/maps/lint", c, map[string]any{}); resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing board, got %d", resp.StatusCode)
	}
}

func TestRandomizeMapEndpoint(t *testing.T) {
	e := newEnv(t)
	_, c := e.discordUser(t, "d1", "randomizer")
	resp, out := e.req(t, "POST", "/api/maps/randomize", c, map[string]any{"board": validBoard(t)})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	raw, _ := json.Marshal(out["board"])
	var b board.Board
	if err := json.Unmarshal(raw, &b); err != nil {
		t.Fatalf("board decode: %v", err)
	}
	// Every land tile now carries a real resource and a number (no generic land left).
	land, numbered := 0, 0
	for _, tile := range b.Tiles {
		if tile.Res >= board.Wood && tile.Res <= board.Ore {
			land++
			if tile.Number != 0 {
				numbered++
			}
		}
		if tile.Res == board.ResLand {
			t.Errorf("randomized board still has generic land at a tile")
		}
	}
	if land == 0 || numbered != land {
		t.Fatalf("expected every producing tile numbered: land=%d numbered=%d", land, numbered)
	}
	// Ports come with it, so promoting a shape into Design mode yields a board
	// that is complete rather than one the author has to hand-port first.
	if len(b.Harbors) == 0 {
		t.Error("randomized board has no harbors")
	}
}

// Randomize re-rolls the ports along with the resources and numbers.
func TestRandomizeMapRerollsHarbors(t *testing.T) {
	e := newEnv(t)
	_, c := e.discordUser(t, "d1", "randomizer3")
	// A sparse, hand-authored port set. Presets ship with no harbors (the engine
	// fills them at game start), so take one real port from the harbors endpoint.
	seeded, out0 := e.req(t, "POST", "/api/maps/harbors", c, map[string]any{"board": validBoard(t)})
	if seeded.StatusCode != http.StatusOK {
		t.Fatalf("harbors status = %d", seeded.StatusCode)
	}
	raw0, _ := json.Marshal(out0["board"])
	var src board.Board
	if err := json.Unmarshal(raw0, &src); err != nil {
		t.Fatalf("board decode: %v", err)
	}
	if len(src.Harbors) < 2 {
		t.Fatalf("expected a full port set to trim, got %d", len(src.Harbors))
	}
	src.Harbors = src.Harbors[:1]

	resp, out := e.req(t, "POST", "/api/maps/randomize", c, map[string]any{"board": &src})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	raw, _ := json.Marshal(out["board"])
	var b board.Board
	if err := json.Unmarshal(raw, &b); err != nil {
		t.Fatalf("board decode: %v", err)
	}
	if len(b.Harbors) <= 1 {
		t.Errorf("harbors were kept, not re-rolled: got %d", len(b.Harbors))
	}
}

// A seed makes the roll reproducible: typing the shown seed back in deals the
// same board. Without one, the reply says which seed it picked.
func TestRandomizeMapIsSeeded(t *testing.T) {
	e := newEnv(t)
	_, c := e.discordUser(t, "d1", "randomizer4")
	roll := func(seed string) (string, string) {
		body := map[string]any{"board": validBoard(t)}
		if seed != "" {
			body["seed"] = seed
		}
		resp, out := e.req(t, "POST", "/api/maps/randomize", c, body)
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("status = %d (%v)", resp.StatusCode, out)
		}
		raw, _ := json.Marshal(out["board"])
		got, _ := out["seed"].(string)
		return string(raw), got
	}
	a, seedA := roll("99")
	b, seedB := roll("99")
	if seedA != "99" || seedB != "99" {
		t.Errorf("seed echoed as %q / %q, want \"99\"", seedA, seedB)
	}
	if a != b {
		t.Error("the same seed rolled two different boards")
	}
	if other, _ := roll("100"); other == a {
		t.Error("a different seed rolled the same board")
	}
	if _, picked := roll(""); picked == "" {
		t.Error("an unseeded roll did not report the seed it used")
	}
	if resp, out := e.req(t, "POST", "/api/maps/randomize", c, map[string]any{"board": validBoard(t), "seed": "abc"}); resp.StatusCode != http.StatusBadRequest || out["code"] != "PREVIEW_BAD_SEED" {
		t.Errorf("bad seed = %d %v, want 400 PREVIEW_BAD_SEED", resp.StatusCode, out["code"])
	}
}

// Tiles and ports roll from separate seeds, so the builder can hold one still
// while re-rolling the other: the same tile seed under two port seeds deals the
// same tiles with different ports, and the ports endpoint under the same port
// seed lays the same ports again.
func TestRandomizeMapSeparatesTileAndPortSeeds(t *testing.T) {
	e := newEnv(t)
	_, c := e.discordUser(t, "d1", "randomizer5")
	roll := func(seed, harborSeed string) board.Board {
		resp, out := e.req(t, "POST", "/api/maps/randomize", c, map[string]any{"board": validBoard(t), "seed": seed, "harbor_seed": harborSeed})
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("status = %d (%v)", resp.StatusCode, out)
		}
		if out["harbor_seed"] != harborSeed {
			t.Errorf("harbor_seed echoed as %v, want %q", out["harbor_seed"], harborSeed)
		}
		raw, _ := json.Marshal(out["board"])
		var b board.Board
		if err := json.Unmarshal(raw, &b); err != nil {
			t.Fatal(err)
		}
		return b
	}
	a := roll("5", "1")
	b := roll("5", "2")
	if !reflect.DeepEqual(a.Tiles, b.Tiles) {
		t.Error("changing the port seed changed the tiles")
	}
	if reflect.DeepEqual(a.Harbors, b.Harbors) {
		t.Error("changing the port seed did not change the ports")
	}
	// The ports endpoint under port seed 1 reproduces the ports of roll (5, 1).
	resp, out := e.req(t, "POST", "/api/maps/harbors", c, map[string]any{"board": &a, "seed": "1"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("harbors status = %d (%v)", resp.StatusCode, out)
	}
	raw, _ := json.Marshal(out["board"])
	var again board.Board
	if err := json.Unmarshal(raw, &again); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(a.Harbors, again.Harbors) {
		t.Error("the ports endpoint under the same seed laid different ports")
	}
	if out["seed"] != "1" {
		t.Errorf("ports seed echoed as %v, want \"1\"", out["seed"])
	}
}

func TestHarborsMapEndpoint(t *testing.T) {
	e := newEnv(t)
	_, c := e.discordUser(t, "d1", "porter")
	resp, out := e.req(t, "POST", "/api/maps/harbors", c, map[string]any{"board": validBoard(t)})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	raw, _ := json.Marshal(out["board"])
	var b board.Board
	if err := json.Unmarshal(raw, &b); err != nil {
		t.Fatalf("board decode: %v", err)
	}
	if len(b.Harbors) == 0 {
		t.Fatal("no harbors placed")
	}
	// The engine's one-dock-per-water-hex invariant must hold in what we hand back.
	seen := map[board.Hex]bool{}
	for _, h := range b.Harbors {
		sea, ok := b.HarborSeaHex(h)
		if !ok {
			t.Errorf("harbor %v has no water side", h.Verts)
			continue
		}
		if seen[sea] {
			t.Errorf("two harbors share water hex %v", sea)
		}
		seen[sea] = true
	}
}

func TestHarborsMapBadRequest(t *testing.T) {
	e := newEnv(t)
	_, c := e.discordUser(t, "d1", "porter2")
	if resp, _ := e.req(t, "POST", "/api/maps/harbors", c, map[string]any{}); resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", resp.StatusCode)
	}
}

func TestRandomizeMapBadRequest(t *testing.T) {
	e := newEnv(t)
	_, c := e.discordUser(t, "d1", "randomizer2")
	if resp, _ := e.req(t, "POST", "/api/maps/randomize", c, map[string]any{}); resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", resp.StatusCode)
	}
}

func TestDeleteMap(t *testing.T) {
	e := newEnv(t)
	_, ownerC := e.discordUser(t, "d1", "owner")
	_, otherC := e.discordUser(t, "d2", "other")

	// Owner creates a map.
	resp, saved := e.req(t, "POST", "/api/maps", ownerC, map[string]any{
		"name": "Mine", "board": validBoard(t),
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create: %d", resp.StatusCode)
	}
	id := saved["id"].(string)

	// A different user cannot delete it (404, still present).
	if resp, _ := e.req(t, "DELETE", "/api/maps/"+id, otherC, nil); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("non-owner delete: want 404, got %d", resp.StatusCode)
	}
	if resp, _ := e.req(t, "GET", "/api/maps/"+id, ownerC, nil); resp.StatusCode != http.StatusOK {
		t.Fatalf("map should still exist, got %d", resp.StatusCode)
	}

	// Owner deletes it (204), then it is gone (404).
	if resp, _ := e.req(t, "DELETE", "/api/maps/"+id, ownerC, nil); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("owner delete: want 204, got %d", resp.StatusCode)
	}
	if resp, _ := e.req(t, "GET", "/api/maps/"+id, ownerC, nil); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("map should be gone, got %d", resp.StatusCode)
	}

	// Deleting an unknown id is 404.
	if resp, _ := e.req(t, "DELETE", "/api/maps/deadbeef", ownerC, nil); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown delete: want 404, got %d", resp.StatusCode)
	}
}

func TestListMapsMineBranch(t *testing.T) {
	e := newEnv(t)
	_, aC := e.discordUser(t, "d1", "alice")
	_, bC := e.discordUser(t, "d2", "bob")

	// Alice saves a map; Bob saves a map.
	resp, _ := e.req(t, "POST", "/api/maps", aC, map[string]any{
		"name": "AliceMap", "board": validBoard(t),
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("alice save: %d", resp.StatusCode)
	}
	resp, _ = e.req(t, "POST", "/api/maps", bC, map[string]any{
		"name": "BobMap", "board": validBoard(t),
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("bob save: %d", resp.StatusCode)
	}

	// GET /api/maps is owner-scoped: Alice sees only her own map, not Bob's
	// (no cross-user exposure / IDOR).
	resp, listed := e.req(t, "GET", "/api/maps", aC, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("list all: %d", resp.StatusCode)
	}
	all := listed["maps"].([]any)
	if len(all) != 1 {
		t.Fatalf("list (alice) = %d, want 1 (own maps only)", len(all))
	}
	if all[0].(map[string]any)["name"] != "AliceMap" {
		t.Errorf("alice list[0].name = %v, want AliceMap (must not see BobMap)", all[0].(map[string]any)["name"])
	}

	// GET /api/maps?mine=1 for Alice returns only Alice's map.
	resp, listed = e.req(t, "GET", "/api/maps?mine=1", aC, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("list mine (alice): %d", resp.StatusCode)
	}
	mine := listed["maps"].([]any)
	if len(mine) != 1 {
		t.Fatalf("alice mine = %d, want 1", len(mine))
	}
	if mine[0].(map[string]any)["name"] != "AliceMap" {
		t.Errorf("alice mine[0].name = %v, want AliceMap", mine[0].(map[string]any)["name"])
	}

	// GET /api/maps?mine=1 for Bob returns only Bob's map.
	resp, listed = e.req(t, "GET", "/api/maps?mine=1", bC, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("list mine (bob): %d", resp.StatusCode)
	}
	bMine := listed["maps"].([]any)
	if len(bMine) != 1 {
		t.Fatalf("bob mine = %d, want 1", len(bMine))
	}
	if bMine[0].(map[string]any)["name"] != "BobMap" {
		t.Errorf("bob mine[0].name = %v, want BobMap", bMine[0].(map[string]any)["name"])
	}
}

func TestGetMapOwnerScoped(t *testing.T) {
	e := newEnv(t)
	_, ownerC := e.discordUser(t, "downer", "Owner")
	_, otherC := e.discordUser(t, "dother", "Other")

	resp, saved := e.req(t, "POST", "/api/maps", ownerC, map[string]any{"name": "Secret", "board": validBoard(t)})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("save map = %d: %v", resp.StatusCode, saved)
	}
	id := saved["id"].(string)

	// The owner can read their own map.
	if resp, _ := e.req(t, "GET", "/api/maps/"+id, ownerC, nil); resp.StatusCode != http.StatusOK {
		t.Fatalf("owner get = %d, want 200", resp.StatusCode)
	}
	// A different user gets 404 (no ownership/existence leak), not the map.
	if resp, _ := e.req(t, "GET", "/api/maps/"+id, otherC, nil); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("non-owner get = %d, want 404", resp.StatusCode)
	}
}
