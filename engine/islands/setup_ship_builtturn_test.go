package islands

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// A free ship placed during setup must not be marked built this turn. That flag
// is a play-phase restriction, and player 0's first play turn gets no
// EvTurnReset (the setup-to-play EvTurnStarted rides a setup-phase command
// whose finalize returns early), so a marked setup ship would never become
// movable. A free Road Building ship during play is still marked. The phase at
// fold time distinguishes the two.
func TestSetupShipBuiltTurnByPhase(t *testing.T) {
	cases := []struct {
		name      string
		phase     engine.Phase
		wantBuilt bool
	}{
		{"setup ship is not built-this-turn", engine.PhaseSetup, false},
		{"road-building ship is built-this-turn", engine.PhasePlay, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := builtState(t, 2, board.Hex{Q: 1, R: 0})
			s.Phase = tc.phase
			e, _ := coastEdge(t, s)
			applyModuleEvent(t, s, engine.NewEvent(EvShipBuilt, shipData{Player: 0, E: e, Free: true}))
			if got := ext(s).BuiltTurn[e]; got != tc.wantBuilt {
				t.Fatalf("BuiltTurn[%v] = %v, want %v", e, got, tc.wantBuilt)
			}
		})
	}
}

// Player 0 must be able to move a setup ship on their first play turn even
// though no EvTurnReset clears BuiltTurn for that turn.
func TestSetupShipMovableOnFirstPlayTurn(t *testing.T) {
	s := builtState(t, 2, board.Hex{Q: 1, R: 0}, board.Hex{Q: 0, R: 1}, board.Hex{Q: -1, R: 1})

	// Anchor a coastal settlement and place a free setup ship from it, folding
	// the ship event while the game is still in the setup phase (as the engine
	// does for a round-2 setup connector).
	e1, v := coastEdge(t, s)
	s.Buildings[v] = engine.Building{Owner: 0}
	s.Phase = engine.PhaseSetup
	applyModuleEvent(t, s, engine.NewEvent(EvShipBuilt, shipData{Player: 0, E: e1, Free: true}))

	// Enter the first play turn without an EvTurnReset, as for player 0's first
	// turn.
	s.Phase = engine.PhasePlay
	s.Cur = 0
	s.Rolled = true

	// Destination: another free sea edge at the anchor vertex, so the ship still
	// connects to the network after the original edge is lifted.
	var to board.Edge
	for _, ne := range v.Edges() {
		if ne == e1 || !s.Board.SeaEdge(ne) {
			continue
		}
		if _, taken := ext(s).Ships[ne]; taken {
			continue
		}
		if _, taken := s.Roads[ne]; taken {
			continue
		}
		to = ne
		break
	}
	if (to == board.Edge{}) {
		t.Fatal("no free sea edge at the anchor vertex to move onto")
	}

	evs := step(t, s, engine.Command{Player: 0, Type: CmdMoveShip,
		Data: mustJSON(t, map[string]any{"from": e1, "to": to})})
	if !hasEvent(evs, EvShipMoved) {
		t.Fatalf("setup ship could not move on first play turn: %+v", evs)
	}
}
