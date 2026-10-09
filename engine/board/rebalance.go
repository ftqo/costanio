package board

// Rebalance re-runs the fair-mode number balance on a board whose terrain a
// module changed after generation, swapping number tokens between movable
// hexes until no single swap improves the fair penalty.
//
// Written for Rivers (derivation 11): the watercourse is derived from the
// finished board, and painting turns each estuary into a swamp (losing its
// resource and token) and each headwater into mountains, which pushed most
// base+rivers fair boards outside the 0.34 band.
//
// Deterministic and rng-free: a first-improvement descent over pairs in board
// order (HexesInRadius), accepting only strict improvements, repeated until a
// pass accepts nothing or maxRebalancePasses is reached. No random stream is
// used. verify/board.mjs ports it as rebalanceNumbers.
//
// Tokens move only between hexes `movable` accepts that are producing and
// carry a token, and a swap is taken only if the count of touching red (6/8)
// pairs does not rise. Reds may move. `movable` keeps an authored map's pinned
// tokens in place.
//
// Callers, all fair mode only: Rivers after painting (derivation 11), Caravans
// after an oasis promotion, and Islands after the carve (13).
func (b *Board) Rebalance(movable func(Hex) bool) {
	var present []Hex
	for _, h := range HexesInRadius(b.Radius) {
		if _, ok := b.Tiles[h]; ok {
			present = append(present, h)
		}
	}
	g := newGrid(present)
	res := make([]Resource, len(present))
	num := make([]int, len(present))
	var slots []int
	for i, h := range present {
		t := b.Tiles[h]
		res[i], num[i] = t.Res, t.Number
		if t.Res.Producing() && t.Number != 0 && movable(h) {
			slots = append(slots, i)
		}
	}
	pen := g.penalty(res, num, true)
	reds := g.redPairs(num)
	for pass := 0; pass < maxRebalancePasses && pen > 0; pass++ {
		improved := false
		for x := range slots {
			for y := x + 1; y < len(slots); y++ {
				i, j := slots[x], slots[y]
				if num[i] == num[j] {
					continue
				}
				num[i], num[j] = num[j], num[i]
				if p := g.penalty(res, num, true); p < pen && g.redPairs(num) <= reds {
					pen, improved = p, true
					continue
				}
				num[i], num[j] = num[j], num[i]
			}
		}
		if !improved {
			break
		}
	}
	for i, h := range present {
		t := b.Tiles[h]
		t.Number = num[i]
		b.Tiles[h] = t
	}
}

// maxRebalancePasses bounds Rebalance. Every accepted swap strictly lowers a
// penalty that is a sum of rounded non-negative terms, so the descent ends on
// its own; the bound only caps the work on a pathological authored map.
const maxRebalancePasses = 32

// redPairs counts touching pairs of red (6/8) tokens.
func (g *grid) redPairs(num []int) int {
	n := 0
	for i := range g.hexes {
		if !isRed(num[i]) {
			continue
		}
		for _, j := range g.nbr[i] {
			if j > i && isRed(num[j]) {
				n++
			}
		}
	}
	return n
}
