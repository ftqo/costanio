package knights_test

import (
	"slices"
	"strings"
	"testing"

	"github.com/ftqo/costan.io/engine"
	_ "github.com/ftqo/costan.io/engine/islands"
	_ "github.com/ftqo/costan.io/engine/knights"
)

func TestMaxVPWithoutCards_Knights(t *testing.T) {
	cases := []struct {
		ruleset string
		want    int
	}{
		{"base+cak", 20}, // +3 metropolises*2 +1 merchant
		{"base+cak+islands", 20},
	}
	for _, c := range cases {
		got := engine.MaxVPWithoutCards(engine.GameConfig{Players: 4, Ruleset: c.ruleset})
		if got != c.want {
			t.Errorf("MaxVPWithoutCards(%q) = %d, want %d", c.ruleset, got, c.want)
		}
	}
}

func TestRecommendedVPWithinCeiling_Knights(t *testing.T) {
	// recommended target per (ruleset, players) mirroring frontend/src/lib/format.ts
	rec := func(ruleset string, players int) int {
		base := 10
		switch {
		case players >= 9:
			base = 12
		case players >= 7:
			base = 11
		}
		if containsModuleKnights(ruleset, "cak") {
			base += 3
		}
		if containsModuleKnights(ruleset, "islands") {
			base++
		}
		return base
	}
	rulesets := []string{"base+cak", "base+cak+islands"}
	for _, rs := range rulesets {
		for p := 3; p <= 10; p++ {
			want, ceil := rec(rs, p), engine.MaxVPWithoutCards(engine.GameConfig{Players: p, Ruleset: rs})
			if want > ceil {
				t.Errorf("%s/%dp: recommended %d exceeds ceiling %d", rs, p, want, ceil)
			}
		}
	}
}

// containsModuleKnights reports whether ruleset contains the named module part.
func containsModuleKnights(ruleset, name string) bool {
	return slices.Contains(strings.Split(ruleset, "+"), name)
}
