package islands

import (
	"math"
	"testing"

	"github.com/ftqo/costan.io/engine/board"
)

// pipSpread is the fair-mode balance measure: the spread of per-resource
// average pips over the producing hexes (engine/rivers' and engine/scenarios' tests
// use the same one). The generator's fair search stops at 0.34.
func pipSpread(b *board.Board) float64 {
	var sum, count [6]int
	for _, t := range b.Tiles {
		if !t.Res.Producing() {
			continue
		}
		sum[t.Res] += board.Pips(t.Number)
		count[t.Res]++
	}
	lo, hi := math.Inf(1), math.Inf(-1)
	for _, r := range board.Resources {
		if count[r] == 0 {
			continue
		}
		avg := float64(sum[r]) / float64(count[r])
		lo, hi = math.Min(lo, avg), math.Max(hi, avg)
	}
	return hi - lo
}

// TestFairCarvedBoardIsRebalanced: the carve drowns about a sixth of the board
// (and its desert repair takes a token) after the generator balanced numbers
// against terrain, so SetupBoard rebalances a fair board's tokens (derivation
// 13). Every fair carved board must be a fixed point of board.Rebalance.
// Random-mode boards are left as carved, so at least one in the sweep is not.
func TestFairCarvedBoardIsRebalanced(t *testing.T) {
	all := func(board.Hex) bool { return true }
	randomMoved := 0
	var spread float64
	boards := 0
	for players := 2; players <= 10; players++ {
		for seed := uint64(1); seed <= 12; seed++ {
			b := proceduralBoard(t, players, seed, board.BoardFair)
			again := b.Clone()
			again.Rebalance(all)
			for h, tl := range again.Tiles {
				if b.Tiles[h] != tl {
					t.Fatalf("%dp seed %d: fair board is not rebalanced: %v is %+v, Rebalance makes it %+v", players, seed, h, b.Tiles[h], tl)
				}
			}
			spread += pipSpread(b)
			boards++

			r := proceduralBoard(t, players, seed, board.BoardRandom)
			ragain := r.Clone()
			ragain.Rebalance(all)
			for h, tl := range ragain.Tiles {
				if r.Tiles[h] != tl {
					randomMoved++
					break
				}
			}
		}
	}
	if randomMoved == 0 {
		t.Error("every random-mode board is a Rebalance fixed point")
	}
	t.Logf("%d fair boards, mean pip spread %.3f; %d random boards Rebalance would still move", boards, spread/float64(boards), randomMoved)
}
