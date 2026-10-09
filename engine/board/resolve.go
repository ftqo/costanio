package board

import (
	"math/rand/v2"
)

// takesNumber reports whether a tile of this resource carries a dice token.
func takesNumber(r Resource) bool { return r.Producing() || r == Gold || r == ResLand }

// Resolve turns a partially specified board into a playable one: every
// generic-land (ResLand) tile gets a real producing resource, and every
// producing tile without a number token gets one, balanced per `mode`
// (fair/random) like procedural generation. Pinned resources and numbers are
// kept, and a fully specified board is unchanged. Deterministic in rng, so the
// result still follows from the game seed.
func (b *Board) Resolve(rng *rand.Rand, mode string) {
	hexes := HexesInRadius(b.Radius)
	var resFree []Hex
	var deserts []Hex
	landCount := 0
	for _, h := range hexes {
		t, ok := b.Tiles[h]
		if !ok {
			continue
		}
		switch {
		case t.Res == ResNone:
			deserts = append(deserts, h)
			landCount++
		case t.Res == ResLand:
			resFree = append(resFree, h)
			landCount++
		case t.Res.Producing() || t.Res == Gold:
			landCount++
		}
	}

	// Shape-only boards (all generic land, no pinned desert) get the standard
	// desert allotment carved from their land, with the robber on one. Maps that
	// pin their own desert are left alone.
	if len(deserts) == 0 && len(resFree) > 0 {
		rng.Shuffle(len(resFree), func(a, c int) { resFree[a], resFree[c] = resFree[c], resFree[a] })
		for i := 0; i < desertCount(landCount) && len(resFree) > 0; i++ {
			h := resFree[0]
			resFree = resFree[1:]
			b.Tiles[h] = Tile{Res: ResNone}
			b.Robber = h // multiple deserts: the robber lands on the last one
		}
	}

	// The robber always begins on a desert. A custom map may have saved it
	// elsewhere (or nowhere), so snap it onto a desert unless it is on one.
	if len(deserts) > 0 && b.Tiles[b.Robber].Res != ResNone {
		b.Robber = deserts[len(deserts)-1]
	}

	// Every blank producing tile (and soon-to-produce ResLand) needs a token; the
	// deserts carved above are ResNone and excluded. Pinned tokens are gathered
	// too, so the fill complements them toward the standard spread.
	var numFree []Hex
	var pinnedNums []int
	for _, h := range hexes {
		t, ok := b.Tiles[h]
		if !ok {
			continue
		}
		switch {
		case t.Number == 0 && (t.Res == ResLand || t.Res.Producing() || t.Res == Gold):
			numFree = append(numFree, h)
		case t.Number != 0 && takesNumber(t.Res):
			pinnedNums = append(pinnedNums, t.Number)
		}
	}
	if len(resFree) == 0 && len(numFree) == 0 {
		return // already resolved
	}

	resBag := producingBag(len(resFree))
	numbers := complementTokens(pinnedNums, len(numFree))
	fair := mode == BoardFair

	// Index the present tiles in canonical order and hand the free slots to the
	// constructive solver, which fills resources and numbers while honouring
	// pinned tiles. See solve.go.
	present := make([]Hex, 0, len(b.Tiles))
	for _, h := range hexes {
		if _, ok := b.Tiles[h]; ok {
			present = append(present, h)
		}
	}
	g := newGrid(present)
	res := make([]Resource, len(present))
	num := make([]int, len(present))
	for i, h := range present {
		t := b.Tiles[h]
		res[i], num[i] = t.Res, t.Number
	}
	resSlots := slotIndexes(g, resFree)
	numSlots := slotIndexes(g, numFree)

	solveLayout(rng, g, res, num, resSlots, numSlots, resBag, numbers, fair)

	for i, h := range present {
		b.Tiles[h] = Tile{Res: res[i], Number: num[i]}
	}
}

// slotIndexes maps a list of hexes to their grid indices.
func slotIndexes(g *grid, hexes []Hex) []int {
	out := make([]int, len(hexes))
	for i, h := range hexes {
		out[i] = g.index[h]
	}
	return out
}

// desertCount mirrors the procedural ratio: ~1 desert per 30 land tiles.
func desertCount(landTiles int) int {
	if landTiles <= 0 {
		return 0
	}
	return 1 + (landTiles-1)/30
}

// producingBag builds a balanced bag of n producing resources (no deserts),
// using the base game's 4:4:4:3:3 wood/sheep/wheat/brick/ore ratio.
func producingBag(n int) []Resource {
	if n <= 0 {
		return nil
	}
	order := []Resource{Wood, Sheep, Wheat, Brick, Ore}
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
	bag := make([]Resource, 0, n)
	for i, r := range order {
		for range counts[i] {
			bag = append(bag, r)
		}
	}
	return bag
}
