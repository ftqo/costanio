package server

import (
	"fmt"
	"net/http"
	"slices"
	"testing"

	"github.com/ftqo/costan.io/engine"
)

// A refused expansion pairing comes back as its own code carrying the two
// module keys, not a sentence and not BAD_CONFIG.
//
// `modules` is a two-element array of wire-level module names, in the sorted
// order the engine's tables use, so the client can look up the pair and render
// the reason in the player's language. `debug` is English for the operator log
// and never rendered.
func TestCreateRefusesConflictingRuleset(t *testing.T) {
	e := newEnv(t)
	_, cookie := e.discordUser(t, "rc1", "Host")

	resp, body := e.req(t, "POST", "/api/games", cookie, map[string]any{
		"config": map[string]any{"players": 4, "ruleset": "base+explorers+islands"},
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
	if body["code"] != "RULESET_CONFLICT" {
		t.Fatalf("code = %v, want RULESET_CONFLICT (body %v)", body["code"], body)
	}
	params, ok := body["params"].(map[string]any)
	if !ok {
		t.Fatalf("params missing: %v", body)
	}
	mods, ok := params["modules"].([]any)
	if !ok || len(mods) != 2 {
		t.Fatalf("params.modules = %v, want two module keys", params["modules"])
	}
	if mods[0] != "explorers" || mods[1] != "islands" {
		t.Errorf("params.modules = %v, want [explorers islands] in sorted order", mods)
	}
	// The reason sentence stays server-side in `debug`, which clients must not
	// render.
	if debug, _ := body["debug"].(string); debug == "" {
		t.Error("debug wording missing")
	}
}

func TestConflictingModulesKeepsFullRuleset(t *testing.T) {
	err := fmt.Errorf("create: %w", &engine.ConflictError{Conflict: engine.Conflict{
		A: "cak", B: "islands", Also: []string{"raiders"}, Reason: "Synthetic conflict.",
	}})
	if got := conflictingModules(err); !slices.Equal(got, []string{"cak", "islands", "raiders"}) {
		t.Fatalf("conflicting modules = %v", got)
	}
}
