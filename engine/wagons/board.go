package wagons

import (
	"math/rand/v2"
	"slices"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// Trade hexes are derived from the board's shape rather than fixed on a map. The
// candidates are capes (land with exactly three consecutive non-land neighbours),
// and the triple with the largest minimum pairwise distance wins. On a full
// hexagon of radius R the capes are the six outer corners, and the two
// alternating triples tie at 2R apart, so the seed picks one. That gives the
// reference layout's key property: three equal legs of one circuit.
//
// Everything here is a pure function of the land mask plus the public seed and
// reads no other module's state, so it is safe wherever the SetupBoard sort puts
// this module (see docs/engine.md).

// tradeHexCount is three at every player count: one per cargo role.
const tradeHexCount = 3

// hexDirs are the six neighbour offsets, in board.Hex.Neighbors' order, read
// off the origin rather than restating the board package's unexported copy.
var hexDirs = board.Hex{}.Neighbors()

// hexDist is the cube distance between two hexes.
func hexDist(a, b board.Hex) int {
	dq, dr := a.Q-b.Q, a.R-b.R
	ds := -dq - dr
	return (abs(dq) + abs(dr) + abs(ds)) / 2
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

// capeOutward reports whether h is a cape (land with exactly three non-land
// neighbours, consecutive around it) and, if so, which neighbour direction points
// seaward from the middle of that run.
//
// On a full hexagon that is the direction the corner sits in: the corner at
// R*d[0] = (R,0) has sea at neighbour indices 5, 0 and 1, whose middle is 0. This
// lets the barbarian derivation use the reference board's terms on any board.
func capeOutward(b *board.Board, h board.Hex) (int, bool) {
	if !b.Land(h) {
		return 0, false
	}
	var water [6]bool
	n := 0
	for i, nb := range h.Neighbors() {
		if !b.Land(nb) {
			water[i] = true
			n++
		}
	}
	if n != 3 {
		return 0, false
	}
	for s := range 6 {
		if water[s] && water[(s+1)%6] && water[(s+2)%6] {
			return (s + 1) % 6, true
		}
	}
	return 0, false // three, but not consecutive: a strait, not a cape
}

// capeHexes lists every cape on the board in board order (HexesInRadius), so
// the enumeration is the same everywhere.
func capeHexes(b *board.Board) []board.Hex {
	var out []board.Hex
	for _, h := range board.HexesInRadius(b.Radius) {
		if _, ok := capeOutward(b, h); ok {
			out = append(out, h)
		}
	}
	return out
}

// maxCapes bounds the triple enumeration. A procedural board has six capes; an
// authored silhouette can have many more and C(n,3) is cubic. The first maxCapes
// in board order is a deterministic cut, and 20 gives 1140 triples.
const maxCapes = 20

// deriveTrade picks the three trade hexes and their roles.
//
// Candidates are the capes in board order. The chosen triple has the largest
// minimum pairwise distance; ties (on a full hexagon there are always exactly
// two) are broken by the seeded rng. The rng then permutes the three roles over
// the chosen hexes.
//
// rng is from the public stream (engine.WagonsBoardSeq): the result is on the
// board for everyone from the first frame and must be re-derivable. See
// verify/modules.mjs.
func deriveTrade(capes []board.Hex, rng *rand.Rand) (hexes [tradeHexCount]board.Hex, roles [tradeHexCount]uint8, ok bool) {
	if len(capes) > maxCapes {
		capes = capes[:maxCapes]
	}
	if len(capes) < tradeHexCount {
		return hexes, roles, false
	}
	best := -1
	var pick [][tradeHexCount]board.Hex
	for i := range capes {
		for j := i + 1; j < len(capes); j++ {
			for k := j + 1; k < len(capes); k++ {
				d := min(hexDist(capes[i], capes[j]),
					hexDist(capes[i], capes[k]), hexDist(capes[j], capes[k]))
				if d > best {
					best = d
					pick = pick[:0]
				}
				if d == best {
					pick = append(pick, [tradeHexCount]board.Hex{capes[i], capes[j], capes[k]})
				}
			}
		}
	}
	if len(pick) == 0 {
		return hexes, roles, false
	}
	hexes = pick[rng.IntN(len(pick))]
	for i, r := range rng.Perm(tradeHexCount) {
		roles[i] = uint8(r)
	}
	return hexes, roles, true
}

// sharedEdge returns the edge two adjacent hexes share, and whether they are
// adjacent at all.
func sharedEdge(a, c board.Hex) (board.Edge, bool) {
	for _, e := range a.Edges() {
		if slices.Contains(board.EdgeHexes(e), c) {
			return e, true
		}
	}
	return board.Edge{}, false
}

// boardEdges lists every edge of the board once, in board order. It is the
// "deterministic edge order" the barbarian fallback walks.
func boardEdges(b *board.Board) []board.Edge {
	seen := map[board.Edge]bool{}
	var out []board.Edge
	for _, h := range board.HexesInRadius(b.Radius) {
		if _, ok := b.Tiles[h]; !ok {
			continue
		}
		for _, e := range h.Edges() {
			if !seen[e] {
				seen[e] = true
				out = append(out, e)
			}
		}
	}
	return out
}

// deriveBarbarians places the three barbarians, one per trade hex.
//
// For the trade hex in outward direction d[i], its barbarian starts on the path
// shared by the hex at (R-1)*d[i] and the hex at (R-1)*d[i] + d[i+1]: one step
// inward along the outward direction, then one step around. The three positions
// are rotationally symmetric and each sits on the approach to its own hex.
//
// If that path does not exist, is not a legal home, or is taken, walk the board's
// edge order from it and take the first free legal one. This fallback never
// fires on a procedural board.
func deriveBarbarians(b *board.Board, hexes [tradeHexCount]board.Hex, blocked func(board.Edge) bool) [tradeHexCount]board.Edge {
	var out [tradeHexCount]board.Edge
	all := boardEdges(b)
	index := make(map[board.Edge]int, len(all))
	for i, e := range all {
		index[e] = i
	}
	taken := map[board.Edge]bool{}
	legal := func(e board.Edge) bool {
		// LandEdge (derivation 12). It differs from the old predicate only
		// across a strait, which a Wagons board never has (Islands is refused
		// alongside it).
		return e.Valid() && b.LandEdge(e) && !blocked(e) && !taken[e]
	}
	for i, h := range hexes {
		start := 0
		if dir, ok := capeOutward(b, h); ok {
			inner := board.Hex{Q: h.Q - hexDirs[dir].Q, R: h.R - hexDirs[dir].R}
			round := hexDirs[(dir+1)%6]
			around := board.Hex{Q: inner.Q + round.Q, R: inner.R + round.R}
			if e, ok := sharedEdge(inner, around); ok {
				if legal(e) {
					out[i] = e
					taken[e] = true
					continue
				}
				if idx, ok := index[e]; ok {
					start = idx
				}
			}
		}
		for n := range all {
			e := all[(start+n)%len(all)]
			if legal(e) {
				out[i] = e
				taken[e] = true
				break
			}
		}
	}
	return out
}

// --- the shape of a trade hex ---------------------------------------------
//
// A trade hex is a cape, so three of its six edges and two of its six corners face
// only water, and the building stands there. Those are blocked (no road on the
// edges, no settlement or city on the corners); the four land corners behave
// normally, distance rule included.
//
// docs/rules/wagons.md places the plaza as a third board.Side value on the trade
// hex's coordinate, with four spokes joining it to the land corners. Doing that
// in engine/board means teaching Hex.Vertices, Vertex.Neighbors, Vertex.Edges and
// edge ordering about a degree-four vertex, plus wire and art support, so it is
// deferred. Here the plaza is a module-owned vertex at the same address,
// board.Vertex{Q, R, plazaSide}, and the module walks its own path graph over it.
// Consequences:
//
//   - No settlement or city on a plaza: checkSettlementSpot refuses any vertex
//     with Side > board.S, and nothing on the board produces one.
//   - No road on a spoke: board.Edge.Valid refuses an out-of-range Side.
//   - Given up: the spec allows roads on spokes. Here a spoke always costs the
//     bare-path 2 MP and pays no toll (a Decision recorded in the spec). Wagons
//     has no Longest Road award, so such a road would only have earned the toll
//     and 1 MP, on four paths out of several hundred.
//
// plazaSide is the value engine/board will use when the tile lands, so the
// migration is a move rather than a rewrite.
const plazaSide board.Side = 2

// plazaOf is the plaza vertex of a trade hex.
func plazaOf(h board.Hex) board.Vertex {
	return board.Vertex{Q: h.Q, R: h.R, Side: plazaSide}
}

// isPlaza reports whether v is a plaza address rather than one of the board's
// two corner sides. Board helpers (Hexes, Neighbors, Edges, LandVertex) are
// undefined on a plaza, so this guards them.
func isPlaza(v board.Vertex) bool { return v.Side > board.S }

// landCorners are the four corners of a trade hex a wagon may stand on and a
// settlement may be built on: those sharing at least one land hex besides the
// trade hex. The other two touch only water and are blocked. Returned in the
// hex's clockwise corner order.
func landCorners(b *board.Board, h board.Hex) []board.Vertex {
	var out []board.Vertex
	for _, v := range h.Vertices() {
		if cornerIsLand(b, h, v) {
			out = append(out, v)
		}
	}
	return out
}

// cornerIsLand reports whether corner v of hex h touches land other than h.
func cornerIsLand(b *board.Board, h board.Hex, v board.Vertex) bool {
	for _, hh := range v.Hexes() {
		if hh != h && b.Land(hh) {
			return true
		}
	}
	return false
}

// seawardEdges are the trade hex's three blocked edges: the ones it shares with
// a non-land neighbour. No road may stand on one and no wagon may cross one.
func seawardEdges(b *board.Board, h board.Hex) []board.Edge {
	var out []board.Edge
	for _, e := range h.Edges() {
		for _, hh := range board.EdgeHexes(e) {
			if hh != h && !b.Land(hh) {
				out = append(out, e)
				break
			}
		}
	}
	return out
}

// --- harbours on a cape ------------------------------------------------------
//
// The base generator places harbours before any module's board work, and the
// trade hexes are picked afterwards. A cape's middle seaward edge joins its two
// sea-only corners, which a trade hex blocks, so a harbour there could never hold
// a settlement (and under Harbormaster would score for nobody).

// FinishBoard slides every harbour sitting on a candidate cape's two sea-only
// corners one edge along the coast, onto a seaward edge of the same cape with a
// buildable land corner.
//
// It covers every cape this module could pick (ReservedHexes), not just the
// final three, since naming those needs this module's public slot and the other
// modules' vetoes, which FinishBoard lacks. A harbour slid on a cape that stays
// ordinary is just as usable. The trade hex does not move instead because that
// would break the circuit's equal legs.
//
// Draws nothing (rng is unused). Order-independent among finishers: it reads the
// land mask, which no finisher changes on a Wagons board (Islands is refused
// alongside it), and the harbour list, which only Raiders' Islands-only repair
// rewrites. The slide is idempotent, so finisher order does not matter.
func (Wagons) FinishBoard(b *board.Board, _ engine.GameConfig, _ *rand.Rand) {
	slideCapeHarbours(b, Wagons{}.ReservedHexes(b))
}

// slideCapeHarbours is FinishBoard's work, on an explicit cape list.
//
// For each cape in board order, a harbour on its middle seaward edge (both ends
// sea-only) moves to one of the two seaward edges beside it, which share one
// corner with it and have the other on land. The first in the cape's clockwise
// edge order is tried first, then the second, if the first would break a harbour
// rule: no two harbours share a corner or a dock sea hex (board.HarborSeaHex). A
// harbour with nowhere to go stays; on a generated board harbours are spaced far
// enough apart that this never happens.
func slideCapeHarbours(b *board.Board, capes []board.Hex) {
	for _, c := range capes {
		for i, hb := range b.Harbors {
			if !strandedOn(b, c, hb) {
				continue
			}
			for _, e := range seawardEdges(b, c) {
				// The cape's other two seaward edges each have one land corner (by the
				// definition of a cape), so either is usable if it fits.
				if e == board.NewEdge(hb.Verts[0], hb.Verts[1]) || !harbourFits(b, i, e) {
					continue
				}
				b.Harbors[i].Verts = [2]board.Vertex{e.A, e.B}
				break
			}
		}
	}
}

// strandedOn reports whether harbour hb has both its ends on cape c's sea-only
// corners.
func strandedOn(b *board.Board, c board.Hex, hb board.Harbor) bool {
	corners := c.Vertices()
	for _, v := range hb.Verts {
		if !slices.Contains(corners[:], v) || cornerIsLand(b, c, v) {
			return false
		}
	}
	return true
}

// harbourFits reports whether harbour i may move onto edge e without sharing a
// corner or a dock hex with any other harbour.
func harbourFits(b *board.Board, i int, e board.Edge) bool {
	sea, ok := b.HarborSeaHex(board.Harbor{Verts: [2]board.Vertex{e.A, e.B}})
	if !ok {
		return false
	}
	for j, o := range b.Harbors {
		if j == i {
			continue
		}
		if slices.Contains(o.Verts[:], e.A) || slices.Contains(o.Verts[:], e.B) {
			return false
		}
		if os, ok := b.HarborSeaHex(o); ok && os == sea {
			return false
		}
	}
	return true
}
