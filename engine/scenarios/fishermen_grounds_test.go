package scenarios

import (
	"reflect"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	_ "github.com/ftqo/costan.io/engine/islands"
)

// groundRulesets are every shipped ruleset that puts fishing grounds on a
// procedural board. Islands' carved coast produces notches with four and five
// land vertices, which base boards never do.
var groundRulesets = []string{"base+fishermen", "base+islands+fishermen"}

// boardFor generates the board a real game of ruleset rs would start from.
func boardFor(t *testing.T, rs string, players int, seed uint64) *board.Board {
	t.Helper()
	log, err := engine.New(engine.GameConfig{Players: players, Ruleset: rs}, engine.SeedsFrom(seed))
	if err != nil {
		t.Fatal(err)
	}
	s := engine.Empty()
	for _, e := range log {
		if err := engine.Apply(s, e); err != nil {
			t.Fatal(err)
		}
	}
	return s.Board
}

// connectedPath reports whether the vertices form a single connected stretch of
// shore: every vertex reachable from the first through vertex adjacency, and no
// vertex with more than two neighbours in the set (a run, not a star). It walks
// board.Vertex.Neighbors rather than assuming anything about slice order.
func connectedPath(vs []board.Vertex) bool {
	if len(vs) == 0 {
		return false
	}
	in := map[board.Vertex]bool{}
	for _, v := range vs {
		in[v] = true
	}
	if len(in) != len(vs) {
		return false // a duplicate corner
	}
	adj := map[board.Vertex][]board.Vertex{}
	for _, v := range vs {
		for _, n := range v.Neighbors() {
			if in[n] {
				adj[v] = append(adj[v], n)
			}
		}
		if len(adj[v]) > 2 {
			return false
		}
	}
	seen := map[board.Vertex]bool{vs[0]: true}
	queue := []board.Vertex{vs[0]}
	for len(queue) > 0 {
		v := queue[0]
		queue = queue[1:]
		for _, n := range adj[v] {
			if !seen[n] {
				seen[n] = true
				queue = append(queue, n)
			}
		}
	}
	return len(seen) == len(in)
}

// TestGroundsCappedAndContiguous is the headline guarantee: no fishing ground
// on any shipped ruleset touches more than three coastal intersections, and the
// intersections it does touch are a connected stretch of coast.
func TestGroundsCappedAndContiguous(t *testing.T) {
	for _, rs := range groundRulesets {
		for players := 2; players <= 10; players++ {
			for seed := uint64(1); seed <= 12; seed++ {
				b := boardFor(t, rs, players, seed)
				for _, g := range deriveGrounds(b, groundNumbers) {
					if len(g.V) < 2 || len(g.V) > groundCorners {
						t.Fatalf("%s p=%d seed=%d: ground %d has %d corners (%v), want 2..%d",
							rs, players, seed, g.Number, len(g.V), g.V, groundCorners)
					}
					if !connectedPath(g.V) {
						t.Fatalf("%s p=%d seed=%d: ground %d corners are not contiguous: %v",
							rs, players, seed, g.Number, g.V)
					}
					for _, v := range g.V {
						if !b.LandVertex(v) {
							t.Fatalf("%s p=%d seed=%d: ground %d corner %v is not coastal", rs, players, seed, g.Number, v)
						}
					}
				}
			}
		}
	}
}

// TestGroundsDoNotShareCorners keeps the spread guarantee that survived the cap.
func TestGroundsDoNotShareCorners(t *testing.T) {
	for _, rs := range groundRulesets {
		for seed := uint64(1); seed <= 20; seed++ {
			b := boardFor(t, rs, 4, seed)
			used := map[board.Vertex]bool{}
			for _, g := range deriveGrounds(b, groundNumbers) {
				for _, v := range g.V {
					if used[v] {
						t.Fatalf("%s seed=%d: corner %v shared by two grounds", rs, seed, v)
					}
					used[v] = true
				}
			}
		}
	}
}

// TestDeriveGroundsDeterministic: the placement is a pure function of the board,
// so repeated calls agree. deriveGrounds iterates a map internally, so this is a
// real risk.
func TestDeriveGroundsDeterministic(t *testing.T) {
	for _, rs := range groundRulesets {
		for seed := uint64(1); seed <= 10; seed++ {
			b := boardFor(t, rs, 6, seed)
			want := deriveGrounds(b, groundNumbers)
			for i := range 8 {
				if got := deriveGrounds(b, groundNumbers); !reflect.DeepEqual(got, want) {
					t.Fatalf("%s seed=%d call %d: %v != %v", rs, seed, i, got, want)
				}
			}
		}
	}
}

// TestShoreRunDeterministicOnTies pins the tie-break. Two runs of two (a hex in a
// strait) is the only split a hex admits; procedural boards produce it too rarely
// for TestDeriveGroundsDeterministic, so it is asserted on a hand-built notch,
// repeated enough that an unstable scan would show.
func TestShoreRunDeterministicOnTies(t *testing.T) {
	b := seaNotch(1, 4)
	want := shoreRun(b, board.Hex{})
	if len(want) != 2 {
		t.Fatalf("setup: want a 2-corner tie notch, got %v", want)
	}
	for i := range 200 {
		if got := shoreRun(b, board.Hex{}); !reflect.DeepEqual(got, want) {
			t.Fatalf("call %d: shoreRun = %v, want %v", i, got, want)
		}
	}
}

// seaNotch builds a one-sea-hex board: the origin is sea, and each named
// neighbour direction is land. board.Hex.Neighbors is indexed by direction, so
// this addresses shores by position around the notch.
func seaNotch(dirs ...int) *board.Board {
	b := &board.Board{Radius: 3, Tiles: map[board.Hex]board.Tile{}}
	origin := board.Hex{}
	b.Tiles[origin] = board.Tile{Res: board.Sea}
	n := origin.Neighbors()
	for _, d := range dirs {
		b.Tiles[n[d]] = board.Tile{Res: board.Wood, Number: 6}
	}
	return b
}

func TestShoreRun(t *testing.T) {
	ring := board.Hex{}.Vertices()
	// A land neighbour in direction d makes exactly two of the notch's corners
	// land: ring indices (1-d) and (2-d), modulo 6 (a neighbour shares one edge,
	// hence two corners, with the notch). Each case below spells out the land
	// mask that follows.
	cases := []struct {
		name string
		dirs []int
		want []board.Vertex
	}{
		{"no land at all", nil, nil},
		// {1,2}: the only run, already within the cap.
		{"one shore, two corners", []int{0}, []board.Vertex{ring[1], ring[2]}},
		// {0,1,2}: a run of exactly three.
		{"two adjacent shores, three corners", []int{0, 1}, []board.Vertex{ring[0], ring[1], ring[2]}},
		// {5,0,1,2}: a run of four starting at 5, trimmed to 5,0,1 and listed in
		// ascending ring order.
		{"four contiguous corners trim to three", []int{0, 1, 2}, []board.Vertex{ring[0], ring[1], ring[5]}},
		// {3,4,5,0}: a run of four starting at 3, trimmed to 3,4,5.
		{"run starting past index 0", []int{2, 3, 4}, []board.Vertex{ring[3], ring[4], ring[5]}},
		// {0,1} and {3,4}: opposite shores of a strait, two runs of two. The
		// lower ring index breaks the tie; the far shore is dropped rather than
		// joined across water.
		{"opposite shores, tie goes to the lower index", []int{1, 4}, []board.Vertex{ring[0], ring[1]}},
		// Two separated runs of unequal length cannot occur on a hex: each run
		// is at least two corners with a gap between, so 2+2+1+1 = 6 is the
		// only split.
		// All six corners land: every index starts a maximal run, so index 0 is
		// the canonical choice.
		{"enclosed", []int{0, 1, 2, 3, 4, 5}, []board.Vertex{ring[0], ring[1], ring[2]}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := shoreRun(seaNotch(tc.dirs...), board.Hex{})
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("shoreRun = %v, want %v", got, tc.want)
			}
			if got != nil && !connectedPath(got) {
				t.Fatalf("shoreRun = %v is not contiguous", got)
			}
		})
	}
}

// TestBaseFishermenGroundsUnchanged pins the fishing grounds of plain
// base+fishermen boards against a golden fingerprint, so no change moves a ground
// without someone deciding it should.
//
// The golden has to be recomputed when board generation or ground derivation
// changes on purpose (for example harbor-dock exclusion, the seeded
// number-token tie-break, the solver's unfused arithmetic, the derivation 12
// number shuffle, and the derivation 13 table sizes). When it moves, check which
// part moved: at 2 to 4 seats the derivation 13 change left the placement intact.
func TestBaseFishermenGroundsUnchanged(t *testing.T) {
	const want = "3e4d66b38406eb50"
	if got := groundsFingerprint(t, "base+fishermen"); got != want {
		t.Fatalf("base+fishermen fishing grounds changed: fingerprint %s, want %s", got, want)
	}
}

// TestGroundsAvoidHarborDocks: a fishing ground must not sit on the water hex a
// harbor's dock stands on (both are drawn at that hex centre). It also asserts
// every board still gets its full six grounds, so a future board shape that
// leaves too few non-dock notches fails here.
func TestGroundsAvoidHarborDocks(t *testing.T) {
	for players := 2; players <= 10; players++ {
		for seed := uint64(1); seed <= 40; seed++ {
			log, err := engine.New(engine.GameConfig{Players: players, Ruleset: "base+fishermen"}, engine.SeedsFrom(seed))
			if err != nil {
				t.Fatal(err)
			}
			s := engine.Empty()
			for _, e := range log {
				if err := engine.Apply(s, e); err != nil {
					t.Fatal(err)
				}
			}
			b := s.Board
			docked := map[board.Hex]bool{}
			for _, hb := range b.Harbors {
				if sea, ok := b.HarborSeaHex(hb); ok {
					docked[sea] = true
				}
			}
			grounds := deriveGrounds(b, groundNumbers)
			if len(grounds) != len(groundNumbers) {
				t.Fatalf("players %d seed %d: got %d grounds, want %d", players, seed, len(grounds), len(groundNumbers))
			}
			for _, g := range grounds {
				if docked[g.Hex] {
					t.Fatalf("players %d seed %d: ground %d sits on hex (%d,%d), which a harbor's dock stands on",
						players, seed, g.Number, g.Hex.Q, g.Hex.R)
				}
			}
		}
	}
}
