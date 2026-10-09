package rivers

import (
	"math/rand/v2"
	"slices"
	"sort"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// Watercourse derivation.
//
// The watercourse is derived deterministically from the finished board, as
// Fishermen derives its fishing grounds and Caravans its oasis.
// docs/rules/rivers.md, "Deriving the river on a generated board", is the
// specification; comments here only add what the spec cannot say about the
// code.
//
// It runs twice and both runs must agree. FinishBoard derives the chains,
// paints them (a swamp at the estuary, mountains at the headwater, every hex
// between unchanged) and rebalances fair-mode tokens. InitExtBoard derives them
// again from the painted board, and that result is recorded in
// EvBoardGenerated's ext blob (see engine.ExtBoardInitializer). So the
// derivation must be invariant under its own painting.
//
// Everything it reads is invariant by construction:
//
//   - Eligibility is the land mask minus a fixed exclusion set (sea, border,
//     desert, lake, gold) and minus hexes another module reserved
//     (engine.HexReserver, a function of the land mask). Painting creates a
//     swamp, which is eligible, and swaps producing terrain between eligible
//     hexes; it never creates or removes a desert, lake or gold hex or touches
//     the mask.
//   - Length, non-self-adjacency, source-to-sea and the outer-edge rule depend
//     only on the land mask and position.
//   - Scoring and candidate order are positional, and the mouth is the chain's
//     sea end: nothing reads terrain or tokens.
//   - The generator is minted fresh from one reserved slot, so the same
//     candidates draw the same numbers.

// riverCount is how many watercourses a board of this many land hexes carries:
// 1 + (land-1)/30, the same shape as the board's desert count. One river at
// radius 2 (19 hexes), two at radius 3 (37), three at radius 4 (61).
func riverCount(land int) int {
	if land < 1 {
		return 0
	}
	return 1 + (land-1)/30
}

// maxChainLen is the cap on a chain, 2*radius+3.
func maxChainLen(radius int) int { return min(2*radius+3, chainLenCeiling) }

// minChainLen is the floor: four hexes is the shortest run that reads as a
// river.
const minChainLen = 4

// searchNodeBudget bounds the chain enumeration for a whole derivation, all
// rivers included.
//
// The search is depth-first with branching factor three in a chain's body (six
// directions, minus the arrival direction, minus the two drawable() refuses).
// Over 200 procedural boards per radius the worst case is 6,396 nodes at radius
// 2, 92,124 at radius 3 and 1,538,940 at radius 4 (the largest generated
// board); the budget keeps about tenfold headroom over that.
//
// It bounds pathological authored maps: board.MaxRadius is 16, POST
// /api/replay/frames folds a caller-chosen config, and riverCount asks for one
// river per 30 land hexes, so it is counted across the whole derivation, not
// per river.
//
// When it runs out, the derivation keeps the candidates found so far
// (deterministic, since the walk is in board order), giving a shorter river
// rather than none.
const searchNodeBudget = 16_000_000

// chainLenCeiling caps maxChainLen however large the board is.
//
// The spec's cap is 2*radius+3, 11 on the radius-4 board used for 7 to 10
// players, and is followed exactly for every generated board. An authored map
// can be radius 16 (cap 35), and the search is exponential in the cap, so it is
// held at the largest procedural value. Recorded as a Decision in
// docs/rules/rivers.md.
const chainLenCeiling = 11

// eligible reports whether hex h may carry a channel.
//
// Exclusions follow the spec: sea and border are not land; the desert is where
// the robber starts and what Caravans derives its oasis from; the lake is that
// desert flooded by Fishermen; an Islands gold hex is not to be drowned. A
// swamp must be eligible because the previous pass painted it at a mouth.
//
// Excluding desert and lake covers Caravans' oasis on every generated board. An
// authored map with neither makes Caravans fall back to a producing hex, which
// this cannot detect (modules do not import each other), so a river may cross
// the oasis there.
func eligible(b *board.Board, h board.Hex) bool {
	t, ok := b.Tiles[h]
	if !ok {
		return false
	}
	switch t.Res {
	case board.Sea, board.Border, board.Fog, board.ResNone, board.Lake, board.Gold, board.ResLand:
		return false
	case board.Wood, board.Brick, board.Sheep, board.Wheat, board.Ore, board.Swamp:
		// Producing land, and the swamp the previous pass painted at a mouth.
		// Listed explicitly so a new terrain has to be classified here.
		return true
	}
	return false
}

// openWater reports whether hex h borders the sea or the frame (the coast a
// chain end must reach). A hex with no tile is off the board, which is the
// coast on a full-hexagon procedural board.
func openWater(b *board.Board, h board.Hex) bool {
	for _, n := range h.Neighbors() {
		if !b.Land(n) {
			return true
		}
	}
	return false
}

// dirTo returns the index in Hex.Neighbors of neighbour n of h, and whether n
// is a neighbour at all.
func dirTo(h, n board.Hex) (int, bool) {
	for i, x := range h.Neighbors() {
		if x == n {
			return i, true
		}
	}
	return 0, false
}

// drawable reports whether two channel directions out of one hex are a shape a
// tile can draw: opposite (straight) or two apart (a bend). Adjacent
// directions are the 60 degree hairpin no tile has, and identical directions
// are not two mouths at all.
func drawable(a, b int) bool {
	d := ((a-b)%6 + 6) % 6
	return d == 2 || d == 3 || d == 4
}

// Directions. board.hexDirs is {+1,0} {+1,-1} {0,-1} {-1,0} {-1,+1} {0,+1}, and
// the client lays the lattice out at world x = size*sqrt3*(q + r/2), z =
// size*1.5*r with +z toward the viewer (frontend/src/lib/board3d/coords.ts,
// hexToWorld). With bearings measured as the tile art does (direction at angle
// t is world vector (cos t, -sin t), anticlockwise on screen from +x):
//
//	d  offset   compass       bearing   mouth-to-chip distance
//	0  {+1, 0}  east            0        3.000
//	1  {+1,-1}  north-east     60        3.969
//	2  { 0,-1}  north-west    120        3.969
//	3  {-1, 0}  west          180        3.000
//	4  {-1,+1}  south-west    240        1.500
//	5  { 0,+1}  south-east    300        1.500
//
// All six are open. layers/chips.ts mounts every chip at one tile-local spot,
// (0, +HEX_SIZE/2) in world terms, due south at bearing 270, between the
// south-west and south-east edges. The chip's keep-clear radius is 1.05 and the
// nearest mouth is 1.500 away, leaving room for a channel up to 0.90 wide
// against the 0.42 drawn. Each shape has its own tile file (see Shape), so no
// tile is rotated in a way that would move its chip socket.
//
// The reference setup's 3-hex river turns from east to south-west in its
// estuary hex, so all six directions are needed to reproduce it. See
// docs/rules/rivers.md, "Six-direction stepping".
const (
	dirE  = 0
	dirNE = 1
	dirNW = 2
	dirW  = 3
	dirSW = 4
	dirSE = 5
)

// dirNames are the compass names in direction order, and they are the shape ids'
// own vocabulary: a two-mouth shape is its two directions sorted by index and
// joined with an underscore, a source is "src_" and its one direction.
var dirNames = [6]string{"e", "ne", "nw", "w", "sw", "se"}

// Shape names the channel one river hex draws.
//
// The engine sends the shape, not just the two edges. Each shape has its own
// tile file laid down at TILE_ROTATION_Y like every other tile, so the renderer
// never rotates a tile to fit a mouth pair (which would move the tile's chip
// socket away from where layers/chips.ts mounts the chip).
//
// Ids are sorted compass pairs (`ne_w` says which two edges the water meets).
//
// A shape is not a file: four terrains wear each of the nine, `e_w` has two
// authored meanders, and only mountains carry a source. This says which channel
// the hex has; the renderer picks the file.
type Shape string

const (
	// The nine two-mouth channels: three straights and six 120 degree bends.
	// The fifteenth pair {SW, SE} and the five 60 degree hairpins are not here;
	// see channelShapes.
	ShapeEW   Shape = "e_w"   // straight, east to west
	ShapeNESW Shape = "ne_sw" // straight, north-east to south-west
	ShapeNWSE Shape = "nw_se" // straight, north-west to south-east
	ShapeNEW  Shape = "ne_w"  // bend, north-east to west
	ShapeENW  Shape = "e_nw"  // bend, east to north-west (ne_w mirrored)
	ShapeESW  Shape = "e_sw"  // bend, east to south-west
	ShapeWSE  Shape = "w_se"  // bend, west to south-east (e_sw mirrored)
	ShapeNESE Shape = "ne_se" // bend, north-east to south-east
	ShapeNWSW Shape = "nw_sw" // bend, north-west to south-west (ne_se mirrored)

	// The six sources: a headwater hex with one mouth, the water fanning into
	// rivulets in the peaks. Mountains only.
	ShapeSrcE  Shape = "src_e"
	ShapeSrcNE Shape = "src_ne"
	ShapeSrcNW Shape = "src_nw"
	ShapeSrcW  Shape = "src_w"
	ShapeSrcSW Shape = "src_sw"
	ShapeSrcSE Shape = "src_se"

	// ShapeNone is a pair no tile draws. Unreachable on a board this package
	// derived; returned rather than panicking because ViewExt also serves
	// authored maps folded through POST /api/replay/frames. The renderer draws
	// plain terrain, leaving a gap in the river.
	ShapeNone Shape = ""
)

// channelShapes is every mouth pair a tile is authored for, keyed by the two
// directions sorted by index.
//
// Nine of fifteen pairs; the missing six are the 60 degree hairpins. Five are
// drawable but never occur: non-self-adjacency forbids a hairpin inside a chain
// and outerEdge's drawable() test forbids one at the estuary.
//
// {SW, SE} cannot be drawn: those edge lines are 1.299 from the chip mount, so
// a centreline half a channel inside sits at 1.049, inside the 1.05 keep-clear.
// TestShapeIsOneOfNine checks this.
var channelShapes = map[[2]int]Shape{
	{dirE, dirW}:   ShapeEW,
	{dirNE, dirSW}: ShapeNESW,
	{dirNW, dirSE}: ShapeNWSE,
	{dirNE, dirW}:  ShapeNEW,
	{dirE, dirNW}:  ShapeENW,
	{dirE, dirSW}:  ShapeESW,
	{dirW, dirSE}:  ShapeWSE,
	{dirNE, dirSE}: ShapeNESE,
	{dirNW, dirSW}: ShapeNWSW,
}

// sourceShapes is the one-mouth headwater shape per direction, indexed by the
// direction of that single mouth.
var sourceShapes = [6]Shape{ShapeSrcE, ShapeSrcNE, ShapeSrcNW, ShapeSrcW, ShapeSrcSW, ShapeSrcSE}

// EWVariants is how many authored meanders the east-west straight has. It is
// the only shape with more than one, because it is the commonest run and the
// only one that repeats within a river. The two are an asymmetric meander and
// its mirror, so three straights in a row do not show the same tile. See
// variantFor.
const EWVariants = 2

// dirOfEdge returns which of h's six directions edge e lies in.
func dirOfEdge(h board.Hex, e board.Edge) (int, bool) {
	for d := range 6 {
		if h.Edges()[edgeIndexForDir(d)] == e {
			return d, true
		}
	}
	return 0, false
}

// ChannelShape is the shape hex h draws given its two channel edges.
//
// in == out is a source: a headwater hex has one mouth, so the River records
// the same seam as both In and Out, and this returns the one-mouth shape for
// that direction.
//
// Exported for the fairness audit's conformance rows, the renderer's contract
// test, and any caller holding a RiverView.
func ChannelShape(h board.Hex, in, out board.Edge) Shape {
	a, oka := dirOfEdge(h, in)
	b, okb := dirOfEdge(h, out)
	if !oka || !okb {
		return ShapeNone
	}
	if a == b {
		return sourceShapes[a]
	}
	return channelShapes[[2]int{min(a, b), max(a, b)}]
}

// isEastWest reports whether hex h's two mouths are its east and west edges,
// the one shape with more than one meander. See variantFor.
func isEastWest(h board.Hex, in, out board.Edge) bool {
	return ChannelShape(h, in, out) == ShapeEW
}

// seamEdge is the edge hexes a and b share. a and b must be neighbours.
func seamEdge(a, b board.Hex) (board.Edge, bool) {
	d, ok := dirTo(a, b)
	if !ok {
		return board.Edge{}, false
	}
	return a.Edges()[edgeIndexForDir(d)], true
}

// edgeIndexForDir maps a neighbour direction (index in Hex.Neighbors) to the
// index in Hex.Edges of the edge shared with that neighbour.
//
// The two orders run opposite ways round the hex. Hex.Vertices lists corners
// clockwise from the north one and Edges()[i] spans corners i and i+1, so edges
// run clockwise from the north-east. Hex.Neighbors runs east, north-east,
// north-west, west, south-west, south-east: anticlockwise. For the origin hex,
// edge 0 = direction 1, edge 1 = direction 0, edge 2 = direction 5, giving e =
// (1 - d) mod 6 both ways.
//
// (d + 1) mod 6 agrees for d = 0 and 1 only, and its failures look plausible
// (right number of bridge sites, on real edges, but not on the seams).
// TestEdgeIndexForDirMatchesGeometry pins this.
func edgeIndexForDir(d int) int { return ((1-d)%6 + 6) % 6 }

// outerEdge picks the coastal outlet at a chain's estuary: the edge shared with
// a non-land neighbour whose direction is opposite or two apart from the seam
// with its chain neighbour.
//
// When an end hex borders several sea hexes, the outlet is the first qualifying
// one in board order of the sea neighbour, which makes the answer independent
// of neighbour enumeration.
//
// One end only: the watercourse runs source to sea, and the other end is a
// headwater with one mouth and no outlet. See DeriveRivers.
func outerEdge(b *board.Board, end, inward board.Hex) (board.Edge, int, bool) {
	seamDir, ok := dirTo(end, inward)
	if !ok {
		return board.Edge{}, 0, false
	}
	type cand struct {
		hex board.Hex
		dir int
	}
	var cands []cand
	for d, n := range end.Neighbors() {
		// drawable is the only test: it excludes the 60 degree hairpin at an
		// end hex, where non-self-adjacency does not apply.
		if b.Land(n) || !drawable(d, seamDir) {
			continue
		}
		cands = append(cands, cand{n, d})
	}
	if len(cands) == 0 {
		return board.Edge{}, 0, false
	}
	sort.Slice(cands, func(i, j int) bool {
		if cands[i].hex.Q != cands[j].hex.Q {
			return cands[i].hex.Q < cands[j].hex.Q
		}
		return cands[i].hex.R < cands[j].hex.R
	})
	d := cands[0].dir
	return end.Edges()[edgeIndexForDir(d)], d, true
}

// hexDist is the axial hex distance.
func hexDist(a, b board.Hex) int {
	dq, dr := a.Q-b.Q, a.R-b.R
	return (abs(dq) + abs(dq+dr) + abs(dr)) / 2
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

func hexLess(a, b board.Hex) bool {
	if a.Q != b.Q {
		return a.Q < b.Q
	}
	return a.R < b.R
}

// chainLess is board order over whole chains: h1's (Q, R), then h2's, and so
// on. It is the last tiebreak in the scoring and the order the candidate list
// is held in, so the seeded pick indexes a list that does not depend on map
// iteration anywhere.
func chainLess(a, b []board.Hex) bool {
	for i := 0; i < len(a) && i < len(b); i++ {
		if a[i] != b[i] {
			return hexLess(a[i], b[i])
		}
	}
	return len(a) < len(b)
}

// candidate is one enumerated chain, source first, with the coastal outlet its
// estuary uses.
//
// hexes[0] is the headwater and hexes[len-1] the swamp at the sea, so a chain
// and its reverse are two different candidates when both ends are coastal (two
// rivers running opposite ways).
type candidate struct {
	hexes []board.Hex
	// outDir is the direction of the coastal outlet at the estuary, hexes[len-1].
	outDir  int
	endDist int
}

// grid is the board flattened into index-addressed arrays for the chain walk.
// The walk visits millions of nodes on the largest board and asks the same
// three questions at each (eligible, on the chain, touching the chain other
// than at its end), so map lookups would dominate; this cuts derivation from
// hundreds of milliseconds to a few.
//
// Order is board order (board.HexesInRadius), so lists built from these indices
// do not depend on map iteration.
type grid struct {
	hexes []board.Hex
	index map[board.Hex]int32
	// nbr[i][d] is the index of hex i's neighbour in direction d, or -1 when
	// that neighbour is off the board or ineligible.
	nbr [][6]int32
	// coastal[i] is whether hex i borders the sea or the frame.
	coastal []bool
	// eligible[i] is whether hex i may carry a channel at all.
	eligible []bool
}

func newGrid(b *board.Board, reserved map[board.Hex]bool) *grid {
	all := board.HexesInRadius(b.Radius)
	g := &grid{
		hexes:    all,
		index:    make(map[board.Hex]int32, len(all)),
		nbr:      make([][6]int32, len(all)),
		coastal:  make([]bool, len(all)),
		eligible: make([]bool, len(all)),
	}
	for i, h := range all {
		g.index[h] = int32(i)
	}
	for i, h := range all {
		g.eligible[i] = eligible(b, h) && !reserved[h]
		g.coastal[i] = openWater(b, h)
		for d, n := range h.Neighbors() {
			j, ok := g.index[n]
			if !ok || !eligible(b, n) || reserved[n] {
				g.nbr[i][d] = -1
				continue
			}
			g.nbr[i][d] = j
		}
	}
	return g
}

// enumerate walks the candidate chains and keeps only the best-scoring ones:
// longest first, then ends farthest apart. `blocked` is a previously chosen
// river and everything touching it.
//
// The spec picks one of the best-scoring candidates with the seeded draw, so
// worse candidates are discarded as soon as a better one is found rather than
// materialised.
//
// The walk starts at the estuary and ends at the source. Only the estuary must
// be coastal, so DFS roots are limited to coastal hexes while reaching the same
// set of chains. Each candidate is reversed on output so `hexes` reads source
// to sea.
func enumerate(b *board.Board, g *grid, blocked []bool, minLen, maxLen int, nodes *int) []candidate {
	n := len(g.hexes)

	chain := make([]int32, 0, maxLen)
	onChain := make([]bool, n)
	var best []candidate
	bestLen, bestDist := 0, 0

	// touchesChain reports whether hex i touches a chain hex other than the
	// chain's last. This is the hairpin rule: if h(k-1) and h(k+1) were
	// adjacent, h(k)'s two channel edges would be 60 degrees apart, which no
	// tile draws.
	touchesChain := func(i int32, last int32) bool {
		for _, j := range g.nbr[i] {
			if j >= 0 && j != last && onChain[j] {
				return true
			}
		}
		return false
	}

	record := func(outDir int) {
		first, last := chain[0], chain[len(chain)-1]
		fh, lh := g.hexes[first], g.hexes[last]
		dist := hexDist(fh, lh)
		if len(chain) < bestLen || (len(chain) == bestLen && dist < bestDist) {
			return
		}
		if len(chain) > bestLen || dist > bestDist {
			bestLen, bestDist = len(chain), dist
			best = best[:0]
		}
		// Reversed: the walk ran upstream from the estuary, and a candidate
		// reads downstream from the source.
		hexes := make([]board.Hex, len(chain))
		for k, ci := range chain {
			hexes[len(chain)-1-k] = g.hexes[ci]
		}
		best = append(best, candidate{hexes: hexes, outDir: outDir, endDist: dist})
	}

	// walk extends the chain by one hex, away from the estuary. outDir/outOK
	// are the estuary's (chain[0]'s) coastal outlet, settled once the chain has
	// a second hex and constant for the subtree below. Hoisted out of the
	// record step because outerEdge sorts.
	var walk func(outDir int, outOK bool, inFrom int)
	walk = func(outDir int, outOK bool, inFrom int) {
		if *nodes > searchNodeBudget {
			return
		}
		if outOK && len(chain) >= minLen {
			record(outDir)
		}
		if len(chain) >= maxLen {
			return
		}
		last := chain[len(chain)-1]
		for d, j := range g.nbr[last] {
			*nodes++
			if *nodes > searchNodeBudget {
				return
			}
			if j < 0 || blocked[j] || onChain[j] {
				continue
			}
			// The channel through `last` must be drawable: entry and exit seams
			// opposite or two apart. Self-adjacency already rules out the 60
			// degree case; checking here guarantees every hex gets a tile.
			if inFrom >= 0 && !drawable(inFrom, d) {
				continue
			}
			if touchesChain(j, last) {
				continue
			}
			nextOut, nextOK := outDir, outOK
			if len(chain) == 1 {
				// The estuary's outlet depends on which way the chain leaves
				// it, so it is settled here. With no drawable outlet toward
				// this neighbour the whole subtree is dead.
				_, od, ok := outerEdge(b, g.hexes[chain[0]], g.hexes[j])
				if !ok {
					continue
				}
				nextOut, nextOK = od, true
			}
			chain = append(chain, j)
			onChain[j] = true
			// The direction back out of j toward `last` is d+3: the walk
			// arrived on d, so it came in on the opposite side.
			walk(nextOut, nextOK, (d+3)%6)
			onChain[j] = false
			chain = chain[:len(chain)-1]
		}
	}

	// Roots are the coastal eligible hexes, since only the estuary must reach
	// the sea. A source may sit anywhere, coast included.
	for i := range g.hexes {
		if blocked[i] || !g.eligible[i] || !g.coastal[i] {
			continue
		}
		chain = append(chain[:0], int32(i))
		onChain[i] = true
		walk(0, false, -1)
		onChain[i] = false
	}
	// Board order over what survived, so the seeded pick below indexes
	// something stable whatever order the walk produced.
	sort.SliceStable(best, func(i, j int) bool { return chainLess(best[i].hexes, best[j].hexes) })
	return best
}

// buildRiver turns a chosen candidate into the stored River: channel edges per
// hex, the mouth, and the bridge sites.
//
// Source to sea: hexes[0] is the headwater and hexes[n-1] the estuary, so the
// mouth is always the last index. Nothing here reads terrain, so the derivation
// is invariant under its own painting.
//
// The source has one mouth, recorded as In[0] == Out[0] == the seam with the
// second hex, which ChannelShape reads as a `src_*` shape. Bridge sites are the
// n-1 seams plus one outlet, n per river (a 3-hex and a 4-hex river give the
// reference layout's seven).
func buildRiver(b *board.Board, c candidate) River {
	n := len(c.hexes)
	r := River{
		Hexes: append([]board.Hex(nil), c.hexes...),
		In:    make([]board.Edge, n),
		Out:   make([]board.Edge, n),
	}
	for i := range n - 1 {
		seam, ok := seamEdge(c.hexes[i], c.hexes[i+1])
		if !ok {
			// Unreachable: the walk only ever extends to a neighbour.
			continue
		}
		r.Out[i] = seam
		r.In[i+1] = seam
	}
	r.Out[n-1] = c.hexes[n-1].Edges()[edgeIndexForDir(c.outDir)]
	// The source's single mouth is both of its channel edges. Written after the
	// seam loop so a one-hex chain (only possible on an authored map) reads its
	// outlet rather than a zero edge.
	r.In[0] = r.Out[0]
	// The bridge sites: the n-1 seams plus the estuary's coastal outlet, which
	// is exactly Out in chain order.
	r.Sites = append(r.Sites, r.Out...)
	r.Mouth = n - 1
	return r
}

// variantFor is which authored meander a hex draws, for a shape with more than
// one. Only `e_w` has more; every other hex is 0.
//
// Drawn from its own reserved public slot, once per east-west hex, in river
// order then chain order. It is player-visible, so it is recorded in the board
// ext, published in ViewExt and reproduced by the fairness port. It uses
// engine.RiversVariantSeq rather than the watercourse slot so a cosmetic draw
// cannot shift the chain choice.
func assignVariants(rivers []River, rng *rand.Rand) {
	for i := range rivers {
		r := &rivers[i]
		r.Variants = make([]int, len(r.Hexes))
		for k, h := range r.Hexes {
			if isEastWest(h, r.In[k], r.Out[k]) {
				r.Variants[k] = rng.IntN(EWVariants)
			}
		}
	}
}

// DeriveRivers is the whole derivation: a pure function of the finished board
// and the reserved public stream. Two calls on the same board return the same
// chains in the same order.
//
// Exported because verify/ ports it to JavaScript (see verify/README.md) and
// the conformance test lives outside this package.
//
// The length cap is lowered until every river fits, which the spec does not
// spell out. Chains are chosen longest first and each blocks every hex it
// touches, so on a radius-4 board two eleven-hex rivers can take the coast a
// third one needs (about one board in five at 8 and 10 players). Rather than
// ship fewer rivers than the rules say, the derivation reruns with a shorter
// cap and the first cap that fits every river wins. Recorded as a Decision in
// docs/rules/rivers.md.
//
// Each pass at cap-1 costs about a third of the one above, so the first pass
// dominates; the whole descent is at most about 1.54 million nodes on the
// largest generated board (see searchNodeBudget). Every pass draws from the
// same generator in order, so the result is a pure function of (board, stream).
func DeriveRivers(b *board.Board, rng *rand.Rand) []River {
	return DeriveRiversAround(b, nil, rng)
}

// DeriveRiversAround is DeriveRivers with a set of hexes no channel may enter:
// hexes another module claimed through engine.HexReserver (the Wagons trade-hex
// candidates). A reserved hex is treated as ineligible (no chain runs through
// it, no estuary ends on it) but is not blocked-adjacent, so a river may run
// beside it. With no reservation it matches DeriveRivers draw for draw. See
// docs/rules/rivers.md, "With Wagons".
func DeriveRiversAround(b *board.Board, reserved map[board.Hex]bool, rng *rand.Rand) []River {
	if b == nil {
		return nil
	}
	land := 0
	for _, h := range board.HexesInRadius(b.Radius) {
		if b.Land(h) {
			land++
		}
	}
	want := riverCount(land)
	if want == 0 {
		return nil
	}
	g := newGrid(b, reserved)
	nodes := 0
	var best []River
	// One floor, at the scenario's minimum of four. With six-direction
	// stepping, 200 boards at each of radius 2, 3 and 4 (base and Islands) all
	// fit at floor 4. See docs/rules/rivers.md.
	//
	// Pure in (board, stream): every pass draws from the same generator in
	// order and reads only what painting leaves untouched.
	for limit := maxChainLen(b.Radius); limit >= minChainLen; limit-- {
		out := deriveAtCap(b, g, rng, want, minChainLen, limit, &nodes)
		if len(out) == want {
			return out
		}
		if len(out) > len(best) {
			best = out
		}
		if nodes > searchNodeBudget {
			return best
		}
	}
	return best
}

// deriveAtCap chooses up to `want` rivers with chains of at most `cap` hexes.
func deriveAtCap(b *board.Board, g *grid, rng *rand.Rand, want, minLen, limit int, nodes *int) []River {
	blocked := make([]bool, len(g.hexes))
	var out []River
	for range want {
		// Longer chains first, then the coastal ends farthest apart: enumerate
		// returns that best-scoring set in board order, and the seed picks one.
		best := enumerate(b, g, blocked, minLen, limit, nodes)
		if len(best) == 0 {
			break
		}
		r := buildRiver(b, best[rng.IntN(len(best))])
		out = append(out, r)
		// Later rivers never touch this one: every hex of it and every hex
		// beside it is excluded. The multi-river setups require this, and it
		// keeps each bridge site crossed by at most one channel.
		for _, h := range r.Hexes {
			if j, ok := g.index[h]; ok {
				blocked[j] = true
			}
			for _, nb := range h.Neighbors() {
				if j, ok := g.index[nb]; ok {
					blocked[j] = true
				}
			}
		}
	}
	return out
}

// sourceTerrain is what a headwater hex is painted: mountains only. The
// scenario's rivers rise in the peaks, and the one-mouth headwater tile exists
// only for that terrain (see frontend/src/lib/board3d/layers/rivers.ts).
const sourceTerrain = board.Ore

// paint applies a derived layout: a swamp with no chit at each estuary,
// mountains at each source, and nothing else. Every channel hex keeps its dealt
// terrain and number (derivation 11); repainting them after the fair-mode
// solver had balanced numbers against terrain pushed nearly every board out of
// the fair band. See docs/rules/rivers.md, "Painting the chain".
//
// Idempotent, as BoardFinisher and the two-pass derivation require: a swamp
// estuary stays a swamp and a mountain source needs no swap.
func paint(b *board.Board, rivers []River) {
	onRiver, ends := map[board.Hex]bool{}, map[board.Hex]bool{}
	for _, r := range rivers {
		for _, h := range r.Hexes {
			onRiver[h] = true
		}
		ends[r.SourceHex()], ends[r.MouthHex()] = true, true
	}
	for _, r := range rivers {
		for i, h := range r.Hexes {
			if i == r.Mouth {
				// The chit is discarded, not moved: chits are generated for the
				// producing hexes there are, so nothing is doubled up. See the
				// Decision in the spec.
				b.Tiles[h] = board.Tile{Res: board.Swamp}
				continue
			}
			if i != 0 {
				continue // the channel runs through whatever was dealt here
			}
			t := b.Tiles[h]
			if t.Res == sourceTerrain {
				continue
			}
			partner, ok := swapPartner(b, h, onRiver, ends)
			if !ok {
				// No mountains except at river ends (only an authored map can
				// do this). The headwater keeps its terrain rather than the
				// board losing a resource.
				continue
			}
			// Terrain swaps, chits stay: the board's number multiset is
			// untouched and only which resource sits under which number moves.
			pt := b.Tiles[partner]
			b.Tiles[h] = board.Tile{Res: pt.Res, Number: t.Number}
			b.Tiles[partner] = board.Tile{Res: t.Res, Number: pt.Number}
		}
	}
}

// swapPartner is the mountain hex the headwater trades terrain with.
//
// Preferred in order: a hex off every river (so channel hexes keep their dealt
// terrain), then one whose token has the same pips as the headwater's (so the
// swap moves no production and fair-mode balance holds), then the nearest, then
// board order.
//
// When no mountains are left off the rivers (possible at radius 4 with three
// rivers), an interior channel hex with mountains is used and takes the
// headwater's terrain: an interior hex may carry any terrain, a headwater only
// one. Never another river's source or a mouth.
func swapPartner(b *board.Board, h board.Hex, onRiver, ends map[board.Hex]bool) (board.Hex, bool) {
	best, found := board.Hex{}, false
	var bestKey [3]int
	want := board.Pips(b.Tiles[h].Number)
	for _, c := range board.HexesInRadius(b.Radius) {
		if ends[c] {
			continue
		}
		t, ok := b.Tiles[c]
		if !ok || t.Res != sourceTerrain {
			continue
		}
		key := [3]int{0, abs(board.Pips(t.Number) - want), hexDist(h, c)}
		if onRiver[c] {
			key[0] = 1
		}
		if !found || key[0] < bestKey[0] || (key[0] == bestKey[0] && (key[1] < bestKey[1] ||
			(key[1] == bestKey[1] && key[2] < bestKey[2]))) {
			best, bestKey, found = c, key, true
		}
	}
	return best, found
}

// FinishBoard derives the watercourses and paints them.
//
// It is a FinishBoard rather than SetupBoard because a river needs the final
// land and coast, and Islands carves sea out of the generated board. SetupBoard
// order is the ruleset's lexicographic sort, so relying on it would be fragile
// (see engine.BoardFinisher).
func (Module) FinishBoard(b *board.Board, cfg engine.GameConfig, rng *rand.Rand) {
	paint(b, DeriveRiversAround(b, engine.ReservedHexes(cfg, b), rng))
	// Painting moved terrain after the generator balanced numbers against it,
	// so a fair-mode board has its tokens rebalanced here. Only engine-dealt
	// tokens move; an authored map's pinned numbers stay. The derivation reads
	// no token, so the recorded pass is unaffected.
	if cfg.BoardMode == board.BoardFair {
		b.Rebalance(dealtNumbers(cfg))
	}
}

// dealtNumbers reports, per hex, whether the number token there is the engine's
// to move or the map author's to keep. Same rule as Caravans' tab.dealtTerrain,
// restated because modules cannot import each other: on an inlined board,
// generic-land hexes with blank numbers were filled by board.Resolve and are
// the engine's, everything else is the author's; a preset pins every tile; a
// procedural board is all the engine's.
func dealtNumbers(cfg engine.GameConfig) func(board.Hex) bool {
	switch {
	case cfg.Board != nil:
		src := cfg.Board.Tiles
		return func(h board.Hex) bool {
			t, ok := src[h]
			return ok && t.Res == board.ResLand && t.Number == 0
		}
	case cfg.Preset != "":
		return func(board.Hex) bool { return false }
	default:
		return func(board.Hex) bool { return true }
	}
}

// FinishBoardSeq puts this derivation on its own reserved public slot rather
// than the shared slot 3. Caravans and Fishermen share slot 3 because they draw
// only when repairing, which is rare; this draws on every board, so sharing
// would tie the first river's choice to the Caravans oasis repair. See
// engine.RiversBoardSeq.
func (Module) FinishBoardSeq() int { return engine.RiversBoardSeq }

// WatercourseHexes is every hex a river runs through, for modules that keep a
// whole-hex feature off the channel (engine.WatercourseSource; the Raiders
// castle). Uses the stored ext when present, otherwise the same derivation
// InitExtBoard records (same board, reservation and fresh generator on
// RiversBoardSeq), because the caller may be another module's InitExtBoard
// running before this module's, or the recording pass with nothing stored.
func (Module) WatercourseHexes(s *engine.State) []board.Hex {
	rs := []River(nil)
	if x, ok := StateExt(s); ok && len(x.Rivers) > 0 {
		rs = x.Rivers
	} else if s.Board != nil {
		rs = DeriveRiversAround(s.Board, engine.ReservedHexes(s.Config, s.Board),
			engine.PublicRngForSeed(s.PublicSeed, engine.RiversBoardSeq))
	}
	var out []board.Hex
	for _, r := range rs {
		out = append(out, r.Hexes...)
	}
	return out
}

// riverHexSet is every hex any river runs through, swamps included.
func (x *Ext) riverHexSet() map[board.Hex]bool {
	out := map[board.Hex]bool{}
	for _, r := range x.Rivers {
		for _, h := range r.Hexes {
			out[h] = true
		}
	}
	return out
}

// BridgeSites is every edge on the board that may hold a bridge and may hold
// nothing else.
func (x *Ext) BridgeSites() map[board.Edge]bool {
	out := map[board.Edge]bool{}
	for _, r := range x.Rivers {
		for _, e := range r.Sites {
			out[e] = true
		}
	}
	return out
}

// IsBridgeSite reports whether edge e is crossed by a channel.
func (x *Ext) IsBridgeSite(e board.Edge) bool {
	for _, r := range x.Rivers {
		if slices.Contains(r.Sites, e) {
			return true
		}
	}
	return false
}

// IsRiverHex reports whether hex h carries a channel.
func (x *Ext) IsRiverHex(h board.Hex) bool {
	for _, r := range x.Rivers {
		if slices.Contains(r.Hexes, h) {
			return true
		}
	}
	return false
}

// IsRiverEdge reports whether edge e has a river hex on at least one of its two
// sides, whether or not the channel crosses it. This is the edge a road or a
// ship earns its coin on.
func (x *Ext) IsRiverEdge(e board.Edge) bool {
	return slices.ContainsFunc(board.EdgeHexes(e), x.IsRiverHex)
}

// IsRiverVertex reports whether vertex v touches at least one river hex, swamp
// included. This is the vertex a settlement (or a Knights setup city) earns its
// coin on.
func (x *Ext) IsRiverVertex(v board.Vertex) bool {
	for _, h := range v.Hexes() {
		if x.IsRiverHex(h) {
			return true
		}
	}
	return false
}
