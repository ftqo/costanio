package engine

import (
	"errors"
	"testing"

	"github.com/ftqo/costan.io/engine/board"
)

// robberPlacementLegal asks the validator, without mutating, whether the robber
// may be placed on h. A hex that needs a victim still counts as legal; only
// ErrBadPlacement means the hex is off-limits.
func robberPlacementLegal(t *testing.T, s *State, h board.Hex) bool {
	t.Helper()
	_, err := Decide(s, Command{Player: s.Cur, Type: CmdMoveRobber,
		Data: mustJSON(t, map[string]any{"hex": h})})
	return !errors.Is(err, ErrBadPlacement)
}

// The offered robber hex set must exactly equal the set the validator accepts,
// across every hex on the board (land, sea, the robber's own hex).
func assertRobberSetMatchesValidator(t *testing.T, s *State) {
	t.Helper()
	offered := map[board.Hex]bool{}
	for _, h := range s.LegalRobberHexes(s.Cur) {
		offered[h] = true
	}
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		if offered[h] != robberPlacementLegal(t, s, h) {
			t.Errorf("hex %v: offered=%v but validator-legal=%v", h, offered[h], !offered[h])
		}
	}
	if offered[s.Board.Robber] {
		t.Errorf("offered the robber's current hex %v", s.Board.Robber)
	}
}

func TestLegalRobberHexesMatchesValidator(t *testing.T) {
	s, _, _ := robberStage(t, 1)
	assertRobberSetMatchesValidator(t, s)
}

func TestLegalRobberHexesFriendlyMatchesValidator(t *testing.T) {
	s, protHex, targetHex := robberStage(t, 401)
	makeProtected(s, protHex, 1)
	makeUnprotected(s, targetHex, 2)
	s.Config.FriendlyRobber = true

	// With an unprotected target reachable, empty or protected-only hexes are
	// not legal placements, so the offered set must drop them.
	assertRobberSetMatchesValidator(t, s)
	offered := map[board.Hex]bool{}
	for _, h := range s.LegalRobberHexes(s.Cur) {
		offered[h] = true
	}
	if offered[protHex] {
		t.Error("friendly robber: protected-only hex must not be offered")
	}
	if !offered[targetHex] {
		t.Error("friendly robber: the reachable target hex must be offered")
	}
}

func TestLegalTargetsForRobberPending(t *testing.T) {
	s, _, _ := robberStage(t, 1)
	lt := s.LegalTargetsFor(s.Cur)
	if len(lt.RobberHexes) == 0 {
		t.Fatal("no robber hexes offered while RobberPending")
	}
	// Nothing else may be built until the robber is resolved.
	if len(lt.Settlements) != 0 || len(lt.Roads) != 0 || len(lt.Cities) != 0 {
		t.Errorf("offered build targets during RobberPending: %+v", lt)
	}
}
