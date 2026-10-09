// Package bot provides seat-takeover AIs. A bot is just another command
// source plugged into the game actor where auto-pass would act.
package bot

import "github.com/ftqo/costan.io/engine"

// Bot produces the next command for a seat. Implementations must return
// legal commands (the engine rejects illegal ones and the actor then falls
// back to minimal auto-pass for safety).
type Bot interface {
	Act(s *engine.State, seat engine.PlayerID) (engine.Command, bool)
}
