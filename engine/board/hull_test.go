package board

import "testing"

func setOf(hs ...Hex) map[Hex]struct{} {
	m := make(map[Hex]struct{}, len(hs))
	for _, h := range hs {
		m[h] = struct{}{}
	}
	return m
}

func TestHullInsideSingleHex(t *testing.T) {
	got := hullInside(setOf(Hex{0, 0}))
	if len(got) != 1 {
		t.Fatalf("single hex should yield only itself, got %d: %v", len(got), got)
	}
	if _, ok := got[Hex{0, 0}]; !ok {
		t.Fatalf("origin missing from result")
	}
}

func TestHullInsideCollinearGapFilled(t *testing.T) {
	// Three hexes on r=0 with the middle one missing: the gap is inside the
	// segment and must be filled; nothing off the line is added.
	got := hullInside(setOf(Hex{-1, 0}, Hex{1, 0}))
	if _, ok := got[Hex{0, 0}]; !ok {
		t.Errorf("collinear gap (0,0) should be filled")
	}
	for _, off := range []Hex{{0, -1}, {0, 1}, {-1, 1}, {1, -1}} {
		if _, ok := got[off]; ok {
			t.Errorf("off-segment hex %v must not be inside a collinear hull", off)
		}
	}
}

func TestHullInsideTriangleFillsInterior(t *testing.T) {
	// A triangle of land; an interior hex must be inside the hull.
	tri := setOf(Hex{-2, 0}, Hex{2, 0}, Hex{0, -2})
	got := hullInside(tri)
	for _, in := range []Hex{{0, 0}, {-1, 0}, {1, 0}, {0, -1}} {
		if _, ok := got[in]; !ok {
			t.Errorf("interior hex %v should be inside the triangle hull", in)
		}
	}
	// A hex clearly outside the triangle must not be included.
	if _, ok := got[Hex{0, 2}]; ok {
		t.Errorf("(0,2) is outside the triangle and must not be filled")
	}
}
