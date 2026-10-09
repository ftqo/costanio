package board

import (
	"math/rand/v2"
	"testing"
)

// A shape-only board (all generic land, no pinned desert) should resolve into a
// classic distribution: exactly the standard desert allotment, robber parked on
// a desert, every other land tile producing with a token, and a valid layout.
func TestResolveShapeOnlyAddsDesert(t *testing.T) {
	b := &Board{Radius: 2, Tiles: map[Hex]Tile{}}
	hexes := HexesInRadius(2)
	for _, h := range hexes {
		b.Tiles[h] = Tile{Res: ResLand}
	}
	b.Robber = hexes[0]

	rng := rand.New(rand.NewPCG(7, 11))
	b.Resolve(rng, BoardFair)

	deserts := 0
	for _, tile := range b.Tiles {
		if tile.Res == ResNone {
			deserts++
		}
	}
	if want := desertCount(len(hexes)); deserts != want {
		t.Errorf("deserts = %d, want %d", deserts, want)
	}
	if b.Tiles[b.Robber].Res != ResNone {
		t.Errorf("robber is not on a desert (on %v)", b.Tiles[b.Robber].Res)
	}
	if err := b.ValidateLayout(); err != nil {
		t.Errorf("resolved board invalid: %v", err)
	}
	// Every producing tile got a token; deserts carry none.
	for h, tile := range b.Tiles {
		if tile.Res.Producing() && tile.Number == 0 {
			t.Errorf("producing tile %v has no number", h)
		}
		if tile.Res == ResNone && tile.Number != 0 {
			t.Errorf("desert %v carries a number", h)
		}
	}
}

// A fully pinned board (the builder already chose a desert) is left alone:
// Resolve must not add deserts or move the robber.
func TestResolvePinnedDesertUntouched(t *testing.T) {
	b := &Board{Radius: 1, Tiles: map[Hex]Tile{}}
	hexes := HexesInRadius(1) // 7 tiles
	for i, h := range hexes {
		if i == 0 {
			b.Tiles[h] = Tile{Res: ResNone} // the one desert
		} else {
			b.Tiles[h] = Tile{Res: Wood, Number: 5}
		}
	}
	b.Robber = hexes[0]
	rng := rand.New(rand.NewPCG(1, 2))
	b.Resolve(rng, BoardFair)

	deserts := 0
	for _, tile := range b.Tiles {
		if tile.Res == ResNone {
			deserts++
		}
	}
	if deserts != 1 {
		t.Errorf("deserts = %d, want 1 (pinned board must be untouched)", deserts)
	}
	if b.Robber != hexes[0] {
		t.Errorf("robber moved off the pinned desert")
	}
}

func TestStripToShape(t *testing.T) {
	b := &Board{Radius: 1, Robber: Hex{0, 0}, Tiles: map[Hex]Tile{
		{0, 0}:  {Res: Ore, Number: 6},
		{1, 0}:  {Res: ResNone}, // desert
		{0, 1}:  {Res: Gold, Number: 8},
		{-1, 0}: {Res: Sea},
		{1, -1}: {Res: Wheat, Number: 11},
	}}
	b.StripToShape()
	want := map[Hex]Resource{
		{0, 0}: ResLand, {1, -1}: ResLand, // producing → generic
		{1, 0}: ResNone, {0, 1}: Gold, {-1, 0}: Sea, // desert + gold + sea terrain preserved
	}
	for h, wr := range want {
		if got := b.Tiles[h]; got.Res != wr || got.Number != 0 {
			t.Errorf("tile %v: got %+v, want res %v num 0", h, got, wr)
		}
	}
}

// Promoting a shape to a design (StripToShape then Resolve, the randomize
// endpoint's pipeline) must keep a hand-painted desert where the author put it.
func TestStripAndResolveKeepsPaintedDesert(t *testing.T) {
	desert := Hex{1, -1}
	b := &Board{Radius: 1, Robber: Hex{0, 0}, Tiles: map[Hex]Tile{}}
	for _, h := range HexesInRadius(1) {
		b.Tiles[h] = Tile{Res: ResLand} // a shape: all generic land...
	}
	b.Tiles[desert] = Tile{Res: ResNone} // ...with one painted desert.

	b.StripToShape()
	b.Resolve(rand.New(rand.NewPCG(5, 9)), BoardFair)

	deserts := 0
	for h, tile := range b.Tiles {
		if tile.Res == ResNone {
			deserts++
			if h != desert {
				t.Errorf("desert moved to %v, want it kept at %v", h, desert)
			}
		}
	}
	if deserts != 1 {
		t.Errorf("got %d deserts, want exactly the 1 painted desert", deserts)
	}
	if b.Tiles[desert].Res != ResNone {
		t.Errorf("painted desert %v was overwritten: %+v", desert, b.Tiles[desert])
	}
	if b.Robber != desert {
		t.Errorf("robber at %v, want it on the painted desert %v", b.Robber, desert)
	}
}

// A custom map that pins a desert but saved the robber on a producing tile
// gets the robber snapped back onto the desert.
func TestResolveSnapsRobberToDesert(t *testing.T) {
	b := &Board{Radius: 1, Tiles: map[Hex]Tile{}}
	hexes := HexesInRadius(1) // 7 tiles
	desert := hexes[3]
	for _, h := range hexes {
		if h == desert {
			b.Tiles[h] = Tile{Res: ResNone}
		} else {
			b.Tiles[h] = Tile{Res: Wood, Number: 5}
		}
	}
	b.Robber = hexes[0] // robber saved on a producing tile, not the desert
	rng := rand.New(rand.NewPCG(3, 4))
	b.Resolve(rng, BoardFair)

	if b.Robber != desert {
		t.Errorf("robber = %v, want desert %v", b.Robber, desert)
	}
	if b.Tiles[b.Robber].Res != ResNone {
		t.Errorf("robber is not on a desert (on %v)", b.Tiles[b.Robber].Res)
	}
}

func TestResolveLeavesCompleteDesignUntouched(t *testing.T) {
	before := &Board{Radius: 1, Robber: Hex{1, 0}, Tiles: map[Hex]Tile{
		{0, 0}:  {Res: Wood, Number: 4},
		{1, 0}:  {Res: ResNone}, // pinned desert, robber sits here
		{0, 1}:  {Res: Brick, Number: 5},
		{-1, 0}: {Res: Sheep, Number: 9},
		{1, -1}: {Res: Wheat, Number: 8},
		{-1, 1}: {Res: Ore, Number: 6},
		{0, -1}: {Res: Wood, Number: 11},
	}}
	got := before.Clone()
	got.Resolve(rand.New(rand.NewPCG(42, 7)), BoardFair)
	if got.Robber != before.Robber {
		t.Errorf("robber moved: %v → %v", before.Robber, got.Robber)
	}
	for h, tw := range before.Tiles {
		if tg := got.Tiles[h]; tg != tw {
			t.Errorf("tile %v changed: %+v → %+v", h, tw, tg)
		}
	}
	if len(got.Tiles) != len(before.Tiles) {
		t.Errorf("tile count changed: %d → %d", len(before.Tiles), len(got.Tiles))
	}
}
