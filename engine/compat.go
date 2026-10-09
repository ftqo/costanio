package engine

import (
	"fmt"
	"slices"
	"sort"
	"strings"
)

// Expansion compatibility.
//
// Some modules cannot sit beside others: Explorers refuses every partner except
// Knights (which has a full combination rule set), Wagons refuses Islands, and
// Wagons with Caravans is allowed but degraded. Each rules spec in docs/rules/
// has a `## Compatibility` section stating its refusals and why, and
// compat_test.go pins this table to them. The table is data so the lobby, the
// replay-upload path and the frontend all read the same thing. Names may refer
// to modules not yet registered, so a pairing can be enforced from the start.

// KnownModules is every expansion name the rules specs in docs/rules/ describe,
// sorted. It may be a superset of what is registered (all nine are registered
// today). Ruleset validation still rejects an unregistered name; this list only
// records what each name means so pairing rules can name it.
var KnownModules = []string{
	"cak",
	"caravans",
	"explorers",
	"fishermen",
	"harbormaster",
	"islands",
	"raiders",
	"rivers",
	"wagons",
}

// Conflict is one incompatible combination, with its player-readable reason.
// A and B are module names in sorted order, as the tables are keyed; Also
// carries any remaining names in sorted order. The reason is one sentence in
// the house style (no em dashes), shown in the lobby's disabled-toggle help and
// in the refusal, and says what breaks rather than citing a rule number.
type Conflict struct {
	A      string   `json:"a"`
	B      string   `json:"b"`
	Also   []string `json:"also,omitempty"`
	Reason string   `json:"reason"`
}

// Warning is a pairing that is allowed but degraded: one module switches off
// something in the other. Same shape as Conflict; the caller shows a note beside
// the toggle instead of disabling it.
type Warning = Conflict

// combinationKey is a sorted, deduplicated set of module names joined by +.
// Tables match the entire set, so a triple never disables one of its pairs.
type combinationKey = string

func combination(names ...string) combinationKey {
	names = slices.Clone(names)
	sort.Strings(names)
	return strings.Join(slices.Compact(names), "+")
}

func pair(a, b string) combinationKey { return combination(a, b) }

// Modules includes every member; A/B preserve the existing pair wire format.
func (c Conflict) Modules() []string { return append([]string{c.A, c.B}, c.Also...) }

func combinationConflict(key combinationKey, reason string) Conflict {
	names := strings.Split(key, "+")
	return Conflict{A: names[0], B: names[1], Also: names[2:], Reason: reason}
}

// Conflicts is the refusal table: sorted module set -> reason, stored once in
// canonical order. ConflictBetween looks up a pair in either order. Each entry
// is quoted from the pairing's rules spec; compat_test.go cites each and fails
// when they disagree.
var Conflicts = map[combinationKey]string{
	// Explorers is a Standalone (own board, setup, pieces and a third turn phase)
	// and refuses every module except Knights. There is one entry per partner
	// because the reason shown to the player differs. Knights is allowed through
	// Explorers' StandaloneCompanions entry, with ten lettered rules specified in
	// "Knights in an Explorers game" (docs/rules/explorers.md).
	//
	// Fishermen with Explorers is a workable variant with substitutions that is not
	// built yet (see the table in docs/rules/explorers.md), so it is refused for
	// now. The other six are structural or balance refusals. Reasons say what
	// costan has not built rather than inventing a rules problem.
	pair("explorers", "fishermen"):    "Fishermen and Explorers can only be combined by rewriting three of the five fish spends, which Costanio has not built.",
	pair("explorers", "islands"):      "Explorers and Islands both use ships and a pirate, and their rules for both are different.",
	pair("explorers", "caravans"):     "Explorers has no longest route for a caravan to double, so caravan scoring has nothing to measure.",
	pair("explorers", "rivers"):       "Explorers deals its map face down, so a river cannot be laid across it.",
	pair("explorers", "raiders"):      "Raiders needs a fixed coastline to land on and a castle to defend, and most of an Explorers map is face down when the game starts.",
	pair("explorers", "wagons"):       "Explorers is not a land connected map, so a wagon has no route to travel.",
	pair("explorers", "harbormaster"): "Explorers has no harbours, so there would be nothing to score.",

	// Wagons needs one contiguous, roughly round landmass so the three legs of the
	// delivery circuit are the same length, plus three coastal cape hexes for the
	// trade hexes. An Islands board is an archipelago, so neither is guaranteed.
	pair("wagons", "islands"): "Wagons cannot cross water, and an island board has no single landmass for the trade route to circle.",
}

// Warnings is the degraded-pairing table: pair -> reason, keyed like
// Conflicts. Both specs call these playable, but one module switches off
// something the other provides, so the lobby shows the note inline and leaves
// the toggle enabled.
var Warnings = map[combinationKey]string{
	// docs/rules/wagons.md: "there is no Longest Road award here, so the
	// camels' road-doubling effect is dead. Only the between-two-camels VP
	// survives."
	pair("wagons", "caravans"): "Wagons removes the Longest Road award, so the camels' road bonus does nothing (their settlement points still score).",
}

// ConflictBetween reports the refusal between two module names, if any. Order
// of the arguments does not matter.
func ConflictBetween(a, b string) (string, bool) {
	r, ok := Conflicts[pair(a, b)]
	return r, ok
}

// WarningBetween reports the degraded-pairing note between two module names, if
// any. Order of the arguments does not matter.
func WarningBetween(a, b string) (string, bool) {
	r, ok := Warnings[pair(a, b)]
	return r, ok
}

// rulesetModuleNames splits a ruleset string into its module names, dropping
// "base" and any empty part. It does not validate: an unknown name comes back
// as itself, since the tables may name unregistered modules.
func rulesetModuleNames(ruleset string) []string {
	var out []string
	seen := map[string]bool{}
	for part := range strings.SplitSeq(ruleset, "+") {
		if part == "" || part == "base" || seen[part] {
			continue
		}
		seen[part] = true
		out = append(out, part)
	}
	return out
}

// rulesetPairings matches each complete table key against a ruleset.
// The result is sorted by every module name so it reports combinations in
// the same order, whatever order the string spelled its modules in.
func rulesetPairings(ruleset string, table map[combinationKey]string) []Conflict {
	names := rulesetModuleNames(ruleset)
	var out []Conflict
	for key, reason := range table {
		required := strings.Split(key, "+")
		if len(required) >= 2 && !slices.ContainsFunc(required, func(n string) bool { return !slices.Contains(names, n) }) {
			out = append(out, combinationConflict(key, reason))
		}
	}
	sort.Slice(out, func(i, j int) bool { return strings.Join(out[i].Modules(), "+") < strings.Join(out[j].Modules(), "+") })
	return out
}

// RulesetConflicts lists every refused pairing in a ruleset string, sorted and
// deduplicated. An empty result means no pair in the string refuses another; it
// says nothing about whether the names are registered, which is modulesFor's
// job.
func RulesetConflicts(ruleset string) []Conflict {
	return rulesetPairings(ruleset, Conflicts)
}

// RulesetWarnings lists every degraded pairing in a ruleset string, sorted and
// deduplicated. These do not block a game; they are shown to the host.
func RulesetWarnings(ruleset string) []Warning {
	return rulesetPairings(ruleset, Warnings)
}

// ConflictError reports an incompatible module combination and its reason, so
// the transport can send a stable code plus named parameters. Typed so the
// lobby can tell it apart from an unknown module, which needs different
// recourse (drop an expansion versus update the client).
type ConflictError struct {
	Conflict
}

func (e *ConflictError) Error() string {
	return fmt.Sprintf("engine: %s cannot be combined: %s", strings.Join(e.Modules(), ", "), e.Reason)
}
