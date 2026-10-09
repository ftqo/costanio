package wagons

import (
	"slices"
	"testing"

	"github.com/ftqo/costan.io/engine/board"
)

// capeShape is a full hexagon's corner (R, 0) split into its three seaward
// edges: the middle one, whose two corners touch only water, and the two beside
// it, each with one land corner, in the cape's own edge order.
func capeShape(t *testing.T, b *board.Board, c board.Hex) (middle board.Edge, sides []board.Edge) {
	t.Helper()
	for _, e := range seawardEdges(b, c) {
		if !cornerIsLand(b, c, e.A) && !cornerIsLand(b, c, e.B) {
			middle = e
		} else {
			sides = append(sides, e)
		}
	}
	if middle == (board.Edge{}) || len(sides) != 2 {
		t.Fatalf("cape %v: want one sea-only edge and two sides, got %v and %v", c, middle, sides)
	}
	return middle, sides
}

func harbourOn(e board.Edge) board.Harbor {
	return board.Harbor{Verts: [2]board.Vertex{e.A, e.B}, Ratio: 3}
}

// landCornerOf is the side edge's corner that touches land besides the cape.
func landCornerOf(b *board.Board, c board.Hex, e board.Edge) board.Vertex {
	if cornerIsLand(b, c, e.A) {
		return e.A
	}
	return e.B
}

// blockerAt is a coast edge of the land neighbour meeting the cape at v, other
// than any of the cape's own: a harbour there shares corner v with the side edge.
func blockerAt(t *testing.T, b *board.Board, c board.Hex, v board.Vertex) board.Edge {
	t.Helper()
	own := c.Edges()
	for _, e := range v.Edges() {
		if slices.Contains(own[:], e) {
			continue
		}
		if _, ok := b.HarborSeaHex(harbourOn(e)); ok {
			return e
		}
	}
	t.Fatalf("no coast edge meets %v outside the cape", v)
	return board.Edge{}
}

// TestSlideCapeHarbours pins docs/rules/wagons.md, "Harbours on a trade hex":
// a harbour on a cape's two sea-only corners slides one edge along the coast,
// the first side in the cape's edge order first, the second when the first
// would share a corner or a dock with another harbour, and nowhere when both
// would. Generated boards never produce the second and third cases (harbours
// are two coast edges apart), so they are constructed here.
func TestSlideCapeHarbours(t *testing.T) {
	b := fullSilhouette(4)
	c := board.Hex{Q: b.Radius, R: 0}
	if _, ok := capeOutward(b, c); !ok {
		t.Fatalf("%v is not a cape", c)
	}
	middle, sides := capeShape(t, b, c)

	t.Run("first side", func(t *testing.T) {
		b.Harbors = []board.Harbor{harbourOn(middle)}
		slideCapeHarbours(b, []board.Hex{c})
		if got := board.NewEdge(b.Harbors[0].Verts[0], b.Harbors[0].Verts[1]); got != sides[0] {
			t.Fatalf("slid to %v, want the first side %v", got, sides[0])
		}
		// Idempotent: a slid harbour is no longer stranded.
		before := slices.Clone(b.Harbors)
		slideCapeHarbours(b, []board.Hex{c})
		if !slices.Equal(before, b.Harbors) {
			t.Fatalf("a second pass moved %v to %v", before, b.Harbors)
		}
	})
	t.Run("second side when the first shares a corner", func(t *testing.T) {
		block := blockerAt(t, b, c, landCornerOf(b, c, sides[0]))
		b.Harbors = []board.Harbor{harbourOn(middle), harbourOn(block)}
		slideCapeHarbours(b, []board.Hex{c})
		if got := board.NewEdge(b.Harbors[0].Verts[0], b.Harbors[0].Verts[1]); got != sides[1] {
			t.Fatalf("slid to %v, want the second side %v", got, sides[1])
		}
		if b.Harbors[1] != harbourOn(block) {
			t.Fatalf("the blocking harbour moved to %v", b.Harbors[1])
		}
	})
	t.Run("second side when first dock taken", func(t *testing.T) {
		// A harbour on the far side of the first side's sea hex: it shares no
		// corner with the side edge, only the water its dock would stand on.
		// On a full hexagon that water touches no other land, so put an islet
		// beyond it.
		bb := fullSilhouette(4)
		sea, ok := bb.HarborSeaHex(harbourOn(sides[0]))
		if !ok {
			t.Fatal("side edge has no dock hex")
		}
		islet := board.Hex{Q: 2*sea.Q - c.Q, R: 2*sea.R - c.R}
		bb.Tiles[islet] = board.Tile{Res: board.Wood, Number: 5}
		var across board.Edge
		for _, e := range islet.Edges() {
			if slices.Contains(board.EdgeHexes(e), sea) {
				across = e
			}
		}
		if across == (board.Edge{}) {
			t.Fatal("islet does not face the dock hex")
		}
		if s2, _ := bb.HarborSeaHex(harbourOn(across)); s2 != sea {
			t.Fatalf("across edge docks at %v, want %v", s2, sea)
		}
		bb.Harbors = []board.Harbor{harbourOn(middle), harbourOn(across)}
		slideCapeHarbours(bb, []board.Hex{c})
		if got := board.NewEdge(bb.Harbors[0].Verts[0], bb.Harbors[0].Verts[1]); got != sides[1] {
			t.Fatalf("slid to %v, want the second side %v (the first's dock hex is taken)", got, sides[1])
		}
	})
	t.Run("stays when both sides are taken", func(t *testing.T) {
		b.Harbors = []board.Harbor{
			harbourOn(middle),
			harbourOn(blockerAt(t, b, c, landCornerOf(b, c, sides[0]))),
			harbourOn(blockerAt(t, b, c, landCornerOf(b, c, sides[1]))),
		}
		slideCapeHarbours(b, []board.Hex{c})
		if got := board.NewEdge(b.Harbors[0].Verts[0], b.Harbors[0].Verts[1]); got != middle {
			t.Fatalf("moved to %v, want left on %v", got, middle)
		}
	})
	t.Run("land-corner harbour unchanged", func(t *testing.T) {
		b.Harbors = []board.Harbor{harbourOn(sides[1])}
		slideCapeHarbours(b, []board.Hex{c})
		if got := board.NewEdge(b.Harbors[0].Verts[0], b.Harbors[0].Verts[1]); got != sides[1] {
			t.Fatalf("a usable harbour moved from %v to %v", sides[1], got)
		}
	})
}
