package knights

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// A displaced knight is rebuilt at its new vertex rather than moved, so
// PromotedThisTurn must be carried explicitly: being displaced never refunds a
// promotion.
func TestDisplacedKnightKeepsPromotedThisTurn(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	rolled(t, s)
	p := s.Cur
	q := (p + 1) % engine.PlayerID(len(s.Players))
	x := ext(s)

	from, to, toDest, dest, ok := findDisplacementSetup(s)
	if !ok {
		fixtureGone(t, "no clean displacement geometry on this board")
	}
	s.Roads[board.NewEdge(from, to)] = p
	s.Roads[toDest] = q
	x.Knights[from] = Knight{Owner: p, Level: 2, Active: true}
	x.Knights[to] = Knight{Owner: q, Level: 1, Active: true, PromotedThisTurn: true}

	step(t, s, engine.Command{Player: p, Type: CmdMoveKnight,
		Data: mustJSON(t, map[string]any{"from": from, "to": to})})
	step(t, s, engine.Command{Player: q, Type: CmdRelocateKnight,
		Data: mustJSON(t, map[string]any{"to": dest})})

	if k := x.Knights[dest]; !k.PromotedThisTurn {
		t.Errorf("relocated knight = %+v, want PromotedThisTurn kept", k)
	}
}
