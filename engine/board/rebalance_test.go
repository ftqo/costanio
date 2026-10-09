package board

import (
	"math/rand/v2"
	"testing"
)

// unbalance changes terrain the way Rivers' painting does after the solver:
// one hex of the most-produced resource becomes a swamp and drops its token,
// and a low hex swaps terrain with a high one, leaving numbers that no longer
// suit the terrain.
func unbalance(b *Board) {
	hexes := HexesInRadius(b.Radius)
	for _, h := range hexes {
		if t := b.Tiles[h]; t.Res.Producing() && pipValue(t.Number) <= 2 {
			b.Tiles[h] = Tile{Res: Swamp}
			break
		}
	}
	var lo, hi Hex
	for _, h := range hexes {
		t := b.Tiles[h]
		if t.Res == Ore && pipValue(t.Number) >= 4 {
			hi = h
		}
		if t.Res == Wheat && pipValue(t.Number) <= 2 {
			lo = h
		}
	}
	a, c := b.Tiles[lo], b.Tiles[hi]
	b.Tiles[lo] = Tile{Res: c.Res, Number: a.Number}
	b.Tiles[hi] = Tile{Res: a.Res, Number: c.Number}
}

// Rebalance never raises the fair penalty, never moves a 6 or 8 next to another,
// leaves every non-movable token where it is, keeps the token multiset, and is
// a pure function of the board (no rng).
func TestRebalanceRespectsPins(t *testing.T) {
	improved := 0
	for seed := range uint64(40) {
		b, err := GenerateRadius(rand.New(rand.NewPCG(seed, 7)), 4, 2, BoardFair)
		if err != nil {
			t.Fatal(err)
		}
		unbalance(b)
		before := b.Clone()
		pinned := Hex{Q: 0, R: 0}
		movable := func(h Hex) bool { return h != pinned }
		b.Rebalance(movable)
		again := before.Clone()
		again.Rebalance(movable)
		for _, h := range HexesInRadius(b.Radius) {
			if b.Tiles[h] != again.Tiles[h] {
				t.Fatalf("seed %d: two rebalances of one board disagree at %v", seed, h)
			}
			if b.Tiles[h].Res != before.Tiles[h].Res {
				t.Fatalf("seed %d: Rebalance moved terrain at %v", seed, h)
			}
		}
		if b.Tiles[pinned] != before.Tiles[pinned] {
			t.Fatalf("seed %d: a hex movable refused had its token moved", seed)
		}
		count := map[int]int{}
		for _, t := range before.Tiles {
			count[t.Number]++
		}
		for _, t := range b.Tiles {
			count[t.Number]--
		}
		for n, c := range count {
			if c != 0 {
				t.Fatalf("seed %d: token %d count changed by %d", seed, n, -c)
			}
		}
		pb, pa := before.penalty(true), b.penalty(true)
		if pa > pb {
			t.Fatalf("seed %d: penalty rose from %v to %v", seed, pb, pa)
		}
		if pa < pb {
			improved++
		}
		red := func(x, y int) bool { return isRed(x) && isRed(y) }
		if before.adjacentPairs(red) < b.adjacentPairs(red) {
			t.Fatalf("seed %d: Rebalance put two reds side by side", seed)
		}
	}
	if improved == 0 {
		t.Fatal("Rebalance improved no unbalanced board")
	}
}
