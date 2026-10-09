package board

import "testing"

// TestMaxPlayersForMatchesTheGallery checks the seat rule against the three
// standard maps offered to players, full hexagons at the radii RadiusFor
// produces (2, 3, 4), so the tile-count rule agrees with the generator's.
func TestMaxPlayersForMatchesTheGallery(t *testing.T) {
	for _, tc := range []struct{ radius, wantSeats int }{
		{2, 4},  // "Small": 19 hexes, the classic board
		{3, 8},  // "Medium": 37 hexes
		{4, 14}, // "Large": 61 hexes, comfortably past the engine's 10
	} {
		b := &Board{Radius: tc.radius, Tiles: map[Hex]Tile{}}
		for _, h := range HexesInRadius(tc.radius) {
			b.Tiles[h] = Tile{Res: ResLand}
		}
		if got := MaxPlayersFor(b); got != tc.wantSeats {
			t.Errorf("radius %d (%d hexes): seats %d, want %d", tc.radius, len(b.Tiles), got, tc.wantSeats)
		}
	}
}

// TestEveryPlayerCountHasBoard: every supported seat count has a
// standard board that holds it, and RadiusFor returns one of them.
func TestEveryPlayerCountHasBoard(t *testing.T) {
	for players := 2; players <= 10; players++ {
		r := RadiusFor(players)
		b := &Board{Radius: r, Tiles: map[Hex]Tile{}}
		for _, h := range HexesInRadius(r) {
			b.Tiles[h] = Tile{Res: ResLand}
		}
		if err := ValidateSeats(b, players); err != nil {
			t.Errorf("%d players: RadiusFor says radius %d, which does not seat them: %v", players, r, err)
		}
	}
}

// TestTinyBoardRefusesBigTable: a 19-hex board cannot seat a large table.
func TestTinyBoardRefusesBigTable(t *testing.T) {
	b := &Board{Radius: 2, Tiles: map[Hex]Tile{}}
	for _, h := range HexesInRadius(2) {
		b.Tiles[h] = Tile{Res: ResLand}
	}
	if err := ValidateSeats(b, 10); err == nil {
		t.Error("19 hexes accepted a 10-player table")
	}
	if err := ValidateSeats(b, 4); err != nil {
		t.Errorf("19 hexes refused the 4-player table it was designed for: %v", err)
	}
}
