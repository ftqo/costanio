package board

import (
	"sort"
	"strconv"
	"strings"
	"testing"
)

// parseHexList parses a space-separated "q,r" list into hexes.
func parseHexList(t *testing.T, s string) []Hex {
	t.Helper()
	var out []Hex
	for tok := range strings.FieldsSeq(s) {
		parts := strings.Split(tok, ",")
		if len(parts) != 2 {
			t.Fatalf("bad hex token %q", tok)
		}
		q, err := strconv.Atoi(parts[0])
		if err != nil {
			t.Fatalf("bad q in %q: %v", tok, err)
		}
		r, err := strconv.Atoi(parts[1])
		if err != nil {
			t.Fatalf("bad r in %q: %v", tok, err)
		}
		out = append(out, Hex{Q: q, R: r})
	}
	return out
}

// landBoard builds a board whose given hexes are ResLand, with a generous radius.
func landBoard(radius int, land []Hex) *Board {
	tiles := make(map[Hex]Tile, len(land))
	for _, h := range land {
		tiles[h] = Tile{Res: ResLand}
	}
	robber := Hex{}
	if len(land) > 0 {
		robber = land[0]
	}
	return &Board{Radius: radius, Tiles: tiles, Robber: robber}
}

func cubeDist(h Hex) int { return max(abs(h.Q), abs(h.R), abs(h.Q+h.R)) }

// seaHexes returns the set of Sea tiles in the board.
func seaHexes(b *Board) map[Hex]bool {
	out := map[Hex]bool{}
	for h, t := range b.Tiles {
		if t.Res == Sea {
			out[h] = true
		}
	}
	return out
}

func TestFrameSingleHex(t *testing.T) {
	b := landBoard(5, []Hex{{0, 0}})
	b.Frame()

	// The origin should remain ground.
	if tl, ok := b.Tiles[Hex{0, 0}]; !ok || tl.Res == Sea {
		t.Fatalf("origin should remain ground, got %+v ok=%v", tl, ok)
	}
	// Its 6 neighbors should all be Sea, and nothing else.
	want := map[Hex]bool{}
	for _, n := range (Hex{0, 0}).Neighbors() {
		want[n] = true
	}
	got := seaHexes(b)
	if len(got) != len(want) {
		t.Fatalf("expected %d sea hexes, got %d: %v", len(want), len(got), got)
	}
	for h := range want {
		if !got[h] {
			t.Errorf("expected sea at %v", h)
		}
	}
	// Tiles should be exactly 1 land + 6 sea = 7.
	if len(b.Tiles) != 7 {
		t.Errorf("expected 7 tiles, got %d", len(b.Tiles))
	}
}

func TestFrameHorizontalStrip(t *testing.T) {
	var land []Hex
	for q := -4; q <= 4; q++ {
		land = append(land, Hex{Q: q, R: 0})
	}
	b := landBoard(10, land)
	b.Frame()

	// Compute bounding extents in q and r over all kept tiles.
	minQ, maxQ, minR, maxR := 1<<30, -(1 << 30), 1<<30, -(1 << 30)
	for h := range b.Tiles {
		if h.Q < minQ {
			minQ = h.Q
		}
		if h.Q > maxQ {
			maxQ = h.Q
		}
		if h.R < minR {
			minR = h.R
		}
		if h.R > maxR {
			maxR = h.R
		}
	}
	widthQ := maxQ - minQ
	heightR := maxR - minR
	// The strip is wide and thin, so the kept shape must be wider than tall.
	if widthQ <= heightR {
		t.Fatalf("expected wider-than-tall shape, q-extent=%d r-extent=%d", widthQ, heightR)
	}

	// Sea above and below the land must be exactly one hex thick: every land hex
	// is at r=0, so r=±1 above/below land columns is sea and r=±2 is absent.
	for q := -4; q <= 4; q++ {
		if t2, ok := b.Tiles[Hex{Q: q, R: -2}]; ok {
			t.Errorf("hex (%d,-2) should be absent, got %+v", q, t2)
		}
		if t2, ok := b.Tiles[Hex{Q: q, R: 2}]; ok {
			t.Errorf("hex (%d,2) should be absent, got %+v", q, t2)
		}
	}
}

func TestFrameBridgeTwoLandmasses(t *testing.T) {
	// Two single-hex landmasses 3 hexes apart (within D).
	left := Hex{Q: -2, R: 0}
	right := Hex{Q: 2, R: 0}
	b := landBoard(10, []Hex{left, right})
	b.Frame()

	// No interior absent hex: flood-fill the exterior from radius+1 over
	// non-present hexes; any non-present hex inside that is not reached is
	// interior.
	assertNoInteriorAbsent(t, b)

	// Specifically, the hexes directly between the two landmasses must all be Sea.
	for _, h := range []Hex{{-1, 0}, {0, 0}, {1, 0}} {
		tl, ok := b.Tiles[h]
		if !ok {
			t.Errorf("channel hex %v should be present (sea), is absent", h)
			continue
		}
		if tl.Res != Sea && tl.Res != ResLand {
			t.Errorf("channel hex %v should be sea/land, got %+v", h, tl)
		}
	}
}

func TestFrameEnclosedLake(t *testing.T) {
	// A ring of land around the origin; the origin starts absent.
	ring := (Hex{0, 0}).Neighbors()
	b := landBoard(5, ring[:])
	b.Frame()

	// The enclosed origin hex must become Sea.
	tl, ok := b.Tiles[Hex{0, 0}]
	if !ok {
		t.Fatalf("enclosed origin hex should be present")
	}
	if tl.Res != Sea {
		t.Errorf("enclosed origin should be Sea, got %+v", tl)
	}
}

func TestFrameFullHexagonUnchanged(t *testing.T) {
	// Full hexagon of ResLand at radius 2.
	hexes := HexesInRadius(2)
	tiles := make(map[Hex]Tile, len(hexes))
	for _, h := range hexes {
		tiles[h] = Tile{Res: ResLand}
	}
	b := &Board{Radius: 2, Tiles: tiles, Robber: Hex{0, 0}}
	before := b.Clone()
	b.Frame()

	if b.Radius != before.Radius {
		t.Errorf("radius changed: %d -> %d", before.Radius, b.Radius)
	}
	if len(b.Tiles) != len(before.Tiles) {
		t.Fatalf("tile count changed: %d -> %d", len(before.Tiles), len(b.Tiles))
	}
	for h, tl := range before.Tiles {
		if got, ok := b.Tiles[h]; !ok || got != tl {
			t.Errorf("tile %v changed: %+v -> %+v (ok=%v)", h, tl, got, ok)
		}
	}
}

func TestFrameIdempotent(t *testing.T) {
	var land []Hex
	for q := -3; q <= 3; q++ {
		land = append(land, Hex{Q: q, R: 0})
	}
	land = append(land, Hex{Q: 0, R: -2}, Hex{Q: 1, R: -3}) // an arm sticking up
	b := landBoard(10, land)
	b.Frame()
	first := b.Clone()
	b.Frame()

	if b.Radius != first.Radius {
		t.Errorf("radius changed on second Frame: %d -> %d", first.Radius, b.Radius)
	}
	if len(b.Tiles) != len(first.Tiles) {
		t.Fatalf("tile count changed on second Frame: %d -> %d", len(first.Tiles), len(b.Tiles))
	}
	for h, tl := range first.Tiles {
		if got, ok := b.Tiles[h]; !ok || got != tl {
			t.Errorf("tile %v changed on second Frame: %+v -> %+v (ok=%v)", h, tl, got, ok)
		}
	}
}

func TestFrameRobberRelocated(t *testing.T) {
	// Robber on a hex that won't survive framing (a far-off sea-only spot).
	land := []Hex{{0, 0}, {1, 0}, {0, 1}}
	tiles := make(map[Hex]Tile, len(land))
	for _, h := range land {
		tiles[h] = Tile{Res: ResLand}
	}
	b := &Board{Radius: 10, Tiles: tiles, Robber: Hex{Q: 9, R: 0}}
	b.Frame()

	tl, ok := b.Tiles[b.Robber]
	if !ok {
		t.Fatalf("robber not on a tile after frame: %v", b.Robber)
	}
	if tl.Res == Sea {
		t.Errorf("robber on a sea tile: %v %+v", b.Robber, tl)
	}
}

const ukLand = `5,-9 4,-8 3,-7 2,-6 2,-5 2,-4 1,-3 2,-3 2,-2 1,-1 2,-1 2,0 2,1 2,2 1,3 0,4 -1,5 -2,6 -2,7 -3,8 -2,8 -1,8 0,7 1,6 2,5 3,4 4,3 4,2 5,1 5,0 4,0 4,-1 4,-2 5,-3 4,-3 4,-4 5,-5 6,-6 7,-7 6,-7 5,-7 4,-6 5,-6 4,-5 4,1 5,3 5,4 4,5 3,6 2,7 3,7 3,3 4,4 2,4 3,5 1,5 2,6 0,6 1,7 0,8 -1,7 -1,6 -2,5 0,5 1,4 0,3 2,3 3,2 3,1 3,0 3,-1 3,-2 3,-3 3,-4 3,-5 3,-6 2,-7 2,-8 1,-7 4,-7 5,-8 6,-9 -1,-2 -2,-1 -3,0 -4,1 -5,2 -6,3 -6,4 -7,5 -8,6 -7,6 -6,5 -5,4 -4,3 -3,2 -2,1 -1,0 -3,3 -4,4 -5,3 -6,2 -4,2 -5,1 -3,1 -2,0 -3,-1 -1,-1`

func TestFrameUKNoInteriorGaps(t *testing.T) {
	land := parseHexList(t, ukLand)
	tiles := make(map[Hex]Tile, len(land))
	for _, h := range land {
		tiles[h] = Tile{Res: ResLand}
	}
	b := &Board{Radius: 11, Tiles: tiles, Robber: land[0]}
	b.Frame()
	assertNoInteriorAbsent(t, b)
	// The framed region (ground + sea) must be one 6-connected component: Ireland
	// and Britain are bridged with the Irish Sea filled as Sea, not split by an
	// absent channel.
	assertSingleComponent(t, b)
}

// assertSingleComponent checks every present tile is reachable from any other
// via 6-neighbor steps through present tiles.
func assertSingleComponent(t *testing.T, b *Board) {
	t.Helper()
	present := func(h Hex) bool { _, ok := b.Tiles[h]; return ok }
	var start Hex
	found := false
	for h := range b.Tiles {
		start = h
		found = true
		break
	}
	if !found {
		return
	}
	seen := map[Hex]bool{start: true}
	queue := []Hex{start}
	for len(queue) > 0 {
		cur := queue[len(queue)-1]
		queue = queue[:len(queue)-1]
		for _, n := range cur.Neighbors() {
			if present(n) && !seen[n] {
				seen[n] = true
				queue = append(queue, n)
			}
		}
	}
	if len(seen) != len(b.Tiles) {
		t.Errorf("framed board is not a single connected component: reached %d of %d tiles", len(seen), len(b.Tiles))
	}
}

// assertNoInteriorAbsent flood-fills the exterior from the ring at radius+1 over
// non-present hexes; any non-present hex inside that ring not reached is an
// interior gap (a hole) and is a failure.
func assertNoInteriorAbsent(t *testing.T, b *Board) {
	t.Helper()
	present := func(h Hex) bool { _, ok := b.Tiles[h]; return ok }
	// extent of present hexes
	R := 0
	for h := range b.Tiles {
		if d := cubeDist(h); d > R {
			R = d
		}
	}
	limit := R + 1
	exterior := map[Hex]bool{}
	var queue []Hex
	for _, h := range HexesInRadius(limit) {
		if cubeDist(h) == limit && !present(h) {
			exterior[h] = true
			queue = append(queue, h)
		}
	}
	for len(queue) > 0 {
		cur := queue[len(queue)-1]
		queue = queue[:len(queue)-1]
		for _, n := range cur.Neighbors() {
			if cubeDist(n) > limit || present(n) || exterior[n] {
				continue
			}
			exterior[n] = true
			queue = append(queue, n)
		}
	}
	// Any non-present hex within radius R that is not exterior is an interior gap.
	var gaps []Hex
	for _, h := range HexesInRadius(R) {
		if !present(h) && !exterior[h] {
			gaps = append(gaps, h)
		}
	}
	if len(gaps) > 0 {
		sort.Slice(gaps, func(i, j int) bool {
			if gaps[i].Q != gaps[j].Q {
				return gaps[i].Q < gaps[j].Q
			}
			return gaps[i].R < gaps[j].R
		})
		t.Errorf("found %d interior absent gaps: %v", len(gaps), gaps)
	}
}
