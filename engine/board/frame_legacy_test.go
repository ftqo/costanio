package board

import "testing"

// legacyHexagonCode is a reported map that rendered as a giant hexagon: a
// version-1, radius-8 board whose 39 land hexes sit inside a hexagon of
// authored Sea. The share code's trailing Sea bytes are reconstructed by
// padding the per-hex stream to HexesInRadius(8) with Sea (resource nibble 7),
// so DecodeBoard yields a dense radius-8 board (217 tiles) whose only non-Sea
// tiles are the 39 land hexes.
const legacyHexagonCode = `AQgJBXBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcKBwcHBwcHBwcHBwcHCgcHBwcHBwcHBwcHBwcKBwcKCgoKBwcHBwcHBwcKBwoKCgoKBwcHBwcHBwcHBwoKCgoKCgcHBwcHBwcHBwcKCgoKCgoKBwcHBwcHBwcHBwoKCgoKCgcHBwcHBwcHBwcKCgoKBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcKBwcHBwcHBwcHBwcKBwcHBwcHBwcHBwoHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHA`

// TestFrameHealsLegacyHexagonCode decodes the legacy board, confirms the bug
// state (a full radius-8 hexagon whose every non-land hex is Sea), runs
// Frame(), and asserts the result is a tight non-hexagonal silhouette with a
// 1-hex coast and no interior gaps that survives a codec round-trip.
//
// Dimensions from the actual data:
//   - decoded: radius 8, 217 tiles = HexesInRadius(8); 39 land, 178 Sea, 0 absent.
//   - the land is a main blob (q∈[-5,2]) plus a thin arm reaching up-right to
//     {6,-7}; its bounding box is near-square (q-extent 11, r-extent 10), so the
//     check is for a non-square box rather than width>height.
//   - healed: radius 9 (the arm at {6,-7} is cube-distance 7 from the origin, so
//     its coastal margin reaches 9), 82 tiles, 39 land, 43 Sea, and 189 absent
//     hexes out of HexesInRadius(9)=271.
func TestFrameHealsLegacyHexagonCode(t *testing.T) {
	b, err := DecodeBoard(legacyHexagonCode)
	if err != nil {
		t.Fatalf("DecodeBoard: %v", err)
	}

	// (1) Confirm the decoded board is in the bug state: a dense radius-8 hexagon
	// whose every non-land hex is Sea.
	if b.Radius != 8 {
		t.Fatalf("expected decoded radius 8, got %d", b.Radius)
	}
	full8 := HexesInRadius(8)
	if len(b.Tiles) != len(full8) {
		t.Fatalf("expected a dense radius-8 board (%d tiles), got %d", len(full8), len(b.Tiles))
	}
	var landBefore, seaBefore int
	for _, h := range full8 {
		tl, ok := b.Tiles[h]
		if !ok {
			t.Fatalf("decoded board is not dense: hex %v absent", h)
		}
		switch {
		case tl.Res == Sea:
			seaBefore++
		case isGround(tl.Res):
			landBefore++
		default:
			t.Fatalf("hex %v has unexpected resource %v", h, tl.Res)
		}
	}
	if landBefore == 0 || seaBefore < 100 {
		t.Fatalf("want a full sea hexagon before healing, got land=%d sea=%d", landBefore, seaBefore)
	}
	t.Logf("decoded: radius=%d tiles=%d land=%d sea=%d (giant sea hexagon)", b.Radius, len(b.Tiles), landBefore, seaBefore)

	// Capture land before framing; it must be preserved exactly.
	landTiles := map[Hex]Tile{}
	for h, tl := range b.Tiles {
		if isGround(tl.Res) {
			landTiles[h] = tl
		}
	}

	// (2) Heal.
	b.Frame()

	// (3a) The healed board is not a sea-filled hexagon: most hexes of the
	// bounding hexagon are absent, so it is non-hexagonal.
	hexesInR := HexesInRadius(b.Radius)
	absent := len(hexesInR) - len(b.Tiles)
	if len(b.Tiles) >= len(hexesInR) {
		t.Fatalf("healed board is still a full hexagon: %d tiles vs %d hexes in radius %d", len(b.Tiles), len(hexesInR), b.Radius)
	}
	// Well over half of the bounding hexagon must be absent once the sea hexagon
	// collapses to a thin coast.
	if absent <= len(hexesInR)/2 {
		t.Fatalf("expected most of the bounding hexagon to be absent (non-hexagonal); got %d absent of %d", absent, len(hexesInR))
	}
	var landAfter, seaAfter int
	for _, tl := range b.Tiles {
		if tl.Res == Sea {
			seaAfter++
		} else {
			landAfter++
		}
	}
	t.Logf("healed: radius=%d tiles=%d land=%d sea=%d absent=%d (of %d in radius)",
		b.Radius, len(b.Tiles), landAfter, seaAfter, absent, len(hexesInR))

	// The ocean must shrink: 178 Sea becomes a thin coastal ring.
	if seaAfter >= seaBefore {
		t.Fatalf("expected the sea to shrink to a coastal ring; before=%d after=%d", seaBefore, seaAfter)
	}

	// (3b) Bounding box is non-square. The arm makes it near-square, so this
	// checks non-square rather than width>height.
	minQ, maxQ, minR, maxR := 1<<30, -(1 << 30), 1<<30, -(1 << 30)
	for h := range b.Tiles {
		if h.Q < minQ {
			minQ = h.Q
		}
		if h.Q > maxQ {
			maxQ = h.Q
		}
		if h.R < minR {
			minR = h.R
		}
		if h.R > maxR {
			maxR = h.R
		}
	}
	widthQ := maxQ - minQ
	heightR := maxR - minR
	if widthQ == heightR {
		t.Errorf("expected a non-square bounding box, got square q-extent=%d r-extent=%d", widthQ, heightR)
	}

	// (3c) No interior gaps and a single connected ocean+land component.
	assertNoInteriorAbsent(t, b)
	assertSingleComponent(t, b)

	// Land tiles are preserved exactly through framing (deserts stay deserts).
	for h, tl := range landTiles {
		if got, ok := b.Tiles[h]; !ok || got != tl {
			t.Errorf("land hex %v changed by Frame: %+v -> %+v (ok=%v)", h, tl, got, ok)
		}
	}

	// (4) Codec round-trip: encode the healed board, decode it again, and assert
	// identical tiles (deserts stay deserts, absent stays absent).
	reDecoded, err := DecodeBoard(EncodeBoard(b))
	if err != nil {
		t.Fatalf("re-decode of healed board: %v", err)
	}
	if reDecoded.Radius != b.Radius {
		t.Errorf("round-trip radius changed: %d -> %d", b.Radius, reDecoded.Radius)
	}
	if len(reDecoded.Tiles) != len(b.Tiles) {
		t.Fatalf("round-trip tile count changed: %d -> %d", len(b.Tiles), len(reDecoded.Tiles))
	}
	for h, tl := range b.Tiles {
		if got, ok := reDecoded.Tiles[h]; !ok || got != tl {
			t.Errorf("round-trip tile %v changed: %+v -> %+v (ok=%v)", h, tl, got, ok)
		}
	}
}
