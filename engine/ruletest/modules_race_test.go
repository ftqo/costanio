package ruletest

import (
	"sync"
	"testing"

	"github.com/ftqo/costan.io/engine"
)

// TestModulesIsSafeToShare: Modules() looks like a getter and is called from
// bot/ and game/views.go on states they treat as read-only, so it must not write
// to its receiver. The memo lives in a package-level sync.Map; under -race a
// per-State cache would show up here as a data race on one *State.
//
// Lives in ruletest because resolution needs the module packages registered.
func TestModulesIsSafeToShare(t *testing.T) {
	// The count comes from a different state, so the shared one below is
	// still cold when the goroutines reach it; warming it first would hide
	// the race.
	probe := &engine.State{Config: engine.GameConfig{Players: 4, Ruleset: "base+islands"}}
	want := len(probe.Modules())
	if want == 0 {
		t.Fatal("expected the islands module to resolve")
	}
	s := &engine.State{Config: engine.GameConfig{Players: 4, Ruleset: "base+islands"}}
	var wg sync.WaitGroup
	for range 16 {
		wg.Go(func() {
			for range 50 {
				if got := len(s.Modules()); got != want {
					t.Errorf("Modules() = %d modules, want %d", got, want)
				}
			}
		})
	}
	wg.Wait()
}

// TestModulesIdentityIsStable: module identity keys State.Ext and orders hooks,
// so two resolutions of the same ruleset must return the same instances.
func TestModulesIdentityIsStable(t *testing.T) {
	a := &engine.State{Config: engine.GameConfig{Players: 4, Ruleset: "base+cak"}}
	b := &engine.State{Config: engine.GameConfig{Players: 3, Ruleset: "base+cak"}}
	ma, mb := a.Modules(), b.Modules()
	if len(ma) != len(mb) || len(ma) == 0 {
		t.Fatalf("resolved %d and %d modules", len(ma), len(mb))
	}
	for i := range ma {
		if ma[i] != mb[i] {
			t.Fatalf("module %d differs between two states with the same ruleset", i)
		}
	}
}
