package board

import (
	"math"
	"math/rand/v2"
)

// isRed reports whether a number token is a high-probability "red" 6 or 8, the
// tokens the no-adjacency rule applies to.
func isRed(n int) bool { return n == 6 || n == 8 }

// grid is an index-based view of a board's tiles, built once so the layout
// solver scores adjacency with slice access instead of map[Hex]Tile lookups.
// Tiles are numbered 0..n-1 in the canonical hex order passed in, so the
// solver stays deterministic.
type grid struct {
	hexes []Hex       // index -> hex, in the order supplied
	index map[Hex]int // hex -> index
	nbr   [][]int     // nbr[i] = indices of i's neighbors that are present
	verts [][3]int    // each board vertex as its surrounding tile indices (-1 = absent)

	// Scratch for clumpExcess's component labelling, reused across scoring calls.
	// gen stamps the current pass so the seen marks never need clearing.
	seenGen []int32
	stack   []int
	gen     int32
}

// newGrid builds the indexed substrate from a list of present hexes. The order
// of hexes is preserved (callers pass a deterministic order), and only
// neighbors that are themselves present are recorded.
func newGrid(hexes []Hex) *grid {
	g := &grid{
		hexes:   hexes,
		index:   make(map[Hex]int, len(hexes)),
		nbr:     make([][]int, len(hexes)),
		seenGen: make([]int32, len(hexes)),
		stack:   make([]int, 0, len(hexes)),
	}
	for i, h := range hexes {
		g.index[h] = i
	}
	for i, h := range hexes {
		for _, nb := range h.Neighbors() {
			if j, ok := g.index[nb]; ok {
				g.nbr[i] = append(g.nbr[i], j)
			}
		}
	}
	// Collect every vertex incident to a present hex once, with the tile indices
	// around it, for index-based spot scoring.
	seen := map[Vertex]bool{}
	for _, h := range hexes {
		for _, v := range h.Vertices() {
			if seen[v] {
				continue
			}
			seen[v] = true
			var group [3]int
			for k, hh := range v.Hexes() {
				if j, ok := g.index[hh]; ok {
					group[k] = j
				} else {
					group[k] = -1
				}
			}
			g.verts = append(g.verts, group)
		}
	}
	return g
}

// penalty is the index-based mirror of Board.penalty: identical scoring with no
// map lookups, so the local search optimizes the same objective. Random mode
// scores only adjacent reds; fair mode adds duplicate-number adjacency,
// per-resource pip imbalance, over-loaded settlement spots and same-resource
// clumping.
func (g *grid) penalty(res []Resource, num []int, fair bool) float64 {
	if !fair {
		redPairs := 0
		for i := range g.hexes {
			if num[i] == 0 || !isRed(num[i]) {
				continue
			}
			for _, j := range g.nbr[i] {
				if j > i && isRed(num[j]) {
					redPairs++
				}
			}
		}
		return float64(redPairs) * 100
	}
	// The float64 conversions keep the score architecture-independent; see roundf.
	return g.numPenalty(res, num) +
		roundf(float64(g.clumpExcess(res))*10) +
		roundf(g.pipImbalance(res, num)*20)
}

// roundf forces its argument to be rounded to a float64 before it is used.
// Go may fuse `a + b*c` into an FMA, and does on arm64 but not amd64, so the
// same seed could score 91.2 on one and 91.19999999999999 on the other and the
// solver's `newPen <= pen` comparisons would diverge. That breaks determinism
// and the fairness audit (verify/board.mjs cannot fuse). An explicit conversion
// is the language's way to require rounding, so every product that feeds an
// addition here goes through this function; do not remove these calls.
func roundf(x float64) float64 { return float64(x) }

// pipImbalance mirrors Board.pipImbalance on the indexed arrays.
func (g *grid) pipImbalance(res []Resource, num []int) float64 {
	var pipSum, count [6]int
	for i := range g.hexes {
		if !res[i].Producing() {
			continue
		}
		pipSum[res[i]] += pipValue(num[i])
		count[res[i]]++
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

// hotSpots mirrors Board.hotSpots over the precomputed vertex groups.
func (g *grid) hotSpots(res []Resource, num []int) (hot3, hot2 int) {
	for _, group := range g.verts {
		producing, pips := 0, 0
		for _, ti := range group {
			if ti < 0 || !res[ti].Producing() {
				continue
			}
			producing++
			pips += pipValue(num[ti])
		}
		switch {
		case producing >= 3 && pips >= hotSpot3:
			hot3++
		case producing == 2 && pips >= hotSpot2:
			hot2++
		}
	}
	return hot3, hot2
}

// clumpExcess mirrors Board.clumpExcess on the indexed arrays, using a
// per-call generation stamp in reusable scratch so the local search's inner
// loop does not allocate.
func (g *grid) clumpExcess(res []Resource) int {
	g.gen++
	seen, stack := g.seenGen, g.stack[:0]
	excess := 0
	for i := range g.hexes {
		if seen[i] == g.gen || !res[i].Producing() {
			continue
		}
		seen[i] = g.gen
		stack = append(stack[:0], i)
		size := 0
		for len(stack) > 0 {
			cur := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			size++
			for _, j := range g.nbr[cur] {
				if seen[j] != g.gen && res[j] == res[i] {
					seen[j] = g.gen
					stack = append(stack, j)
				}
			}
		}
		if size > clumpMax {
			excess += size - clumpMax
		}
	}
	g.stack = stack[:0]
	return excess
}

// solveLayout fills res and num (both indexed by tile) for the given free
// slots, satisfying the no-adjacent-red hard constraint and, in fair mode,
// balancing the soft objectives. Pinned values already in res/num are
// respected. Deterministic in rng.
//
// numSlots may be nil, in which case it is derived from the resource assignment
// (every slot whose dealt resource takes a number): the full-board case used by
// GenerateRadius, where deserts land wherever the shuffle puts them.
func solveLayout(rng *rand.Rand, g *grid, res []Resource, num []int,
	resSlots, numSlots []int, resBag []Resource, numbers []int, fair bool) {

	rng.Shuffle(len(resBag), func(i, j int) { resBag[i], resBag[j] = resBag[j], resBag[i] })
	for k, s := range resSlots {
		res[s] = resBag[k]
	}
	if numSlots == nil {
		for _, s := range resSlots {
			if takesNumber(res[s]) {
				numSlots = append(numSlots, s)
			}
		}
	}

	placeNumbers(rng, g, numSlots, numbers, num)

	if fair {
		fairLayout(rng, g, res, num, resSlots, numSlots)
	}
}

// placeNumbers assigns the number-token multiset to numSlots (writing into num,
// indexed by tile) so that no two red tokens (6/8) are neighbours, the one hard
// constraint of board generation. Reds are spread greedily onto a non-adjacent
// set, then a bounded repair pass clears what is left. On boards too dense to
// separate every red (large curated maps) it minimizes adjacencies instead.
// Deterministic in rng.
func placeNumbers(rng *rand.Rand, g *grid, numSlots, numbers, num []int) {
	var reds, rest []int
	for _, n := range numbers {
		if isRed(n) {
			reds = append(reds, n)
		} else {
			rest = append(rest, n)
		}
	}
	rng.Shuffle(len(reds), func(i, j int) { reds[i], reds[j] = reds[j], reds[i] })
	rng.Shuffle(len(rest), func(i, j int) { rest[i], rest[j] = rest[j], rest[i] })

	order := append([]int(nil), numSlots...)
	rng.Shuffle(len(order), func(i, j int) { order[i], order[j] = order[j], order[i] })

	// Seed occupancy from tiles with a pinned number, so fixed reds on custom maps
	// count and pinned tiles are never overwritten.
	isRedAt := make([]bool, len(g.hexes))
	placed := make([]bool, len(g.hexes))
	for i := range g.hexes {
		if num[i] != 0 {
			placed[i] = true
			isRedAt[i] = isRed(num[i])
		}
	}

	// Pass 1: greedily place reds where no neighbor is already red.
	ri := 0
	for _, s := range order {
		if ri >= len(reds) {
			break
		}
		if redNeighbors(g, isRedAt, s) == 0 {
			num[s], isRedAt[s], placed[s] = reds[ri], true, true
			ri++
		}
	}
	// Pass 2: any reds that didn't fit go on the empty slot that adds the
	// fewest new adjacencies (only reached on dense boards).
	for ; ri < len(reds); ri++ {
		best, bestCost := -1, 1<<30
		for _, s := range order {
			if placed[s] {
				continue
			}
			if c := redNeighbors(g, isRedAt, s); c < bestCost {
				best, bestCost = s, c
				if c == 0 {
					break
				}
			}
		}
		if best < 0 {
			break
		}
		num[best], isRedAt[best], placed[best] = reds[ri], true, true
	}
	// Fill the remaining slots with the non-red tokens.
	ti := 0
	for _, s := range order {
		if !placed[s] {
			num[s], placed[s] = rest[ti], true
			ti++
		}
	}
	// Repair: while a red still touches a red, move it onto a non-red slot with
	// no red neighbor (swapping their tokens). Bounded so it always terminates;
	// on achievable boards it reaches zero, otherwise it stops at a local floor.
	repairReds(g, order, num, isRedAt)
}

// fairLayout improves a constructively placed board toward the fair-mode soft
// objectives (no adjacent duplicate numbers, balanced per-resource pips, fewer
// over-loaded settlement spots) with bounded local search and random restarts.
// Moves swap two non-red number tokens or two producing-tile resources; reds
// never move, so the hard constraint holds. Deterministic in rng. Keeps the best
// layout seen and stops early at penalty 0, which very large boards may never
// reach.
func fairLayout(rng *rand.Rand, g *grid, res []Resource, num, resSlots, numSlots []int) {
	// Movable sets: non-red number slots, and producing resource slots.
	var nonRed, resMov []int
	for _, s := range numSlots {
		if !isRed(num[s]) {
			nonRed = append(nonRed, s)
		}
	}
	for _, s := range resSlots {
		if res[s].Producing() {
			resMov = append(resMov, s)
		}
	}
	if len(nonRed) < 2 && len(resMov) < 2 {
		return // nothing to optimize
	}

	bestRes := append([]Resource(nil), res...)
	bestNum := append([]int(nil), num...)
	bestPen := g.penalty(res, num, true)

	const restarts = 40
	for k := 0; k < restarts && bestPen > 0; k++ {
		if k > 0 {
			// Re-randomize from the best layout so far: shuffle the non-red
			// numbers and the producing resources among their slots.
			copy(res, bestRes)
			copy(num, bestNum)
			shuffleAt(rng, num, nonRed)
			shuffleResAt(rng, res, resMov)
		}
		descend(rng, g, res, num, nonRed, resMov)
		if pen := g.penalty(res, num, true); pen < bestPen {
			bestPen = pen
			copy(bestRes, res)
			copy(bestNum, num)
		}
	}
	copy(res, bestRes)
	copy(num, bestNum)
}

// descend runs local search: it proposes random single swaps (two non-red
// numbers, or two producing resources) and keeps any that do not worsen the
// fair penalty, so sideways moves cross plateaus. The proposal budget scales
// with board size. Each proposal rescores only the parts of the penalty it can
// change:
//
//   - numPenalty (adjacent reds, adjacent duplicates, hot spots) reads numbers
//     only. A resource swap cannot change it: hot spots depend on res only via
//     Producing(), and resMov holds producing slots only.
//   - clumpExcess reads resources only, so a number swap cannot change it.
//   - pipImbalance reads both and is rescored every proposal; it is one cheap
//     pass over the tiles.
func descend(rng *rand.Rand, g *grid, res []Resource, num, nonRed, resMov []int) {
	budget := 60 * (len(nonRed) + len(resMov))
	numPart := g.numPenalty(res, num)
	resPart := roundf(float64(g.clumpExcess(res)) * 10)
	pen := numPart + resPart + roundf(g.pipImbalance(res, num)*20)
	for t := 0; t < budget && pen > 0; t++ {
		swapNums := len(resMov) < 2 || (len(nonRed) >= 2 && rng.IntN(2) == 0)
		var a, b int
		newNum, newRes := numPart, resPart
		if swapNums {
			a, b = nonRed[rng.IntN(len(nonRed))], nonRed[rng.IntN(len(nonRed))]
			if a == b {
				continue
			}
			num[a], num[b] = num[b], num[a]
			newNum = g.numPenalty(res, num)
		} else {
			a, b = resMov[rng.IntN(len(resMov))], resMov[rng.IntN(len(resMov))]
			if a == b {
				continue
			}
			res[a], res[b] = res[b], res[a]
			newRes = roundf(float64(g.clumpExcess(res)) * 10)
		}
		newPip := roundf(g.pipImbalance(res, num) * 20)
		if newPen := newNum + newRes + newPip; newPen <= pen {
			// accept (improving or sideways)
			pen, numPart, resPart = newPen, newNum, newRes
			continue
		}
		// reject: undo
		if swapNums {
			num[a], num[b] = num[b], num[a]
		} else {
			res[a], res[b] = res[b], res[a]
		}
	}
}

// numPenalty is the part of the fair penalty that reads only the number tokens:
// adjacent reds, adjacent duplicates, and over-loaded settlement spots.
func (g *grid) numPenalty(res []Resource, num []int) float64 {
	redPairs, samePairs := 0, 0
	for i := range g.hexes {
		if num[i] == 0 {
			continue
		}
		for _, j := range g.nbr[i] {
			if j <= i || num[j] == 0 {
				continue
			}
			if isRed(num[i]) && isRed(num[j]) {
				redPairs++
			}
			if num[i] == num[j] {
				samePairs++
			}
		}
	}
	hot3, hot2 := g.hotSpots(res, num)
	return roundf(float64(redPairs)*100) + roundf(float64(samePairs)*12) +
		roundf(float64(hot3)*8) + roundf(float64(hot2)*3)
}

// shuffleAt shuffles the values held at the given indices of v among themselves.
func shuffleAt(rng *rand.Rand, v, idx []int) {
	rng.Shuffle(len(idx), func(i, j int) {
		v[idx[i]], v[idx[j]] = v[idx[j]], v[idx[i]]
	})
}

// shuffleResAt is shuffleAt for a resource slice.
func shuffleResAt(rng *rand.Rand, v []Resource, idx []int) {
	rng.Shuffle(len(idx), func(i, j int) {
		v[idx[i]], v[idx[j]] = v[idx[j]], v[idx[i]]
	})
}

// redNeighbors counts how many of tile s's neighbors currently hold a red token.
func redNeighbors(g *grid, isRedAt []bool, s int) int {
	c := 0
	for _, j := range g.nbr[s] {
		if isRedAt[j] {
			c++
		}
	}
	return c
}

// repairReds clears residual adjacent-red pairs by relocating a conflicting red
// onto a conflict-free non-red slot, swapping their tokens. Bounded iteration.
func repairReds(g *grid, order, num []int, isRedAt []bool) {
	limit := 4 * len(order)
	for range limit {
		conflict := -1
		for _, s := range order {
			if isRedAt[s] && redNeighbors(g, isRedAt, s) > 0 {
				conflict = s
				break
			}
		}
		if conflict < 0 {
			return // no adjacent reds remain
		}
		target := -1
		for _, s := range order {
			if !isRedAt[s] && s != conflict && redNeighbors(g, isRedAt, s) == 0 {
				target = s
				break
			}
		}
		if target < 0 {
			return // can't improve further (dense board)
		}
		num[conflict], num[target] = num[target], num[conflict]
		isRedAt[conflict], isRedAt[target] = false, true
	}
}
