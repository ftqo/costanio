package board

import (
	"sort"
	"testing"
	"time"
)

// fullLandShape builds a radius-r board of generic blank land (every tile
// ResLand, no numbers), the shape a large curated map (e.g. the 157-tile
// United States map) hands to Resolve.
func fullLandShape(r int) *Board {
	tiles := map[Hex]Tile{}
	for _, h := range HexesInRadius(r) {
		tiles[h] = Tile{Res: ResLand}
	}
	return &Board{Radius: r, Tiles: tiles}
}

// TestResolveLargeBoardIsFast: resolving a large custom board must be
// near-instant (a reject-and-retry generator once took ~25s random and ~2min
// fair). The 3s deadline catches that with room to spare while tolerating a
// heavily loaded machine; tighter wall-clock budgets fail spuriously under
// load.
func TestResolveLargeBoardIsFast(t *testing.T) {
	for _, mode := range []string{BoardRandom, BoardFair} {
		b := fullLandShape(6) // 127 tiles, all blank land
		done := make(chan time.Duration, 1)
		go func() {
			start := time.Now()
			b.Resolve(testRNG(1), mode)
			done <- time.Since(start)
		}()
		select {
		case d := <-done:
			t.Logf("mode %s: Resolve %v", mode, d.Round(time.Millisecond))
		case <-time.After(3 * time.Second):
			t.Fatalf("mode %s: Resolve took over 3s", mode)
		}
	}
}

// gridAdjacentReds counts unordered adjacent red (6/8) pairs over an
// index-based number array, mirroring Board.adjacentReds.
func gridAdjacentReds(g *grid, num []int) int {
	c := 0
	for i := range g.hexes {
		if !isRed(num[i]) {
			continue
		}
		for _, j := range g.nbr[i] {
			if j > i && isRed(num[j]) {
				c++
			}
		}
	}
	return c
}

// TestPlaceNumbersNoAdjacentReds checks constructive placement spreads the red
// (6/8) tokens so none touch on a standard radius-2 board, across many seeds,
// preserving the exact token multiset.
func TestPlaceNumbersNoAdjacentReds(t *testing.T) {
	hexes := HexesInRadius(2) // 19 hexes
	g := newGrid(hexes)
	numSlots := make([]int, 18) // leave one tile blank (the desert)
	for i := range numSlots {
		numSlots[i] = i
	}
	want := numberTokens(nil, 18)

	for seed := range uint64(50) {
		num := make([]int, len(hexes))
		placeNumbers(testRNG(seed), g, numSlots, append([]int(nil), want...), num)

		if r := gridAdjacentReds(g, num); r != 0 {
			t.Errorf("seed %d: %d adjacent red pairs, want 0", seed, r)
		}
		got := make([]int, 0, len(numSlots))
		for _, s := range numSlots {
			got = append(got, num[s])
		}
		if !sameMultiset(got, want) {
			t.Errorf("seed %d: token multiset not preserved\n got=%v\nwant=%v", seed, got, want)
		}
		// Non-slot tiles must stay blank.
		if num[18] != 0 {
			t.Errorf("seed %d: blank tile got number %d", seed, num[18])
		}
	}
}

// gridFrom builds a grid plus res/num arrays from a finished board, in
// canonical present-hex order, to compare index-based scoring with the
// map-based Board methods.
func gridFrom(b *Board) (*grid, []Resource, []int) {
	var present []Hex
	for _, h := range HexesInRadius(b.Radius) {
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
	return g, res, num
}

// TestIndexPenaltyMatchesBoard checks the solver's index-based penalty equals
// Board.penalty in both modes across generated boards.
func TestIndexPenaltyMatchesBoard(t *testing.T) {
	for _, fair := range []bool{false, true} {
		for seed := range uint64(30) {
			mode := BoardRandom
			if fair {
				mode = BoardFair
			}
			b, _ := GenerateRadius(testRNG(seed), 6, 4, mode)
			g, res, num := gridFrom(b)
			got := g.penalty(res, num, fair)
			want := b.penalty(fair)
			if got != want {
				t.Errorf("fair=%v seed %d: index penalty %.4f != board penalty %.4f", fair, seed, got, want)
			}
		}
	}
}

func sameMultiset(a, b []int) bool {
	if len(a) != len(b) {
		return false
	}
	as := append([]int(nil), a...)
	bs := append([]int(nil), b...)
	sort.Ints(as)
	sort.Ints(bs)
	for i := range as {
		if as[i] != bs[i] {
			return false
		}
	}
	return true
}

// TestGridNeighbors checks the indexed substrate precomputes hex adjacency
// (present-tile neighbor indices) correctly: the center of a radius-1 board has
// all 6 neighbors, an outer hex has only the 3 that lie inside the board.
func TestGridNeighbors(t *testing.T) {
	hexes := HexesInRadius(1) // center + 6 ring
	g := newGrid(hexes)

	if len(g.hexes) != len(hexes) {
		t.Fatalf("grid has %d hexes, want %d", len(g.hexes), len(hexes))
	}
	ci, ok := g.index[Hex{0, 0}]
	if !ok {
		t.Fatal("center hex not indexed")
	}
	if got := len(g.nbr[ci]); got != 6 {
		t.Errorf("center has %d neighbors, want 6", got)
	}

	oi := g.index[Hex{1, 0}]
	if got := len(g.nbr[oi]); got != 3 {
		t.Errorf("outer hex {1,0} has %d in-board neighbors, want 3", got)
	}
	// Every neighbor index must be a real, distinct tile index.
	for i := range g.hexes {
		seen := map[int]bool{}
		for _, j := range g.nbr[i] {
			if j < 0 || j >= len(g.hexes) {
				t.Fatalf("tile %d: neighbor index %d out of range", i, j)
			}
			if j == i {
				t.Fatalf("tile %d lists itself as a neighbor", i)
			}
			if seen[j] {
				t.Fatalf("tile %d: duplicate neighbor %d", i, j)
			}
			seen[j] = true
		}
	}
}
