package knights

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// emptyKnightVertex reports whether v holds no building and no knight.
func emptyKnightVertex(s *engine.State, v board.Vertex) bool {
	if v.Side > board.S || !s.Board.LandVertex(v) {
		return false
	}
	if _, ok := s.Buildings[v]; ok {
		return false
	}
	if _, ok := ext(s).Knights[v]; ok {
		return false
	}
	return true
}

// findDisplacementSetup locates from→to (a land edge, both ends empty) plus an
// optional dest vertex reachable from `to` over a distinct land edge, so a
// displaced knight at `to` can relocate to `dest`.
func findDisplacementSetup(s *engine.State) (from, to board.Vertex, toDest board.Edge, dest board.Vertex, ok bool) {
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, e := range h.Edges() {
			if !s.Board.LandEdge(e) || !emptyKnightVertex(s, e.A) || !emptyKnightVertex(s, e.B) {
				continue
			}
			for _, end := range [2][2]board.Vertex{{e.A, e.B}, {e.B, e.A}} {
				f, t := end[0], end[1]
				for _, e2 := range t.Edges() {
					if e2 == e || !s.Board.LandEdge(e2) {
						continue
					}
					d := e2.Other(t)
					if d == f || !emptyKnightVertex(s, d) {
						continue
					}
					return f, t, e2, d, true
				}
			}
		}
	}
	return board.Vertex{}, board.Vertex{}, board.Edge{}, board.Vertex{}, false
}

func TestKnightMoveDisplacesWeakerAndRelocates(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	rolled(t, s)
	p := s.Cur
	q := (p + 1) % engine.PlayerID(len(s.Players))
	x := ext(s)

	from, to, toDest, dest, ok := findDisplacementSetup(s)
	if !ok {
		fixtureGone(t, "no clean displacement geometry on this board")
	}
	// p's road from→to, q's road to→dest (so the displaced knight can relocate).
	s.Roads[board.NewEdge(from, to)] = p
	s.Roads[toDest] = q
	x.Knights[from] = Knight{Owner: p, Level: 2, Active: true}
	x.Knights[to] = Knight{Owner: q, Level: 1, Active: true}

	step(t, s, engine.Command{Player: p, Type: CmdMoveKnight,
		Data: mustJSON(t, map[string]any{"from": from, "to": to})})

	if k, ok := x.Knights[to]; !ok || k.Owner != p || k.Active {
		t.Errorf("mover should occupy `to`, deactivated: %+v ok=%v", k, ok)
	}
	if _, ok := x.Knights[from]; ok {
		t.Error("mover should have left `from`")
	}
	// The displaced owner chooses where to relocate (along their routes).
	if x.RelocPlayer != q {
		t.Fatalf("displaced owner %d should owe a relocation, got %d", q, x.RelocPlayer)
	}
	step(t, s, engine.Command{Player: q, Type: CmdRelocateKnight,
		Data: mustJSON(t, map[string]any{"to": dest})})
	dk, ok := x.Knights[dest]
	if !ok || dk.Owner != q || dk.Level != 1 || !dk.Active {
		t.Errorf("displaced knight should relocate to dest preserving level/active: %+v ok=%v", dk, ok)
	}
}

func TestKnightMoveCannotDisplaceEqualOrStronger(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	rolled(t, s)
	p := s.Cur
	q := (p + 1) % engine.PlayerID(len(s.Players))
	x := ext(s)

	from, to, _, _, ok := findDisplacementSetup(s)
	if !ok {
		fixtureGone(t, "no clean displacement geometry on this board")
	}
	s.Roads[board.NewEdge(from, to)] = p
	x.Knights[from] = Knight{Owner: p, Level: 2, Active: true}
	x.Knights[to] = Knight{Owner: q, Level: 2, Active: true} // equal strength

	if _, err := engine.Decide(s, engine.Command{Player: p, Type: CmdMoveKnight,
		Data: mustJSON(t, map[string]any{"from": from, "to": to})}); err == nil {
		t.Fatal("equal-level enemy knight must not be displaceable")
	}
}

func TestIntrigueRelocatesDisplacedKnight(t *testing.T) {
	s, _ := newGame(t, 5, nil)
	rolled(t, s)
	p := s.Cur
	q := (p + 1) % engine.PlayerID(len(s.Players))
	x := ext(s)

	// Reuse the geometry: `to` holds q's knight on p's road; `dest` is reachable
	// via q's road.
	from, at, atDest, dest, ok := findDisplacementSetup(s)
	if !ok {
		fixtureGone(t, "no clean displacement geometry on this board")
	}
	_ = from
	s.Roads[board.NewEdge(from, at)] = p // p's road touches the enemy knight's vertex
	s.Roads[atDest] = q
	x.Knights[at] = Knight{Owner: q, Level: 3, Active: false} // any level: Intrigue has no gate
	x.Players[p].Progress = []ProgressCard{CardIntrigue}

	step(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: mustJSON(t, map[string]any{"card": CardIntrigue, "v": at})})

	if _, ok := x.Knights[at]; ok {
		t.Error("Intrigue should vacate the contested vertex")
	}
	if x.RelocPlayer != q {
		t.Fatalf("displaced owner %d should owe a relocation, got %d", q, x.RelocPlayer)
	}
	step(t, s, engine.Command{Player: q, Type: CmdRelocateKnight,
		Data: mustJSON(t, map[string]any{"to": dest})})
	dk, ok := x.Knights[dest]
	if !ok || dk.Owner != q || dk.Level != 3 {
		t.Errorf("displaced knight should relocate preserving level: %+v ok=%v", dk, ok)
	}
}
