package board

import "testing"

// reportedGapCode is a reported share code that produced a gap in the middle
// of the ocean. Its land is a 5-component archipelago; a lone hex at {-8,3}
// sits cube-distance 5 from the mainland, beyond frameMergeDist, so it got its
// own coastal moat with absent background between the two stretches of sea.
const reportedGapCode = "AQkABcDAwHBwwMDAwMDAwMBwoHDAwMDAwMDAwMBwcMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMBwcMDAwMDAwMDAwMDAwHBwcHDAwMDAwMDAwMDAwHCgoKBwwMDAwMDAwMDAwMBwoKCgoHDAwMDAwMDAwMDAcHCgoKCgoHDAwMDAwMDAwMDAcKBwoKCgoHBwwMDAwMDAwMDAwHBwcKCgoHCgcMDAwMDAwMDAwHCgcHBwcKBwwMDAwMDAwMDAcKCgoHCgcMDAwMDAwMDAwHBwcGBwcMDAwMDAwMDAwMDAcHDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMA"

func TestFrameReportedGapOceanConnected(t *testing.T) {
	b, err := DecodeBoard(reportedGapCode)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	b.Frame()
	// The whole framed board (land + ocean) must be a single connected region:
	// no absent background wedged between two stretches of sea.
	assertSingleComponent(t, b)
	assertNoInteriorAbsent(t, b)
}

// TestFrameRemoteIslandOceanConnected: a lone island well beyond frameMergeDist
// must end up in the same connected body of water as the mainland.
func TestFrameRemoteIslandOceanConnected(t *testing.T) {
	main := []Hex{{0, 0}, {1, 0}, {0, 1}, {-1, 1}, {-1, 0}, {1, -1}, {0, -1}}
	island := Hex{7, 0} // cube-distance 7 from the mainland, far beyond D=3
	land := append(append([]Hex{}, main...), island)
	b := landBoard(12, land)
	b.Frame()

	if _, ok := b.Tiles[island]; !ok {
		t.Fatalf("island hex %v should survive framing", island)
	}
	assertSingleComponent(t, b)
}
