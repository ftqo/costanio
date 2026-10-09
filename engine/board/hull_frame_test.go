package board

import "testing"

// A C-shaped land mass: the mouth of the C is a concavity that the convex hull
// must fill solid with ocean (no absent hexes wedged inside).
func TestFrameConcaveCFillsMouth(t *testing.T) {
	land := []Hex{
		{-2, -2}, {-1, -2}, {0, -2}, // top arm
		{-2, -1}, {-2, 0}, {-2, 1}, // spine
		{-2, 2}, {-1, 2}, {0, 2}, // bottom arm
	}
	b := landBoard(8, land)
	b.Frame()

	assertSingleComponent(t, b)
	assertNoInteriorAbsent(t, b)
	// The mouth of the C (toward +q) must be filled with sea, not left absent.
	for _, h := range []Hex{{-1, 0}, {0, 0}, {-1, -1}, {-1, 1}} {
		tl, ok := b.Tiles[h]
		if !ok {
			t.Errorf("mouth hex %v should be present (sea), is absent", h)
			continue
		}
		if tl.Res != Sea {
			t.Errorf("mouth hex %v should be Sea, got %+v", h, tl)
		}
	}
}

// A lone island far beyond any merge distance must end up in the same
// connected sea, with the wedge between it and the mainland filled rather than
// joined by a single-hex canal.
func TestFrameFarOutlierWedgeFilled(t *testing.T) {
	main := []Hex{{0, 0}, {1, 0}, {0, 1}, {-1, 1}, {-1, 0}, {1, -1}, {0, -1}}
	island := Hex{8, 0} // cube-distance 8 from the mainland
	b := landBoard(12, append(append([]Hex{}, main...), island))
	b.Frame()

	if _, ok := b.Tiles[island]; !ok {
		t.Fatalf("island %v should survive framing", island)
	}
	assertSingleComponent(t, b)
	assertNoInteriorAbsent(t, b)

	// Count sea hexes strictly between the mainland and the island (0 < q < 8 on
	// r=0): a canal would leave most absent; the hull fills the wedge, so several
	// are sea.
	seaBetween := 0
	for q := 1; q < 8; q++ {
		if tl, ok := b.Tiles[Hex{q, 0}]; ok && tl.Res == Sea {
			seaBetween++
		}
	}
	if seaBetween < 4 {
		t.Errorf("wedge to the outlier not filled with sea: %d sea hexes between", seaBetween)
	}
}
