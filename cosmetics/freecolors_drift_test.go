package cosmetics

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

// The client keeps its own list of free seat colors to decide which renders to
// cache (/api/cosmetics is auth-gated, and guests benefit too). This reads the
// real file so the mirrored list cannot drift silently.
const freeColorsTS = "../frontend/src/lib/board3d/freeColors.ts"

var hexInTS = regexp.MustCompile(`"(#[0-9a-fA-F]{6})"`)

func TestFrontendFreeColorsMatchPalette(t *testing.T) {
	raw, err := os.ReadFile(freeColorsTS)
	if err != nil {
		t.Fatalf("reading %s: %v (update the path if the file moved)", freeColorsTS, err)
	}
	// Only the array literal, so a hex mentioned in the prose above it cannot
	// pass the test on its own.
	src := string(raw)
	start := strings.Index(src, "FREE_SEAT_COLORS = [")
	if start < 0 {
		t.Fatalf("%s does not declare FREE_SEAT_COLORS as an array literal", freeColorsTS)
	}
	end := strings.Index(src[start:], "]")
	if end < 0 {
		t.Fatalf("%s: FREE_SEAT_COLORS literal is not closed", freeColorsTS)
	}

	var got []string
	for _, m := range hexInTS.FindAllStringSubmatch(src[start:start+end], -1) {
		got = append(got, strings.ToLower(m[1]))
	}

	want := make([]string, 0, FreeCount)
	for _, c := range Palette[:FreeCount] {
		want = append(want, strings.ToLower(c.Hex))
	}

	if len(got) != len(want) {
		t.Fatalf("%s lists %d colors, Palette[:FreeCount] has %d\n  client: %v\n  server: %v",
			freeColorsTS, len(got), len(want), got, want)
	}
	// Order does not affect behavior, but a reordering usually means a swap, so
	// compare positionally.
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("free color %d: client has %s, server has %s", i, got[i], want[i])
		}
	}
}
