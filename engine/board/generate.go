package board

import (
	"fmt"
	"maps"
	"math"
	"math/rand/v2"
	"slices"
)

// Board generation modes. Both are deterministic functions of the game seed
// (see docs/dice.md and docs/maps.md); they differ in how balanced the layout is.
const (
	BoardRandom = "random" // shuffle with only the no-adjacent-6/8 rule
	BoardFair   = "fair"   // additionally balance numbers and resource pips
)

type Resource int8

const (
	ResNone Resource = iota // desert tile / generic 3:1 harbor
	Wood
	Brick
	Sheep
	Wheat
	Ore
	// Terrain beyond the five bankable resources (never valid Hand indexes).
	Gold // produces a resource of the owner's choice (Islands)
	Sea
	Lake // produces fish (Fishermen scenario)
	Fog  // wire-only: an unrevealed hex (reserved for a future fog-of-war mode); never stored
	// ResLand is a builder/codec sentinel: a producing land hex whose specific
	// resource (and number, if left blank) is randomized when the game starts.
	// It only appears in unresolved config/saved/shared boards; Resolve replaces
	// every ResLand with a real resource, so it never reaches play or replay.
	ResLand
	// Border is impassable foreign land: visible (rendered as muted off-board
	// terrain, e.g. Canada/Mexico on the USA map) but never buildable, never
	// sailable, never producing. It bounds a continent with neighboring land
	// instead of open ocean. Base-legal (no module owns it).
	Border
	// Swamp is where a river reaches the sea (Rivers): buildable land that holds
	// the robber and produces nothing, treated like the desert everywhere. It is a
	// terrain rather than a tile flag because the renderer, validator, RobberOK and
	// RobberNeutral all read terrain. Appended last because the numeric values are
	// a persisted legacy encoding (resource_json.go) and are frozen.
	Swamp
)

var Resources = []Resource{Wood, Brick, Sheep, Wheat, Ore}

// Producing reports whether a tile resource pays out directly on its number.
func (r Resource) Producing() bool { return r >= Wood && r <= Ore }

type Tile struct {
	Res    Resource // ResNone = desert
	Number int      // dice number token; 0 on desert
}

type Harbor struct {
	Verts [2]Vertex `json:"verts"`
	Ratio int       `json:"ratio"` // 3 = generic, 2 = specific
	Res   Resource  `json:"res"`   // ResNone for generic
}

type Board struct {
	Radius  int
	Tiles   map[Hex]Tile
	Robber  Hex
	Harbors []Harbor
}

// EnsureHarbors places a harbor set on a board that has none, so a hand-built
// or curated map still plays with ports. The count scales with coastline length
// (about 3.3 coast edges per harbor), so a standard 30-edge coast gets the base
// game's nine. A board that already has harbors is left untouched.
func (b *Board) EnsureHarbors(rng *rand.Rand) {
	if len(b.Harbors) == 0 {
		n := min(max(len(b.coastEdges())*3/10, 5), 16)
		b.Harbors = placeHarbors(rng, b, n)
	}
}

// StripToShape resets a board to its bare silhouette so a fresh fair layout can
// be rolled onto it: producing tiles (and ResLand) become generic land with a
// blank number, while Sea/Lake/Border/Fog/Gold and desert keep their position.
// Combined with Resolve this is the map builder's "Randomize" (and the
// Shape→Design promotion). Harbors are left untouched.
func (b *Board) StripToShape() {
	for h, t := range b.Tiles {
		switch t.Res {
		case Sea, Lake, Border, Fog, Gold, ResNone, Swamp:
			if t.Number != 0 {
				b.Tiles[h] = Tile{Res: t.Res} // clear any stray token, keep terrain
			}
		default:
			b.Tiles[h] = Tile{Res: ResLand}
		}
	}
}

// coastEdges returns edges with exactly one adjacent land hex: the coastline
// (also the outer boundary on a landlocked full-hexagon board).
func (b *Board) coastEdges() []Edge {
	set := map[Edge]bool{}
	for h, t := range b.Tiles {
		if t.Res == Sea {
			continue
		}
		for _, e := range h.Edges() {
			land := 0
			for _, eh := range EdgeHexes(e) {
				if b.Land(eh) {
					land++
				}
			}
			if land == 1 { // faces sea or the board boundary
				set[e] = true
			}
		}
	}
	out := make([]Edge, 0, len(set))
	for e := range set {
		out = append(out, e)
	}
	sortEdges(out)
	return out
}

// Clone returns a deep copy so callers (e.g. module SetupBoard) can mutate a
// board from the game config without affecting the source.
func (b *Board) Clone() *Board {
	tiles := make(map[Hex]Tile, len(b.Tiles))
	maps.Copy(tiles, b.Tiles)
	harbors := make([]Harbor, len(b.Harbors))
	copy(harbors, b.Harbors)
	return &Board{Radius: b.Radius, Tiles: tiles, Robber: b.Robber, Harbors: harbors}
}

func (b *Board) Contains(h Hex) bool {
	_, ok := b.Tiles[h]
	return ok
}

// OffBoard is where the robber stands when it is not on the board: Fishermen
// starts it beside the board (it enters on the first 7), and the two-fish spend
// takes it off again. A coordinate rather than a flag, so every existing
// `h == s.Board.Robber` check reads "not blocked" without change. No board
// contains it (HexesInRadius, Tiles, Land/RobberOK/Contains all exclude it), and
// its magnitude stays clear of overflow when coord helpers add two together.
var OffBoard = Hex{Q: -1 << 30, R: -1 << 30}

// RobberOnBoard reports whether the robber is on the board. False only before
// the first 7 of a Fishermen game and after a two-fish spend.
func (b *Board) RobberOnBoard() bool { return b.Robber != OffBoard }

// Land reports whether the hex is buildable land (on the board, not sea, and not
// impassable foreign-land border).
func (b *Board) Land(h Hex) bool {
	t, ok := b.Tiles[h]
	return ok && t.Res != Sea && t.Res != Border
}

// RobberOK reports whether the robber may sit on this hex. Land alone is not
// enough: it is also true for the ResLand/Fog sentinels, and Sea and Border are
// off the board.
//
// Desert, Lake and Swamp are legal: none produces a resource, so the robber
// blocks no income there. Fishermen floods every desert into a lake, so
// excluding Lake would push the setup robber onto a producing hex. Sea must
// stay refused (Islands carves the outer ring); see islands.relocateRobber and
// ruletest.TestSetupRobberNeverOnWater.
func (b *Board) RobberOK(h Hex) bool {
	t, ok := b.Tiles[h]
	return ok && (t.Res.Producing() || t.Res == ResNone || t.Res == Gold || t.Res == Lake || t.Res == Swamp)
}

// RobberNeutral reports whether the robber on this hex blocks no resource: a
// desert, or the lake a desert became. Setup and relocation prefer such a hex
// over merely legal ones. A lake still blocks the fish catch on its numbers
// (engine/scenarios, fishCatch); in a Fishermen game the robber starts off the board
// (board.OffBoard) instead.
func (b *Board) RobberNeutral(h Hex) bool {
	t, ok := b.Tiles[h]
	return ok && (t.Res == ResNone || t.Res == Lake || t.Res == Swamp)
}

// IsSea reports whether the hex is a sea tile.
func (b *Board) IsSea(h Hex) bool {
	t, ok := b.Tiles[h]
	return ok && t.Res == Sea
}

// LandVertex reports whether the vertex touches at least one land tile.
func (b *Board) LandVertex(v Vertex) bool {
	for _, h := range v.Hexes() {
		if b.Land(h) {
			return true
		}
	}
	return false
}

// LandEdge reports whether one of the two hexes the edge separates is land,
// which is where a road may stand (coastal edges included). "Both ends touch
// land" is wrong: it allows a strait between two sea hexes.
func (b *Board) LandEdge(e Edge) bool {
	return slices.ContainsFunc(EdgeHexes(e), b.Land)
}

// SeaEdge reports whether the edge borders at least one sea tile, where ships
// go (Islands).
func (b *Board) SeaEdge(e Edge) bool {
	return slices.ContainsFunc(EdgeHexes(e), b.IsSea)
}

// EdgeHexes returns the one or two hexes an edge borders.
func EdgeHexes(e Edge) []Hex {
	var out []Hex
	for _, ha := range e.A.Hexes() {
		for _, hb := range e.B.Hexes() {
			if ha == hb {
				out = append(out, ha)
			}
		}
	}
	return out
}

// Islands labels each land hex with a connected-component id, flood-filling
// over land adjacency. Ids are deterministic (smallest hex first).
func (b *Board) Islands() map[Hex]int {
	out := map[Hex]int{}
	next := 0
	for _, h := range HexesInRadius(b.Radius) {
		if !b.Land(h) {
			continue
		}
		if _, seen := out[h]; seen {
			continue
		}
		stack := []Hex{h}
		out[h] = next
		for len(stack) > 0 {
			cur := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			for _, n := range cur.Neighbors() {
				if b.Land(n) {
					if _, seen := out[n]; !seen {
						out[n] = next
						stack = append(stack, n)
					}
				}
			}
		}
		next++
	}
	return out
}

// HarborSeaHex returns the water hex a harbor's dock stands on: the single
// non-land hex beside its edge. Two harbors must never share it (docs/maps.md).
// ok is false when the edge is not a proper coast edge (both sides land or both
// water); callers skip such a harbor.
func (b *Board) HarborSeaHex(h Harbor) (Hex, bool) {
	return b.edgeSeaHex(NewEdge(h.Verts[0], h.Verts[1]))
}

// edgeSeaHex is HarborSeaHex for a bare edge.
func (b *Board) edgeSeaHex(e Edge) (Hex, bool) {
	var sea Hex
	n := 0
	for _, h := range EdgeHexes(e) {
		if !b.Land(h) {
			sea = h
			n++
		}
	}
	return sea, n == 1
}

// HarborAt returns the harbor a vertex belongs to, if any.
func (b *Board) HarborAt(v Vertex) (Harbor, bool) {
	for _, h := range b.Harbors {
		if h.Verts[0] == v || h.Verts[1] == v {
			return h, true
		}
	}
	return Harbor{}, false
}

// Scaling beyond 6 players is our own extension: a hex-shaped grid of the given
// radius with tile/token/harbor counts scaled proportionally (docs/engine.md).

// RadiusFor maps player count to board radius: 19, 37, or 61 hexes.
func RadiusFor(players int) int {
	switch {
	case players <= 4:
		return 2
	case players <= 6:
		return 3
	default:
		return 4
	}
}

// tileBag builds the resource bag for a board size. Ratios follow the base
// game: wood/sheep/wheat heavy, brick/ore lighter, 1 desert per ~30 tiles.
func tileBag(hexes int) []Resource {
	deserts := 1 + (hexes-1)/30
	producing := hexes - deserts
	// Base ratio 4:4:4:3:3 over 18 producing tiles.
	counts := map[Resource]int{}
	order := []Resource{Wood, Sheep, Wheat, Brick, Ore}
	weights := map[Resource]int{Wood: 4, Sheep: 4, Wheat: 4, Brick: 3, Ore: 3}
	assigned := 0
	for _, r := range order {
		counts[r] = producing * weights[r] / 18
		assigned += counts[r]
	}
	for i := 0; assigned < producing; i++ { // distribute remainder
		counts[order[i%len(order)]]++
		assigned++
	}
	var bag []Resource
	for _, r := range order {
		for range counts[r] {
			bag = append(bag, r)
		}
	}
	for range deserts {
		bag = append(bag, ResNone)
	}
	return bag
}

var baseTokens = []int{2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12}

// tokenShare is the base bag's ratio out of 18: a lone 2 and 12, every other
// value paired. numberTokens scales this, so a board of any size keeps the base
// game's proportions.
var tokenShare = map[int]int{2: 1, 3: 2, 4: 2, 5: 2, 6: 2, 8: 2, 9: 2, 10: 2, 11: 2, 12: 1}

// tokenDealOrder orders the scaled counts and is the tie-break when no rng is
// supplied. Mirror-image values sit together and the reds come last. Seeded
// boards break ties with the rng instead, because a fixed order favoured 6 over
// 8 on every seed (see numberTokens).
var tokenDealOrder = []int{2, 12, 3, 11, 4, 10, 5, 9, 6, 8}

// numberTokens builds a bag of n dice tokens with the base distribution scaled
// to the board: each value gets n*share/18 tokens and the leftover goes by
// largest fractional part. numberTokens(18) is exactly baseTokens.
func numberTokens(rng *rand.Rand, n int) []int {
	if n <= 0 {
		return nil
	}
	counts := make(map[int]int, len(tokenDealOrder))
	dealt := 0
	for _, v := range tokenDealOrder {
		counts[v] = n * tokenShare[v] / 18
		dealt += counts[v]
	}
	// Largest remainder: each spare token goes to the value furthest below its
	// exact share. Ties are common (6 and 8 share a share) and are broken by the
	// seed, since a fixed order gave every 35-token board four 6s and three 8s.
	// With a nil rng tokenDealOrder decides: complementTokens and Resolve must stay
	// pure functions of their input.
	for ; dealt < n; dealt++ {
		best, most, ties := 0, -1, 0
		for _, v := range tokenDealOrder {
			short := n*tokenShare[v] - counts[v]*18
			switch {
			case short > most:
				best, most, ties = v, short, 1
			case short == most:
				ties++
				// Reservoir sampling: each of the `ties` equally-short values is chosen with
				// probability 1/ties in one pass.
				if rng != nil && rng.IntN(ties) == 0 {
					best = v
				}
			}
		}
		counts[best]++
	}
	out := make([]int, 0, n)
	for _, v := range tokenValues {
		for range counts[v] {
			out = append(out, v)
		}
	}
	return out
}

// tokenValues is the set of legal dice tokens in ascending order (no 7).
var tokenValues = []int{2, 3, 4, 5, 6, 8, 9, 10, 11, 12}

// complementTokens returns a bag of `blanks` tokens for the un-numbered
// producing tiles of a partially-pinned board. It targets numberTokens over all
// number-bearing tiles minus the pinned tokens, so the finished board
// approximates the standard spread. With no pins it equals numberTokens(blanks).
// Over-filled values are trimmed from the most abundant remaining values. No
// randomness here; placeNumbers shuffles later.
func complementTokens(pinned []int, blanks int) []int {
	if blanks <= 0 {
		return nil
	}
	count := map[int]int{}
	for _, n := range numberTokens(nil, len(pinned)+blanks) {
		count[n]++
	}
	for _, n := range pinned {
		if count[n] > 0 {
			count[n]-- // consume a pinned token from the ideal spread
		}
	}
	bag := make([]int, 0, blanks)
	for _, v := range tokenValues {
		for range count[v] {
			bag = append(bag, v)
		}
	}
	// The remaining counts sum to >= blanks (equal when pins are a subset of the
	// ideal). Trim any surplus from the most-abundant value, keeping balance.
	for len(bag) > blanks {
		cnt := map[int]int{}
		for _, n := range bag {
			cnt[n]++
		}
		most, mostCount := 0, -1
		for _, v := range tokenValues {
			if cnt[v] > mostCount {
				most, mostCount = v, cnt[v]
			}
		}
		for i, n := range bag {
			if n == most {
				bag = append(bag[:i], bag[i+1:]...)
				break
			}
		}
	}
	return bag
}

// harborCount scales with the radius (procedural full-hexagon boards). Curated
// boards scale by coastline length instead; see EnsureHarbors.
func harborCount(radius int) int {
	return 9 + 3*(radius-2)
}

// GenerateRadius builds a board at an explicit radius (some modules need more
// room than the player count implies) in the given mode, keeping the layout
// with the lowest penalty. No two 6/8 hexes may touch: generation reshuffles on
// a seeded stream up to a size-scaled cap and only then falls back to the
// fewest adjacent reds. Fair mode also balances number spacing, per-resource
// pips and over-loaded spots. The loop is bounded.
func GenerateRadius(rng *rand.Rand, players, radius int, mode string) (*Board, error) {
	if players < 2 || players > 10 {
		return nil, fmt.Errorf("board: players must be 2-10, got %d", players)
	}
	hexes := HexesInRadius(radius)
	bag := tileBag(len(hexes))
	numbers := numberTokens(rng, len(hexes)-countDeserts(bag))
	fair := mode == BoardFair

	// The constructive solver deals resources (deserts included) and numbers
	// directly. resSlots is every tile; numSlots follows from where the deserts
	// land. See solve.go.
	g := newGrid(hexes)
	res := make([]Resource, len(hexes))
	num := make([]int, len(hexes))
	resSlots := make([]int, len(hexes))
	for i := range hexes {
		resSlots[i] = i
	}
	solveLayout(rng, g, res, num, resSlots, nil, bag, numbers, fair)

	b := &Board{Radius: radius, Tiles: make(map[Hex]Tile, len(hexes))}
	for i, h := range hexes {
		if res[i] == ResNone {
			b.Tiles[h] = Tile{Res: ResNone}
			b.Robber = h // multiple deserts: the robber lands on the last one
			continue
		}
		b.Tiles[h] = Tile{Res: res[i], Number: num[i]}
	}
	b.Harbors = placeHarbors(rng, b, harborCount(radius))
	return b, nil
}

func countDeserts(bag []Resource) int {
	n := 0
	for _, r := range bag {
		if r == ResNone {
			n++
		}
	}
	return n
}

// Pips is the number of dice combinations a token pays on: 5 for a 6 or 8 down
// to 1 for a 2 or 12, and 0 for no token. Exported for islands' robber
// relocation.
func Pips(n int) int { return pipValue(n) }

func pipValue(n int) int {
	if n <= 0 || n == 7 {
		return 0
	}
	return 6 - abs(7-n)
}

// Fair-mode tuning. These are the thresholds the soft objectives are measured
// against; the weights they are scored with live in penalty.
const (
	// fairPipBand is the per-resource average-pip spread treated as balanced. It
	// sits just above 1/3, the best a standard board can reach (58 pips over three
	// 4-hex and two 3-hex resources gives 3.25 vs 3.33); anything tighter would be
	// unreachable. See docs/maps.md.
	fairPipBand = 0.34
	// hotSpot3/hotSpot2 are the pip sums at which a settlement spot counts as
	// over-loaded, for a vertex touching three producing tiles and for a coastal
	// vertex touching two. 13 is the legal 3-tile maximum (5+4+4) and 9 the coastal
	// one (a 6/8 with a 5/9).
	hotSpot3 = 13
	hotSpot2 = 9
	// clumpMax is the largest same-resource cluster that costs nothing. Touching
	// pairs are normal; a 3- or 4-hex block is a monopoly.
	clumpMax = 2
)

// penalty scores how unbalanced a layout is; 0 is ideal. Random mode only
// penalizes adjacent red (6/8) numbers. Fair mode adds duplicate-number
// adjacency, per-resource pip imbalance, over-loaded spots and clumping.
func (b *Board) penalty(fair bool) float64 {
	red := func(n int) bool { return n == 6 || n == 8 }
	pen := float64(b.adjacentPairs(func(a, c int) bool { return red(a) && red(c) })) * 100
	if !fair {
		return pen
	}
	// roundf on every product: `pen += x*y` can fuse into an FMA on arm64 but not
	// amd64, which would make the score architecture-dependent. See solve.go.
	pen += roundf(float64(b.adjacentPairs(func(a, c int) bool { return a == c })) * 12)
	pen += roundf(b.pipImbalance() * 20)
	hot3, hot2 := b.hotSpots()
	pen += roundf(float64(hot3)*8) + roundf(float64(hot2)*3)
	pen += roundf(float64(b.clumpExcess()) * 10)
	return pen
}

// adjacentPairs counts unordered pairs of numbered-tile neighbors matching f.
func (b *Board) adjacentPairs(f func(n1, n2 int) bool) int {
	count := 0
	for h, t := range b.Tiles {
		if t.Number == 0 {
			continue
		}
		for _, nb := range h.Neighbors() {
			nt, ok := b.Tiles[nb]
			if !ok || nt.Number == 0 {
				continue
			}
			if f(t.Number, nt.Number) {
				count++
			}
		}
	}
	return count / 2 // each pair is seen from both hexes
}

// pipImbalance is how far the spread of per-resource average pips exceeds the
// fair band. 0 means every resource yields comparably.
func (b *Board) pipImbalance() float64 {
	var pipSum, count [6]int
	for _, t := range b.Tiles {
		if !t.Res.Producing() {
			continue
		}
		pipSum[t.Res] += pipValue(t.Number)
		count[t.Res]++
	}
	minAvg, maxAvg := math.Inf(1), math.Inf(-1)
	for _, r := range Resources {
		if count[r] == 0 {
			continue
		}
		avg := float64(pipSum[r]) / float64(count[r])
		minAvg = math.Min(minAvg, avg)
		maxAvg = math.Max(maxAvg, avg)
	}
	if spread := maxAvg - minAvg; spread > fairPipBand {
		return spread - fairPipBand
	}
	return 0
}

// hotSpots counts over-loaded settlement spots by the pips a settlement there
// would collect: hot3 for inland vertices at or above hotSpot3, hot2 for
// coastal ones at or above hotSpot2. They are separate because the coastal
// maximum is weaker and scored more cheaply.
func (b *Board) hotSpots() (hot3, hot2 int) {
	seen := map[Vertex]bool{}
	for h := range b.Tiles {
		for _, v := range h.Vertices() {
			if seen[v] {
				continue
			}
			seen[v] = true
			producing, pips := 0, 0
			for _, hh := range v.Hexes() {
				if t, ok := b.Tiles[hh]; ok && t.Res.Producing() {
					producing++
					pips += pipValue(t.Number)
				}
			}
			switch {
			case producing >= 3 && pips >= hotSpot3:
				hot3++
			case producing == 2 && pips >= hotSpot2:
				hot2++
			}
		}
	}
	return hot3, hot2
}

// clumpExcess sums how far each same-resource cluster runs past clumpMax, so a
// 3-hex block costs 1 and a 4-hex block 2. Clusters are connected groups of
// equal producing resources.
func (b *Board) clumpExcess() int {
	seen := map[Hex]bool{}
	excess := 0
	for h, t := range b.Tiles {
		if seen[h] || !t.Res.Producing() {
			continue
		}
		seen[h] = true
		stack, size := []Hex{h}, 0
		for len(stack) > 0 {
			cur := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			size++
			for _, nb := range cur.Neighbors() {
				if nt, ok := b.Tiles[nb]; ok && !seen[nb] && nt.Res == t.Res {
					seen[nb] = true
					stack = append(stack, nb)
				}
			}
		}
		if size > clumpMax {
			excess += size - clumpMax
		}
	}
	return excess
}

// PlaceHarbors lays n harbors out evenly around the board's coastline and
// deals each a base-game-proportioned mix of generic 3:1 and resource-specific
// 2:1 ports. A coast edge belongs to a land hex and faces sea or the board
// boundary. Exported so modules that reshape the board (Islands) can recompute
// harbors after carving up the coast.
func PlaceHarbors(rng *rand.Rand, b *Board, n int) []Harbor {
	return placeHarbors(rng, b, n)
}

// placeHarbors spreads n harbors around the coastline. The coast splits into
// simple loops (landmass, islets, inland seas); each gets a share proportional
// to its length, evenly spaced with a seeded rotation, which keeps harbors at
// least two coast edges apart.
//
// One water hex can serve several coast edges (a bay or strait), so each
// spaced position is a target: if its water hex is taken the harbor slides to
// the nearest free edge on the loop, and is dropped if none is free. A board
// may end up with fewer than n harbors, but never two docks in one hex.
func placeHarbors(rng *rand.Rand, b *Board, n int) []Harbor {
	if n < 0 {
		n = 0
	}
	loops := coastLoops(b.coastEdges())
	alloc := allocateHarbors(loops, n)

	// Both claims are global: a water hex can touch two coastlines (an islet in a
	// bay), so dock hexes are reserved across all loops.
	usedVerts := map[Vertex]bool{}
	usedSea := map[Hex]bool{}
	var edges []Edge
	for i, loop := range loops {
		for _, want := range spaceOnLoop(rng, loop, alloc[i]) {
			e, ok := nearestFreeCoastEdge(b, loop, want, usedVerts, usedSea)
			if !ok {
				continue // this loop is saturated; drop the harbor
			}
			usedVerts[e.A], usedVerts[e.B] = true, true
			if sea, ok := b.edgeSeaHex(e); ok {
				usedSea[sea] = true
			}
			edges = append(edges, e)
		}
	}

	kinds := harborMix(rng, len(edges))
	out := make([]Harbor, len(edges))
	for i, e := range edges {
		h := kinds[i]
		h.Verts = [2]Vertex{e.A, e.B}
		out[i] = h
	}
	return out
}

// coastLoops splits the coastline into ordered simple cycles. On a hex grid a
// coastal vertex touches exactly two coast edges, so the coastline is a
// disjoint union of loops. Loops come out lowest edge first because the input
// is sorted.
func coastLoops(coast []Edge) [][]Edge {
	inc := map[Vertex][]Edge{} // coastal vertex -> its (two) incident coast edges
	for _, e := range coast {
		inc[e.A] = append(inc[e.A], e)
		inc[e.B] = append(inc[e.B], e)
	}
	visited := make(map[Edge]bool, len(coast))
	var loops [][]Edge
	for _, start := range coast {
		if visited[start] {
			continue
		}
		visited[start] = true
		loop := []Edge{start}
		v := start.B
		for {
			var next Edge
			ok := false
			for _, e := range inc[v] {
				if !visited[e] {
					next, ok = e, true
					break
				}
			}
			if !ok {
				break // the ring has closed back on its start edge
			}
			visited[next] = true
			loop = append(loop, next)
			v = next.Other(v)
		}
		loops = append(loops, loop)
	}
	return loops
}

// nearestFreeCoastEdge returns the edge closest to `want` along the loop that
// can still take a harbor, searching outward (forward before backward at equal
// distance, no randomness). It returns false when the loop is full.
func nearestFreeCoastEdge(b *Board, loop []Edge, want Edge, usedVerts map[Vertex]bool, usedSea map[Hex]bool) (Edge, bool) {
	L := len(loop)
	idx := slices.Index(loop, want)
	if idx < 0 {
		return Edge{}, false
	}
	for d := 0; d <= L/2; d++ {
		for _, off := range [2]int{d, -d} {
			e := loop[((idx+off)%L+L)%L]
			if harborFits(b, e, usedVerts, usedSea) {
				return e, true
			}
			if d == 0 {
				break // +0 and -0 are the same edge
			}
		}
	}
	return Edge{}, false
}

// harborFits reports whether an edge can host a harbor given what is already
// placed: neither endpoint may belong to another harbor, and the water hex its
// dock would stand on must be unclaimed. An edge with no single water side
// (both hexes land, or both water) can host no dock and never fits.
func harborFits(b *Board, e Edge, usedVerts map[Vertex]bool, usedSea map[Hex]bool) bool {
	if usedVerts[e.A] || usedVerts[e.B] {
		return false
	}
	sea, ok := b.edgeSeaHex(e)
	return ok && !usedSea[sea]
}

// allocateHarbors splits n harbors across the coast loops, giving each a share
// proportional to its length but never more than it can hold without two
// harbors sharing a vertex (at most len(loop)/2). Each harbor goes to the
// currently least-dense loop, so coverage stays even across multiple landmasses.
// If the whole coastline saturates before n are placed, it returns fewer.
func allocateHarbors(loops [][]Edge, n int) []int {
	alloc := make([]int, len(loops))
	for range n {
		best := -1
		var bestDensity float64
		for i, loop := range loops {
			if alloc[i] >= len(loop)/2 { // loop full: another harbor would touch one
				continue
			}
			d := float64(alloc[i]) / float64(len(loop))
			if best == -1 || d < bestDensity {
				best, bestDensity = i, d
			}
		}
		if best == -1 {
			break
		}
		alloc[best]++
	}
	return alloc
}

// spaceOnLoop returns k edges evenly spaced around the loop, rotated by a
// seed-driven offset. With k ≤ len(loop)/2 the gap between consecutive picks is
// at least two edges, so no two picked edges are adjacent (share a vertex).
func spaceOnLoop(rng *rand.Rand, loop []Edge, k int) []Edge {
	L := len(loop)
	if k <= 0 || L == 0 {
		return nil
	}
	off := rng.IntN(L)
	out := make([]Edge, 0, k)
	for i := range k {
		out = append(out, loop[(off+i*L/k)%L])
	}
	return out
}

// harborMix returns n harbor kinds in the base proportion of generic 3:1 to
// specific 2:1 (9 harbors: 5 specific, 4 generic). Specific ports go
// round-robin over the resources in a seeded order, and the mix is shuffled.
// Below nine harbors the generic count is capped to keep min(n, 5) specific
// ports, so no resource goes without one.
func harborMix(rng *rand.Rand, n int) []Harbor {
	if n <= 0 {
		return nil
	}
	generic := (8*n + 9) / 18 // integer rounding of n*4/9
	if maxGeneric := n - min(n, len(Resources)); generic > maxGeneric {
		generic = maxGeneric
	}
	specific := n - generic

	res := append([]Resource(nil), Resources...)
	rng.Shuffle(len(res), func(i, j int) { res[i], res[j] = res[j], res[i] })

	kinds := make([]Harbor, 0, n)
	for i := range specific {
		kinds = append(kinds, Harbor{Ratio: 2, Res: res[i%len(res)]})
	}
	for range generic {
		kinds = append(kinds, Harbor{Ratio: 3})
	}
	rng.Shuffle(len(kinds), func(i, j int) { kinds[i], kinds[j] = kinds[j], kinds[i] })
	return kinds
}

// sortEdges orders edges deterministically so map iteration order cannot leak
// into the rng-driven shuffle.
func sortEdges(edges []Edge) {
	less := func(a, b Edge) bool {
		if a.A != b.A {
			return vertexLess(a.A, b.A)
		}
		return vertexLess(a.B, b.B)
	}
	for i := 1; i < len(edges); i++ {
		for j := i; j > 0 && less(edges[j], edges[j-1]); j-- {
			edges[j], edges[j-1] = edges[j-1], edges[j]
		}
	}
}

// Non-land tiles host no settlements. A comparison rather than a switch so a
// new producing resource needs no edit here.
func hostsSettlements(r Resource) bool {
	return r != Sea && r != Lake && r != Fog && r != Border
}

// MaxPlayersFor is how many seats a custom board can hold, from its buildable
// tile count (about 4.5 land tiles per seat; 19 seats 4). Mirrors
// recommendedPlayers in frontend/src/lib/format.ts. Not clamped to
// engine.MaxPlayers (board cannot import engine); the caller checks that.
func MaxPlayersFor(b *Board) int {
	if b == nil {
		return math.MaxInt
	}
	land := 0
	for _, t := range b.Tiles {
		if hostsSettlements(t.Res) {
			land++
		}
	}
	// Floor of 2: smaller boards are caught by the caller's own minimum.
	return max(2, int(math.Round(float64(land)/4.5)))
}

// ValidateSeats refuses a board that cannot seat the table. Custom inlined
// boards need it because ValidateLayout and engine.ValidateMap take no player
// count; a 10-player table on the 19-hex Small board could get stuck in setup.
// See TestTenPlayersCannotOpenOnATinyBoard.
func ValidateSeats(b *Board, players int) error {
	if b == nil {
		return nil
	}
	if maxSeats := MaxPlayersFor(b); players > maxSeats {
		return &SeatsError{Max: maxSeats, Players: players}
	}
	return nil
}

// SeatsError is ValidateSeats' refusal, typed so the server can map it to its
// own code carrying both numbers.
type SeatsError struct {
	Max, Players int
}

func (e *SeatsError) Error() string {
	return fmt.Sprintf("board: this map seats %d players, not %d", e.Max, e.Players)
}
