package sim

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// TestHarborDocksNeverShareAHex is the broad, cheap form of the one-dock-per-hex
// invariant: it only needs the board, which the seeded setup events determine,
// so it sweeps every ruleset across many seeds and player counts without
// playing a turn.
//
// A harbor travels as an edge with a ratio, but its dock stands on the water
// hex beside that edge, so two harbors on one hex would put two docks in one
// place.
func TestHarborDocksNeverShareAHex(t *testing.T) {
	// Through canonical(): module SetupBoard hooks, which are all this test
	// looks at, run in ruleset-string order. See canonical_test.go.
	rulesets := canonical([]string{
		"base",
		"base+islands",
		"base+cak",
		"base+islands+cak",
		"base+fishermen",
		"base+caravans",
		"base+fishermen+caravans",
	})
	// Scaled rather than skipped: the cheap 25-seed sweep is board generation
	// only (no turns played), and it is the version that runs by default.
	seeds := uint64(25)
	if slowEnabled() {
		seeds = 300
	}
	for _, rs := range rulesets {
		t.Run(rs, func(t *testing.T) {
			for _, players := range []int{3, 4, 6, 8, 10} {
				for seed := range seeds {
					b := setupBoard(t, rs, players, seed)
					docks := map[board.Hex]board.Harbor{}
					for _, h := range b.Harbors {
						sea, ok := b.HarborSeaHex(h)
						if !ok {
							t.Fatalf("%s p%d seed %d: harbor %v has no single water side",
								rs, players, seed, h.Verts)
						}
						if prev, dup := docks[sea]; dup {
							t.Fatalf("%s p%d seed %d: harbors %v and %v both dock on %v",
								rs, players, seed, prev.Verts, h.Verts, sea)
						}
						docks[sea] = h
					}
					if len(b.Harbors) == 0 {
						t.Fatalf("%s p%d seed %d: board has no harbors at all", rs, players, seed)
					}
				}
			}
		})
	}
}

// setupBoard folds a game's seeded setup events into a state and returns the
// board they produced, no turns played.
func setupBoard(t *testing.T, ruleset string, players int, seed uint64) *board.Board {
	t.Helper()
	log, err := engine.New(engine.GameConfig{Players: players, Ruleset: ruleset, TargetVP: 10}, engine.SeedsFrom(seed))
	if err != nil {
		t.Fatalf("%s p%d seed %d: New: %v", ruleset, players, seed, err)
	}
	s := engine.Empty()
	for _, e := range log {
		if err := engine.Apply(s, e); err != nil {
			t.Fatalf("%s p%d seed %d: Apply: %v", ruleset, players, seed, err)
		}
	}
	return s.Board
}
