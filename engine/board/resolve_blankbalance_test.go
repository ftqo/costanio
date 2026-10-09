package board

import (
	"math/rand/v2"
	"sort"
	"testing"
)

// A partially numbered design board (resources painted, some hexes without a
// token) must fill the blanks so the whole board's distribution approximates
// the standard spread, rather than piling low numbers on top of the pinned
// tokens.
func TestResolveBlankNumbersComplementPinned(t *testing.T) {
	producing := []Hex{
		{1, 0}, {-1, 0}, {0, 1}, {0, -1}, {1, -1}, {-1, 1}, // ring 1
		{2, 0}, {-2, 0}, {0, 2}, {0, -2}, {2, -2}, {-2, 2}, // ring 2
	}
	// 12 producing tiles total. ideal = numberTokens(nil, 12).
	total := len(producing)
	ideal := numberTokens(nil, total)

	// Pin the first 8 producing tiles with a subset of the ideal multiset, leaving
	// 4 blank. The blanks should get the ideal minus the pinned subset, so the
	// final multiset equals the ideal.
	pinned := []int{2, 3, 3, 4, 5, 6, 8, 9}

	b := &Board{
		Radius: 2,
		Robber: Hex{0, 0},
		Tiles:  map[Hex]Tile{{0, 0}: {Res: ResNone}}, // pinned desert (no carving)
	}
	resOrder := []Resource{Wood, Brick, Sheep, Wheat, Ore}
	for i, h := range producing {
		tile := Tile{Res: resOrder[i%len(resOrder)]}
		if i < len(pinned) {
			tile.Number = pinned[i]
		}
		b.Tiles[h] = tile
	}

	b.Resolve(rand.New(rand.NewPCG(1, 2)), BoardFair)

	got := []int{}
	for _, h := range producing {
		got = append(got, b.Tiles[h].Number)
	}
	sort.Ints(got)
	want := append([]int(nil), ideal...)
	sort.Ints(want)

	if len(got) != len(want) {
		t.Fatalf("got %d numbers, want %d", len(got), len(want))
	}
	for i := range got {
		if got[i] != want[i] {
			t.Errorf("board number multiset = %v, want %v (standard spread)", got, want)
			break
		}
	}
}
