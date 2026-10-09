package main

import (
	"strings"
	"testing"

	_ "github.com/ftqo/costan.io/engine/harbormaster"
	_ "github.com/ftqo/costan.io/engine/islands"
	_ "github.com/ftqo/costan.io/engine/knights"
	_ "github.com/ftqo/costan.io/engine/rivers"
	_ "github.com/ftqo/costan.io/engine/scenarios"
	_ "github.com/ftqo/costan.io/engine/wagons"
)

// The operator must be told when the ruleset they typed is not the canonical
// spelling that gets played (base+islands+cak plays as base+cak+islands).
func TestCanonicaliseRulesetNotice(t *testing.T) {
	for _, tc := range []struct {
		in, want string
		notice   bool
	}{
		{"base+islands+cak", "base+cak+islands", true},
		{"base+islands+caravans", "base+caravans+islands", true},
		{"base+cak+islands", "base+cak+islands", false},
		{"base", "base", false},
		{"base+islands", "base+islands", false},
	} {
		var out strings.Builder
		got := canonicaliseRuleset(&out, tc.in)
		if got != tc.want {
			t.Errorf("canonicaliseRuleset(%q) = %q, want %q", tc.in, got, tc.want)
		}
		switch msg := out.String(); {
		case tc.notice && msg == "":
			t.Errorf("%q: silently played %q, no notice", tc.in, got)
		case !tc.notice && msg != "":
			t.Errorf("%q is already canonical but printed a notice: %q", tc.in, msg)
		case tc.notice:
			// The notice is only useful if it names both spellings.
			if !strings.Contains(msg, tc.in) || !strings.Contains(msg, tc.want) {
				t.Errorf("%q: notice %q does not name both spellings", tc.in, msg)
			}
		}
	}
}
