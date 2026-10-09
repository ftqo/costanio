package ruletest

import (
	"slices"
	"strings"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	_ "github.com/ftqo/costan.io/engine/harbormaster"
	"github.com/ftqo/costan.io/engine/wagons"
)

// docs/rules/wagons.md, "Harbours on a trade hex": trade hexes are outer-ring
// capes whose two sea-only corners are blocked for building, and the base
// generator lays harbours out before the trade hexes are chosen. A harbour with
// both ends on those corners could never hold a building, so it was useless for
// trade and, under Harbormaster, scored for nobody.
//
// Wagons' FinishBoard slides such a harbour one edge along the coast onto a
// seaward edge of the same cape with a buildable corner. This asserts that on an
// empty setup board every harbour has a corner a first settlement may use, across
// every Wagons ruleset that deals harbours, on the procedural board and the
// lobby's silhouette.
func TestWagonsTradeHexesStrandNoHarbour(t *testing.T) {
	var rulesets []string
	for _, rs := range engine.ValidRulesets() {
		parts := strings.Split(rs, "+")
		if slices.Contains(parts, wagons.WagonsName) && len(parts) <= 4 {
			rulesets = append(rulesets, rs)
		}
	}
	for _, want := range []string{"base+wagons", "base+harbormaster+wagons"} {
		if !slices.Contains(rulesets, want) {
			t.Fatalf("%s is not a valid ruleset", want)
		}
	}
	games := 0
	for _, rs := range rulesets {
		seeds := uint64(4)
		if rs == "base+wagons" || rs == "base+harbormaster+wagons" {
			seeds = 40 // the measured sweep
		}
		for _, inline := range []bool{false, true} {
			for seed := uint64(1); seed <= seeds; seed++ {
				for _, players := range []int{3, 4, 6, 8} {
					cfg := engine.GameConfig{Players: players, Ruleset: rs}
					if inline {
						cfg.Board = silhouette(players)
					}
					s := newBoardState(t, cfg, seed)
					games++
					if s.Phase != engine.PhaseSetup || len(s.Buildings) != 0 {
						t.Fatalf("%s seed %d %dp: want an empty setup board, got phase %v with %d buildings",
							rs, seed, players, s.Phase, len(s.Buildings))
					}
					x, ok := wagons.StateExt(s)
					if !ok || !x.HasTrade {
						t.Fatalf("%s seed %d %dp: no trade hexes", rs, seed, players)
					}
					if len(s.Board.Harbors) == 0 {
						t.Fatalf("%s seed %d %dp: no harbours at all", rs, seed, players)
					}
					// The slide keeps the generator's own harbour rules: no two
					// harbours share a corner, and no two docks one sea hex.
					corners, docks := map[board.Vertex]bool{}, map[board.Hex]bool{}
					for _, h := range s.Board.Harbors {
						sea, ok := s.Board.HarborSeaHex(h)
						if !ok || docks[sea] || corners[h.Verts[0]] || corners[h.Verts[1]] {
							t.Fatalf("%s/inline=%v seed %d %dp: harbour %v breaks the spacing rules (dock %v ok=%v)",
								rs, inline, seed, players, h.Verts, sea, ok)
						}
						docks[sea], corners[h.Verts[0]], corners[h.Verts[1]] = true, true, true
					}
					// On an empty setup board every buildable vertex is a legal
					// first settlement, so a harbour with neither corner in this
					// set can never hold a building.
					legal := s.LegalSettlements(s.Cur)
					for _, h := range s.Board.Harbors {
						if slices.Contains(legal, h.Verts[0]) || slices.Contains(legal, h.Verts[1]) {
							continue
						}
						t.Errorf("%s/inline=%v seed %d %dp: harbour %v is unbuildable (trade hexes %v, touches one: %v)",
							rs, inline, seed, players, h.Verts, x.Trade, touchesAny(h, x.Trade[:]))
					}
				}
			}
		}
	}
	t.Logf("%d games over %d rulesets", games, len(rulesets))
}

func touchesAny(h board.Harbor, hexes []board.Hex) bool {
	for _, v := range h.Verts {
		for _, vh := range v.Hexes() {
			if slices.Contains(hexes, vh) {
				return true
			}
		}
	}
	return false
}
