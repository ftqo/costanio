package board

import (
	"encoding/json"
	"math/rand/v2"
	"reflect"
	"sort"
	"strings"
	"testing"
)

func testRNG(seed uint64) *rand.Rand {
	return rand.New(rand.NewPCG(seed, seed^0x9e3779b97f4a7c15))
}

func TestGenerateCounts(t *testing.T) {
	b, err := GenerateRadius(testRNG(1), 4, RadiusFor(4), BoardRandom)
	if err != nil {
		t.Fatal(err)
	}
	if len(b.Tiles) != 19 {
		t.Fatalf("tiles = %d, want 19", len(b.Tiles))
	}

	resCount := map[Resource]int{}
	numCount := map[int]int{}
	for _, tile := range b.Tiles {
		resCount[tile.Res]++
		if tile.Res == ResNone {
			if tile.Number != 0 {
				t.Errorf("desert has number %d", tile.Number)
			}
		} else {
			numCount[tile.Number]++
		}
	}
	want := map[Resource]int{Wood: 4, Sheep: 4, Wheat: 4, Brick: 3, Ore: 3, ResNone: 1}
	if !reflect.DeepEqual(resCount, want) {
		t.Errorf("resources = %v, want %v", resCount, want)
	}
	wantNums := map[int]int{2: 1, 3: 2, 4: 2, 5: 2, 6: 2, 8: 2, 9: 2, 10: 2, 11: 2, 12: 1}
	if !reflect.DeepEqual(numCount, wantNums) {
		t.Errorf("numbers = %v, want %v", numCount, wantNums)
	}
}

func TestRobberStartsOnDesert(t *testing.T) {
	b, _ := GenerateRadius(testRNG(7), 3, RadiusFor(3), BoardRandom)
	if b.Tiles[b.Robber].Res != ResNone {
		t.Errorf("robber on %v = %+v, want desert", b.Robber, b.Tiles[b.Robber])
	}
}

func TestGenerateDeterministic(t *testing.T) {
	a, _ := GenerateRadius(testRNG(42), 4, RadiusFor(4), BoardRandom)
	b, _ := GenerateRadius(testRNG(42), 4, RadiusFor(4), BoardRandom)
	if !reflect.DeepEqual(a, b) {
		t.Error("same seed produced different boards")
	}
	c, _ := GenerateRadius(testRNG(43), 4, RadiusFor(4), BoardRandom)
	if reflect.DeepEqual(a, c) {
		t.Error("different seeds produced identical boards (suspicious)")
	}
}

func adjacentReds(b *Board) int {
	red := func(n int) bool { return n == 6 || n == 8 }
	return b.adjacentPairs(func(a, c int) bool { return red(a) && red(c) })
}

func TestNoAdjacentRedNumbers(t *testing.T) {
	for seed := range uint64(50) {
		b, _ := GenerateRadius(testRNG(seed), 4, RadiusFor(4), BoardRandom)
		if adjacentReds(b) != 0 {
			t.Fatalf("seed %d: adjacent 6/8", seed)
		}
	}
}

// TestNoAdjacentRedNumbersLargeBoards: random mode guarantees no two 6/8 hexes
// touch, so this must hold for every seed at every supported radius.
func TestNoAdjacentRedNumbersLargeBoards(t *testing.T) {
	for _, radius := range []int{3, 4} {
		for seed := range uint64(200) {
			b, err := GenerateRadius(testRNG(seed), 6, radius, BoardRandom)
			if err != nil {
				t.Fatalf("radius %d seed %d: %v", radius, seed, err)
			}
			if n := adjacentReds(b); n != 0 {
				t.Fatalf("radius %d seed %d: %d adjacent 6/8 pairs", radius, seed, n)
			}
		}
	}
}

func TestHarbors(t *testing.T) {
	b, _ := GenerateRadius(testRNG(3), 4, RadiusFor(4), BoardRandom)
	if len(b.Harbors) != 9 {
		t.Fatalf("harbors = %d, want 9", len(b.Harbors))
	}
	generic, specific := 0, map[Resource]int{}
	seen := map[Vertex]bool{}
	for _, h := range b.Harbors {
		switch h.Ratio {
		case 3:
			generic++
		case 2:
			specific[h.Res]++
		default:
			t.Errorf("bad ratio %d", h.Ratio)
		}
		for _, v := range h.Verts {
			if seen[v] {
				t.Errorf("vertex %v in two harbors", v)
			}
			seen[v] = true
			if !b.LandVertex(v) {
				t.Errorf("harbor vertex %v not reachable from land", v)
			}
		}
	}
	if generic != 4 || len(specific) != 5 {
		t.Errorf("harbor mix: %d generic, %v specific", generic, specific)
	}
}

// TestPlaceHarborsSmallN: when fewer than 5 harbors are requested, placement
// must honour n rather than always laying out 5 specific (2:1) harbors.
func TestPlaceHarborsSmallN(t *testing.T) {
	b, _ := GenerateRadius(testRNG(1), 4, RadiusFor(4), BoardRandom)
	for n := range 8 {
		got := placeHarbors(testRNG(1), b, n)
		if len(got) != n {
			t.Errorf("placeHarbors n=%d placed %d harbors", n, len(got))
		}
		// No two harbors may share a vertex.
		seen := map[Vertex]bool{}
		for _, h := range got {
			for _, v := range h.Verts {
				if seen[v] {
					t.Errorf("n=%d: vertex %v reused across harbors", n, v)
				}
				seen[v] = true
			}
		}
	}
}

// TestHarborMixCoverage: every resource gets a 2:1 port once the board holds
// five harbors. The base generic/specific ratio only yields five specific
// ports at n>=9, so smaller boards (a standard-shaped custom map gets 5) need
// the cap. Below five harbors full coverage is impossible, so every harbor
// must at least be a distinct resource.
func TestHarborMixCoverage(t *testing.T) {
	for n := 1; n <= 16; n++ {
		for seed := uint64(1); seed <= 25; seed++ {
			kinds := harborMix(testRNG(seed), n)
			if len(kinds) != n {
				t.Fatalf("n=%d: harborMix returned %d kinds", n, len(kinds))
			}
			specific := map[Resource]int{}
			generic := 0
			for _, k := range kinds {
				switch k.Ratio {
				case 2:
					specific[k.Res]++
				case 3:
					generic++
				default:
					t.Fatalf("n=%d: bad ratio %d", n, k.Ratio)
				}
			}
			wantCovered := min(n, len(Resources))
			if len(specific) != wantCovered {
				t.Errorf("n=%d seed=%d: specific ports cover %d resources, want %d (%v)",
					n, seed, len(specific), wantCovered, specific)
			}
			// Specific ports stay spread evenly across resources.
			lo, hi := n, 0
			for _, c := range specific {
				lo, hi = min(lo, c), max(hi, c)
			}
			if len(specific) > 0 && hi-lo > 1 {
				t.Errorf("n=%d seed=%d: specific ports uneven (%v)", n, seed, specific)
			}
			// Generic count follows round(n*4/9), except where that would leave fewer
			// than five specific ports (n<9): then generic is capped at n-5.
			wantGeneric := min((8*n+9)/18, n-min(n, len(Resources)))
			if generic != wantGeneric {
				t.Errorf("n=%d: %d generic ports, want %d", n, generic, wantGeneric)
			}
		}
	}
}

// TestEnsureHarborsCoverage: a custom or curated board with no harbors must
// get a full base-style port set (every resource plus some generic 3:1),
// matching a procedural board of the same size.
func TestEnsureHarborsCoverage(t *testing.T) {
	b, _ := GenerateRadius(testRNG(1), 4, 2, BoardFair)
	b.Harbors = nil // simulate a custom map that specified no harbors
	b.EnsureHarbors(testRNG(1))
	if len(b.Harbors) != harborCount(2) {
		t.Errorf("EnsureHarbors placed %d harbors on a standard board, want %d",
			len(b.Harbors), harborCount(2))
	}
	specific := map[Resource]int{}
	generic := 0
	for _, h := range b.Harbors {
		if h.Ratio == 2 {
			specific[h.Res]++
		} else {
			generic++
		}
	}
	if len(specific) != len(Resources) {
		t.Errorf("EnsureHarbors covers %d resources, want all %d (%v)",
			len(specific), len(Resources), specific)
	}
	if generic == 0 {
		t.Error("EnsureHarbors produced no generic 3:1 ports")
	}
}

func TestGenerateRejectsBadPlayerCount(t *testing.T) {
	for _, n := range []int{0, 1, 11} {
		if _, err := GenerateRadius(testRNG(1), n, RadiusFor(n), BoardRandom); err == nil {
			t.Errorf("players=%d should error", n)
		}
	}
	// 2 is inside the range: 1v1 gets the standard radius-2 board.
	if _, err := GenerateRadius(testRNG(1), 2, RadiusFor(2), BoardRandom); err != nil {
		t.Errorf("players=2 should generate: %v", err)
	}
}

func TestGenerateScaling(t *testing.T) {
	for _, tc := range []struct {
		players, radius, tiles, harbors int
	}{
		{4, 2, 19, 9}, {5, 3, 37, 12}, {6, 3, 37, 12}, {7, 4, 61, 15}, {10, 4, 61, 15},
	} {
		b, err := GenerateRadius(testRNG(uint64(tc.players)), tc.players, RadiusFor(tc.players), BoardRandom)
		if err != nil {
			t.Fatalf("players=%d: %v", tc.players, err)
		}
		if b.Radius != tc.radius || len(b.Tiles) != tc.tiles || len(b.Harbors) != tc.harbors {
			t.Errorf("players=%d: radius=%d tiles=%d harbors=%d, want %d/%d/%d",
				tc.players, b.Radius, len(b.Tiles), len(b.Harbors), tc.radius, tc.tiles, tc.harbors)
		}
		// Desert count by size, robber on a desert, numbers only on land.
		deserts := 0
		for _, tile := range b.Tiles {
			if tile.Res == ResNone {
				deserts++
				if tile.Number != 0 {
					t.Error("desert with a number")
				}
			}
		}
		if want := 1 + (tc.tiles-1)/30; deserts != want {
			t.Errorf("players=%d: deserts=%d, want %d", tc.players, deserts, want)
		}
		if b.Tiles[b.Robber].Res != ResNone {
			t.Errorf("players=%d: robber not on desert", tc.players)
		}
		// Harbor mix keeps the base-game proportion (round(n*4/9) generic), with
		// the specific 2:1 ports spread evenly across all five resources.
		specific := map[Resource]int{}
		generic := 0
		for _, h := range b.Harbors {
			if h.Ratio == 2 {
				specific[h.Res]++
			} else {
				generic++
			}
		}
		wantGeneric := (8*tc.harbors + 9) / 18
		if generic != wantGeneric {
			t.Errorf("players=%d: %d generic harbors, want %d", tc.players, generic, wantGeneric)
		}
		if len(specific) != 5 {
			t.Errorf("players=%d: specific harbors cover %d resources, want all 5", tc.players, len(specific))
		}
		lo, hi := tc.harbors, 0
		for _, c := range specific {
			if c < lo {
				lo = c
			}
			if c > hi {
				hi = c
			}
		}
		if hi-lo > 1 {
			t.Errorf("players=%d: specific harbors uneven across resources (%v)", tc.players, specific)
		}
	}
}

// TestHarborSpacing: on every coast loop, consecutive harbors are at least two
// edges apart (so none share a vertex) and the gaps are uniform to within one
// edge.
func TestHarborSpacing(t *testing.T) {
	for _, players := range []int{4, 6, 10} {
		b, err := GenerateRadius(testRNG(uint64(players)), players, RadiusFor(players), BoardRandom)
		if err != nil {
			t.Fatal(err)
		}
		loops := coastLoops(b.coastEdges())
		type pos struct{ loop, idx int }
		at := map[Edge]pos{}
		for li, loop := range loops {
			for i, e := range loop {
				at[e] = pos{li, i}
			}
		}
		byLoop := map[int][]int{}
		for _, h := range b.Harbors {
			e := NewEdge(h.Verts[0], h.Verts[1])
			p, ok := at[e]
			if !ok {
				t.Fatalf("players=%d: harbor edge %v not on the coastline", players, e)
			}
			byLoop[p.loop] = append(byLoop[p.loop], p.idx)
		}
		for li, idxs := range byLoop {
			L := len(loops[li])
			sort.Ints(idxs)
			minGap, maxGap := L, 0
			for i := range idxs {
				g := idxs[(i+1)%len(idxs)] - idxs[i]
				if i == len(idxs)-1 {
					g += L // wrap around the ring
				}
				if g < minGap {
					minGap = g
				}
				if g > maxGap {
					maxGap = g
				}
			}
			if minGap < 2 {
				t.Errorf("players=%d loop %d: harbors only %d edge(s) apart (share a vertex)", players, li, minGap)
			}
			if maxGap-minGap > 1 {
				t.Errorf("players=%d loop %d: uneven harbor spacing, gaps %d..%d", players, li, minGap, maxGap)
			}
		}
	}
}

// TestHarborMixScaling checks the harbor blend keeps the base-game proportion
// as boards grow, handing the extra 2:1 ports out evenly across resources.
func TestHarborMixScaling(t *testing.T) {
	for _, tc := range []struct{ n, generic int }{
		{9, 4}, {12, 5}, {15, 7}, {16, 7},
	} {
		kinds := harborMix(testRNG(uint64(tc.n)), tc.n)
		if len(kinds) != tc.n {
			t.Fatalf("n=%d: got %d kinds", tc.n, len(kinds))
		}
		specific := map[Resource]int{}
		generic := 0
		for _, h := range kinds {
			switch h.Ratio {
			case 2:
				specific[h.Res]++
			case 3:
				generic++
			default:
				t.Errorf("n=%d: bad ratio %d", tc.n, h.Ratio)
			}
		}
		if generic != tc.generic {
			t.Errorf("n=%d: %d generic, want %d", tc.n, generic, tc.generic)
		}
		if len(specific) != 5 {
			t.Errorf("n=%d: specific covers %d resources, want all 5", tc.n, len(specific))
		}
		lo, hi := tc.n, 0
		for _, c := range specific {
			if c < lo {
				lo = c
			}
			if c > hi {
				hi = c
			}
		}
		if hi-lo > 1 {
			t.Errorf("n=%d: uneven specific spread %v", tc.n, specific)
		}
	}
}

func TestResourceJSONStrings(t *testing.T) {
	raw, err := json.Marshal(Tile{Res: Gold, Number: 5})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), `"gold"`) {
		t.Errorf("tile json = %s, want terrain string", raw)
	}
	var tile Tile
	if err := json.Unmarshal(raw, &tile); err != nil || tile.Res != Gold {
		t.Errorf("round-trip = %+v, %v", tile, err)
	}
	// Legacy numeric form still parses.
	var r Resource
	if err := json.Unmarshal([]byte("5"), &r); err != nil || r != Ore {
		t.Errorf("legacy int = %v, %v", r, err)
	}
	if err := json.Unmarshal([]byte(`"volcano"`), &r); err == nil {
		t.Error("unknown terrain string should error")
	}
}

// TestResourceJSONRoundTrip: UnmarshalJSON must reject out-of-range numeric
// values MarshalJSON would refuse, or the store could load an event it cannot
// re-emit.
func TestResourceJSONRoundTrip(t *testing.T) {
	// Every known resource must survive a marshal -> unmarshal round-trip and a
	// legacy numeric unmarshal -> marshal round-trip.
	for r := range resourceNames {
		raw, err := json.Marshal(r)
		if err != nil {
			t.Fatalf("marshal %v: %v", r, err)
		}
		var back Resource
		if err := json.Unmarshal(raw, &back); err != nil || back != r {
			t.Errorf("string round-trip %v: got %v, %v", r, back, err)
		}
		// Legacy numeric form must parse to the same value and re-marshal.
		var num Resource
		if err := json.Unmarshal([]byte(itoa(int(r))), &num); err != nil || num != r {
			t.Errorf("numeric round-trip %v: got %v, %v", r, num, err)
		}
		if _, err := json.Marshal(num); err != nil {
			t.Errorf("re-marshal of unmarshaled %v failed: %v", r, err)
		}
	}
	// Out-of-range numeric values must be rejected on the way in, matching
	// MarshalJSON which rejects them on the way out.
	for _, n := range []int{-1, 99, 127, -128} {
		var r Resource
		if err := json.Unmarshal([]byte(itoa(n)), &r); err == nil {
			t.Errorf("numeric %d should be rejected by UnmarshalJSON", n)
		}
	}
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf []byte
	for n > 0 {
		buf = append([]byte{byte('0' + n%10)}, buf...)
		n /= 10
	}
	if neg {
		buf = append([]byte{'-'}, buf...)
	}
	return string(buf)
}

func TestPresetBoard(t *testing.T) {
	b, err := PresetBoard("beginner", 4, testRNG(1))
	if err != nil {
		t.Fatal(err)
	}
	if len(b.Tiles) != 19 || b.Tiles[Hex{0, 0}].Res != ResNone {
		t.Errorf("beginner board wrong: %d tiles, center %+v", len(b.Tiles), b.Tiles[Hex{0, 0}])
	}
	if err := ValidatePreset("beginner", 5); err == nil {
		t.Error("beginner should reject 5 players")
	}
	if err := ValidatePreset("nope", 4); err == nil {
		t.Error("unknown preset should error")
	}
	if names := PresetNames(); len(names) == 0 || names[0] != "beginner" {
		t.Errorf("presets = %v", names)
	}
}
