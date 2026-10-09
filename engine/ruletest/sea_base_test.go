package ruletest

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"

	// Register the real modules so the terrain-to-module gate is populated,
	// as in the server binary.
	_ "github.com/ftqo/costan.io/engine/explorers"
	_ "github.com/ftqo/costan.io/engine/harbormaster"
	_ "github.com/ftqo/costan.io/engine/islands"
	_ "github.com/ftqo/costan.io/engine/knights"
	_ "github.com/ftqo/costan.io/engine/rivers"
	_ "github.com/ftqo/costan.io/engine/scenarios"
	_ "github.com/ftqo/costan.io/engine/wagons"
)

// Water may be carved into a base map to shape its coastline. ValidateMap must
// accept it and a game must start from it. Gold and Lake still require their
// expansions.
func TestSeaIsBaseLegal(t *testing.T) {
	hexes := board.HexesInRadius(2)

	allLand := func() *board.Board {
		b := &board.Board{Radius: 2, Tiles: map[board.Hex]board.Tile{}}
		for _, h := range hexes {
			b.Tiles[h] = board.Tile{Res: board.ResLand}
		}
		b.Robber = hexes[len(hexes)-1]
		return b
	}

	// Sea carved into a base map is allowed and starts a game.
	sea := allLand()
	for i := range 6 {
		sea.Tiles[hexes[i]] = board.Tile{Res: board.Sea}
	}
	if err := engine.ValidateMap(sea, "base"); err != nil {
		t.Fatalf("sea should be base-legal, got %v", err)
	}
	cfg := engine.GameConfig{Players: 4, Ruleset: "base", Board: sea, BoardMode: board.BoardFair}
	if _, err := engine.New(cfg, engine.SeedsFrom(42)); err != nil {
		t.Fatalf("New with a sea-carved base board failed: %v", err)
	}

	// Gold still needs the islands module.
	gold := allLand()
	gold.Tiles[hexes[0]] = board.Tile{Res: board.Gold, Number: 6}
	if err := engine.ValidateMap(gold, "base"); err == nil {
		t.Errorf("gold should still need the islands module in base")
	}

	// Lake still needs the fishermen module.
	lake := allLand()
	lake.Tiles[hexes[0]] = board.Tile{Res: board.Lake}
	if err := engine.ValidateMap(lake, "base"); err == nil {
		t.Errorf("lake should still need the fishermen module in base")
	}
}
