package board

import "testing"

// fullLand builds a complete radius-R hexagon of generic land (ResLand) so a
// shape board passes layout validation.
func fullLand(radius int) *Board {
	tiles := map[Hex]Tile{}
	for _, h := range HexesInRadius(radius) {
		tiles[h] = Tile{Res: ResLand}
	}
	var robber Hex // (0,0) is always in range
	return &Board{Radius: radius, Tiles: tiles, Robber: robber}
}

func TestValidateLayoutRadiusBounds(t *testing.T) {
	// Full hexagons up to radius 9 (271 tiles) are within both caps.
	for r := 1; r <= 9; r++ {
		if err := fullLand(r).ValidateLayout(); err != nil {
			t.Errorf("radius %d should be valid, got %v", r, err)
		}
	}
	// A sparse board beyond the radius-16 sanity bound is rejected on radius alone.
	far := &Board{Radius: 17, Tiles: map[Hex]Tile{}, Robber: Hex{0, 0}}
	for _, h := range []Hex{{0, 0}, {1, 0}, {0, 1}} {
		far.Tiles[h] = Tile{Res: ResLand}
	}
	if err := far.ValidateLayout(); err == nil {
		t.Error("radius 17 should be rejected (over the 16 cap)")
	}
}

func TestValidateLayoutSparse(t *testing.T) {
	// A sparse board: a small cluster of land plus a couple sea tiles, not a
	// full hexagon. Should be valid.
	b := &Board{Radius: 5, Tiles: map[Hex]Tile{}, Robber: Hex{Q: 0, R: 0}}
	b.Tiles[Hex{0, 0}] = Tile{Res: ResLand}
	b.Tiles[Hex{1, 0}] = Tile{Res: ResLand}
	b.Tiles[Hex{0, 1}] = Tile{Res: ResLand}
	b.Tiles[Hex{2, 0}] = Tile{Res: Sea}
	if err := b.ValidateLayout(); err != nil {
		t.Fatalf("sparse board should be valid, got %v", err)
	}
}

func TestValidateLayoutRejectsTileOutsideRadius(t *testing.T) {
	b := &Board{Radius: 2, Tiles: map[Hex]Tile{}, Robber: Hex{Q: 0, R: 0}}
	b.Tiles[Hex{0, 0}] = Tile{Res: ResLand}
	b.Tiles[Hex{1, 0}] = Tile{Res: ResLand}
	b.Tiles[Hex{0, 1}] = Tile{Res: ResLand}
	b.Tiles[Hex{5, 0}] = Tile{Res: ResLand} // outside radius 2
	if err := b.ValidateLayout(); err == nil {
		t.Error("tile outside radius should be rejected")
	}
}

func TestValidateLayoutRejectsTooFewLand(t *testing.T) {
	b := &Board{Radius: 2, Tiles: map[Hex]Tile{}, Robber: Hex{Q: 0, R: 0}}
	b.Tiles[Hex{0, 0}] = Tile{Res: ResLand}
	b.Tiles[Hex{1, 0}] = Tile{Res: Sea}
	if err := b.ValidateLayout(); err == nil {
		t.Error("fewer than 3 land tiles should be rejected")
	}
}

func TestValidateLayoutRejectsDesertFree(t *testing.T) {
	// Fully-pinned producing tiles, no desert and no generic land to carve one
	// from: Resolve can never give it a desert, so reject it up front.
	b := &Board{Radius: 2, Tiles: map[Hex]Tile{}, Robber: Hex{Q: 0, R: 0}}
	b.Tiles[Hex{0, 0}] = Tile{Res: Wood, Number: 5}
	b.Tiles[Hex{1, 0}] = Tile{Res: Brick, Number: 6}
	b.Tiles[Hex{0, 1}] = Tile{Res: Ore, Number: 8}
	if err := b.ValidateLayout(); err == nil {
		t.Error("desert-free fully-pinned board should be rejected")
	}

	// A generic-land tile is a fine desert source (Resolve carves one).
	b.Tiles[Hex{1, -1}] = Tile{Res: ResLand}
	if err := b.ValidateLayout(); err != nil {
		t.Errorf("board with generic land should be valid, got %v", err)
	}

	// A pinned desert is, of course, also fine.
	delete(b.Tiles, Hex{1, -1})
	b.Tiles[Hex{-1, 1}] = Tile{Res: ResNone}
	if err := b.ValidateLayout(); err != nil {
		t.Errorf("board with a pinned desert should be valid, got %v", err)
	}
}

func TestValidateLayoutTileCap(t *testing.T) {
	// A full radius-10 hexagon is 331 tiles (> 300) and must be rejected; radius 9
	// (271) is allowed (covered by TestValidateLayoutRadiusBounds).
	if err := fullLand(10).ValidateLayout(); err == nil {
		t.Error("a 331-tile board should exceed the 300-tile cap")
	}
}
