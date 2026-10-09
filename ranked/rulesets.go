// Package ranked implements ranked matchmaking: locked tournament rulesets,
// the in-process matchmaker, and queue bookkeeping. It depends on the lobby /
// game managers via interfaces and never imports engine rules logic beyond
// GameConfig.
package ranked

import (
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/timings"
)

// Queue describes a single ranked queue.
type Queue struct {
	Key     string
	Ruleset string
	Label   string
}

// Queues are the only ranked queues (4-player base and 4-player Knights).
var Queues = []Queue{
	{Key: "base", Ruleset: "base", Label: "Base (4p)"},
	{Key: "cak", Ruleset: "base+cak", Label: "Knights (4p)"},
}

// Rulesets returns the ruleset strings behind the ranked queues, in queue order.
// These are the only rulesets with a rating, so they are the only leaderboard
// categories; other rulesets sit at a placeholder 1000 ELO.
func Rulesets() []string {
	out := make([]string, len(Queues))
	for i, q := range Queues {
		out[i] = q.Ruleset
	}
	return out
}

// IsRuleset reports whether games on this ruleset move rating.
func IsRuleset(ruleset string) bool {
	for _, q := range Queues {
		if q.Ruleset == ruleset {
			return true
		}
	}
	return false
}

// Tunables for the locked competitive ruleset (see design §5). Turn budgets
// live in the timings package with the other game-loop clocks.
const (
	baseTurnTimerSec    = timings.RankedBaseTurnSec
	knightsTurnTimerSec = timings.RankedKnightsTurnSec
)

// ConfigFor returns the locked GameConfig for a queue key.
// Unknown queue keys return (zero, false).
//
// MemoryMode is always on in ranked: it hides the bank's remaining supply,
// every seat's VP total and event-log scrollback, which a rated game shouldn't
// track for the player. It changes no rule.
func ConfigFor(queueKey string) (engine.GameConfig, bool) {
	switch queueKey {
	case "base":
		return engine.GameConfig{
			Players:        4,
			TargetVP:       10,
			DiscardLimit:   7,
			TurnTimerSec:   baseTurnTimerSec,
			Ruleset:        "base",
			DiceMode:       engine.DiceRandom,
			BoardMode:      board.BoardFair,
			TurnOrder:      engine.TurnOrderRandom,
			FriendlyRobber: false,
			MemoryMode:     true,
		}, true
	case "cak":
		return engine.GameConfig{
			Players:        4,
			TargetVP:       13,
			DiscardLimit:   7,
			TurnTimerSec:   knightsTurnTimerSec,
			Ruleset:        "base+cak",
			DiceMode:       engine.DiceRandom,
			BoardMode:      board.BoardFair,
			TurnOrder:      engine.TurnOrderRandom,
			FriendlyRobber: false,
			MemoryMode:     true,
		}, true
	}
	return engine.GameConfig{}, false
}
