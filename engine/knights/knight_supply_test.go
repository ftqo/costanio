package knights

import (
	"errors"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// knightSpot returns a vertex where player p may legally build a knight.
func knightSpot(s *engine.State, p engine.PlayerID) (board.Vertex, bool) {
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, v := range h.Vertices() {
			if (Module{}).checkKnightSpot(s, v, p) == nil {
				return v, true
			}
		}
	}
	return board.Vertex{}, false
}

// nFreeVertices returns up to n distinct vertices (excluding `not`) holding no
// building or knight, for placing test knights.
func nFreeVertices(s *engine.State, x *Ext, not board.Vertex, n int) []board.Vertex {
	var out []board.Vertex
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, v := range h.Vertices() {
			if v == not {
				continue
			}
			if _, b := s.Buildings[v]; b {
				continue
			}
			if _, k := x.Knights[v]; k {
				continue
			}
			out = append(out, v)
			if len(out) == n {
				return out
			}
		}
	}
	return out
}

// TestKnightBuildCap: a player holding the maximum 2 basic knights cannot build
// a third (only 2 basic pieces exist per player).
func TestKnightBuildCap(t *testing.T) {
	s, _ := newGame(t, 9, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)

	spot, ok := knightSpot(s, p)
	if !ok {
		fixtureGone(t, "no legal knight spot on this seed")
	}
	slots := nFreeVertices(s, x, spot, 2)
	if len(slots) < 2 {
		fixtureGone(t, "board too small for the setup")
	}
	for _, v := range slots {
		x.Knights[v] = Knight{Owner: p, Level: 1}
	}
	s.Players[p].Hand = engine.Hand{board.Sheep: 1, board.Ore: 1}

	_, err := engine.Decide(s, engine.Command{Player: p, Type: CmdBuildKnight, Data: mustJSON(t, knightData{V: spot})})
	if !errors.Is(err, engine.ErrNoPieces) {
		t.Errorf("build past 2 basic knights err = %v, want ErrNoPieces", err)
	}
}

// TestKnightPromoteCap: a player already fielding 2 strong knights cannot
// promote a basic into a third strong knight.
func TestKnightPromoteCap(t *testing.T) {
	s, _ := newGame(t, 9, nil)
	rolled(t, s)
	p := s.Cur
	x := ext(s)

	vs := nFreeVertices(s, x, board.Vertex{}, 3)
	if len(vs) < 3 {
		fixtureGone(t, "board too small for the setup")
	}
	x.Knights[vs[0]] = Knight{Owner: p, Level: 1} // the one we try to promote
	x.Knights[vs[1]] = Knight{Owner: p, Level: 2}
	x.Knights[vs[2]] = Knight{Owner: p, Level: 2}
	s.Players[p].Hand = engine.Hand{board.Sheep: 1, board.Ore: 1}

	_, err := engine.Decide(s, engine.Command{Player: p, Type: CmdPromoteKnight, Data: mustJSON(t, knightData{V: vs[0]})})
	if !errors.Is(err, engine.ErrNoPieces) {
		t.Errorf("promote past 2 strong knights err = %v, want ErrNoPieces", err)
	}
}
