package board

import (
	"slices"
	"testing"
)

// seaBoard is a radius-3 board of open sea with the named hexes made land.
func seaBoard(land ...Hex) *Board {
	b := &Board{Radius: 3, Tiles: map[Hex]Tile{}}
	for _, h := range HexesInRadius(3) {
		b.Tiles[h] = Tile{Res: Sea}
	}
	for _, h := range land {
		b.Tiles[h] = Tile{Res: Wood}
	}
	return b
}

// TestLandEdgeNeedsLandHex: an edge is land when one of the two hexes
// it separates is land. Touching land at both ends is not enough: a strait
// between two sea hexes whose corners meet islands is open water.
func TestLandEdgeNeedsLandHex(t *testing.T) {
	e := Hex{0, 0}.Edges()[0]
	flank := EdgeHexes(e)
	if len(flank) != 2 {
		t.Fatalf("edge %v separates %d hexes, want 2", e, len(flank))
	}
	// A land hex at each end of the edge that is not one of its two sides.
	beyond := func(v Vertex) Hex {
		for _, h := range v.Hexes() {
			if !slices.Contains(flank, h) {
				return h
			}
		}
		t.Fatalf("vertex %v has no third hex", v)
		return Hex{}
	}
	strait := seaBoard(beyond(e.A), beyond(e.B))
	if !strait.LandVertex(e.A) || !strait.LandVertex(e.B) {
		t.Fatal("construction: both ends of the strait should touch land")
	}
	if strait.LandEdge(e) {
		t.Errorf("LandEdge(%v) = true on a strait between two sea hexes %v", e, flank)
	}
	if !strait.SeaEdge(e) {
		t.Errorf("SeaEdge(%v) = false on open water", e)
	}

	for i, h := range flank {
		coast := seaBoard(h)
		if !coast.LandEdge(e) {
			t.Errorf("coastal edge with side %d (%v) land: LandEdge = false, want true", i, h)
		}
		if !coast.SeaEdge(e) {
			t.Errorf("coastal edge with side %d (%v) land: SeaEdge = false, want true", i, h)
		}
	}
	if !seaBoard(flank...).LandEdge(e) {
		t.Error("inland edge: LandEdge = false, want true")
	}
	if seaBoard().LandEdge(e) {
		t.Error("open sea: LandEdge = true, want false")
	}

	// The rim: an edge whose outer side is off the board entirely.
	rim := Hex{3, 0}
	b := seaBoard(rim)
	for _, re := range rim.Edges() {
		if !b.LandEdge(re) {
			t.Errorf("edge %v of land hex %v at the rim: LandEdge = false", re, rim)
		}
	}
}
