package scenarios

import (
	"encoding/json"
	"reflect"
	"slices"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	_ "github.com/ftqo/costan.io/engine/islands"
)

// TestGroundHexMatchesNotch: the hex a ground names is the sea hex
// whose corner ring deriveGrounds walked, so every corner of the ground is one of
// its corners. Checked across both ground rulesets, since Islands' carved coast
// produces unusual notches.
func TestGroundHexMatchesNotch(t *testing.T) {
	for _, rs := range groundRulesets {
		for seed := uint64(1); seed <= 40; seed++ {
			b := boardFor(t, rs, 4, seed)
			grounds := deriveGrounds(b, groundNumbers)
			if len(grounds) == 0 {
				t.Fatalf("%s seed %d: no fishing grounds at all", rs, seed)
			}
			for _, g := range grounds {
				if b.Land(g.Hex) {
					t.Fatalf("%s seed %d: ground %d names %v, which is land", rs, seed, g.Number, g.Hex)
				}
				ring := g.Hex.Vertices()
				for _, v := range g.V {
					if !slices.Contains(ring[:], v) {
						t.Fatalf("%s seed %d: ground %d names %v, but corner %v is not on its ring",
							rs, seed, g.Number, g.Hex, v)
					}
				}
				// And it is the hex the shore run was computed from, not merely
				// a hex the corners happen to touch.
				if got := shoreRun(b, g.Hex); !slices.Equal(got, g.V) {
					t.Fatalf("%s seed %d: ground %d on %v has corners %v, but its hex's shore run is %v",
						rs, seed, g.Number, g.Hex, g.V, got)
				}
			}
		}
	}
}

// TestViewPublishesGroundHex is the wire assertion, so the client need not
// guess the hex from the ground's corners.
func TestViewPublishesGroundHex(t *testing.T) {
	s, _ := newGame(t, "base+fishermen", 7)
	x := fishExt(s)
	if len(x.Grounds) == 0 {
		t.Fatal("no fishing grounds on a base+fishermen board")
	}
	raw, err := json.Marshal(x.ViewExt(0))
	if err != nil {
		t.Fatal(err)
	}
	var got struct {
		Grounds []struct {
			V      []board.Vertex `json:"v"`
			Hex    *board.Hex     `json:"hex"`
			Number int            `json:"number"`
		} `json:"grounds"`
	}
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	if len(got.Grounds) != len(x.Grounds) {
		t.Fatalf("view has %d grounds, state has %d", len(got.Grounds), len(x.Grounds))
	}
	for i, g := range got.Grounds {
		// A pointer only so a missing key differs from the centre hex {0, 0};
		// the field itself is never null.
		if g.Hex == nil {
			t.Fatalf("ground %d publishes no hex", g.Number)
		}
		if *g.Hex != x.Grounds[i].Hex {
			t.Fatalf("ground %d publishes hex %v, state says %v", g.Number, *g.Hex, x.Grounds[i].Hex)
		}
	}
}

// TestTwoCornerGroundAmbiguous: two adjacent corners of
// a hex are also two adjacent corners of the hex across the edge between them, so
// a two-corner ground's corners name two candidates.
//
// Today a run of exactly two land corners means the rival hex is land, so "take
// the water one" works. That follows from groundCorners being 3 and runs being
// contiguous; if either changes, the rival could be water. This pins the geometry
// so such a change fails here.
func TestTwoCornerGroundAmbiguous(t *testing.T) {
	notch := board.Hex{Q: 0, R: 0}
	ring := notch.Vertices()
	for i := range 6 {
		pair := []board.Vertex{ring[i], ring[(i+1)%6]}
		shared := map[board.Hex]int{}
		for _, v := range pair {
			for _, h := range v.Hexes() {
				shared[h]++
			}
		}
		var both []board.Hex
		for h, n := range shared {
			if n == 2 {
				both = append(both, h)
			}
		}
		if len(both) != 2 {
			t.Fatalf("corners %v of %v are shared by %v, want exactly two hexes", pair, notch, both)
		}
		if !slices.Contains(both, notch) {
			t.Fatalf("fixture: corners %v do not name %v", pair, notch)
		}
	}

	// The property that makes it harmless today, asserted: the old client
	// heuristic ("of the two hexes the corners name, take the water one")
	// must match the hex the engine derived.
	twoCorner := 0
	for _, rs := range groundRulesets {
		for seed := uint64(1); seed <= 40; seed++ {
			b := boardFor(t, rs, 4, seed)
			for _, g := range deriveGrounds(b, groundNumbers) {
				if len(g.V) != 2 {
					continue
				}
				twoCorner++
				var water []board.Hex
				cands := map[board.Hex]int{}
				for _, v := range g.V {
					for _, h := range v.Hexes() {
						cands[h]++
					}
				}
				named := 0
				for h, n := range cands {
					if n != 2 {
						continue
					}
					named++
					if !b.Land(h) {
						water = append(water, h)
					}
				}
				if named != 2 {
					t.Fatalf("%s seed %d: ground %d's corners name %d hexes, want 2", rs, seed, g.Number, named)
				}
				if len(water) != 1 {
					t.Fatalf("%s seed %d: two-corner ground %d on %v has %d water candidates (%v), want 1", rs, seed, g.Number, g.Hex, len(water), water)
				}
				if water[0] != g.Hex {
					t.Fatalf("%s seed %d: ground %d is derived from %v, but its only water candidate is %v",
						rs, seed, g.Number, g.Hex, water[0])
				}
			}
		}
	}
	if twoCorner == 0 {
		t.Fatal("no two-corner ground on any swept board")
	}
}

// TestGroundHexSurvivesTheFold: grounds are derived from the board, so a replay
// must rebuild the identical set, hex included.
func TestGroundHexSurvivesTheFold(t *testing.T) {
	s, log := newGame(t, "base+fishermen", 11)
	live := fishExt(s).Grounds

	replayed := engine.Empty()
	for _, e := range log {
		if err := engine.Apply(replayed, e); err != nil {
			t.Fatal(err)
		}
	}
	got := fishExt(replayed).Grounds
	if len(got) != len(live) {
		t.Fatalf("replay derived %d grounds, live has %d", len(got), len(live))
	}
	for i := range got {
		if got[i].Hex != live[i].Hex || got[i].Number != live[i].Number ||
			!slices.Equal(got[i].V, live[i].V) {
			t.Fatalf("ground %d: replay %+v, live %+v", i, got[i], live[i])
		}
	}
}

// TestEagerSeedingMatchesTheLazyAccessor: the ext is built once when
// EvBoardGenerated folds, so it must equal what a fresh derivation from the same
// board gives, also after a full replay. freshFish and freshCaravans read only
// len(s.Players), s.Board and (for the ground-number shuffle, derivation 12) the
// public seed at engine.FishGroundsSeq, so they are pure functions of the state.
func TestEagerSeedingMatchesTheLazyAccessor(t *testing.T) {
	for _, rs := range []string{"base+fishermen", "base+islands+fishermen"} {
		for seed := uint64(1); seed <= 20; seed++ {
			b := boardFor(t, rs, 4, seed)
			// A fresh derivation from the same board, twice.
			a := deriveGrounds(b, groundNumbers)
			c := deriveGrounds(b, groundNumbers)
			if !reflect.DeepEqual(a, c) {
				t.Fatalf("%s seed %d: deriveGrounds is not a function of the board", rs, seed)
			}

			a = dealGroundNumbers(a, engine.PublicRngForSeed(seed, engine.FishGroundsSeq))

			// The eager path's answer, as InitExtBoard produces it.
			s := &engine.State{Board: b, Players: make([]engine.PlayerState, 4), PublicSeed: seed}
			eager, ok := (Fishermen{}).InitExtBoard(s).(*FishExt)
			if !ok {
				t.Fatalf("%s seed %d: InitExtBoard returned no FishExt", rs, seed)
			}
			if !reflect.DeepEqual(eager.Grounds, a) {
				t.Fatalf("%s seed %d: eager seeding derived %v, the lazy accessor derived %v",
					rs, seed, eager.Grounds, a)
			}
		}
	}
}

// TestFoldSeedsTheExtAtBoardTime: the ext must be in State.Ext as soon as the
// board event has folded, before any player acts, so the board is complete from
// the first frame.
func TestFoldSeedsTheExtAtBoardTime(t *testing.T) {
	log, err := engine.New(engine.GameConfig{Players: 3, Ruleset: "base+fishermen"}, engine.SeedsFrom(3))
	if err != nil {
		t.Fatal(err)
	}
	s := engine.Empty()
	for i, e := range log {
		if err := engine.Apply(s, e); err != nil {
			t.Fatal(err)
		}
		if e.Type != engine.EvBoardGenerated {
			continue
		}
		x, ok := FishStateExt(s)
		if !ok {
			t.Fatalf("event %d (%s): fishermen ext absent", i, e.Type)
		}
		if len(x.Grounds) == 0 {
			t.Fatal("the ext was seeded with no fishing grounds")
		}
		return
	}
	t.Fatal("no board_generated event in the opening log")
}
