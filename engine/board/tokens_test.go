package board

import (
	"math/rand/v2"
	"strconv"
	"strings"
	"testing"
)

// tokenWeights restates the base 18-token ratio independently of `baseTokens`,
// so these tests catch a change in the bag's shape.
var tokenWeights = map[int]int{2: 1, 3: 2, 4: 2, 5: 2, 6: 2, 8: 2, 9: 2, 10: 2, 11: 2, 12: 1}

func tokenCounts(in []int) map[int]int {
	out := map[int]int{}
	for _, n := range in {
		out[n]++
	}
	return out
}

// A 27-token board (Shores (Small): 27 land + 1 gold, one carved to desert)
// must not get four 6s and two 8s, which indexing `baseTokens` modulo 18 gave
// (the 9 extra tokens came from the low end: 2,3,3,4,4,5,5,6,6).
func TestNumberTokensNoRedSurplusAt27(t *testing.T) {
	c := tokenCounts(numberTokens(nil, 27))
	if c[6] != 3 || c[8] != 3 {
		t.Errorf("numberTokens(nil, 27) has %d sixes and %d eights, want 3 and 3", c[6], c[8])
	}
	if c[3] != 3 || c[11] != 3 {
		t.Errorf("numberTokens(nil, 27) has %d threes and %d elevens, want 3 and 3", c[3], c[11])
	}
}

// The standard 19-hex board must deal the standard bag, in the standard order.
func TestNumberTokensIsBaseBagAt18(t *testing.T) {
	got := numberTokens(nil, 18)
	if len(got) != len(baseTokens) {
		t.Fatalf("numberTokens(nil, 18) = %v, want %v", got, baseTokens)
	}
	for i := range got {
		if got[i] != baseTokens[i] {
			t.Fatalf("numberTokens(nil, 18) = %v, want %v", got, baseTokens)
		}
	}
}

// Every board size holds the base game's ratio: each value lands on one of the
// two integers bracketing its exact share of n.
func TestNumberTokensHoldsBaseRatio(t *testing.T) {
	for n := 1; n <= 200; n++ {
		got := numberTokens(nil, n)
		if len(got) != n {
			t.Fatalf("numberTokens(%d) returned %d tokens", n, len(got))
		}
		c := tokenCounts(got)
		for v, w := range tokenWeights {
			lo, hi := n*w/18, (n*w+17)/18
			if c[v] < lo || c[v] > hi {
				t.Errorf("numberTokens(%d) has %d %ds, want %d or %d", n, c[v], v, lo, hi)
			}
		}
	}
}

// Values sharing a weight must stay within one token of each other, and no
// paired value may fall below a singleton.
func TestNumberTokensSpreadsEqualWeightsEvenly(t *testing.T) {
	paired := []int{3, 4, 5, 6, 8, 9, 10, 11}
	for n := 1; n <= 200; n++ {
		c := tokenCounts(numberTokens(nil, n))
		lo, hi := paired[0], paired[0]
		for _, v := range paired {
			if c[v] < c[lo] {
				lo = v
			}
			if c[v] > c[hi] {
				hi = v
			}
		}
		if c[hi]-c[lo] > 1 {
			t.Errorf("numberTokens(%d): %d %ds vs %d %ds, spread > 1", n, c[hi], hi, c[lo], lo)
		}
		if c[2]-c[lo] > 0 || c[12]-c[lo] > 0 {
			t.Errorf("numberTokens(%d): %d 2s / %d 12s outnumber %d %ds", n, c[2], c[12], c[lo], lo)
		}
	}
}

// parseHexes reads the "q,r q,r ..." land lists the map gallery authors its
// island presets with.
func parseHexes(t *testing.T, spec string) []Hex {
	t.Helper()
	var out []Hex
	for p := range strings.FieldsSeq(spec) {
		q, r, ok := strings.Cut(p, ",")
		if !ok {
			t.Fatalf("bad hex %q", p)
		}
		qi, err := strconv.Atoi(q)
		if err != nil {
			t.Fatalf("bad hex %q: %v", p, err)
		}
		ri, err := strconv.Atoi(r)
		if err != nil {
			t.Fatalf("bad hex %q: %v", p, err)
		}
		out = append(out, Hex{qi, ri})
	}
	return out
}

// End to end on Shores (Small) from the map gallery: 27 generic-land hexes plus
// one gold, resolved as a real game does. One hex becomes desert, so 27 tiles
// take a token, and they must follow the standard spread.
func TestResolveShoresSmallTokenSpread(t *testing.T) {
	const shoresLand = "0,-3 2,-3 3,-3 3,-2 -1,-1 0,-1 1,-1 3,-1 -2,0 -1,0 0,0 1,0 -3,1 -2,1 -1,1 0,1 1,1 3,1 -3,2 -2,2 -1,2 0,2 2,2 -3,3 -2,3 -1,3 1,3"
	const shoresGold = "4,-1"

	land := parseHexes(t, shoresLand)
	gold := parseHexes(t, shoresGold)
	if len(land)+len(gold) != 28 {
		t.Fatalf("preset has %d tiles, want 28", len(land)+len(gold))
	}

	for seed := range uint64(20) {
		b := &Board{Radius: 4, Robber: land[0], Tiles: map[Hex]Tile{}}
		for _, h := range land {
			b.Tiles[h] = Tile{Res: ResLand}
		}
		for _, h := range gold {
			b.Tiles[h] = Tile{Res: Gold}
		}

		b.Resolve(rand.New(rand.NewPCG(seed, 7)), BoardFair)

		c := map[int]int{}
		for _, tile := range b.Tiles {
			if tile.Number != 0 {
				c[tile.Number]++
			}
		}
		total := 0
		for _, n := range c {
			total += n
		}
		if total != 27 {
			t.Fatalf("seed %d: %d numbered tiles, want 27", seed, total)
		}
		if c[6] != c[8] {
			t.Errorf("seed %d: %d sixes vs %d eights", seed, c[6], c[8])
		}
		for v, w := range tokenWeights {
			lo, hi := 27*w/18, (27*w+17)/18
			if c[v] < lo || c[v] > hi {
				t.Errorf("seed %d: %d %ds, want %d or %d", seed, c[v], v, lo, hi)
			}
		}
	}
}
