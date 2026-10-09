package sim

import (
	"errors"
	"strings"
	"testing"

	"github.com/ftqo/costan.io/engine"

	_ "github.com/ftqo/costan.io/engine/harbormaster"
	_ "github.com/ftqo/costan.io/engine/islands"
	_ "github.com/ftqo/costan.io/engine/knights"
	_ "github.com/ftqo/costan.io/engine/rivers"
	_ "github.com/ftqo/costan.io/engine/scenarios"
	_ "github.com/ftqo/costan.io/engine/wagons"
)

// noncanonical returns s after asserting it is not canonical. These tests need
// a hand-ordered spelling as their input, which TestEveryRulesetLiteralIsCanonical
// otherwise forbids, so arguments to this function are exempt. If module
// sorting changes and the fixture becomes canonical, this fails.
func noncanonical(t *testing.T, s string) string {
	t.Helper()
	if engine.CanonicalRuleset(s) == s {
		t.Fatalf("fixture %q is already canonical", s)
	}
	return s
}

// The engine game was always canonical (game.Manager.Start normalises cfg), but
// the row must be too: store.Game.Ruleset buckets per-ruleset stats and Elo, so
// a hand-ordered string would land games in a bucket no lobby game uses.
func TestRowRulesetIsCanonical(t *testing.T) {
	st := openStore(t)
	typed := noncanonical(t, "base+islands+cak")
	res, err := RunGame(st, Options{Players: 3, Ruleset: typed, TargetVP: 5, Seed: 4242})
	if err != nil {
		t.Fatal(err)
	}
	g, err := st.GameByID(res.GameID)
	if err != nil {
		t.Fatal(err)
	}
	want := engine.CanonicalRuleset(typed)
	if g.Ruleset != want {
		t.Errorf("games row ruleset = %q, want %q", g.Ruleset, want)
	}
	// The log is the source of truth; the row must agree with it.
	events, err := Transcript(st, res.GameID)
	if err != nil {
		t.Fatal(err)
	}
	state, err := engine.Replay(events)
	if err != nil {
		t.Fatal(err)
	}
	if state.Config.Ruleset != g.Ruleset {
		t.Errorf("row says ruleset %q but the event log says %q", g.Ruleset, state.Config.Ruleset)
	}
}

// Two spellings of an order-inert pair are the same game, so they must hash to
// one id, or ErrDuplicateGame misses the duplicate.
func TestOrderInertSpellingsShareGameID(t *testing.T) {
	st := openStore(t)
	typed := noncanonical(t, "base+islands+cak")
	canon := engine.CanonicalRuleset(typed)

	first, err := RunGame(st, Options{Players: 3, Ruleset: canon, TargetVP: 5, Seed: 77})
	if err != nil {
		t.Fatal(err)
	}
	_, err = RunGame(st, Options{Players: 3, Ruleset: typed, TargetVP: 5, Seed: 77})
	if !errors.Is(err, ErrDuplicateGame) {
		t.Fatalf("re-running %q as %q: got %v, want ErrDuplicateGame", canon, typed, err)
	}
	// The error names the id it collided with: same id, same row, one game.
	if !strings.Contains(err.Error(), first.GameID) {
		t.Errorf("duplicate error %q does not name %s", err, first.GameID)
	}
}
