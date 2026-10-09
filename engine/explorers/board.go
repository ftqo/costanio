package explorers

import (
	"math/rand/v2"
	"slices"
	"sort"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// The Explorers map is derived from the public seed, so replay reproduces it
// and the fairness audit can check it. The derivation has two halves:
//
//   - partition() is pure geometry: radius and player count decide the rim, the
//     home island, home waters, the face-down pool, the Council hex and its two
//     anchors.
//   - derivePool() is the seeded half: regions, the nine special hexes per
//     region, shoal die faces, the remaining terrain, and each region's
//     number-chit stack.
//
// Both run twice (SetupBoardSeeded writes the terrain, InitExtBoard records the
// layout), so neither may read anything the other changed: partition takes only
// (radius, players) and derivePool only (partition, seed).

// doubled returns the doubled-axial coordinates the spec is written in:
// X = 2q + r (so a constant X is a vertical column of hexes) and Y = r. West is
// small X, north is negative Y.
func doubled(h board.Hex) (x, y int) { return 2*h.Q + h.R, h.R }

// homeIslandSize is the island's land-hex count: ceil(7 * players / 2), so 14
// at 4 players and 21 at 6.
func homeIslandSize(players int) int { return (7*players + 1) / 2 }

// layout is the geometric partition of the board.
type layout struct {
	radius  int
	home    []board.Hex
	waters  []board.Hex
	pool    []board.Hex
	council board.Hex
	anchors [2]board.Vertex
}

// cornerBetween[i] is the index into Hex.Vertices() of the corner between the
// neighbours in hex directions i and i+1. board.hexDirs and Hex.Vertices() use
// unrelated orders, so the mapping is written out;
// TestCornerBetweenMatchesGeometry checks it.
var cornerBetween = [6]int{1, 0, 5, 4, 3, 2}

// partition derives the rim, the home island, home waters, the pool, the Council
// hex and its anchors. Pure in (radius, players).
func partition(radius, players int) layout {
	l := layout{radius: radius}
	interior := hexesWithin(radius - 1)

	// The home island: the first L interior hexes in (X, |Y|, Y) order (westmost
	// column first, then outward from the equator, north before south). That gives
	// one contiguous landmass anchored at the west.
	ordered := slices.Clone(interior)
	sort.Slice(ordered, func(i, j int) bool { return islandLess(ordered[i], ordered[j]) })
	n := min(homeIslandSize(players), len(ordered))
	l.home = slices.Clone(ordered[:n])
	inHome := make(map[board.Hex]bool, len(l.home))
	for _, h := range l.home {
		inHome[h] = true
	}

	// Home waters: every interior hex adjacent to the island but not part of it.
	// Because the ring is a full hex thick, no island coastal edge touches a pool
	// hex, so every coastal edge is legal for a ship at setup.
	inWater := map[board.Hex]bool{}
	for _, h := range l.home {
		for _, nb := range h.Neighbors() {
			if inHome[nb] || inWater[nb] || dist(nb) >= radius {
				continue
			}
			inWater[nb] = true
			l.waters = append(l.waters, nb)
		}
	}
	sortHexes(l.waters)

	// The pool: every interior hex that is neither island nor home waters.
	for _, h := range interior {
		if !inHome[h] && !inWater[h] {
			l.pool = append(l.pool, h)
		}
	}
	sortHexes(l.pool)

	l.council, l.anchors = councilAndAnchors(l.home, l.waters)
	return l
}

// islandLess orders interior hexes by (X, |Y|, Y): the home island's deal order.
func islandLess(a, b board.Hex) bool {
	ax, ay := doubled(a)
	bx, by := doubled(b)
	if ax != bx {
		return ax < bx
	}
	if abs(ay) != abs(by) {
		return abs(ay) < abs(by)
	}
	return ay < by
}

// councilAndAnchors picks the Council hex and its two berths. The Council hex
// is the home-waters hex with the greatest X (ties: smallest |Y|, then smallest
// Y), the middle of the island's seaward coast, reachable from every starting
// harbour settlement. The anchors are the opposite corners flanking its seaward
// face: with d the direction from the Council toward the island's centroid,
// the corners between (d+1, d+2) and (d+4, d+5), giving ships from the north
// and south lanes a berth each.
func councilAndAnchors(home, waters []board.Hex) (board.Hex, [2]board.Vertex) {
	if len(waters) == 0 {
		return board.Hex{}, [2]board.Vertex{}
	}
	best := waters[0]
	for _, h := range waters[1:] {
		if councilBetter(h, best) {
			best = h
		}
	}
	d := directionToward(best, home)
	verts := best.Vertices()
	return best, [2]board.Vertex{
		verts[cornerBetween[(d+1)%6]],
		verts[cornerBetween[(d+4)%6]],
	}
}

func councilBetter(h, best board.Hex) bool {
	hx, hy := doubled(h)
	bx, by := doubled(best)
	if hx != bx {
		return hx > bx
	}
	if abs(hy) != abs(by) {
		return abs(hy) < abs(by)
	}
	return hy < by
}

// directionToward is the hex direction index pointing from `from` at the
// centroid of `at`, by the largest cube-coordinate dot product. Ties go to the
// lowest index so the function is total.
func directionToward(from board.Hex, at []board.Hex) int {
	if len(at) == 0 {
		return 0
	}
	// Centroid scaled by len(at) so everything stays in integers; no floats in a
	// frozen derivation.
	var sq, sr int
	for _, h := range at {
		sq += h.Q
		sr += h.R
	}
	n := len(at)
	dq := sq - from.Q*n
	dr := sr - from.R*n
	// Cube coordinates: x = q, z = r, y = -x-z.
	dx, dz := dq, dr
	dy := -dx - dz
	bestIdx, bestDot := 0, 0
	for i, dir := range hexDirections() {
		ex, ez := dir.Q, dir.R
		ey := -ex - ez
		dot := dx*ex + dy*ey + dz*ez
		if i == 0 || dot > bestDot {
			bestIdx, bestDot = i, dot
		}
	}
	return bestIdx
}

// hexDirections mirrors board's direction order (Hex.Neighbors). Duplicated
// rather than exported from board; TestHexDirectionsMatchNeighbors pins it.
func hexDirections() [6]board.Hex {
	return [6]board.Hex{{Q: 1, R: 0}, {Q: 1, R: -1}, {Q: 0, R: -1}, {Q: -1, R: 0}, {Q: -1, R: 1}, {Q: 0, R: 1}}
}

// poolPlan is the seeded half of the derivation.
type poolPlan struct {
	hexes []PoolHex
	chits [][]int
	// res and sea are the pool's terrain, which lives on the board (hidden by
	// MaskBoard) and never on PoolHex: PoolHex goes into the event log and every
	// client's view, so it would publish the unexplored map. Only SetupBoardSeeded
	// reads these.
	res map[board.Hex]board.Resource
	sea map[board.Hex]bool
}

// derivePool assigns every pool hex to a region, places the nine special hexes
// per region, numbers the shoals, deals the terrain and shuffles each region's
// number-chit stack. Pure in (pool, seed). Each step draws from its own
// reserved slot on the public stream (engine.ExplorersBoardSeqs), so changing
// one step does not move the others.
func derivePool(pool []board.Hex, seed uint64) poolPlan {
	regions := splitRegions(pool)
	out := poolPlan{
		hexes: make([]PoolHex, 0, len(pool)),
		chits: make([][]int, RegionCount),
		res:   map[board.Hex]board.Resource{},
		sea:   map[board.Hex]bool{},
	}
	specialRng := engine.PublicRngForSeed(seed, engine.ExplorersBoardSeqs.Special)
	shoalRng := engine.PublicRngForSeed(seed, engine.ExplorersBoardSeqs.Shoal)
	terrainRng := engine.PublicRngForSeed(seed, engine.ExplorersBoardSeqs.Terrain)
	chitRng := [RegionCount]*rand.Rand{
		engine.PublicRngForSeed(seed, engine.ExplorersBoardSeqs.ChitNorth),
		engine.PublicRngForSeed(seed, engine.ExplorersBoardSeqs.ChitSouth),
	}

	// Pass one: where each region's nine special hexes go, as far apart as the
	// region allows.
	var specials [RegionCount][]board.Hex
	for region := range RegionCount {
		specials[region] = placeSpecials(regions[region], specialRng)
	}
	// Pass two: what each one is. Colouring is global across both regions, since
	// they meet at the equator and two shoals touching across it are as bad as two
	// inside one region. Each region still gets three of each.
	kindsOf := assignKinds(specials)

	for region := range RegionCount {
		hexes := regions[region]
		kind := map[board.Hex]Special{}
		var shoals, farms []board.Hex
		for i, h := range specials[region] {
			kind[h] = kindsOf[region][i]
			switch kindsOf[region][i] {
			case SpecialShoal:
				shoals = append(shoals, h)
			case SpecialSpice:
				farms = append(farms, h)
			case SpecialNone, SpecialGold:
			}
		}
		// Shoal numbering: 1, 2, 3 in the north region and 4, 5, 6 in the south,
		// assigned within the region from the seed. Six shoals match the six faces of
		// the single fishing die.
		faces := shoalFaces(region)
		shoalRng.Shuffle(len(faces), func(i, j int) { faces[i], faces[j] = faces[j], faces[i] })
		shoalOf := map[board.Hex]int{}
		for i, h := range shoals {
			if i < len(faces) {
				shoalOf[h] = faces[i]
			}
		}
		// One of each village per region, so both copies of every advantage exist and
		// are reachable (the doubled-advantage rule needs that).
		villages := []Village{VillageSwift, VillagePirate, VillageGold}
		villageOf := map[board.Hex]Village{}
		for i, h := range farms {
			if i < len(villages) {
				villageOf[h] = villages[i]
			}
		}

		// The rest: `max(1, round(size/16))` sea hexes, producing land for everything
		// else. A revealed sea hex is a real result (2 gold and a lane), so the ratio
		// is a rule rather than a leftover.
		var rest []board.Hex
		for _, h := range hexes {
			if kind[h] == SpecialNone {
				rest = append(rest, h)
			}
		}
		order := slices.Clone(rest)
		terrainRng.Shuffle(len(order), func(i, j int) { order[i], order[j] = order[j], order[i] })
		seaWanted := min(max(1, (len(hexes)+8)/16), len(order))
		for _, h := range order[:seaWanted] {
			out.sea[h] = true
		}
		land := order[seaWanted:]
		bag := producingBag(len(land))
		terrainRng.Shuffle(len(bag), func(i, j int) { bag[i], bag[j] = bag[j], bag[i] })
		for i, h := range land {
			out.res[h] = bag[i]
		}

		for _, h := range hexes {
			p := PoolHex{H: h, Region: region, Kind: kind[h]}
			switch p.Kind {
			case SpecialShoal:
				p.Shoal = shoalOf[h]
			case SpecialSpice:
				p.Village = villageOf[h]
			case SpecialNone, SpecialGold:
			}
			out.hexes = append(out.hexes, p)
		}
		// The chit stack: one chit per producing-land hex and one per gold field
		// in the region, shuffled from the seed and consumed from the front.
		out.chits[region] = chitStack(len(land)+GoldFieldsPerRegion, chitRng[region])
	}
	sort.Slice(out.hexes, func(i, j int) bool { return hexLess(out.hexes[i].H, out.hexes[j].H) })
	return out
}

// splitRegions divides the pool about the board's equator: Y < 0 north, Y > 0
// south, and the equator row dealt one hex at a time in ascending X to the
// smaller region (north on a tie). A sign rule would hand the whole row to one
// region, since the home island sits on the west of it; dealing keeps the
// regions within one hex of each other, which matters with nine specials each.
func splitRegions(pool []board.Hex) [RegionCount][]board.Hex {
	var out [RegionCount][]board.Hex
	var equator []board.Hex
	for _, h := range pool {
		switch _, y := doubled(h); {
		case y < 0:
			out[RegionNorth] = append(out[RegionNorth], h)
		case y > 0:
			out[RegionSouth] = append(out[RegionSouth], h)
		default:
			equator = append(equator, h)
		}
	}
	sort.Slice(equator, func(i, j int) bool {
		xi, _ := doubled(equator[i])
		xj, _ := doubled(equator[j])
		if xi != xj {
			return xi < xj
		}
		return hexLess(equator[i], equator[j])
	})
	for _, h := range equator {
		if len(out[RegionSouth]) < len(out[RegionNorth]) {
			out[RegionSouth] = append(out[RegionSouth], h)
		} else {
			out[RegionNorth] = append(out[RegionNorth], h)
		}
	}
	sortHexes(out[RegionNorth])
	sortHexes(out[RegionSouth])
	return out
}

// placeSpecials picks the region's nine special hexes, as far apart as the
// region allows. The spec says no two may be adjacent, but a four-player
// region is 19 hexes and fits at most seven non-adjacent ones. So:
//
//  1. Separation is maximised by trying `placementAttempts` seeded shuffles
//     and keeping the one with the fewest adjacent pairs (earlier attempt wins
//     ties, so the result depends only on the seed).
//  2. The three kinds are then coloured so no two hexes of the same kind are
//     adjacent (assignKinds), which is the property that matters: one ship
//     must not work two shoals, farms or gold fields from one position.
//
// TestSpecialsOfAKindNotAdjacent checks the second half over every
// supported player count and a sweep of seeds.
const placementAttempts = 32

func placeSpecials(hexes []board.Hex, rng *rand.Rand) []board.Hex {
	want := GoldFieldsPerRegion + ShoalsPerRegion + FarmsPerRegion
	var best []board.Hex
	bestCost := -1
	for range placementAttempts {
		order := slices.Clone(hexes)
		rng.Shuffle(len(order), func(i, j int) { order[i], order[j] = order[j], order[i] })
		got := onePlacement(order, want)
		cost := adjacentPairs(got)
		if bestCost < 0 || cost < bestCost {
			best, bestCost = got, cost
		}
		if bestCost == 0 {
			break
		}
	}
	return best
}

// onePlacement is one greedy pass: take every hex that touches nothing already
// taken, then, if nine were not reached, relax one violation at a time,
// cheapest first, as the base generator relaxes the red-number rule.
func onePlacement(order []board.Hex, want int) []board.Hex {
	chosen := map[board.Hex]bool{}
	var out []board.Hex
	for _, h := range order {
		if len(out) == want {
			break
		}
		if adjacentCount(h, chosen) == 0 {
			chosen[h] = true
			out = append(out, h)
		}
	}
	for len(out) < want {
		best, bestCost, found := board.Hex{}, 0, false
		for _, h := range order {
			if chosen[h] {
				continue
			}
			cost := adjacentCount(h, chosen)
			if !found || cost < bestCost {
				best, bestCost, found = h, cost, true
			}
		}
		if !found {
			break // the region is smaller than nine hexes: nothing left to take
		}
		chosen[best] = true
		out = append(out, best)
	}
	return out
}

// adjacentPairs counts the unordered adjacent pairs within a placement.
func adjacentPairs(hexes []board.Hex) int {
	set := map[board.Hex]bool{}
	for _, h := range hexes {
		set[h] = true
	}
	n := 0
	for _, h := range hexes {
		n += adjacentCount(h, set)
	}
	return n / 2
}

// assignKinds colours each region's nine chosen hexes with three gold fields,
// three shoals and three spice farms so that no two of a kind touch, across
// both regions at once (they meet at the equator). The stock is per region;
// only the adjacency is global.
//
// It is an exhaustive backtracking search, since a greedy pass can paint itself
// into a corner. The first valid assignment in a fixed kind order is taken. If
// none exists (no supported player count produces such a clump) it deals each
// region's multiset in order, so the function is total.
func assignKinds(specials [RegionCount][]board.Hex) [RegionCount][]Special {
	kinds := []Special{SpecialGold, SpecialShoal, SpecialSpice}
	var left [RegionCount]map[Special]int
	type slot struct {
		region int
		h      board.Hex
	}
	var slots []slot
	for region := range RegionCount {
		left[region] = map[Special]int{
			SpecialGold:  GoldFieldsPerRegion,
			SpecialShoal: ShoalsPerRegion,
			SpecialSpice: FarmsPerRegion,
		}
		for _, h := range specials[region] {
			slots = append(slots, slot{region, h})
		}
	}
	index := make(map[board.Hex]int, len(slots))
	for i, sl := range slots {
		index[sl.h] = i
	}
	before := make([][]int, len(slots))
	for i, sl := range slots {
		for _, nb := range sl.h.Neighbors() {
			if j, ok := index[nb]; ok && j < i {
				before[i] = append(before[i], j)
			}
		}
	}
	painted := make([]Special, len(slots))
	var walk func(i int) bool
	walk = func(i int) bool {
		if i == len(slots) {
			return true
		}
		region := slots[i].region
		for _, k := range kinds {
			if left[region][k] == 0 {
				continue
			}
			clash := false
			for _, j := range before[i] {
				if painted[j] == k {
					clash = true
					break
				}
			}
			if clash {
				continue
			}
			left[region][k]--
			painted[i] = k
			if walk(i + 1) {
				return true
			}
			left[region][k]++
		}
		return false
	}
	var out [RegionCount][]Special
	if !walk(0) {
		for region := range RegionCount {
			for _, k := range kinds {
				for range left[region][k] {
					out[region] = append(out[region], k)
				}
			}
			for len(out[region]) < len(specials[region]) {
				out[region] = append(out[region], SpecialGold)
			}
			out[region] = out[region][:len(specials[region])]
		}
		return out
	}
	for region := range RegionCount {
		out[region] = make([]Special, 0, len(specials[region]))
	}
	for i, sl := range slots {
		out[sl.region] = append(out[sl.region], painted[i])
	}
	return out
}

func adjacentCount(h board.Hex, set map[board.Hex]bool) int {
	n := 0
	for _, nb := range h.Neighbors() {
		if set[nb] {
			n++
		}
	}
	return n
}

// shoalFaces is the die faces a region's three shoals carry.
func shoalFaces(region int) []int {
	if region == RegionNorth {
		return []int{1, 2, 3}
	}
	return []int{4, 5, 6}
}

// producingBag deals n producing-land tiles at the base generator's resource
// weights (4:4:4:3:3 over 18), with no desert: Explorers has no robber.
func producingBag(n int) []board.Resource {
	order := []board.Resource{board.Wood, board.Sheep, board.Wheat, board.Brick, board.Ore}
	weights := []int{4, 4, 4, 3, 3}
	counts := make([]int, len(order))
	assigned := 0
	for i := range order {
		counts[i] = n * weights[i] / 18
		assigned += counts[i]
	}
	for i := 0; assigned < n; i++ {
		counts[i%len(order)]++
		assigned++
	}
	bag := make([]board.Resource, 0, n)
	for i, r := range order {
		for range counts[i] {
			bag = append(bag, r)
		}
	}
	return bag
}

// chitValues is the base number distribution without 2 and 12, so new land is
// worth settling. Each value has the same share, so a stack of n chits is these
// eight dealt round-robin and then shuffled. The order is the base generator's
// (mirror values adjacent, reds last), so a spare chit becomes a 6 or 8 only
// after every other value is served.
var chitValues = []int{3, 11, 4, 10, 5, 9, 6, 8}

func chitStack(n int, rng *rand.Rand) []int {
	if n <= 0 {
		return []int{}
	}
	out := make([]int, 0, n)
	for i := range n {
		out = append(out, chitValues[i%len(chitValues)])
	}
	rng.Shuffle(len(out), func(i, j int) { out[i], out[j] = out[j], out[i] })
	return out
}

// RefusesAuthoredMaps: the Explorers board is a partition, a chit stack and a
// hidden pool order, none of which survives a preset's fixed tiles or a share
// code. See engine.AuthoredMapRefuser.
func (Module) RefusesAuthoredMaps() string {
	return "Explorers deals its own map, so it cannot be played on a chosen or hand-drawn one."
}

// SetupBoard is empty: every choice this module makes needs its own reserved
// stream, which the single *rand.Rand cannot provide. See SetupBoardSeeded and
// engine.BoardSeeder.
func (Module) SetupBoard(*board.Board, engine.GameConfig, *rand.Rand) {}

// SetupBoardSeeded reshapes the generated full-hexagon board into the Explorers
// map: a Sea rim, the home island with the terrain and chits the generator dealt
// it, a ring of home waters, and the face-down pool.
func (Module) SetupBoardSeeded(b *board.Board, cfg engine.GameConfig, publicSeed uint64) {
	l := partition(b.Radius, cfg.Players)
	plan := derivePool(l.pool, publicSeed)

	// No ports in Explorers: bank trade is a flat 3:1, so the generated harbours
	// are discarded.
	b.Harbors = nil
	// No robber either. A 7 moves a pirate ship instead, so the robber stays off
	// the board all game.
	b.Robber = board.OffBoard

	// The rim: open ocean, which also keeps the home island off the board boundary.
	for _, h := range board.HexesInRadius(b.Radius) {
		if dist(h) == b.Radius {
			b.Tiles[h] = board.Tile{Res: board.Sea}
		}
	}
	for _, h := range l.waters {
		b.Tiles[h] = board.Tile{Res: board.Sea}
	}
	// The home island keeps what the generator dealt, including the red-number
	// adjacency rule, except that a desert is re-dealt as producing terrain. Its
	// chit comes from the non-red mid numbers so the adjacency rule still holds.
	fill := engine.PublicRngForSeed(publicSeed, engine.ExplorersBoardSeqs.Terrain)
	for _, h := range l.home {
		t, ok := b.Tiles[h]
		if !ok || t.Res.Producing() {
			continue
		}
		res := board.Resources[fill.IntN(len(board.Resources))]
		safe := []int{3, 4, 5, 9, 10, 11}
		b.Tiles[h] = board.Tile{Res: res, Number: safe[fill.IntN(len(safe))]}
	}
	// cak+explorers rule B: replace 1 forest with 1 fields on the starting island,
	// since Knights spends grain heavily. Our island is dealt, so the first forest
	// in (X, |Y|, Y) order becomes fields and keeps its chit. Done after the desert
	// re-deal so a re-dealt hex is eligible too. No forest means no swap.
	if withKnightsRuleset(cfg.Ruleset) {
		for _, h := range l.home {
			if t, ok := b.Tiles[h]; ok && t.Res == board.Wood {
				t.Res = board.Wheat
				b.Tiles[h] = t
				break
			}
		}
	}
	// The pool. Terrain goes on the board, where MaskBoard hides it until a ship
	// reveals it; a producing hex's chit is drawn from the region's stack at
	// reveal time and is 0 until then.
	for _, p := range plan.hexes {
		switch p.Kind {
		case SpecialGold:
			b.Tiles[p.H] = board.Tile{Res: board.Gold}
		case SpecialShoal:
			b.Tiles[p.H] = board.Tile{Res: board.Sea}
		case SpecialSpice:
			// Land that produces nothing and carries no chit: a spice farm is worth its
			// sack and advantage.
			b.Tiles[p.H] = board.Tile{Res: board.ResNone}
		case SpecialNone:
			if plan.sea[p.H] {
				b.Tiles[p.H] = board.Tile{Res: board.Sea}
			} else {
				b.Tiles[p.H] = board.Tile{Res: plan.res[p.H]}
			}
		}
	}
}

// InitExtBoard records the layout in the event log (engine.ExtBoardInitializer):
// the value is marshalled into EvBoardGenerated and restored on every fold, so
// later changes to this file affect only new games. It returns the completed
// creation-time Ext because State.Apply assigns the result rather than merging.
func (Module) InitExtBoard(s *engine.State) engine.Extension {
	e, ok := s.Ext[Name].(*Ext)
	if !ok {
		e = freshExt(len(s.Players))
	} else {
		c, _ := e.CloneExt().(*Ext)
		e = c
	}
	l := partition(s.Board.Radius, len(s.Players))
	plan := derivePool(l.pool, s.PublicSeed)
	e.Home = l.home
	e.Waters = l.waters
	e.Pool = plan.hexes
	e.Chits = plan.chits
	e.Council = l.council
	e.Anchors = l.anchors[:]
	return e
}

// ---- small geometry helpers -------------------------------------------------

func dist(h board.Hex) int {
	x, z := h.Q, h.R
	y := -x - z
	return max(abs(x), max(abs(y), abs(z)))
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

func hexesWithin(radius int) []board.Hex {
	if radius < 0 {
		return nil
	}
	return board.HexesInRadius(radius)
}

func hexLess(a, b board.Hex) bool {
	if a.Q != b.Q {
		return a.Q < b.Q
	}
	return a.R < b.R
}

func sortHexes(hs []board.Hex) {
	sort.Slice(hs, func(i, j int) bool { return hexLess(hs[i], hs[j]) })
}

func vertexLess(a, b board.Vertex) bool {
	if a.Q != b.Q {
		return a.Q < b.Q
	}
	if a.R != b.R {
		return a.R < b.R
	}
	return a.Side < b.Side
}

func edgeLess(a, b board.Edge) bool {
	if a.A != b.A {
		return vertexLess(a.A, b.A)
	}
	return vertexLess(a.B, b.B)
}
