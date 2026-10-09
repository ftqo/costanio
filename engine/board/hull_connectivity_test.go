package board

import (
	"fmt"
	"sort"
	"strings"
	"testing"
)

// tileCount6Components returns the number of 6-connected components of the
// board's present tiles (land + ocean).
func tileCount6Components(b *Board) int {
	present := func(h Hex) bool { _, ok := b.Tiles[h]; return ok }
	seen := map[Hex]bool{}
	n := 0
	for start := range b.Tiles {
		if seen[start] {
			continue
		}
		n++
		stack := []Hex{start}
		seen[start] = true
		for len(stack) > 0 {
			cur := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			for _, nb := range cur.Neighbors() {
				if present(nb) && !seen[nb] {
					seen[nb] = true
					stack = append(stack, nb)
				}
			}
		}
	}
	return n
}

// hasInteriorHole flood-fills the exterior over absent hexes from just past the
// board extent; any absent hex inside the extent the flood cannot reach is an
// enclosed hole in the sea.
func hasInteriorHole(b *Board) bool {
	present := func(h Hex) bool { _, ok := b.Tiles[h]; return ok }
	R := 0
	for h := range b.Tiles {
		if d := cubeDistOrigin(h); d > R {
			R = d
		}
	}
	limit := R + 1
	ext := map[Hex]bool{}
	var q []Hex
	for _, h := range HexesInRadius(limit) {
		if cubeDistOrigin(h) == limit && !present(h) {
			ext[h] = true
			q = append(q, h)
		}
	}
	for len(q) > 0 {
		cur := q[len(q)-1]
		q = q[:len(q)-1]
		for _, nb := range cur.Neighbors() {
			if cubeDistOrigin(nb) > limit || present(nb) || ext[nb] {
				continue
			}
			ext[nb] = true
			q = append(q, nb)
		}
	}
	for _, h := range HexesInRadius(R) {
		if !present(h) && !ext[h] {
			return true
		}
	}
	return false
}

func framedFromLand(land []Hex) *Board {
	tiles := make(map[Hex]Tile, len(land))
	for _, h := range land {
		tiles[h] = Tile{Res: ResLand}
	}
	b := &Board{Radius: 16, Tiles: tiles, Robber: land[0]}
	b.Frame()
	return b
}

// tileSignature is a canonical, order-independent string of a board's tiles.
func tileSignature(b *Board) string {
	hs := make([]Hex, 0, len(b.Tiles))
	for h := range b.Tiles {
		hs = append(hs, h)
	}
	sort.Slice(hs, func(i, j int) bool {
		return hs[i].Q < hs[j].Q || (hs[i].Q == hs[j].Q && hs[i].R < hs[j].R)
	})
	var sb strings.Builder
	for _, h := range hs {
		fmt.Fprintf(&sb, "%d,%d:%d;", h.Q, h.R, b.Tiles[h].Res)
	}
	return sb.String()
}

// thinSparseCases are land shapes whose framing exercises the connectivity
// backstop, where map-iteration nondeterminism would show.
var thinSparseCases = map[string][]Hex{
	"two distant hexes": {{6, 1}, {-5, 2}},
	"three collinear":   {{-9, -3}, {-5, 1}, {1, 7}},
	"thin triangle":     {{-10, 0}, {-9, 1}, {0, 8}},
	"sliver triangle":   {{-3, 2}, {4, -4}, {-4, 3}},
}

// TestFrameDeterministic: framing the same land many times yields identical
// tile maps, so map iteration order cannot leak into the result (the
// backstop's closest-pair bridge is where it could).
func TestFrameDeterministic(t *testing.T) {
	for name, land := range thinSparseCases {
		want := tileSignature(framedFromLand(land))
		for i := range 100 {
			if got := tileSignature(framedFromLand(land)); got != want {
				t.Fatalf("%s: Frame is nondeterministic (run %d differs)", name, i)
			}
		}
	}
}

// TestFrameIdempotentThin extends the idempotency guarantee to the thin/sparse
// shapes that drive the connectivity backstop, which the fat-hull idempotency
// test never exercises.
func TestFrameIdempotentThin(t *testing.T) {
	for name, land := range thinSparseCases {
		b := framedFromLand(land)
		first := tileSignature(b)
		b.Frame()
		if again := tileSignature(b); again != first {
			t.Errorf("%s: Frame(Frame(b)) != Frame(b)", name)
		}
	}
}

// TestFrameThinAndSparseConnected covers degenerate land shapes: two distant
// hexes, three collinear hexes, and a razor-thin triangle. Each must frame into
// one connected sea with no holes.
func TestFrameThinAndSparseConnected(t *testing.T) {
	cases := map[string][]Hex{
		"two distant hexes": {{6, 1}, {-5, 2}},
		"three collinear":   {{-9, -3}, {-5, 1}, {1, 7}},
		"thin triangle":     {{-10, 0}, {-9, 1}, {0, 8}},
		"sliver triangle":   {{-3, 2}, {4, -4}, {-4, 3}},
		"single hex":        {{0, 0}},
	}
	for name, land := range cases {
		b := framedFromLand(land)
		if c := tileCount6Components(b); c != 1 {
			t.Errorf("%s: framed into %d components, want 1", name, c)
		}
		if hasInteriorHole(b) {
			t.Errorf("%s: framed board has an interior hole in the sea", name)
		}
	}
}

// TestFrameAlwaysConnected fuzzes Frame over many random small land sets with a
// deterministic PRNG, asserting every framed board is one connected, hole-free
// body of water.
func TestFrameAlwaysConnected(t *testing.T) {
	seed := uint64(0x9e3779b97f4a7c15)
	next := func() uint64 { seed ^= seed << 13; seed ^= seed >> 7; seed ^= seed << 17; return seed }
	for trial := range 20000 {
		count := 1 + int(next()%20)
		tiles := map[Hex]Tile{}
		var first Hex
		for range count {
			h := Hex{Q: int(next()%21) - 10, R: int(next()%21) - 10}
			if cubeDistOrigin(h) > 12 {
				continue
			}
			if len(tiles) == 0 {
				first = h
			}
			tiles[h] = Tile{Res: ResLand}
		}
		if len(tiles) == 0 {
			continue
		}
		b := &Board{Radius: 16, Tiles: tiles, Robber: first}
		b.Frame()
		if c := tileCount6Components(b); c != 1 {
			t.Fatalf("trial %d (%d land): %d components, want 1", trial, len(tiles), c)
		}
		if hasInteriorHole(b) {
			t.Fatalf("trial %d (%d land): interior hole in the sea", trial, len(tiles))
		}
	}
}
