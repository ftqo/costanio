package ruletest

import (
	"errors"
	"slices"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/raiders"
	"github.com/ftqo/costan.io/engine/scenarios"
)

// riderWithHurry plants one of p's riders on a road p owns and returns it with a
// destination only the hurry reaches. Any of p's setup roads is a land path, and
// on a board this size a rider there has paths four and five steps out.
func riderWithHurry(t *testing.T, s *engine.State, p engine.PlayerID) (from, to board.Edge) {
	t.Helper()
	rx, ok := raiders.StateExt(s)
	if !ok {
		t.Fatal("no raiders ext")
	}
	var roads []board.Edge
	for e, owner := range s.Roads {
		if owner == p {
			roads = append(roads, e)
		}
	}
	slices.SortFunc(roads, func(a, b board.Edge) int {
		for _, d := range [4]int{a.A.Q - b.A.Q, a.A.R - b.A.R, a.B.Q - b.B.Q, a.B.R - b.B.R} {
			if d != 0 {
				return d
			}
		}
		if a.A.Side != b.A.Side {
			return int(a.A.Side) - int(b.A.Side)
		}
		return int(b.B.Side) - int(a.B.Side)
	})
	for _, e := range roads {
		if _, taken := rx.RiderAt[e]; taken {
			continue
		}
		rx.RiderAt[e] = p
		for _, m := range raiders.MovesFor(s, p) {
			if m.From == e && len(m.Hurry) > 0 {
				return e, m.Hurry[0]
			}
		}
		delete(rx.RiderAt, e)
	}
	t.Fatal("no road of p's gives a rider a hurry-only destination")
	return
}

// TestTwoFishHurryARider: under Fishermen with Raiders, 2 fish move one of your
// knights up to five edges as if you had paid 1 wheat. Raiders' marching piece is
// the rider, so the fish buy the rider's five-path move instead of the grain.
func TestTwoFishHurryARider(t *testing.T) {
	s := playState(t, engine.CanonicalRuleset("base+fishermen+raiders"), 4)
	s.Rolled = true
	p := s.Cur
	from, to := riderWithHurry(t, s, p)
	s.Players[p].Hand = engine.Hand{} // no grain: the fish must pay on their own
	giveFish(t, s, p, 3)
	cmd := func(from, to board.Edge) engine.Command {
		return engine.Command{Player: p, Type: scenarios.CmdSpendFish,
			Data: rawCmd(map[string]any{"use": scenarios.FishRiderHurry, "from": from, "to": to})}
	}
	// An out-of-reach destination is refused, and costs nothing.
	far := board.Edge{}
	rx, _ := raiders.StateExt(s)
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, e := range h.Edges() {
			e = board.NewEdge(e.A, e.B)
			if e != from && !slices.Contains(raiders.MovesFor(s, p)[0].To, e) && !slices.Contains(raiders.MovesFor(s, p)[0].Hurry, e) {
				if _, taken := rx.RiderAt[e]; !taken {
					far = e
				}
			}
		}
	}
	if _, err := engine.Decide(s, cmd(from, far)); !errors.Is(err, engine.ErrBadPlacement) {
		t.Fatalf("out-of-reach hurry: err %v, want ErrBadPlacement", err)
	}
	if fishHeld(t, s, p) != 3 {
		t.Fatal("a refused hurry spent fish")
	}
	// The hurry: the rider moves five paths, two fish leave (two 1-tiles),
	// and no grain is taken.
	applyWagonCommand(t, s, cmd(from, to))
	if rx.RiderAt[to] != p {
		t.Fatalf("rider not on %v after the fish hurry", to)
	}
	if _, still := rx.RiderAt[from]; still {
		t.Fatal("rider still on its old path")
	}
	if fishHeld(t, s, p) != 1 {
		t.Fatalf("fish after the hurry = %d, want 1", fishHeld(t, s, p))
	}
	if s.Players[p].Hand[board.Wheat] != 0 {
		t.Fatal("the fish hurry touched the grain")
	}
	// Once per rider, whatever paid: the same rider may not hurry again.
	giveFish(t, s, p, 2)
	for _, e := range raiders.MovesFor(s, p) {
		if e.From == to {
			t.Fatal("a rider that moved is still listed as movable")
		}
	}
	if _, err := engine.Decide(s, cmd(to, from)); err == nil {
		t.Fatal("a rider hurried twice in one turn")
	}
}

// TestTwoFishHurryNeedsRiders: the rung exists only where there are riders.
// Elsewhere it is refused before a tile is spent.
func TestTwoFishHurryNeedsRiders(t *testing.T) {
	s := playState(t, "base+fishermen", 4)
	s.Rolled = true
	p := s.Cur
	giveFish(t, s, p, 2)
	e := board.Edge{}
	for road, owner := range s.Roads {
		if owner == p {
			e = road
		}
	}
	_, err := engine.Decide(s, engine.Command{Player: p, Type: scenarios.CmdSpendFish,
		Data: rawCmd(map[string]any{"use": scenarios.FishRiderHurry, "from": e, "to": e})})
	if !errors.Is(err, scenarios.ErrSpendUnavailable) {
		t.Fatalf("rider hurry without Raiders: err %v, want ErrSpendUnavailable", err)
	}
	if fishHeld(t, s, p) != 2 {
		t.Fatal("refusal spent fish")
	}
}
