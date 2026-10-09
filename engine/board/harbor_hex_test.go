package board

import (
	"math/rand/v2"
	"strings"
	"testing"
)

// assertOneDockPerHex checks the invariant for this file: no two harbors
// resolve to the same seaward water hex, where each harbor's dock stands.
func assertOneDockPerHex(t *testing.T, b *Board, what string) {
	t.Helper()
	seen := map[Hex]Harbor{}
	for _, h := range b.Harbors {
		sea, ok := b.HarborSeaHex(h)
		if !ok {
			t.Errorf("%s: harbor %v has no single water side", what, h.Verts)
			continue
		}
		if prev, dup := seen[sea]; dup {
			t.Errorf("%s: harbors %v and %v both dock on hex %v", what, prev.Verts, h.Verts, sea)
		}
		seen[sea] = h
	}
}

// raggedBoard drowns a seeded half of the outer ring of a generated board, as
// Islands does. The resulting bays, straits and islet notches are where one
// water hex serves several coast edges.
func raggedBoard(t *testing.T, seed uint64, radius, players int) *Board {
	t.Helper()
	rng := rand.New(rand.NewPCG(seed, seed^0x9e3779b97f4a7c15))
	b, err := GenerateRadius(rng, players, radius, BoardFair)
	if err != nil {
		t.Fatal(err)
	}
	want := len(b.Harbors)
	for _, h := range HexesInRadius(radius) {
		if max(abs(h.Q), abs(h.R), abs(h.Q+h.R)) == radius && rng.IntN(2) == 0 {
			b.Tiles[h] = Tile{Res: Sea}
		}
	}
	b.Harbors = placeHarbors(rng, b, want)
	return b
}

// TestGeneratedBoardsOneDockPerHex sweeps the shapes the generator produces
// (full hexagons at every supported radius, and ragged Islands-style coasts)
// and checks one dock per hex on each.
func TestGeneratedBoardsOneDockPerHex(t *testing.T) {
	radii := map[int]int{2: 4, 3: 6, 4: 10}
	for radius, players := range radii {
		for seed := range uint64(200) {
			rng := rand.New(rand.NewPCG(seed, seed^0x9e3779b97f4a7c15))
			b, err := GenerateRadius(rng, players, radius, BoardFair)
			if err != nil {
				t.Fatal(err)
			}
			assertOneDockPerHex(t, b, "hexagon")
			assertOneDockPerHex(t, raggedBoard(t, seed, radius, players), "ragged")
		}
	}
}

// TestFullHexagonHarborCountUnchanged: on a convex board the evenly spaced
// harbors already sit on distinct water hexes, so all of them are placed and
// output for these seeds is unchanged.
func TestFullHexagonHarborCountUnchanged(t *testing.T) {
	for radius, players := range map[int]int{2: 4, 3: 6, 4: 10} {
		for seed := range uint64(50) {
			rng := rand.New(rand.NewPCG(seed, seed^0x9e3779b97f4a7c15))
			b, err := GenerateRadius(rng, players, radius, BoardFair)
			if err != nil {
				t.Fatal(err)
			}
			if got, want := len(b.Harbors), harborCount(radius); got != want {
				t.Fatalf("radius %d seed %d: %d harbors, want %d", radius, seed, got, want)
			}
		}
	}
}

// TestEnsureHarborsOneDockPerHex covers the other generation entry point: a
// hand-built map that ships no harbors gets a set laid on at game start.
func TestEnsureHarborsOneDockPerHex(t *testing.T) {
	for seed := range uint64(100) {
		b := raggedBoard(t, seed, 3, 6)
		b.Harbors = nil
		b.EnsureHarbors(rand.New(rand.NewPCG(seed, 0x5eed)))
		if len(b.Harbors) == 0 {
			t.Fatalf("seed %d: EnsureHarbors placed nothing", seed)
		}
		assertOneDockPerHex(t, b, "ensured")
	}
}

// TestPlaceHarborsNoDoubleDock: asking for more harbors than a
// coastline can hold yields fewer, never two on one hex. A single land hex has
// six coast edges and six water neighbours, and the no-shared-vertex rule caps
// it at three.
func TestPlaceHarborsNoDoubleDock(t *testing.T) {
	b := &Board{Radius: 3, Tiles: map[Hex]Tile{}, Robber: Hex{0, 0}}
	for _, h := range []Hex{{0, 0}, {1, 0}, {0, 1}} {
		b.Tiles[h] = Tile{Res: ResLand}
	}
	for n := 1; n <= 40; n++ {
		b.Harbors = placeHarbors(rand.New(rand.NewPCG(uint64(n), 7)), b, n)
		if len(b.Harbors) > n {
			t.Fatalf("n=%d: placed %d harbors", n, len(b.Harbors))
		}
		assertOneDockPerHex(t, b, "saturated")
	}
}

// sharedDockBoard hand-builds the smallest board where two coast edges share a
// water hex without sharing a vertex: an L of land wrapped around hex (1,0),
// whose two arms each face it across a different edge.
func sharedDockBoard(t *testing.T) (*Board, Edge, Edge) {
	t.Helper()
	b := &Board{Radius: 3, Tiles: map[Hex]Tile{}, Robber: Hex{0, 0}}
	for _, h := range []Hex{{0, 0}, {1, -1}, {1, 1}, {2, 0}} {
		b.Tiles[h] = Tile{Res: ResLand}
	}
	b.Tiles[Hex{1, 0}] = Tile{Res: Sea}
	// Find two distinct edges of the sea hex that each border land.
	var coast []Edge
	for _, e := range (Hex{1, 0}).Edges() {
		if sea, ok := b.edgeSeaHex(e); ok && sea == (Hex{1, 0}) {
			coast = append(coast, e)
		}
	}
	sortEdges(coast)
	if len(coast) < 2 {
		t.Fatalf("fixture: sea hex has %d coast edges, need 2", len(coast))
	}
	// Pick two that do not share a vertex, so only the hex rule can reject them.
	for i := range coast {
		for j := i + 1; j < len(coast); j++ {
			if !coast[i].Connects(coast[j]) {
				return b, coast[i], coast[j]
			}
		}
	}
	t.Fatal("fixture: no two non-touching coast edges on the sea hex")
	return nil, Edge{}, Edge{}
}

func TestValidateLayoutRejectsSharedDockHex(t *testing.T) {
	b, e1, e2 := sharedDockBoard(t)
	b.Harbors = []Harbor{{Verts: [2]Vertex{e1.A, e1.B}, Ratio: 3}}
	if err := b.ValidateLayout(); err != nil {
		t.Fatalf("one harbor should validate, got %v", err)
	}
	b.Harbors = append(b.Harbors, Harbor{Verts: [2]Vertex{e2.A, e2.B}, Ratio: 2, Res: Wheat})
	err := b.ValidateLayout()
	if err == nil {
		t.Fatal("two harbors on one water hex should be rejected")
	}
	if want := "share the water hex"; !strings.Contains(err.Error(), want) {
		t.Errorf("error %q should mention %q", err, want)
	}
}

func TestLintFlagsSharedDockHex(t *testing.T) {
	b, e1, e2 := sharedDockBoard(t)
	b.Harbors = []Harbor{
		{Verts: [2]Vertex{e1.A, e1.B}, Ratio: 3},
		{Verts: [2]Vertex{e2.A, e2.B}, Ratio: 2, Res: Wheat},
	}
	issues := Lint(b)
	var got *Issue
	for i := range issues {
		if issues[i].Code == "harbor_shared_hex" {
			got = &issues[i]
		}
	}
	if got == nil {
		t.Fatalf("Lint did not report harbor_shared_hex; got %+v", issues)
	}
	if got.Severity != sevError {
		t.Errorf("severity = %q, want error", got.Severity)
	}
	if len(got.Hexes) != 1 || got.Hexes[0] != (Hex{1, 0}) {
		t.Errorf("issue hexes = %v, want the shared water hex (1,0)", got.Hexes)
	}
	// A clean board reports nothing.
	b.Harbors = b.Harbors[:1]
	for _, is := range Lint(b) {
		if is.Code == "harbor_shared_hex" {
			t.Error("clean board reported harbor_shared_hex")
		}
	}
}
