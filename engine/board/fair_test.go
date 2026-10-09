package board

import "testing"

func sameNumberAdjacent(b *Board) int {
	return b.adjacentPairs(func(a, c int) bool { return a == c })
}

// TestFairBoardIsBalanced checks what fair mode reliably achieves on a
// standard board: no adjacent 6/8, no adjacent duplicate numbers, resource pips
// within the fair band, no over-loaded inland spot, and no same-resource block
// bigger than a pair. Coastal hot spots are minimized but not guaranteed zero,
// since a 6/8 sharing a coastal vertex with a 5/9 is not always avoidable.
func TestFairBoardIsBalanced(t *testing.T) {
	coastalTotal := 0
	for seed := range uint64(40) {
		b, err := GenerateRadius(testRNG(seed), 4, 2, BoardFair)
		if err != nil {
			t.Fatal(err)
		}
		if adjacentReds(b) != 0 {
			t.Errorf("fair seed %d: adjacent 6/8", seed)
		}
		if n := sameNumberAdjacent(b); n != 0 {
			t.Errorf("fair seed %d: %d adjacent same-number pairs", seed, n)
		}
		if imb := b.pipImbalance(); imb > 0 {
			t.Errorf("fair seed %d: pip imbalance %.2f beyond the fair band", seed, imb)
		}
		hot3, hot2 := b.hotSpots()
		if hot3 != 0 {
			t.Errorf("fair seed %d: %d over-loaded inland spots", seed, hot3)
		}
		if n := b.clumpExcess(); n != 0 {
			t.Errorf("fair seed %d: same-resource clumping excess %d", seed, n)
		}
		coastalTotal += hot2
		// Counts and validity are unchanged from random generation.
		if len(b.Tiles) != 19 || b.Tiles[b.Robber].Res != ResNone {
			t.Errorf("fair seed %d: malformed board", seed)
		}
	}
	t.Logf("coastal hot spots across 40 fair boards: %d (softly minimized)", coastalTotal)
}

// TestFairBeatsRandomOnAverage confirms fair mode actually improves balance:
// across seeds, fair boards have strictly lower average imbalance + duplicate
// adjacency than random boards.
func TestFairBeatsRandomOnAverage(t *testing.T) {
	const seeds = 60
	var fairScore, randScore float64
	for seed := range uint64(seeds) {
		f, _ := GenerateRadius(testRNG(seed), 4, 2, BoardFair)
		r, _ := GenerateRadius(testRNG(seed), 4, 2, BoardRandom)
		fairScore += f.pipImbalance() + float64(sameNumberAdjacent(f))
		randScore += r.pipImbalance() + float64(sameNumberAdjacent(r))
	}
	t.Logf("avg unfairness: fair=%.3f random=%.3f", fairScore/seeds, randScore/seeds)
	if fairScore >= randScore {
		t.Errorf("fair boards not more balanced: fair=%.2f random=%.2f", fairScore, randScore)
	}
	if fairScore != 0 {
		t.Logf("note: fair mode left residual unfairness %.2f (bounded search)", fairScore)
	}
}

func TestBoardModeDeterministic(t *testing.T) {
	for _, mode := range []string{BoardRandom, BoardFair} {
		a, _ := GenerateRadius(testRNG(7), 4, 2, mode)
		b, _ := GenerateRadius(testRNG(7), 4, 2, mode)
		if !boardsEqual(a, b) {
			t.Errorf("%s mode not deterministic for same seed", mode)
		}
	}
	// Random and fair modes generally differ for the same seed.
	r, _ := GenerateRadius(testRNG(7), 4, 2, BoardRandom)
	f, _ := GenerateRadius(testRNG(7), 4, 2, BoardFair)
	if boardsEqual(r, f) {
		t.Log("random and fair produced the same board for this seed (possible but rare)")
	}
}

func TestFairBoardScales(t *testing.T) {
	// Fair generation must terminate and stay valid at every size and be no less
	// balanced than random. Large boards have too many 6/8 tiles to guarantee none
	// touch, so compare against random rather than demanding zero.
	for _, players := range []int{4, 6, 10} {
		radius := RadiusFor(players)
		f, err := GenerateRadius(testRNG(3), players, radius, BoardFair)
		if err != nil {
			t.Fatalf("players=%d: %v", players, err)
		}
		r, _ := GenerateRadius(testRNG(3), players, radius, BoardRandom)
		if len(f.Tiles) != len(HexesInRadius(radius)) || f.Tiles[f.Robber].Res != ResNone {
			t.Errorf("players=%d: malformed fair board", players)
		}
		fairUnfair := f.pipImbalance() + float64(sameNumberAdjacent(f)) + float64(adjacentReds(f))
		randUnfair := r.pipImbalance() + float64(sameNumberAdjacent(r)) + float64(adjacentReds(r))
		if fairUnfair > randUnfair {
			t.Errorf("players=%d: fair board (%.2f) less balanced than random (%.2f)", players, fairUnfair, randUnfair)
		}
	}
}

func boardsEqual(a, b *Board) bool {
	if a.Radius != b.Radius || a.Robber != b.Robber || len(a.Tiles) != len(b.Tiles) {
		return false
	}
	for h, t := range a.Tiles {
		if b.Tiles[h] != t {
			return false
		}
	}
	return true
}
