package scenarios

import (
	"encoding/json"
	"maps"
	"slices"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// lakeHex returns a lake tile on s's board, failing if the flood left none.
func lakeHex(t *testing.T, s *engine.State) board.Hex {
	t.Helper()
	var out []board.Hex
	for h, tile := range s.Board.Tiles {
		if tile.Res == board.Lake {
			out = append(out, h)
		}
	}
	if len(out) == 0 {
		t.Fatal("base+fishermen board has no lake")
	}
	// s.Board.Tiles is a map; sort so the test picks the same hex every run.
	slices.SortFunc(out, func(a, b board.Hex) int {
		if a.Q != b.Q {
			return a.Q - b.Q
		}
		return a.R - b.R
	})
	return out[0]
}

// TestLakeTileCarriesNoNumber: the flooded desert has Number 0, because a Tile
// holds one number and the lake pays on four. Anything keyed on `Number != 0`
// (the Islands gold pass, the client's chip planner) must see it as unnumbered.
func TestLakeTileCarriesNoNumber(t *testing.T) {
	s, _ := newGame(t, "base+fishermen", 7)
	for h, tile := range s.Board.Tiles {
		if tile.Res == board.Lake && tile.Number != 0 {
			t.Fatalf("lake %v has Number %d, want 0 (lake numbers %v)", h, tile.Number, LakeNumbers)
		}
	}
	lakeHex(t, s) // and there is at least one, so the check above is not vacuous
}

// TestViewPublishesLakeNumbers: since the tile carries no number, the four
// numbers reach the client through the view.
func TestViewPublishesLakeNumbers(t *testing.T) {
	s, _ := newGame(t, "base+fishermen", 7)
	// fishExt, not FishStateExt: a game that has only run setup may not have
	// the ext yet.
	x := fishExt(s)
	raw, err := json.Marshal(x.ViewExt(0))
	if err != nil {
		t.Fatal(err)
	}
	var got struct {
		Lake []int `json:"lake_numbers"`
	}
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	// The literal rule, spelled out only here; everything else compares
	// against LakeNumbers. docs/rules/scenarios.md: the lake yields on 2, 3,
	// 11 and 12.
	want := []int{2, 3, 11, 12}
	if !slices.Equal(got.Lake, want) {
		t.Fatalf("view lake_numbers = %v, want %v", got.Lake, want)
	}
	if !slices.IsSorted(got.Lake) {
		t.Fatalf("lake_numbers %v not ascending", got.Lake)
	}
	// Spectators see them too: lake numbers are on the board.
	rawSpec, err := json.Marshal(x.ViewExt(engine.NoPlayer))
	if err != nil {
		t.Fatal(err)
	}
	var spec struct {
		Lake []int `json:"lake_numbers"`
	}
	if err := json.Unmarshal(rawSpec, &spec); err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(spec.Lake, want) {
		t.Fatalf("spectator lake_numbers = %v, want %v", spec.Lake, want)
	}
}

// TestLakePaysExactlyItsPublishedNumbers: the list the view publishes is the list
// fishCatch pays on, across every dice total. A settlement is placed on a lake
// corner directly and the grounds are emptied, so only the lake can produce.
func TestLakePaysExactlyItsPublishedNumbers(t *testing.T) {
	s, _ := newGame(t, "base+fishermen", 7)
	h := lakeHex(t, s)

	// One settlement on a corner of the lake, owned by seat 0, and nothing else
	// on the board: every draw below is the lake's doing.
	s.Buildings = map[board.Vertex]engine.Building{
		h.Vertices()[0]: {Owner: 0, City: false},
	}
	x := fishExt(s)
	x.Grounds = nil // the grounds' numbers (4..10) must not answer for the lake

	for roll := 2; roll <= 12; roll++ {
		d1 := min(roll-1, 6)
		d2 := roll - d1
		events := fishCatch(s, d1, d2)
		paid := len(events) > 0
		want := slices.Contains(LakeNumbers, roll)
		if paid != want {
			t.Errorf("roll %d: lake paid=%v, want %v (LakeNumbers=%v)", roll, paid, want, LakeNumbers)
		}
	}
}

// TestLakeSurvivesOnLobbyBoards: Fishermen.FinishBoard must run on boards inlined
// by the lobby, which is every real game. A sweep, since the failure is a rate;
// that the repair path is live on a lobby board is pinned by construction in the
// next test, so this one cannot pass vacuously.
func TestLakeSurvivesOnLobbyBoards(t *testing.T) {
	maps := []struct {
		ruleset string
		board   func(int) *board.Board
	}{
		{"base+fishermen", lobbyBoard},
		{engine.CanonicalRuleset("base+fishermen+islands"), lobbyIslandsBoard},
		{engine.CanonicalRuleset("base+caravans+fishermen+islands"), lobbyIslandsBoard},
	}
	for _, m := range maps {
		for _, players := range []int{3, 4, 6} {
			for seed := uint64(1); seed <= 40; seed++ {
				cfg := engine.GameConfig{
					Players: players, Ruleset: m.ruleset,
					Board: m.board(board.RadiusFor(players)),
				}
				s := replayNew(t, cfg, seed)
				if !hasLake(s.Board) {
					t.Fatalf("%s p%d seed %d: lobby board finished with no lake",
						m.ruleset, players, seed)
				}
				// No desert survives beside it. A later finisher can create one
				// (Caravans promotes a hex to ResNone, and "caravans" sorts before
				// "fishermen"), and step 1 of the finisher floods it.
				for h, tile := range s.Board.Tiles {
					if tile.Res == board.ResNone {
						t.Fatalf("%s p%d seed %d: hex %v finished as a desert on a Fishermen board",
							m.ruleset, players, seed, h)
					}
				}
			}
		}
	}
}

// TestFinishBoardRepairsALobbyBoard: a board with no neutral hex left and an
// inlined board in the config, as every real game has, must still get a lake.
func TestFinishBoardRepairsALobbyBoard(t *testing.T) {
	const radius = 2
	shape := lobbyBoard(radius)
	cfg := engine.GameConfig{Players: 3, Ruleset: "base+fishermen", Board: shape}

	b := lobbyBoard(radius)
	b.Frame()
	b.Resolve(engine.PublicRngForSeed(7, 1), cfg.BoardMode)
	// Drown every neutral hex the deal produced, which is what the Islands carve
	// does to a lake on the ring.
	for h, tile := range b.Tiles {
		if tile.Res == board.ResNone || tile.Res == board.Lake {
			b.Tiles[h] = board.Tile{Res: board.Wood, Number: 6}
		}
	}
	if hasLake(b) {
		t.Fatal("fixture: constructed board already has a lake")
	}
	(Fishermen{}).FinishBoard(b, cfg, engine.PublicRngForSeed(7, 2))
	if !hasLake(b) {
		t.Fatal("FinishBoard left a lobby board with no lake")
	}
}

// TestFishermenFinishBoardKeepsPinnedTiles: a tile the author chose is theirs;
// the hook may only promote a hex the engine dealt into a hole the author left.
// (Flooding a pinned desert is the scenario itself and is not at issue; taking
// a named producing hex for a lake is.)
func TestFishermenFinishBoardKeepsPinnedTiles(t *testing.T) {
	const radius = 2
	// Every hex named and numbered by the author: nothing here is the engine's.
	src := &board.Board{Radius: radius, Tiles: map[board.Hex]board.Tile{}}
	for i, h := range board.HexesInRadius(radius) {
		src.Tiles[h] = board.Tile{Res: board.Resources[i%len(board.Resources)], Number: 6}
	}
	cfg := engine.GameConfig{Players: 3, Ruleset: "base+fishermen", Board: src}

	b := &board.Board{Radius: radius, Tiles: map[board.Hex]board.Tile{}}
	maps.Copy(b.Tiles, src.Tiles)
	(Fishermen{}).FinishBoard(b, cfg, engine.PublicRngForSeed(3, 2))
	for h, tile := range b.Tiles {
		if tile.Res != src.Tiles[h].Res {
			t.Fatalf("authored hex %v was %v, got %v",
				h, src.Tiles[h].Res, tile.Res)
		}
	}
}

// hasLake reports whether the board carries a lake tile.
func hasLake(b *board.Board) bool {
	for _, t := range b.Tiles {
		if t.Res == board.Lake {
			return true
		}
	}
	return false
}
