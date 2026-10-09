package ruletest

import (
	"slices"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/explorers"
	"github.com/ftqo/costan.io/engine/knights"
)

// A Standalone that takes a companion is two facts that can drift apart: the
// module's StandaloneCompanions list, and the absence of a row for that pair in
// engine.Conflicts. Either mistake is silent: a ruleset that resolves but should
// not, or a lobby switch greyed out that the engine would accept.
//
// Modules name each other by string literal since no module may import a peer; a
// test may import both. Mirrors engine/scenarios' TestModuleNamesMatch.

// TestExplorersTakesKnightsAndNothingElse asserts the companion rule against
// the registry.
func TestExplorersTakesKnightsAndNothingElse(t *testing.T) {
	if !engine.ValidRuleset("cak+explorers") {
		t.Fatal("cak+explorers refused, want resolved")
	}
	// Every other module is still refused beside it, and "base" always is:
	// a standalone replaces the base game.
	if engine.ValidRuleset("base+explorers") {
		t.Error("base+explorers resolved, want refused")
	}
	if engine.ValidRuleset("base+cak+explorers") {
		t.Error("base+cak+explorers resolved, want refused")
	}
	for _, name := range engine.RegisteredModuleNames() {
		if name == explorers.Name || name == knights.Name {
			continue
		}
		rs := engine.CanonicalRuleset(explorers.Name + "+" + name)
		if engine.ValidRuleset(rs) {
			t.Errorf("%s resolved, want refused", rs)
		}
	}
}

// TestExplorersCompanionIsRegistered pins the literal the module carries in
// order to name its companion without importing it.
func TestExplorersCompanionIsRegistered(t *testing.T) {
	companions := explorers.Module{}.StandaloneCompanions()
	if !slices.Contains(companions, knights.Name) {
		t.Fatalf("Explorers names its companions %v, and engine/knights calls itself %q", companions, knights.Name)
	}
	for _, c := range companions {
		if !slices.Contains(engine.RegisteredModuleNames(), c) {
			t.Errorf("Explorers names %q as a companion and no module is registered under it", c)
		}
	}
}

// TestKnightsNamesExplorersCorrectly is the same pin from the other side: cak
// keys its target bonus, Bishop rewrite and deck on "explorers", and a typo would
// silently give pairing games the plain Knights rules and a 13-point target.
func TestKnightsNamesExplorersCorrectly(t *testing.T) {
	plain := engine.ResolveTargetVP(engine.GameConfig{Players: 4, Ruleset: "base+cak"})
	paired := engine.ResolveTargetVP(engine.GameConfig{Players: 4, Ruleset: "cak+explorers"})
	if plain != 13 {
		t.Errorf("base+cak plays to %d, want 13", plain)
	}
	if paired != 22 {
		t.Errorf("cak+explorers plays to %d, want 22 (the scenario's 17 plus the combination's 5)", paired)
	}
}
