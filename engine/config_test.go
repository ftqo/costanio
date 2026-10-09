package engine

import (
	"testing"

	"github.com/ftqo/costan.io/engine/board"
)

// TestConfigDefaults pins the defaults the lobby UI shows: an unset dice mode
// resolves to "random" (true dice), an unset board mode to "fair".
func TestConfigDefaults(t *testing.T) {
	c := GameConfig{}.withDefaults()
	if c.DiceMode != DiceRandom {
		t.Errorf("default DiceMode = %q, want %q", c.DiceMode, DiceRandom)
	}
	if c.BoardMode != board.BoardFair {
		t.Errorf("default BoardMode = %q, want %q", c.BoardMode, board.BoardFair)
	}
}
