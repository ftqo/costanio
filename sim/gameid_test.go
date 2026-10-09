package sim

import (
	"errors"
	"strings"
	"testing"

	_ "github.com/ftqo/costan.io/engine/harbormaster"
	_ "github.com/ftqo/costan.io/engine/islands"
	_ "github.com/ftqo/costan.io/engine/rivers"
	_ "github.com/ftqo/costan.io/engine/scenarios"
	_ "github.com/ftqo/costan.io/engine/wagons"
)

// TestCrossRulesetSweepSharesSeedRange: sweeping several rulesets over one seed
// range in a single store must not collide on games.id. A collision makes every
// game after the first ruleset fail to start, which a sweep that skips errors
// reports as zero completions.
//
// Cheap tier: a handful of short games at a low target VP.
func TestCrossRulesetSweepSharesSeedRange(t *testing.T) {
	st := openStore(t)
	rulesets := []string{"base", "base+islands", "base+caravans"}
	seen := map[string]string{}
	for _, rs := range rulesets {
		completed := 0
		for seed := uint64(1); seed <= 3; seed++ {
			res, err := RunGame(st, Options{Players: 3, Ruleset: rs, TargetVP: 6, Seed: seed})
			if err != nil {
				t.Fatalf("%s seed %d: %v", rs, seed, err)
			}
			if prev, dup := seen[res.GameID]; dup {
				t.Fatalf("%s seed %d reused game id %s (first used by %s)", rs, seed, res.GameID, prev)
			}
			seen[res.GameID] = rs
			completed++
		}
		if completed != 3 {
			t.Fatalf("%s: %d of 3 games completed", rs, completed)
		}
	}
}

// TestGameIDDeterministic: the id must be reproducible from the run alone, since
// the package asserts replay(events) == live state across seeds and rulesets.
func TestGameIDDeterministic(t *testing.T) {
	opts := Options{Players: 4, Ruleset: "base+islands", Seed: 7}
	cfg := []byte(`{"players":4,"ruleset":"base+islands"}`)
	a, b := GameID(opts, cfg), GameID(opts, cfg)
	if a != b {
		t.Fatalf("GameID not deterministic: %s vs %s", a, b)
	}
	other := opts
	other.Ruleset = "base"
	if c := GameID(other, []byte(`{"players":4,"ruleset":"base"}`)); c == a {
		t.Fatalf("two rulesets on one seed share id %s", a)
	}
	tagged := opts
	tagged.IDTag = "0:strong,1:simple"
	if c := GameID(tagged, cfg); c == a {
		t.Fatalf("IDTag ignored: both runs are %s", a)
	}
	if !strings.HasPrefix(a, "sim-7-") {
		t.Fatalf("id %s does not carry its seed in the clear", a)
	}
}

// TestDuplicateGameIsLoud: the original damage was that a collision looked like
// an empty result. A genuine duplicate run must name itself.
func TestDuplicateGameIsLoud(t *testing.T) {
	st := openStore(t)
	opts := Options{Players: 3, Ruleset: "base", TargetVP: 6, Seed: 99}
	if _, err := RunGame(st, opts); err != nil {
		t.Fatal(err)
	}
	_, err := RunGame(st, opts)
	if !errors.Is(err, ErrDuplicateGame) {
		t.Fatalf("re-running identical options: got %v, want ErrDuplicateGame", err)
	}
	if !strings.Contains(err.Error(), "sim-99-") {
		t.Fatalf("error does not name the colliding id: %v", err)
	}
}
