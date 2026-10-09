package ruletest

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"

	// Register the real modules so the terrain↔module gate is populated.
	_ "github.com/ftqo/costan.io/engine/explorers"
	_ "github.com/ftqo/costan.io/engine/harbormaster"
	_ "github.com/ftqo/costan.io/engine/islands"
	_ "github.com/ftqo/costan.io/engine/knights"
	_ "github.com/ftqo/costan.io/engine/rivers"
	_ "github.com/ftqo/costan.io/engine/scenarios"
	_ "github.com/ftqo/costan.io/engine/wagons"
)

// MapEligibilityIssues backs both the lobby's ValidateMap gate and the map
// builder's live lint, so unsupported expansion terrain shows up as a builder
// error rather than a play-time rejection. Every case must agree with
// ValidateMap: issues present iff ValidateMap returns an error.
func TestMapEligibilityIssues(t *testing.T) {
	hexes := board.HexesInRadius(2)
	allLand := func() *board.Board {
		b := &board.Board{Radius: 2, Tiles: map[board.Hex]board.Tile{}}
		for _, h := range hexes {
			b.Tiles[h] = board.Tile{Res: board.ResLand}
		}
		b.Robber = hexes[len(hexes)-1]
		return b
	}

	t.Run("clean base board has no issues", func(t *testing.T) {
		if iss := engine.MapEligibilityIssues(allLand(), "base"); len(iss) != 0 {
			t.Fatalf("expected no issues, got %v", iss)
		}
	})

	t.Run("gold without islands flags the gold tiles", func(t *testing.T) {
		b := allLand()
		b.Tiles[hexes[0]] = board.Tile{Res: board.Gold, Number: 6}
		iss := engine.MapEligibilityIssues(b, "base")
		if len(iss) == 0 {
			t.Fatal("gold on a base map should produce an eligibility issue")
		}
		got := iss[0]
		if got.Severity != "error" {
			t.Errorf("severity = %q, want error", got.Severity)
		}
		if len(got.Hexes) == 0 || got.Hexes[0] != hexes[0] {
			t.Errorf("issue should point at the gold hex %v, got hexes %v", hexes[0], got.Hexes)
		}
		// The client composes the sentence, so assert the data it composes from,
		// not the reference wording.
		if got.Code != "terrain_needs_module" {
			t.Errorf("code = %q, want terrain_needs_module", got.Code)
		}
		if got.Params["terrain"] != "gold" || got.Params["module"] != "islands" {
			t.Errorf("params = %v, want terrain=gold module=islands", got.Params)
		}
	})

	t.Run("islands without sea flags missing terrain", func(t *testing.T) {
		// Gold present so islands is the intended ruleset, but the map is
		// landlocked (gold on the main island).
		b := allLand()
		b.Tiles[hexes[0]] = board.Tile{Res: board.Gold, Number: 6}
		iss := engine.MapEligibilityIssues(b, "base+islands")
		if len(iss) == 0 {
			t.Fatal("islands map without sea should produce an issue")
		}
		if iss[0].Code != "module_needs_terrain" {
			t.Errorf("code = %q, want module_needs_terrain", iss[0].Code)
		}
		if iss[0].Params["terrain"] != "sea" || iss[0].Params["module"] != "islands" {
			t.Errorf("params = %v, want terrain=sea module=islands", iss[0].Params)
		}
	})

	t.Run("gold with sea under islands is clean", func(t *testing.T) {
		b := allLand()
		b.Tiles[hexes[0]] = board.Tile{Res: board.Gold, Number: 6}
		b.Tiles[hexes[1]] = board.Tile{Res: board.Sea}
		if iss := engine.MapEligibilityIssues(b, "base+islands"); len(iss) != 0 {
			t.Fatalf("gold + sea under islands should be clean, got %v", iss)
		}
	})

	// The gallery and map builder author land only; Frame computes the
	// ocean (see docs/maps.md). A land-only non-hexagon island shape must be
	// accepted under islands, because the eligibility gate evaluates the
	// framed board.
	t.Run("land-only island shape is clean", func(t *testing.T) {
		// A small island inside a larger radius, not a full hexagon, so Frame
		// computes a coastal sea ring around it. No sea is authored.
		b := &board.Board{Radius: 3, Tiles: map[board.Hex]board.Tile{}}
		for _, h := range board.HexesInRadius(1) {
			b.Tiles[h] = board.Tile{Res: board.ResLand}
		}
		b.Robber = board.Hex{Q: 0, R: 0}
		if iss := engine.MapEligibilityIssues(b, "base+islands"); len(iss) != 0 {
			t.Fatalf("land-only island shape under islands should be clean (sea is computed), got %v", iss)
		}
		if err := engine.ValidateMap(b, "base+islands"); err != nil {
			t.Fatalf("ValidateMap must agree (no error), got %v", err)
		}
	})

	// A full hexagon of land has no coast for Frame to flood, so islands
	// is still rejected.
	t.Run("full-hexagon land under islands still needs water", func(t *testing.T) {
		if iss := engine.MapEligibilityIssues(allLand(), "base+islands"); len(iss) == 0 {
			t.Fatal("a solid land hexagon under islands should still require water")
		}
	})

	// Consistency: issues present iff ValidateMap rejects.
	t.Run("agrees with ValidateMap", func(t *testing.T) {
		cases := []struct {
			name    string
			build   func() *board.Board
			ruleset string
		}{
			{"clean base", allLand, "base"},
			{"gold base", func() *board.Board {
				b := allLand()
				b.Tiles[hexes[0]] = board.Tile{Res: board.Gold, Number: 6}
				return b
			}, "base"},
			{"islands no sea", func() *board.Board {
				b := allLand()
				b.Tiles[hexes[0]] = board.Tile{Res: board.Gold, Number: 6}
				return b
			}, "base+islands"},
			{"lake base", func() *board.Board {
				b := allLand()
				b.Tiles[hexes[0]] = board.Tile{Res: board.Lake}
				return b
			}, "base"},
		}
		for _, c := range cases {
			b := c.build()
			gotErr := engine.ValidateMap(b, c.ruleset) != nil
			gotIss := len(engine.MapEligibilityIssues(b, c.ruleset)) != 0
			if gotErr != gotIss {
				t.Errorf("%s: ValidateMap err=%v but issues=%v (must agree)", c.name, gotErr, gotIss)
			}
		}
	})
}
