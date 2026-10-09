package verify

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
)

// Every ruleset this package plays a game under must stay legal.
//
// It reads verifyCases() rather than a copy of the list. It lives in verify/
// because this package blank-imports every module, so ValidRuleset sees the
// real registry.
//
// engine.RulesetConflicts is checked separately from engine.ValidRuleset
// (which subsumes it) so a failure says whether a conflict was added or a
// module stopped registering.
//
// Needs no node, so it runs even where the JavaScript tests skip.
func TestAuditedRulesetsStayLegal(t *testing.T) {
	seen := map[string]bool{}
	for _, tc := range verifyCases() {
		if seen[tc.ruleset] {
			continue
		}
		seen[tc.ruleset] = true
		if c := engine.RulesetConflicts(tc.ruleset); len(c) != 0 {
			t.Errorf("audited ruleset %q now carries a conflict: %+v", tc.ruleset, c)
		}
		if err := engine.CheckRuleset(tc.ruleset); err != nil {
			t.Errorf("audited ruleset %q no longer resolves: %v", tc.ruleset, err)
		}
	}
	if len(seen) < 10 {
		t.Fatalf("only %d rulesets in verifyCases(), want at least 10", len(seen))
	}
}
