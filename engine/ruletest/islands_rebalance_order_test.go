package ruletest

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/raiders"
	"github.com/ftqo/costan.io/engine/rivers"
	"github.com/ftqo/costan.io/engine/scenarios"
)

// TestIslandsRebalanceBeforeFinishers pins where the fair-mode rebalance
// after the Islands carve sits (derivation 13): at the end of islands.SetupBoard,
// so every BoardFinisher that reads tokens (the Caravans oasis, the Raiders castle,
// the Rivers headwater swap) sees the balanced board.
//
// A plain base+islands board is what those finishers are handed (their
// SetupBoard hooks are empty and Islands has no finisher), so running a finisher
// on it by hand, on the engine's stream, must reproduce the composed board. With
// the rebalance after the finishers it would be Rebalance(finish(unbalanced)).
func TestIslandsRebalanceBeforeFinishers(t *testing.T) {
	finishers := []struct {
		name string
		f    engine.BoardFinisher
	}{
		{"caravans", scenarios.Caravans{}},
		{"raiders", raiders.Module{}},
		{"rivers", rivers.Module{}},
	}
	for _, fin := range finishers {
		rs := engine.CanonicalRuleset("base+islands+" + fin.name)
		for _, players := range []int{3, 4, 6, 8} {
			for seed := uint64(1); seed <= 4; seed++ {
				pre := newBoardState(t, engine.GameConfig{Players: players, Ruleset: "base+islands", BoardMode: board.BoardFair}, seed).Board.Clone()
				cfg := engine.GameConfig{Players: players, Ruleset: rs, BoardMode: board.BoardFair}
				want := newBoardState(t, cfg, seed).Board
				seq := 3 // the shared finisher slot (engine.boardFinishSeq)
				if s, ok := fin.f.(engine.BoardFinisherSlot); ok {
					seq = s.FinishBoardSeq()
				}
				fin.f.FinishBoard(pre, cfg, engine.PublicRngForSeed(seed, seq))
				for h, tl := range want.Tiles {
					if pre.Tiles[h] != tl {
						t.Fatalf("%s %dp seed %d: %v is %+v composed, %+v when %s finishes the rebalanced Islands board",
							rs, players, seed, h, tl, pre.Tiles[h], fin.name)
					}
				}
			}
		}
	}
}
