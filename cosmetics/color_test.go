package cosmetics

import "testing"

func TestPaletteShape(t *testing.T) {
	if len(Palette) != 64 {
		t.Fatalf("palette size = %d; want 64", len(Palette))
	}
	free := 0
	seen := map[string]bool{}
	allowed := map[int]bool{0: true, 85: true, 170: true, 255: true}
	for _, c := range Palette {
		if seen[c.ID] {
			t.Fatalf("duplicate color id %q", c.ID)
		}
		seen[c.ID] = true
		if c.Free {
			free++
		}
		// Every channel must be one of the 4 cube levels {0,85,170,255}.
		r, g, b := hexToRGB(c.Hex)
		for _, ch := range []int{int(r*255 + 0.5), int(g*255 + 0.5), int(b*255 + 0.5)} {
			if !allowed[ch] {
				t.Fatalf("%s (%s) has off-cube channel %d", c.ID, c.Hex, ch)
			}
		}
	}
	if free != FreeCount {
		t.Fatalf("free colors = %d; want %d", free, FreeCount)
	}
	// The cube is exactly all 4^3 combinations: every channel level appears 16x.
	if len(seen) != 64 {
		t.Fatalf("unique colors = %d; want 64", len(seen))
	}
}

func TestFreeColorsMutuallyDistinct(t *testing.T) {
	// The 10 free presets must be distinct from each other: a 10-seat game can
	// use all of them at once.
	var free []Color
	for _, c := range Palette {
		if c.Free {
			free = append(free, c)
		}
	}
	for i := range free {
		for j := i + 1; j < len(free); j++ {
			if d := free[i].DeltaE(free[j]); d < ColorThreshold {
				t.Errorf("free %s vs %s: ΔE %.1f < threshold %.1f", free[i].ID, free[j].ID, d, ColorThreshold)
			}
		}
	}
}

func TestAllowedColor(t *testing.T) {
	red, _ := ColorByID("color.ff0000")
	blue, _ := ColorByID("color.0000ff")
	if !AllowedColor([]Color{red}, blue, ColorThreshold) {
		t.Error("red then blue should be allowed")
	}
	if AllowedColor([]Color{red}, red, ColorThreshold) {
		t.Error("the same color twice must be disallowed")
	}
	if !AllowedColor(nil, red, ColorThreshold) {
		t.Error("first pick on an empty board is always allowed")
	}
}

func TestPickSeatColor(t *testing.T) {
	// With no conflicts, the seat keeps its order default.
	if got := PickSeatColor(nil, 1); got.ID != DefaultSeatColor(1).ID {
		t.Errorf("unconflicted seat 1 = %s, want its default %s", got.ID, DefaultSeatColor(1).ID)
	}

	// When seat 1's default is already taken, the seat must yield a different,
	// still-distinct free preset.
	taken := DefaultSeatColor(1)
	got := PickSeatColor([]Color{taken}, 1)
	if got.ID == taken.ID {
		t.Fatalf("seat 1 reused taken color %s", taken.ID)
	}
	if !AllowedColor([]Color{taken}, got, ColorThreshold) {
		t.Errorf("seat 1 fell back to %s, too close to taken %s", got.ID, taken.ID)
	}
	if !got.Free {
		t.Errorf("seat 1 picked supporter color %s, want a free preset", got.ID)
	}
}
