package board

import (
	"encoding/base64"
	"math/rand/v2"
	"testing"
)

func sameTiles(a, b *Board) bool {
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

func TestCodecRoundTrip(t *testing.T) {
	// A fully-resolved procedural board.
	gen, err := GenerateRadius(rand.New(rand.NewPCG(1, 2)), 4, 2, BoardRandom)
	if err != nil {
		t.Fatal(err)
	}
	// And a hand-built layout: generic land + a couple of sea/desert/pinned tiles
	// + blank numbers.
	layout := &Board{Radius: 2, Tiles: map[Hex]Tile{}, Robber: Hex{Q: 0, R: 0}}
	for i, h := range HexesInRadius(2) {
		switch i % 4 {
		case 0:
			layout.Tiles[h] = Tile{Res: ResLand} // generic land, blank number
		case 1:
			layout.Tiles[h] = Tile{Res: Wood, Number: 8} // pinned
		case 2:
			layout.Tiles[h] = Tile{Res: Sea}
		default:
			layout.Tiles[h] = Tile{Res: ResNone} // desert
		}
	}
	layout.Robber = HexesInRadius(2)[3]

	for name, b := range map[string]*Board{"resolved": gen, "layout": layout} {
		code := EncodeBoard(b)
		got, err := DecodeBoard(code)
		if err != nil {
			t.Fatalf("%s: decode(%q): %v", name, code, err)
		}
		if !sameTiles(b, got) {
			t.Errorf("%s: round-trip mismatch (code %q)", name, code)
		}
		if err := got.ValidateLayout(); err != nil {
			t.Errorf("%s: decoded board invalid: %v", name, err)
		}
	}
}

// A large custom map (radius beyond the four standard sizes) must round-trip
// through its own share code. The builder produces up to radius 10 and
// ValidateLayout allows 16, so the codec must accept them.
func TestCodecRoundTripLargeRadius(t *testing.T) {
	for _, radius := range []int{5, 6, 10, 16} {
		b := &Board{Radius: radius, Tiles: map[Hex]Tile{}, Robber: Hex{Q: 0, R: 0}}
		for i, h := range HexesInRadius(radius) {
			if i%3 == 0 {
				b.Tiles[h] = Tile{Res: Sea}
			} else {
				b.Tiles[h] = Tile{Res: ResLand}
			}
		}
		code := EncodeBoard(b)
		got, err := DecodeBoard(code)
		if err != nil {
			t.Errorf("radius %d: decode(%q): %v", radius, code, err)
			continue
		}
		if !sameTiles(b, got) {
			t.Errorf("radius %d: round-trip mismatch", radius)
		}
	}
	// Radius beyond ValidateLayout's ceiling is still rejected.
	tooBig := EncodeBoard(&Board{Radius: 17, Tiles: map[Hex]Tile{}, Robber: Hex{}})
	if _, err := DecodeBoard(tooBig); err == nil {
		t.Error("decode accepted radius 17 (above the 16 ceiling)")
	}
}

// TestCodecSparseAbsentRoundTrip ensures a framed (sparse, non-hexagon) board
// round-trips: absent hexes stay absent and deserts (ResNone) stay present.
func TestCodecSparseAbsentRoundTrip(t *testing.T) {
	// Build a framed board: a small landmass with a desert, framed to ocean.
	land := []Hex{{0, 0}, {1, 0}, {0, 1}, {-1, 0}}
	b := &Board{Radius: 10, Tiles: map[Hex]Tile{}, Robber: Hex{0, 0}}
	for _, h := range land {
		b.Tiles[h] = Tile{Res: ResLand}
	}
	b.Tiles[Hex{0, 0}] = Tile{Res: ResNone} // a desert in the land
	b.Frame()

	// The framed board must contain at least one desert and some absent hexes for
	// this test to mean anything.
	deserts := 0
	for _, tl := range b.Tiles {
		if tl.Res == ResNone {
			deserts++
		}
	}
	if deserts == 0 {
		t.Fatal("framed board lost its desert before encoding")
	}
	if len(b.Tiles) >= len(HexesInRadius(b.Radius)) {
		t.Fatal("framed board is dense, want absent tiles")
	}

	code := EncodeBoard(b)
	got, err := DecodeBoard(code)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !sameTiles(b, got) {
		t.Errorf("sparse round-trip mismatch (code %q)\n want %v\n got  %v", code, b.Tiles, got.Tiles)
	}
	// Explicitly: every absent hex stays absent.
	for _, h := range HexesInRadius(b.Radius) {
		_, wantPresent := b.Tiles[h]
		_, gotPresent := got.Tiles[h]
		if wantPresent != gotPresent {
			t.Errorf("hex %v presence mismatch: want %v got %v", h, wantPresent, gotPresent)
		}
	}
}

func TestDecodeRejectsGarbage(t *testing.T) {
	for _, code := range []string{"", "!!!!", "AAAA", "zzzzzzzzzzzz"} {
		if _, err := DecodeBoard(code); err == nil {
			t.Errorf("decode(%q) accepted garbage", code)
		}
	}
}

func TestResolveFillsAndIsDeterministic(t *testing.T) {
	build := func() *Board {
		b := &Board{Radius: 2, Tiles: map[Hex]Tile{}, Robber: HexesInRadius(2)[0]}
		for i, h := range HexesInRadius(2) {
			switch i {
			case 0:
				b.Tiles[h] = Tile{Res: ResNone} // one desert
			case 1:
				b.Tiles[h] = Tile{Res: Brick, Number: 5} // a pinned tile
			default:
				b.Tiles[h] = Tile{Res: ResLand} // generic land, blank number
			}
		}
		return b
	}

	a := build()
	a.Resolve(rand.New(rand.NewPCG(7, 1)), BoardFair)
	b := build()
	b.Resolve(rand.New(rand.NewPCG(7, 1)), BoardFair)
	if !sameTiles(a, b) {
		t.Fatal("Resolve is not deterministic for the same seed")
	}

	for h, tile := range a.Tiles {
		if tile.Res == ResLand {
			t.Errorf("tile %v still ResLand after Resolve", h)
		}
		if tile.Res.Producing() && (tile.Number < 2 || tile.Number > 12 || tile.Number == 7) {
			t.Errorf("tile %v producing but bad number %d", h, tile.Number)
		}
	}
	// The pinned tile keeps its resource + number.
	if a.Tiles[HexesInRadius(2)[1]] != (Tile{Res: Brick, Number: 5}) {
		t.Errorf("pinned tile changed: %+v", a.Tiles[HexesInRadius(2)[1]])
	}
}

func TestCodecV2HarborsRoundTrip(t *testing.T) {
	b := &Board{
		Radius: 2,
		Tiles:  map[Hex]Tile{},
		Robber: Hex{0, 0},
		Harbors: []Harbor{
			{Verts: [2]Vertex{{0, 0, N}, {1, -1, S}}, Ratio: 3, Res: ResNone},
			{Verts: [2]Vertex{{0, 1, N}, {0, 0, S}}, Ratio: 2, Res: Wheat},
		},
	}
	for _, h := range HexesInRadius(2) {
		b.Tiles[h] = Tile{Res: Wheat, Number: 5}
	}
	b.Tiles[Hex{0, 0}] = Tile{Res: ResNone} // a desert so ValidateLayout passes elsewhere
	code := EncodeBoard(b)
	// code[0:1] == "A" is a sanity check (base64 of 0x01... starts differently);
	// the real check is the round-trip below.
	got, err := DecodeBoard(code)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(got.Harbors) != 2 {
		t.Fatalf("harbors: got %d, want 2", len(got.Harbors))
	}
	if got.Harbors[0] != b.Harbors[0] || got.Harbors[1] != b.Harbors[1] {
		t.Fatalf("harbor mismatch:\n got %+v\nwant %+v", got.Harbors, b.Harbors)
	}
}

// TestCodecRoundTripManyHarbors: a board with more than 64 harbors survives an
// encode→decode round-trip. The harbors need not sit on real coastline; 70
// entries with varied fields make the assertion meaningful.
func TestCodecRoundTripManyHarbors(t *testing.T) {
	const n = 70
	b := &Board{
		Radius:  2,
		Tiles:   map[Hex]Tile{},
		Robber:  Hex{0, 0},
		Harbors: make([]Harbor, n),
	}
	for _, h := range HexesInRadius(2) {
		b.Tiles[h] = Tile{Res: ResLand, Number: 5}
	}
	resources := []Resource{Wood, Brick, Wheat, Ore, Sheep, ResNone}
	for i := range b.Harbors {
		b.Harbors[i] = Harbor{
			Verts: [2]Vertex{
				{Q: i % 5, R: i % 3, Side: Side(i % 2)},
				{Q: (i + 1) % 5, R: (i + 2) % 3, Side: Side((i + 1) % 2)},
			},
			Ratio: 2 + i%2,
			Res:   resources[i%len(resources)],
		}
	}

	code := EncodeBoard(b)
	got, err := DecodeBoard(code)
	if err != nil {
		t.Fatalf("decode failed for %d-harbor board: %v", n, err)
	}
	if len(got.Harbors) != n {
		t.Fatalf("harbor count: got %d, want %d", len(got.Harbors), n)
	}
	// Spot-check first, last, and a middle entry.
	for _, i := range []int{0, 35, n - 1} {
		if got.Harbors[i] != b.Harbors[i] {
			t.Errorf("harbor[%d]: got %+v, want %+v", i, got.Harbors[i], b.Harbors[i])
		}
	}
}

func TestCodecV1StillDecodes(t *testing.T) {
	// A board with no harbors must still encode to v1 and decode cleanly.
	b := &Board{Radius: 2, Tiles: map[Hex]Tile{}, Robber: Hex{0, 0}}
	for _, h := range HexesInRadius(2) {
		b.Tiles[h] = Tile{Res: ResLand}
	}
	code := EncodeBoard(b)
	raw, _ := base64.RawURLEncoding.DecodeString(code)
	if raw[0] != 1 {
		t.Fatalf("expected version 1 for harborless board, got %d", raw[0])
	}
	got, err := DecodeBoard(code)
	if err != nil {
		t.Fatalf("decode v1: %v", err)
	}
	if len(got.Harbors) != 0 {
		t.Fatalf("v1 board should have no harbors, got %d", len(got.Harbors))
	}
}
