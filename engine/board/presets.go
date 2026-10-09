package board

import (
	"fmt"
	"maps"
	"math/rand/v2"
	"sort"
)

// Preset is a hand-built map layout. Tiles and numbers are fixed; harbors are
// placed procedurally.
type Preset struct {
	Name       string
	MinPlayers int
	MaxPlayers int
	Radius     int
	Tiles      map[Hex]Tile
}

var presets = map[string]*Preset{}

// RegisterPreset adds a named layout.
func RegisterPreset(p *Preset) {
	presets[p.Name] = p
}

// PresetNames lists registered presets.
func PresetNames() []string {
	out := make([]string, 0, len(presets))
	for name := range presets {
		out = append(out, name)
	}
	sort.Strings(out)
	return out
}

// ValidatePreset checks existence and player range without building a board.
func ValidatePreset(name string, players int) error {
	p, ok := presets[name]
	if !ok {
		return fmt.Errorf("board: unknown preset %q", name)
	}
	if players < p.MinPlayers || players > p.MaxPlayers {
		return fmt.Errorf("board: preset %q supports %d-%d players", name, p.MinPlayers, p.MaxPlayers)
	}
	return nil
}

// PresetLayout returns a preset's fixed tiles as an editable board for the map
// builder to start from. Harbors are omitted (re-added at game start) and the
// player range is not enforced.
func PresetLayout(name string) (*Board, error) {
	p, ok := presets[name]
	if !ok {
		return nil, fmt.Errorf("board: unknown preset %q", name)
	}
	b := &Board{Radius: p.Radius, Tiles: make(map[Hex]Tile, len(p.Tiles))}
	maps.Copy(b.Tiles, p.Tiles)
	b.Robber = presetRobber(p)
	return b, nil
}

// presetRobber picks the desert (ResNone) tile the robber starts on: the first
// in HexesInRadius order. Ranging over p.Tiles would pick a different desert
// across runs for presets with several ("expanded" has 2, "grand" 3), breaking
// determinism.
func presetRobber(p *Preset) Hex {
	for _, h := range HexesInRadius(p.Radius) {
		if t, ok := p.Tiles[h]; ok && t.Res == ResNone {
			return h
		}
	}
	return Hex{}
}

// PresetBoard instantiates a preset for a game.
func PresetBoard(name string, players int, rng *rand.Rand) (*Board, error) {
	p, ok := presets[name]
	if !ok {
		return nil, fmt.Errorf("board: unknown preset %q", name)
	}
	if players < p.MinPlayers || players > p.MaxPlayers {
		return nil, fmt.Errorf("board: preset %q supports %d-%d players", name, p.MinPlayers, p.MaxPlayers)
	}
	b := &Board{Radius: p.Radius, Tiles: make(map[Hex]Tile, len(p.Tiles))}
	maps.Copy(b.Tiles, p.Tiles)
	b.Robber = presetRobber(p)
	b.Harbors = placeHarbors(rng, b, harborCount(p.Radius))
	return b, nil
}

// The standard beginner layout for 3-4 players, rows top to bottom, left to
// right.
func init() {
	type rowTile struct {
		res Resource
		num int
	}
	rows := [][]rowTile{
		{{Ore, 10}, {Sheep, 2}, {Wood, 9}},
		{{Wheat, 12}, {Brick, 6}, {Sheep, 4}, {Brick, 10}},
		{{Wheat, 9}, {Wood, 11}, {ResNone, 0}, {Wood, 3}, {Ore, 8}},
		{{Wood, 8}, {Ore, 3}, {Wheat, 4}, {Sheep, 5}},
		{{Brick, 5}, {Wheat, 6}, {Sheep, 11}},
	}
	tiles := map[Hex]Tile{}
	for i, row := range rows {
		r := i - 2
		qStart := -2
		if r < 0 {
			qStart = -2 - r
		}
		for j, t := range row {
			tiles[Hex{Q: qStart + j, R: r}] = Tile{Res: t.res, Number: t.num}
		}
	}
	RegisterPreset(&Preset{Name: "beginner", MinPlayers: 2, MaxPlayers: 4, Radius: 2, Tiles: tiles})
}

// Larger curated maps are frozen from the procedural generator with a fixed
// seed in random mode (which guarantees no adjacent 6/8 at these radii), so
// they ship as stable named layouts. "expanded" adds one ring (radius 3, 5-6
// players); "grand" adds two (radius 4, 7-10 players). Harbors are still placed
// per game like any preset.
func init() {
	freeze := func(name string, radius, min, max int, seed uint64) {
		rng := rand.New(rand.NewPCG(seed, seed^0x9e3779b97f4a7c15))
		b, err := GenerateRadius(rng, max, radius, BoardRandom)
		if err != nil {
			panic(fmt.Sprintf("board: cannot freeze preset %q: %v", name, err))
		}
		RegisterPreset(&Preset{Name: name, MinPlayers: min, MaxPlayers: max, Radius: radius, Tiles: b.Tiles})
	}
	freeze("expanded", 3, 5, 6, 0xC0FFEE)
	freeze("grand", 4, 7, 10, 0xBADCAB)
}
