package rivers

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// The shape bullets of docs/rules/rivers.md's Engine conformance list: which
// mouth pairs exist, which have an authored tile, and that a board only ever
// asks for those.
//
// No seed search: the direction algebra is asserted on a constructed hex, and
// board-wide properties over every river of every board in a fixed sweep
// (TestRiverCountOnRealBoards guarantees the sweep finds rivers).

// dirCase is one row of the direction table this package's geometry rests on.
type dirCase struct {
	dir int
	// off is board.hexDirs[dir], the axial step.
	off board.Hex
	// compass is what that step is on the screen, and bearing is its angle in
	// the convention the tile art is measured in: a direction at angle t is the
	// world vector (cos t, -sin t), so the bearing counts anticlockwise on
	// screen from +x. Both follow from frontend/src/lib/board3d/coords.ts's
	// hexToWorld (x = size*sqrt3*(q + r/2), z = size*1.5*r, +z toward the
	// viewer), which layers/rivers.test.ts pins from the other side.
	compass string
	bearing int
	// short is the compass point's initials, the vocabulary of shape ids
	// (`ne_sw` runs north-east to south-west). Written out rather than derived
	// from `compass` so a typo in either column fails.
	short string
}

var dirTable = [6]dirCase{
	{dirE, board.Hex{Q: 1, R: 0}, "east", 0, "e"},
	{dirNE, board.Hex{Q: 1, R: -1}, "north-east", 60, "ne"},
	{dirNW, board.Hex{Q: 0, R: -1}, "north-west", 120, "nw"},
	{dirW, board.Hex{Q: -1, R: 0}, "west", 180, "w"},
	{dirSW, board.Hex{Q: -1, R: 1}, "south-west", 240, "sw"},
	{dirSE, board.Hex{Q: 0, R: 1}, "south-east", 300, "se"},
}

// TestDirectionTable pins the correspondence between board.hexDirs, the screen
// and the shape ids in one place.
//
// The bearings are not checked in Go (Go has no world coordinates); they
// document where the compass names come from, and the frontend checks them
// (layers/rivers.test.ts, "the six lattice directions are the bearings the
// engine names"). Checked here: the axial step behind each compass name, and
// the shape-id vocabulary derived from them.
func TestDirectionTable(t *testing.T) {
	origin := board.Hex{Q: 0, R: 0}
	for _, c := range dirTable {
		if got := origin.Neighbors()[c.dir]; got != c.off {
			t.Errorf("direction %d (%s): step %v, want %v", c.dir, c.compass, got, c.off)
		}
		// The bearings are 60 degrees apart and in order.
		if want := 60 * c.dir; c.bearing != want {
			t.Errorf("direction %d (%s): bearing %d, want %d", c.dir, c.compass, c.bearing, want)
		}
		// The shape ids are named for these compass points.
		if dirNames[c.dir] != c.short {
			t.Errorf("direction %d (%s): shape id says %q, want %q", c.dir, c.compass, dirNames[c.dir], c.short)
		}
	}
	// Every shape id is built from exactly that vocabulary, so a renamed
	// direction cannot leave a shape id spelling the old one.
	shorts := map[string]bool{}
	for _, c := range dirTable {
		shorts[c.short] = true
	}
	for pair, shape := range channelShapes {
		want := dirNames[pair[0]] + "_" + dirNames[pair[1]]
		if string(shape) != want {
			t.Errorf("mouths %v draw %q, want %q", pair, shape, want)
		}
		if !shorts[dirNames[pair[0]]] || !shorts[dirNames[pair[1]]] {
			t.Errorf("shape %q is not spelled out of the compass table", shape)
		}
		if pair[0] >= pair[1] {
			t.Errorf("shape %q is not its two directions in index order", shape)
		}
	}
	for d, shape := range sourceShapes {
		if want := "src_" + dirNames[d]; string(shape) != want {
			t.Errorf("the source in direction %d draws %q, want %q", d, shape, want)
		}
	}
}

// TestSeamIsOneEdgeReadFromBothSides: stepping in direction d opens a mouth on
// the near hex's edge d and the far hex's edge d+3, because it is one edge.
// That is why a seam is one bridge site rather than two.
func TestSeamIsOneEdgeReadFromBothSides(t *testing.T) {
	for _, h := range []board.Hex{{Q: 0, R: 0}, {Q: 2, R: -1}, {Q: -3, R: 2}} {
		for d, n := range h.Neighbors() {
			near := h.Edges()[edgeIndexForDir(d)]
			far := n.Edges()[edgeIndexForDir((d+3)%6)]
			if near != far {
				t.Fatalf("%v step %d: near hex calls the seam %v, far hex calls it %v", h, d, near, far)
			}
		}
	}
}

// TestShapeIsOneOfNine: the drawable rule leaves exactly nine of the fifteen
// mouth pairs, and ChannelShape names each. The enumeration covers all 15
// unordered pairs, so a tenth shape fails here.
func TestShapeIsOneOfNine(t *testing.T) {
	h := board.Hex{Q: 1, R: -2}
	want := map[Shape][2]int{
		ShapeEW:   {dirE, dirW},
		ShapeNESW: {dirNE, dirSW},
		ShapeNWSE: {dirNW, dirSE},
		ShapeNEW:  {dirNE, dirW},
		ShapeENW:  {dirE, dirNW},
		ShapeESW:  {dirE, dirSW},
		ShapeWSE:  {dirW, dirSE},
		ShapeNESE: {dirNE, dirSE},
		ShapeNWSW: {dirNW, dirSW},
	}
	got := map[Shape][2]int{}
	hairpins := 0
	for a := range 6 {
		for b := a + 1; b < 6; b++ {
			shape := ChannelShape(h, h.Edges()[edgeIndexForDir(a)], h.Edges()[edgeIndexForDir(b)])
			if !drawable(a, b) {
				hairpins++
				if shape != ShapeNone {
					t.Errorf("mouths %d and %d are a 60 degree hairpin but draw %q", a, b, shape)
				}
				continue
			}
			if shape == ShapeNone {
				t.Errorf("mouths %d and %d are drawable but no tile is named for them", a, b)
				continue
			}
			if prev, dup := got[shape]; dup {
				t.Errorf("shape %q claimed by both %v and {%d, %d}", shape, prev, a, b)
			}
			got[shape] = [2]int{a, b}
		}
	}
	// Six of the fifteen pairs are 60 degree hairpins and none is authored.
	// Five are drawable and clear the chip but never occur (non-self-adjacency
	// forbids them inside a chain, drawable() at the estuary).
	//
	// {SW, SE} is geometrically impossible: those edge lines sit 1.299 from the
	// chip mount, so a centreline half a channel inside is at 1.049, inside the
	// 1.05 keep-clear. The only route between them is a 126 degree loop over
	// the number.
	if hairpins != 6 {
		t.Fatalf("%d of the 15 pairs are 60 degree hairpins, want 6", hairpins)
	}
	if s := ChannelShape(h, h.Edges()[edgeIndexForDir(dirSW)], h.Edges()[edgeIndexForDir(dirSE)]); s != ShapeNone {
		t.Fatalf("the {SW, SE} pair draws %q, want none", s)
	}
	if len(got) != len(want) {
		t.Fatalf("the board can draw %d shapes, want %d: %v", len(got), len(want), got)
	}
	for shape, pair := range want {
		if got[shape] != pair {
			t.Errorf("%q is mouths %v, want %v", shape, got[shape], pair)
		}
	}
}

// TestSourceShapeIsOneOfSix: a hex whose In and Out are the same edge is a
// headwater, and it draws the one-mouth shape for that direction.
func TestSourceShapeIsOneOfSix(t *testing.T) {
	h := board.Hex{Q: -1, R: 3}
	want := [6]Shape{"src_e", "src_ne", "src_nw", "src_w", "src_sw", "src_se"}
	seen := map[Shape]bool{}
	for d := range 6 {
		e := h.Edges()[edgeIndexForDir(d)]
		got := ChannelShape(h, e, e)
		if got != want[d] {
			t.Errorf("one mouth in direction %d (%s) draws %q, want %q", d, dirTable[d].compass, got, want[d])
		}
		if seen[got] {
			t.Errorf("%q is claimed twice", got)
		}
		seen[got] = true
	}
	if len(seen) != 6 {
		t.Fatalf("%d source shapes, want 6", len(seen))
	}
}

// TestEveryChannelClearsTheChip checks every hex of every river on 200 boards
// at each of the three generated radii.
//
// Go can only check that every river hex draws one of the fifteen authored
// shapes and never ShapeNone. Whether a shape's water clears the chip depends
// on the authored path in the .glb file, which
// frontend/src/lib/board3d/riverArt.test.ts measures against the chip's disc.
func TestEveryChannelClearsTheChip(t *testing.T) {
	// 2, 6 and 8 seats are radius 2, 3 and 4, every generated board size (10
	// seats is radius 4 again).
	seats := []int{2, 6, 8}
	const rs = "base+rivers"
	for _, players := range seats {
		for seed := range uint64(200) {
			s, _ := newGame(t, rs, players, seed)
			x, ok := StateExt(s)
			if !ok {
				t.Fatalf("%s %dp seed %d: no rivers ext", rs, players, seed)
			}
			checkShapesAreAuthored(t, rs, players, seed, x)
		}
	}
	// Islands is covered by TestRiverCountOnIslandsBoards, which deals 800
	// boards and calls the same checker.
	//
	// Compositions that do not change the land mask get a few seeds each; they
	// cannot reach a new shape, but a module that started excluding hexes would
	// show up here.
	for _, rs := range []string{"base+caravans+fishermen+rivers", "base+cak+rivers"} {
		boards(t, rs, 4, func(t *testing.T, s *engine.State, x *Ext) {
			checkShapesAreAuthored(t, rs, 0, 0, x)
		})
	}
}

func checkShapesAreAuthored(t *testing.T, rs string, players int, seed uint64, x *Ext) {
	t.Helper()
	for ri, r := range x.Rivers {
		for i, h := range r.Hexes {
			for what, e := range map[string]board.Edge{"in": r.In[i], "out": r.Out[i]} {
				if _, ok := dirOfEdge(h, e); !ok {
					t.Fatalf("%s %dp seed %d: river %d hex %d: %s is not one of its own edges",
						rs, players, seed, ri, i, what)
				}
			}
			shape := ChannelShape(h, r.In[i], r.Out[i])
			if shape == ShapeNone {
				t.Fatalf("%s %dp seed %d: river %d hex %d %v draws no authored shape",
					rs, players, seed, ri, i, h)
			}
			// The source is the only hex with one mouth, and it is always
			// first; a `src_*` elsewhere would be a chain that stopped halfway.
			if isSource := r.In[i] == r.Out[i]; isSource != (i == 0) {
				t.Fatalf("%s %dp seed %d: river %d hex %d draws %q; only hex 0 is a source",
					rs, players, seed, ri, i, shape)
			}
		}
	}
}

// TestChainsUseMoreThanTwoStepDirections guards against rivers degenerating
// into straight horizontal runs along one row: the sweep must see steps in more
// than two directions, over enough boards that a straightened derivation fails.
func TestChainsUseMoreThanTwoStepDirections(t *testing.T) {
	for _, rs := range []string{"base+rivers", "base+islands+rivers"} {
		used := map[int]int{}
		turns, straights := 0, 0
		boards(t, rs, 25, func(t *testing.T, s *engine.State, x *Ext) {
			for _, r := range x.Rivers {
				for i := 0; i+1 < len(r.Hexes); i++ {
					d, ok := dirTo(r.Hexes[i], r.Hexes[i+1])
					if !ok {
						t.Fatalf("%s: river hexes %v and %v are not neighbours", rs, r.Hexes[i], r.Hexes[i+1])
					}
					used[d]++
				}
				// The channels themselves bend: an interior hex whose two
				// mouths are two apart rather than opposite.
				for i := 1; i+1 < len(r.Hexes); i++ {
					a, _ := dirOfEdge(r.Hexes[i], r.In[i])
					b, _ := dirOfEdge(r.Hexes[i], r.Out[i])
					if (a-b+6)%6 == 3 {
						straights++
					} else {
						turns++
					}
				}
			}
		})
		if len(used) != 6 {
			t.Fatalf("%s: chains stepped in %d of the 6 directions (%v)", rs, len(used), used)
		}
		if turns == 0 {
			t.Fatalf("%s: %d interior hexes and not one of them bends", rs, straights)
		}
		// At least one interior hex in ten must turn. The real rate is much
		// higher; the bound marks where the rivers stop meandering.
		if turns*10 < straights+turns {
			t.Fatalf("%s: only %d of %d interior hexes bend",
				rs, turns, straights+turns)
		}
	}
}
