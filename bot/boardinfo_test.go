package bot

import (
	"testing"

	"github.com/ftqo/costan.io/engine/board"
)

func TestBoardInfoMatchesDirect(t *testing.T) {
	s := newBaseGame(t, 7)
	bi := newBoardInfo(s.Board)

	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, v := range h.Vertices() {
			vi, ok := bi.vert[v]
			if !ok {
				t.Fatalf("vertex %+v missing from cache", v)
			}
			want := 0
			for _, hh := range v.Hexes() {
				if tl, ok := s.Board.Tiles[hh]; ok && tl.Res.Producing() {
					want += pips(tl.Number)
				}
			}
			if vi.pips != want {
				t.Errorf("vertex %+v pips = %d, want %d", v, vi.pips, want)
			}
			gotHarbor := vi.harbor != nil
			_, wantHarbor := s.Board.HarborAt(v)
			if gotHarbor != wantHarbor {
				t.Errorf("vertex %+v harbor presence = %v, want %v", v, gotHarbor, wantHarbor)
			}
		}
	}
	if len(bi.vertices) == 0 || len(bi.landEdges) == 0 {
		t.Fatalf("cache empty: %d vertices, %d land edges", len(bi.vertices), len(bi.landEdges))
	}
}

// TestPrimeBuildsCache verifies a primed bot holds a ready cache (built once at
// install) and that an unprimed bot still works via the lazy fallback.
func TestPrimeBuildsCache(t *testing.T) {
	s := newBaseGame(t, 7)

	primed := NewStrong()
	if primed.bi != nil {
		t.Fatal("cache should be nil before priming")
	}
	primed.Prime(s.Board)
	if primed.bi == nil {
		t.Fatal("Prime did not build the cache")
	}

	// Unprimed bot builds lazily on first cache use.
	lazy := NewStrong()
	if lazy.cache(s) == nil {
		t.Fatal("lazy fallback did not build the cache")
	}
}
