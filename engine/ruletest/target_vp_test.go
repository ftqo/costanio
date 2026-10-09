package ruletest

import (
	"bufio"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/ftqo/costan.io/engine"
)

// The victory target of a combination is the one rule no module owns: it comes
// from every module's ConfigDefaulter and TargetVPAdjuster together. A module's
// own test can pass while the combined target is wrong (a defaulter that assumed
// the wrong sort order, or declined a row expecting an adjuster that does not
// exist). So this sweeps every valid ruleset through engine.ResolveTargetVP
// against a checked-in table, and separately against the numbers the specs state.

// TestEveryValidRulesetResolvesItsTarget walks every valid ruleset and holds
// each to testdata/target_vp.txt. A fixture rather than a second implementation
// of the resolution rule in Go, which would be another thing to get wrong.
//
// A changed row is a combination whose target moved; regenerate with
// COSTAN_UPDATE_TARGETS=1 only on purpose, and read the diff.
func TestEveryValidRulesetResolvesItsTarget(t *testing.T) {
	got := map[string]int{}
	for _, rs := range engine.ValidRulesets() {
		got[rs] = engine.ResolveTargetVP(engine.GameConfig{Players: 4, Ruleset: rs})
	}
	if os.Getenv("COSTAN_UPDATE_TARGETS") != "" {
		writeTargetTable(t, got)
		t.Fatal("rewrote testdata/target_vp.txt; read the diff, then run again without COSTAN_UPDATE_TARGETS")
	}
	want := readTargetTable(t)
	if len(got) != len(want) {
		t.Errorf("%d valid rulesets, the table has %d: regenerate it and read the diff", len(got), len(want))
	}
	for rs, n := range got {
		w, ok := want[rs]
		if !ok {
			t.Errorf("%s is valid and absent from the table (target %d)", rs, n)
			continue
		}
		if n != w {
			t.Errorf("%s plays to %d, the table says %d", rs, n, w)
		}
	}
	for rs := range want {
		if _, ok := got[rs]; !ok {
			t.Errorf("%s is in the table and is not a valid ruleset", rs)
		}
	}
}

// TestSpecStatedTargets: every combination a rules spec states a number for,
// quoted where stated, asserted through the engine on the spelling a real game
// carries.
func TestSpecStatedTargets(t *testing.T) {
	for _, c := range []struct {
		ruleset string
		want    int
		where   string
	}{
		{"base", 10, "the base game"},
		{"base+islands", 10, "islands.md: no target change"},
		{"base+cak", 13, "knights.md: no dev cards, no Largest Army, target 13"},
		{"base+fishermen", 10, "scenarios.md: Fishermen changes no target (the old boot moves its holder's threshold, not the game's)"},
		{"base+caravans", 12, "scenarios.md, the Caravans half"},
		{"base+cak+caravans", 15, "the caravans/knights combination: the game ends at 15 victory points"},
		{"base+caravans+islands", 14, "the caravans/sea combination: the scenario's target rises by 2"},
		{"base+cak+caravans+islands", 17, "both combinations, composed"},
		{"base+rivers", 10, "rivers.md: the scenario does not move the threshold"},
		{"base+raiders", 12, "raiders.md: victory at 12"},
		{"base+cak+raiders", 13, "raiders.md: 13 under Knights"},
		{"base+wagons", 13, "wagons.md: base target 13"},
		{"base+cak+wagons", 15, "wagons.md's compatibility table"},
		{"base+caravans+wagons", 15, "wagons.md's compatibility table"},
		{"base+raiders+wagons", 14, "wagons.md's compatibility table; raiders.md now agrees"},
		{"base+harbormaster+wagons", 14, "wagons.md's compatibility table: target +1"},
		{"base+fishermen+wagons", 13, "wagons.md's compatibility table"},
		{"base+rivers+wagons", 13, "wagons.md's compatibility table"},
		{"base+harbormaster", 11, "harbormaster.md: the module adds one point to the game"},
		{"base+harbormaster+islands", 11, "harbormaster.md:153, in as many words"},
		{"explorers", 17, "explorers.md: the scenario owns its target outright, and is Standalone so its ruleset has no \"base+\""},
		{"cak+explorers", 22, "explorers.md, \"Knights in an Explorers game\" rule J: the combination's own formula, the Explorers scenario's target + 5 (for cities, metropolises and the Defender title), and 17 + 5 = 22"},
	} {
		if canon := engine.CanonicalRuleset(c.ruleset); canon != c.ruleset {
			t.Errorf("%q is not the spelling a game carries (%q)", c.ruleset, canon)
			continue
		}
		got := engine.ResolveTargetVP(engine.GameConfig{Players: 4, Ruleset: c.ruleset})
		if got != c.want {
			t.Errorf("%s plays to %d, want %d (%s)", c.ruleset, got, c.want, c.where)
		}
	}
}

// TestEveryTargetIsWinnable: the lobby refuses a target above
// engine.MaxVPWithoutCards, so a ruleset whose own default exceeds its ceiling
// cannot be created unless the host names a lower number. Checked for every
// ruleset through the engine: a module that raises the target must also raise
// the ceiling.
func TestEveryTargetIsWinnable(t *testing.T) {
	for _, rs := range engine.ValidRulesets() {
		for _, players := range []int{2, 4, 6, 10} {
			cfg := engine.GameConfig{Players: players, Ruleset: rs}
			target, ceiling := engine.ResolveTargetVP(cfg), engine.MaxVPWithoutCards(cfg)
			if target > ceiling {
				t.Errorf("%s/%dp resolves to %d, above the winnable ceiling %d",
					rs, players, target, ceiling)
			}
		}
	}
}

// writeTargetTable rewrites the fixture from the engine's own answers, sorted so
// a diff reads as a list of combinations rather than a reshuffle.
func writeTargetTable(t *testing.T, got map[string]int) {
	t.Helper()
	rows := make([]string, 0, len(got))
	for rs, n := range got {
		rows = append(rows, rs+" "+strconv.Itoa(n))
	}
	slices.Sort(rows)
	if err := os.WriteFile(filepath.Join("testdata", "target_vp.txt"),
		[]byte(strings.Join(rows, "\n")+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
}

func readTargetTable(t *testing.T) map[string]int {
	t.Helper()
	f, err := os.Open(filepath.Join("testdata", "target_vp.txt"))
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	out := map[string]int{}
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		rs, n, ok := strings.Cut(line, " ")
		if !ok {
			t.Fatalf("malformed row %q", line)
		}
		v, err := strconv.Atoi(strings.TrimSpace(n))
		if err != nil {
			t.Fatalf("malformed row %q: %v", line, err)
		}
		out[rs] = v
	}
	if err := sc.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}
