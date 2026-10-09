package lobby

import (
	"errors"
	"testing"

	"github.com/ftqo/costan.io/engine"
	_ "github.com/ftqo/costan.io/engine/harbormaster"
	_ "github.com/ftqo/costan.io/engine/islands"
	_ "github.com/ftqo/costan.io/engine/knights"
	_ "github.com/ftqo/costan.io/engine/rivers"
	_ "github.com/ftqo/costan.io/engine/scenarios"
	_ "github.com/ftqo/costan.io/engine/wagons"
)

// A config naming two expansions that cannot share a board is refused at
// creation with its own error, not as a generic bad config: the host needs to
// know which pair conflicts, which is a different fix from a client sending an
// unknown module name.
func TestValidateConfigRejectsConflicts(t *testing.T) {
	cfg := engine.GameConfig{Players: 4, Ruleset: "base+explorers+islands"}
	err := validateConfig(&cfg)
	if !errors.Is(err, ErrRulesetConflict) {
		t.Fatalf("validateConfig = %v, want ErrRulesetConflict", err)
	}
	// Not ErrBadConfig: the transport layer switches on these in order and
	// would send BAD_CONFIG for a refusal that has a code of its own.
	if errors.Is(err, ErrBadConfig) {
		t.Error("a ruleset conflict must not also satisfy ErrBadConfig")
	}
	// The pair and its reason survive the wrapping, which is what lets the API
	// send named module keys instead of a server-composed sentence.
	var ce *engine.ConflictError
	if !errors.As(err, &ce) {
		t.Fatal("the engine's typed conflict did not survive wrapping")
	}
	if ce.A != "explorers" || ce.B != "islands" || ce.Reason == "" {
		t.Errorf("conflict carries %+v", ce.Conflict)
	}

	// An unknown module is still an unknown module.
	bad := engine.GameConfig{Players: 4, Ruleset: "base+nosuchthing"}
	if err := validateConfig(&bad); !errors.Is(err, ErrBadConfig) || errors.Is(err, ErrRulesetConflict) {
		t.Errorf("unknown module err = %v, want ErrBadConfig and not ErrRulesetConflict", err)
	}

	// The rulesets the lobby offers still validate. Islands is left out here
	// only: it also requires open water, so a default land board fails it for
	// an unrelated reason. engine's TestShippedModulesAllCompose covers every
	// subset including Islands, without a board.
	for _, ok := range []string{
		"base",
		"base+cak",
		"base+fishermen",
		"base+caravans",
		"base+cak+caravans+fishermen",
		"base+wagons",
		engine.CanonicalRuleset("base+caravans+wagons"),
	} {
		good := engine.GameConfig{Players: 4, Ruleset: ok}
		if err := validateConfig(&good); err != nil {
			t.Errorf("validateConfig(%q) = %v", ok, err)
		}
	}
}

// The same refusal reaches a real Create, not just the validator, and it does
// so before any row is written.
func TestCreateRefusesConflictingExpansions(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "rx", "Host")

	_, err := l.Create(host, engine.GameConfig{Players: 4, Ruleset: "base+explorers+islands"}, false)
	if !errors.Is(err, ErrRulesetConflict) {
		t.Fatalf("Create = %v, want ErrRulesetConflict", err)
	}
}
