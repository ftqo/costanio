package sim

import "github.com/ftqo/costan.io/engine"

// canonical maps hand-written ruleset spellings to the spelling a lobby
// produces: "base" first, then module names sorted.
//
// Every creation path canonicalises (lobby.Create, lobby's reconfigure,
// game.Manager), and module order matters at resolution (DefaultConfig is
// first-writer-wins, SetupBoard hooks run in ruleset-string order). A test that
// calls engine.New with a non-canonical spelling tests a module order no game
// has.
//
// Route every literal through here rather than hand-sorting, which goes stale
// when a module is renamed or added.
func canonical(rulesets []string) []string {
	out := make([]string, len(rulesets))
	for i, rs := range rulesets {
		out[i] = engine.CanonicalRuleset(rs)
	}
	return out
}
