package engine

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// specRefusal is one entry of the expected refusal table, transcribed from the
// rules specs rather than from compat.go. `cite` names the `## Compatibility`
// section each row came from, so a disagreement can be settled by reading it.
type specRefusal struct {
	a, b string
	cite string
}

// expectedRefusals is the compatibility matrix, one row per refused pair, from
// the specs' `## Compatibility` sections. Everything not listed is allowed; the
// list must equal Conflicts exactly, so an unsourced addition fails as surely
// as a removal.
var expectedRefusals = []specRefusal{
	// docs/rules/explorers.md declares the module standalone and gives one row
	// per partner. Six of the seven are refusals; Fishermen is a variant deferred
	// for now ("Rejected for now"). Knights must not appear here: it is allowed via
	// Explorers' StandaloneCompanions entry (see "Knights in an Explorers game" and
	// TestExplorersTakesKnightsAndNothingElse).
	{"caravans", "explorers", `explorers.md: Caravans row, "Explorers has no longest route to double and a 17 VP target that a second VP engine would wreck"`},
	{"explorers", "fishermen", `explorers.md: Fishermen row, workable with substitutions but "Rejected for now", three of the five fish spends redefined`},
	{"explorers", "harbormaster", `explorers.md + harbormaster.md: "there are no harbours in Explorers", and the pairing "is refused in engine.ValidRuleset rather than degraded"`},
	{"explorers", "islands", `explorers.md: Islands row, "Both modules also own the pirate, and they are different pieces with different rules. There is no reconciliation, only a choice."`},
	{"explorers", "raiders", `raiders.md: Explorers row, "Not allowed. Explorers is a Standalone"; explorers.md: "no fixed board, no knights, and the castle position would sit in the fog"`},
	{"explorers", "rivers", `rivers.md: "Explorers is standalone: it replaces the board Rivers derives from"`},
	{"explorers", "wagons", `wagons.md: Explorers row, refused on balance grounds and structurally as well`},

	// The one refusal that is not about Explorers.
	{"islands", "wagons", `wagons.md: "Islands: refused. The scenario needs one contiguous, roughly round landmass ... Refused in engine.ValidRuleset."`},
}

// expectedWarnings is the same, for pairings that are legal and degraded.
var expectedWarnings = []specRefusal{
	{"caravans", "wagons", `wagons.md: "there is no Longest Road award here, so the camels' road-doubling effect is dead. Only the between-two-camels VP survives."`},
}

// tableRows renders a table as sorted "a+b" keys, for comparison.
func tableRows(t map[combinationKey]string) []string {
	var out []string
	for k := range t {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

func expectedRows(rows []specRefusal) []string {
	var out []string
	for _, r := range rows {
		out = append(out, r.a+"+"+r.b)
	}
	sort.Strings(out)
	return out
}

// Conflicts and Warnings must say exactly what the specs say: no pair missing,
// and none present that no spec asked for.
func TestCompatTablesMatchTheSpecs(t *testing.T) {
	if got, want := tableRows(Conflicts), expectedRows(expectedRefusals); !equalStrings(got, want) {
		t.Errorf("Conflicts disagrees with the rules specs.\n  have: %v\n  want: %v", got, want)
	}
	if got, want := tableRows(Warnings), expectedRows(expectedWarnings); !equalStrings(got, want) {
		t.Errorf("Warnings disagrees with the rules specs.\n  have: %v\n  want: %v", got, want)
	}
	// The citations exist to be read, so an empty one is a row nobody can check.
	for _, r := range append(append([]specRefusal{}, expectedRefusals...), expectedWarnings...) {
		if strings.TrimSpace(r.cite) == "" {
			t.Errorf("%s+%s has no spec citation", r.a, r.b)
		}
	}
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// The tables are keyed by a sorted pair and read through accessors that sort
// first. An unsorted key would be unreachable through ConflictBetween and look
// like an allowed pairing.
func TestCompatTablesAreCanonicallyKeyed(t *testing.T) {
	known := map[string]bool{}
	for _, m := range KnownModules {
		known[m] = true
	}
	if !sort.StringsAreSorted(KnownModules) {
		t.Errorf("KnownModules is not sorted: %v", KnownModules)
	}
	for name, table := range map[string]map[combinationKey]string{"Conflicts": Conflicts, "Warnings": Warnings} {
		for key, reason := range table {
			k := strings.Split(key, "+")
			if len(k) < 2 || combination(k...) != key {
				t.Errorf("%s key %v is not a sorted pair of two distinct names", name, k)
			}
			for _, n := range k {
				if !known[n] {
					t.Errorf("%s key %v names %q, which is not in KnownModules", name, k, n)
				}
			}
			if reason == "" {
				t.Errorf("%s key %v has no reason", name, k)
			}
		}
	}
	// A pair cannot be refused and merely warned about at the same time.
	for k := range Conflicts {
		if _, both := Warnings[k]; both {
			t.Errorf("pair %v is in both Conflicts and Warnings", k)
		}
	}
	// Symmetry, through the accessors, in both directions.
	for key, want := range Conflicts {
		k := strings.Split(key, "+")
		if len(k) != 2 {
			continue
		}
		for _, order := range [][2]string{{k[0], k[1]}, {k[1], k[0]}} {
			if got, ok := ConflictBetween(order[0], order[1]); !ok || got != want {
				t.Errorf("ConflictBetween(%q, %q) = %q, %v; want the table's reason", order[0], order[1], got, ok)
			}
		}
	}
	for key, want := range Warnings {
		k := strings.Split(key, "+")
		if len(k) != 2 {
			continue
		}
		for _, order := range [][2]string{{k[0], k[1]}, {k[1], k[0]}} {
			if got, ok := WarningBetween(order[0], order[1]); !ok || got != want {
				t.Errorf("WarningBetween(%q, %q) = %q, %v; want the table's reason", order[0], order[1], got, ok)
			}
		}
	}
}

// Every reason is player-facing copy: one sentence, no em dashes, and no
// leading lowercase, since each is shown as a standalone line beside a toggle.
func TestCompatReasonsArePlayerReadable(t *testing.T) {
	for name, table := range map[string]map[combinationKey]string{"Conflicts": Conflicts, "Warnings": Warnings} {
		for key, reason := range table {
			k := strings.Split(key, "+")
			where := name + " " + k[0] + "+" + k[1]
			if strings.Contains(reason, "\u2014") {
				t.Errorf("%s: no em dashes in user-facing text: %q", where, reason)
			}
			if !strings.HasSuffix(reason, ".") {
				t.Errorf("%s: reason should be a sentence ending in a period: %q", where, reason)
			}
			if r := []rune(reason); len(r) == 0 || !(r[0] >= 'A' && r[0] <= 'Z') {
				t.Errorf("%s: reason should start with a capital: %q", where, reason)
			}
			// One sentence: a period anywhere but the end is a second one.
			if strings.Contains(strings.TrimSuffix(reason, "."), ". ") {
				t.Errorf("%s: reason should be one sentence: %q", where, reason)
			}
			if len(reason) > 160 {
				t.Errorf("%s: reason is %d chars, want <= 160", where, len(reason))
			}
		}
	}
}

// A ruleset's conflicts and warnings do not depend on how the string spells its
// modules, and a string with no pair in either table reports nothing.
func TestRulesetConflictsAndWarnings(t *testing.T) {
	for _, spelling := range []string{"explorers+islands", "islands+explorers", "base+islands+explorers"} {
		got := RulesetConflicts(spelling)
		if len(got) != 1 || got[0].A != "explorers" || got[0].B != "islands" {
			t.Fatalf("RulesetConflicts(%q) = %+v", spelling, got)
		}
	}
	// Several refusals come back together, sorted, so a caller can list every
	// reason.
	multi := RulesetConflicts("base+explorers+islands+cak+wagons")
	var keys []string
	for _, c := range multi {
		keys = append(keys, c.A+"+"+c.B)
	}
	// cak is absent: the Knights pairing is allowed, so only the other partners are
	// refused.
	want := []string{"explorers+islands", "explorers+wagons", "islands+wagons"}
	if !equalStrings(keys, want) {
		t.Errorf("RulesetConflicts multi = %v, want %v", keys, want)
	}
	for _, clean := range []string{"", "base", "base+cak+islands+fishermen+caravans", "base+caravans+wagons"} {
		if got := RulesetConflicts(clean); len(got) != 0 {
			t.Errorf("RulesetConflicts(%q) = %+v, want none", clean, got)
		}
	}
	if got := RulesetWarnings("base+caravans+wagons"); len(got) != 1 || got[0].A != "caravans" || got[0].B != "wagons" {
		t.Errorf("RulesetWarnings = %+v", got)
	}
	// A warning is not a conflict: the pairing plays.
	if got := RulesetWarnings("base+cak+islands"); len(got) != 0 {
		t.Errorf("RulesetWarnings(base+cak+islands) = %+v, want none", got)
	}
}

// Resolution refuses a conflicting ruleset with the typed error, whether or not
// the named modules are compiled in, so the host sees the pair and reason
// rather than "unknown module".
func TestModulesForRefusesConflictingPairs(t *testing.T) {
	err := CheckRuleset("base+explorers+islands")
	var ce *ConflictError
	if !errors.As(err, &ce) {
		t.Fatalf("CheckRuleset = %v, want a *ConflictError", err)
	}
	if ce.A != "explorers" || ce.B != "islands" || ce.Reason == "" {
		t.Errorf("conflict error carries %+v", ce.Conflict)
	}
	if !strings.Contains(ce.Error(), ce.Reason) {
		t.Errorf("error text drops the reason: %q", ce.Error())
	}
	if ValidRuleset("base+explorers+islands") {
		t.Error("a conflicting ruleset must not validate")
	}
	// And the pre-existing refusals still read as themselves.
	if err := CheckRuleset("base+nope"); err == nil || errors.As(err, &ce) {
		t.Errorf("unknown module should not be a conflict: %v", err)
	}
}

// Everything the lobby offers must stay legal. This package registers no
// expansion (they are blank-imported elsewhere), so only the pairwise table is
// checked here; verify/compat_test.go runs full resolution over the audit's
// ruleset list with every module registered.
func TestShippedModulesAllCompose(t *testing.T) {
	mods := []string{"islands", "cak", "fishermen", "caravans"}
	for i := range 1 << len(mods) {
		var parts []string
		for j, m := range mods {
			if i&(1<<j) != 0 {
				parts = append(parts, m)
			}
		}
		ruleset := CanonicalRuleset(strings.Join(append([]string{"base"}, parts...), "+"))
		if c := RulesetConflicts(ruleset); len(c) != 0 {
			t.Errorf("ruleset %q now conflicts: %+v", ruleset, c)
		}
		if w := RulesetWarnings(ruleset); len(w) != 0 {
			t.Errorf("ruleset %q now warns: %+v", ruleset, w)
		}
	}
}

// compatFile is the shape written to testdata for the frontend's mirror.
type compatFile struct {
	Modules             []string   `json:"modules"`
	Conflicts           []Conflict `json:"conflicts"`
	Warnings            []Warning  `json:"warnings"`
	CombinationExamples []Conflict `json:"combination_examples"`
}

const compatGolden = "testdata/expansion_compat.json"

// The frontend mirror. The lobby disables toggles client-side and no endpoint
// serves the table, so this test writes the Go table to a golden file and
// frontend/src/lib/expansionCompat.test.ts fails when the TypeScript mirror
// differs. The file is written only on mismatch, so a green run leaves the tree
// clean.
func TestCompatGoldenIsCurrent(t *testing.T) {
	want := compatFile{Modules: KnownModules, CombinationExamples: []Conflict{
		{A: "cak", B: "islands", Also: []string{"raiders"}, Reason: "Synthetic triple for compatibility matching tests."},
		{A: "cak", B: "fishermen", Also: []string{"islands", "raiders"}, Reason: "Synthetic four-module combination for compatibility matching tests."},
	}}
	for k, reason := range Conflicts {
		want.Conflicts = append(want.Conflicts, combinationConflict(k, reason))
	}
	for k, reason := range Warnings {
		want.Warnings = append(want.Warnings, combinationConflict(k, reason))
	}
	byPair := func(s []Conflict) func(i, j int) bool {
		return func(i, j int) bool {
			if s[i].A != s[j].A {
				return s[i].A < s[j].A
			}
			return s[i].B < s[j].B
		}
	}
	sort.Slice(want.Conflicts, byPair(want.Conflicts))
	sort.Slice(want.Warnings, byPair(want.Warnings))

	encoded, err := json.MarshalIndent(want, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	encoded = append(encoded, '\n')

	have, readErr := os.ReadFile(compatGolden)
	if readErr == nil && string(have) == string(encoded) {
		return
	}
	if err := os.MkdirAll(filepath.Dir(compatGolden), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(compatGolden, encoded, 0o644); err != nil {
		t.Fatal(err)
	}
	t.Errorf("%s was stale and has been rewritten; update frontend/src/lib/expansionCompat.ts to match", compatGolden)
}

// Holds the matrix to the `## Compatibility` tables in docs/rules/. Only rows it
// can be sure of are parsed: a known module name in the first cell, and a
// second cell whose leading word is Yes or No once bolding is stripped
// ("**No**", "Yes", "**Yes**, with conditions"); prose verdicts ("**Never.**
// ...", "n/a") are skipped. explorers.md uses prose there and is covered by
// expectedRefusals instead.
//
// The row count and per-module coverage are asserted, so a table that stops
// being read fails. A section headed "## Compatibility: Fishermen" assigns a
// table to a module, which is how scenarios.md (two modules in one file) is
// read.
func TestSpecCompatibilityTablesAgree(t *testing.T) {
	// The specs write display names; the engine writes module names.
	moduleOf := map[string]string{
		"islands":      "islands",
		"knights":      "cak",
		"fishermen":    "fishermen",
		"caravans":     "caravans",
		"rivers":       "rivers",
		"raiders":      "raiders",
		"wagons":       "wagons",
		"harbormaster": "harbormaster",
		"explorers":    "explorers",
	}
	row := regexp.MustCompile(`^\|([^|]+)\|([^|]+)\|`)
	strip := func(s string) string {
		return strings.ToLower(strings.TrimSpace(strings.ReplaceAll(s, "*", "")))
	}

	files, err := filepath.Glob(filepath.Join("..", "docs", "rules", "*.md"))
	if err != nil {
		t.Fatal(err)
	}
	checked := 0
	covered := map[string]bool{}
	for _, f := range files {
		fileSelf, named := moduleOf[strings.TrimSuffix(filepath.Base(f), ".md")]
		src, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		self := ""
		for line := range strings.SplitSeq(string(src), "\n") {
			if strings.HasPrefix(line, "## ") {
				// harbormaster.md heads the same material "Composition", and scenarios.md
				// names one module per section.
				h := strip(line)
				head, rest, headed := strings.Cut(h, ":")
				self = ""
				if head != "## compatibility" && head != "## composition" {
					continue
				}
				switch {
				case headed:
					if m, ok := moduleOf[strings.TrimSpace(rest)]; ok {
						self = m
					}
				case named:
					self = fileSelf
				}
				if self != "" {
					covered[self] = true
				}
				continue
			}
			if self == "" {
				continue
			}
			m := row.FindStringSubmatch(line)
			if m == nil {
				continue
			}
			other, known := moduleOf[strip(m[1])]
			if !known || other == self {
				continue
			}
			// The leading word, so "**Yes**, with conditions" reads as yes and
			// "**Never.** ..." as neither.
			words := strings.FieldsFunc(strip(m[2]), func(r rune) bool {
				return r == ',' || r == '.' || r == ' '
			})
			if len(words) == 0 {
				continue
			}
			verdict := words[0]
			if verdict != "yes" && verdict != "no" {
				continue // prose verdict; covered by expectedRefusals
			}
			_, refused := ConflictBetween(self, other)
			if refused != (verdict == "no") {
				t.Errorf("%s says %s is %q, but the table %s it",
					filepath.Base(f), other, verdict,
					map[bool]string{true: "refuses", false: "allows"}[refused])
			}
			checked++
		}
	}
	// Every module's compatibility must be in a readable section, except
	// explorers.md, whose verdict column is prose ("**Never.** ...");
	// expectedRefusals pins its rows instead.
	for name, mod := range moduleOf {
		if mod == "explorers" {
			continue
		}
		if !covered[mod] {
			t.Errorf("%s has no ## Compatibility section", name)
		}
	}
	// Asserted, not logged. Raising it is normal (a new spec or module); lowering
	// it means a table stopped being read.
	const wantRows = 64
	if checked != wantRows {
		t.Errorf("checked %d spec table rows, want %d", checked, wantRows)
	}
}

// A three-way restriction must leave all of its pairs legal, match supersets,
// and reach CheckRuleset's typed transport error with every name intact.
func TestCompatibilityCombinations(t *testing.T) {
	const reason = "This test combination cannot be played together."
	key := combination("raiders", "cak", "islands", "cak")
	table := map[combinationKey]string{key: reason}
	for _, rs := range []string{"base+cak+islands", "base+cak+raiders", "base+islands+raiders"} {
		if got := rulesetPairings(rs, table); len(got) != 0 {
			t.Fatalf("pair %s matched triple: %+v", rs, got)
		}
	}
	for _, rs := range []string{"base+cak+islands+raiders", "raiders+islands+cak+cak", "base+fishermen+raiders+islands+cak"} {
		got := rulesetPairings(rs, table)
		if len(got) != 1 || strings.Join(got[0].Modules(), "+") != "cak+islands+raiders" {
			t.Fatalf("%s: %+v", rs, got)
		}
	}
	Conflicts[key] = reason
	t.Cleanup(func() { delete(Conflicts, key) })
	var ce *ConflictError
	if err := CheckRuleset("base+cak+islands+raiders"); !errors.As(err, &ce) || strings.Join(ce.Modules(), "+") != key {
		t.Fatalf("triple conflict lost its names: %v", err)
	}
}
