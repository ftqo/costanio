package bot

import (
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/harbormaster"
)

// Harbormaster adds no command: the card is derived from ordinary builds. The
// 2 VP and the raised target are already counted (PublicVPWithModules,
// engine.WinThreshold), but like Largest Army the bot needs a proximity term to
// build toward the card before holding it.

// harbourActive memoizes whether the Harbormaster module is in the ruleset.
func (b *Strong) harbourActive(s *engine.State) bool {
	if b.harbourOn == nil {
		on := false
		for _, m := range s.Modules() {
			if m.Name() == harbormaster.Name {
				on = true
				break
			}
		}
		b.harbourOn = &on
	}
	return *b.harbourOn
}

// harbourProximity rewards being close to the card without holding it, exactly
// as armyProximity does for Largest Army, and returns 0 once the card is held
// because those 2 VP are already in the VP term.
//
// A ramp toward the threshold of 3 (increments are 1 and 2), capped there, so
// it prices reaching the card rather than hoarding harbours past it.
//
// Not a "chase the leader" term: as with Longest Road (eval.go), chasing a
// title measured as a loss while valuing progress toward it paid.
func harbourProximity(s *engine.State, me engine.PlayerID) float64 {
	if harbormaster.Holder(s) == me {
		return 0 // already counted as +2 VP
	}
	n := harbormaster.HarborPoints(s, me)
	if n >= harbormaster.Threshold {
		// At or above the threshold but not holding it: somebody else leads, and
		// one more building takes the card.
		return 1
	}
	return float64(n) / float64(harbormaster.Threshold)
}
