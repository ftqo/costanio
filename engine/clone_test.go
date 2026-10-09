package engine

import (
	"testing"

	"github.com/ftqo/costan.io/engine/board"
)

// TestCloneIsolatesBoardScalars: Clone copies the board struct by value, so
// moving the robber on a clone (as finalize() does speculatively) must not
// move it on the live board. The Tiles map is shared; its only in-game
// mutator, the Knights Inventor swap, copies on write (see
// knights.TestInventorSwapsTokens).
func TestCloneIsolatesBoardScalars(t *testing.T) {
	events, err := New(GameConfig{Players: 4}, SeedsFrom(1))
	if err != nil {
		t.Fatal(err)
	}
	s := Empty()
	for _, e := range events {
		if err := Apply(s, e); err != nil {
			t.Fatal(err)
		}
	}

	orig := s.Board.Robber
	var other board.Hex
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		if _, ok := s.Board.Tiles[h]; ok && h != orig {
			other = h
			break
		}
	}

	c := s.Clone()
	c.Board.Robber = other

	if s.Board.Robber != orig {
		t.Fatalf("Clone shares the board: original robber moved (got %v, want %v)",
			s.Board.Robber, orig)
	}
	if c.Board.Robber != other {
		t.Fatalf("clone's robber was not moved independently (got %v, want %v)", c.Board.Robber, other)
	}
}
