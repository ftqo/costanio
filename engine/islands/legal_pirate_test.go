package islands

import (
	"errors"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// The offered pirate-hex set must exactly equal what decideMovePirate accepts as
// a placement, across every hex (sea, land, the pirate's own hex).
func TestLegalPirateHexesMatchesValidator(t *testing.T) {
	sea := []board.Hex{
		{Q: 2, R: -2}, {Q: 2, R: -1}, {Q: 2, R: 0}, {Q: 1, R: 1}, {Q: -1, R: 2},
	}
	s := builtState(t, 3, sea...)
	s.RobberPending = true
	s.PendingDiscards = nil

	offered := map[board.Hex]bool{}
	for _, h := range legalPirateHexes(s, s.Cur) {
		offered[h] = true
	}
	if len(offered) == 0 {
		t.Fatal("no pirate hexes offered while RobberPending")
	}
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		_, err := engine.Decide(s, engine.Command{Player: s.Cur, Type: CmdMovePirate,
			Data: mustJSON(t, map[string]any{"hex": h})})
		legal := !errors.Is(err, engine.ErrBadPlacement)
		if offered[h] != legal {
			t.Errorf("hex %v: offered=%v but validator-legal=%v", h, offered[h], legal)
		}
	}

	// And the engine surfaces them through LegalTargetsFor for the FE.
	lt := s.LegalTargetsFor(s.Cur)
	if len(lt.PirateHexes) != len(offered) {
		t.Errorf("LegalTargetsFor.PirateHexes = %d; want %d", len(lt.PirateHexes), len(offered))
	}
}
