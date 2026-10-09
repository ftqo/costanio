package scenarios

import (
	"slices"
	"strings"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	_ "github.com/ftqo/costan.io/engine/islands"
)

// TestOasisSpokesAreNeverStraits: a caravan starts on land. Spokes are derived
// with board.LandEdge (one of the edge's two hexes is land), not "each end
// touches land", which passes a strait between two sea hexes. Derivation 12.
// Seed 2 is first in the sweep because it had a strait spoke (oasis (-1,0)).
func TestOasisSpokesAreNeverStraits(t *testing.T) {
	var rulesets []string
	for _, rs := range engine.ValidRulesets() {
		if slices.Contains(strings.Split(rs, "+"), CaravansName) {
			rulesets = append(rulesets, rs)
		}
	}
	checked := 0
	for _, rs := range rulesets {
		players := []int{4}
		seeds := uint64(6)
		if slices.Contains(strings.Split(rs, "+"), "islands") {
			players, seeds = []int{3, 4, 6}, 24
		}
		for _, n := range players {
			for seed := uint64(1); seed <= seeds; seed++ {
				cfg := engine.GameConfig{
					Players: n, Ruleset: rs, DiceMode: "fair",
					BoardMode: board.BoardFair, TurnOrder: engine.TurnOrderRandom,
				}
				evs, err := engine.New(cfg, engine.SeedsFrom(seed))
				if err != nil {
					t.Fatalf("%s/%dp seed %d: %v", rs, n, seed, err)
				}
				s, err := engine.Replay(evs)
				if err != nil {
					t.Fatal(err)
				}
				x := caravansExtRO(s)
				if !x.HasOasis {
					continue
				}
				for i, a := range x.Arrows {
					if a == (board.Edge{}) {
						continue
					}
					checked++
					if !s.Board.LandEdge(a) {
						t.Errorf("%s/%dp seed %d: caravan %d starts on %v, no land neighbour (oasis %v)",
							rs, n, seed, i, a, x.Oasis)
					}
				}
			}
		}
	}
	if checked == 0 {
		t.Fatal("no spoke was checked")
	}
}
