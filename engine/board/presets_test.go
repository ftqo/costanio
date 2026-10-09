package board

import (
	"math/rand/v2"
	"testing"
)

// TestPresetRobberDeterministic: multi-desert presets ("expanded" has 2,
// "grand" 3) must put the robber on the same hex across runs and across both
// PresetBoard and PresetLayout, not depend on map iteration order.
func TestPresetRobberDeterministic(t *testing.T) {
	// A desert-free preset is allowed, but fail if no preset had one, or this
	// test would check nothing and still pass.
	exercised := 0
	for _, name := range PresetNames() {
		p := presets[name]
		for _, tile := range p.Tiles {
			if tile.Res == ResNone {
				exercised++
				break
			}
		}
	}
	if exercised == 0 {
		t.Fatal("no preset has a desert")
	}
	for _, name := range PresetNames() {
		t.Run(name, func(t *testing.T) {
			p := presets[name]

			// Count deserts so the test stays meaningful if presets change.
			deserts := 0
			for _, tile := range p.Tiles {
				if tile.Res == ResNone {
					deserts++
				}
			}
			if deserts == 0 {
				t.Skipf("preset %q has no desert", name)
			}

			// The robber must be on the first desert tile in hex order.
			want := presetRobber(p)
			if tile, ok := p.Tiles[want]; !ok || tile.Res != ResNone {
				t.Fatalf("presetRobber returned non-desert %v", want)
			}
			for _, h := range HexesInRadius(p.Radius) {
				if tile, ok := p.Tiles[h]; ok && tile.Res == ResNone {
					if h != want {
						t.Fatalf("first desert in order is %v but presetRobber chose %v", h, want)
					}
					break
				}
			}

			players := p.MinPlayers
			for i := range 200 {
				lay, err := PresetLayout(name)
				if err != nil {
					t.Fatalf("PresetLayout: %v", err)
				}
				if lay.Robber != want {
					t.Fatalf("PresetLayout robber = %v, want %v (iter %d)", lay.Robber, want, i)
				}
				// Harbor placement consumes the rng; the robber must not depend on it.
				rng := rand.New(rand.NewPCG(uint64(i), 0x1234))
				bd, err := PresetBoard(name, players, rng)
				if err != nil {
					t.Fatalf("PresetBoard: %v", err)
				}
				if bd.Robber != want {
					t.Fatalf("PresetBoard robber = %v, want %v (iter %d)", bd.Robber, want, i)
				}
			}
		})
	}
}
