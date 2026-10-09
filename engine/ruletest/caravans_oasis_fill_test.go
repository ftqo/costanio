package ruletest

import (
	"slices"
	"strings"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/scenarios"
)

// caravansRulesets is every valid ruleset of one to three modules with
// Caravans in it: Caravans beside Islands' carve and any one other module.
// Wider compositions behave the same.
func caravansRulesets(t *testing.T) []string {
	t.Helper()
	var out []string
	for _, rs := range engine.ValidRulesets() {
		parts := strings.Split(rs, "+")
		if slices.Contains(parts, "caravans") && len(parts) <= 4 {
			out = append(out, rs)
		}
	}
	if len(out) == 0 {
		t.Fatal("no valid ruleset carries Caravans")
	}
	return out
}

// TestEveryCaravansTableGetsItsOases: five or more seats play with two oases,
// seven and up with three (scenarios.OasisCount), and the Islands carve can drown a
// desert. finishOasis promotes a producing hex for each missing oasis, so every
// Caravans board at 5 to 10 seats starts with the full count, each with all
// three caravans and the matching camel supply.
//
// Six seeds per table size on Islands compositions, where the carve is, and two
// on the rest, where no desert is drowned.
//
// Spokes are counted but not failed on: a board where the swaps find no partner
// keeps an outer-ring oasis with fewer than three spokes (stuck in finishOasis).
// The count is logged so it cannot grow unseen.
func TestEveryCaravansTableGetsItsOases(t *testing.T) {
	boards, short, islandsBoards, spokeShort := 0, 0, 0, 0
	for i, rs := range caravansRulesets(t) {
		islands := slices.Contains(strings.Split(rs, "+"), "islands")
		for _, inline := range []bool{false, true} {
			if inline && islands {
				continue // an all-land silhouette is not an Islands map
			}
			for players := 5; players <= 10; players++ {
				seeds := uint64(2)
				if islands {
					seeds = 6
				}
				for k := range seeds {
					seed := uint64(7000+i*131) + k*17 + uint64(players)
					cfg := engine.GameConfig{Players: players, Ruleset: rs}
					if inline {
						cfg.Board = silhouette(players)
					}
					s := newBoardState(t, cfg, seed)
					boards++
					if islands {
						islandsBoards++
					}
					x, ok := scenarios.CaravansStateExt(s)
					if !ok {
						t.Fatalf("%s/%dp seed %d: no Caravans ext", rs, players, seed)
					}
					want := scenarios.OasisCount(players)
					if len(x.Oases) != want {
						short++
						t.Errorf("%s/%dp/inline=%v seed %d: %d oases, want %d", rs, players, inline, seed, len(x.Oases), want)
						continue
					}
					if x.Supply() != 22+11*(want-1) {
						t.Errorf("%s/%dp seed %d: %d camels for %d oases", rs, players, seed, x.Supply(), want)
					}
					for j, a := range x.Arrows {
						if a == (board.Edge{}) {
							spokeShort++
							t.Logf("%s/%dp seed %d: caravan %d has no spoke (a stuck ring oasis)", rs, players, seed, j)
						} else if !s.Board.LandEdge(a) {
							t.Errorf("%s/%dp seed %d: caravan %d starts on water (%v)", rs, players, seed, j, a)
						}
					}
					for _, o := range x.Oases {
						tile := s.Board.Tiles[o]
						if (tile.Res != board.ResNone && tile.Res != board.Lake) || tile.Number != 0 {
							t.Errorf("%s/%dp seed %d: oasis %v is %v with number %d", rs, players, seed, o, tile.Res, tile.Number)
						}
					}
				}
			}
		}
	}
	t.Logf("%d boards (%d Islands), %d an oasis short, %d caravans without a spoke", boards, islandsBoards, short, spokeShort)
}
