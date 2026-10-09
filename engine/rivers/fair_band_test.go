package rivers

import (
	"math"
	"testing"

	"github.com/ftqo/costan.io/engine/board"
)

// pipSpread is the fair-mode balance measure (board.pipImbalance, before the
// band is subtracted): the spread of per-resource average pips over the
// producing hexes. The generator's fair search stops at fairPipBand = 0.34.
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

const fairBand = 0.34

// TestFairModeBoardsStayInTheFairBand: a fair-mode Rivers board is about as
// balanced as the base board it was painted on (docs/rules/rivers.md, "Painting
// the chain"). Painting keeps the channel's dealt terrain, swaps the headwater for
// mountains with the same pips, and board.Rebalance re-runs the number balance.
//
// Not an equality: the swamp removes a hex and its token, which on a 19-hex board
// can leave the fair objective preferring a spread slightly over the band. The
// floor below is the measured rate less a margin, and no board may be far out.
func TestFairModeBoardsStayInTheFairBand(t *testing.T) {
	for _, c := range []struct{ players, seeds, floor int }{
		{4, 40, 34}, {6, 20, 18}, {8, 20, 18},
	} {
		in, worst := 0, 0.0
		for seed := range uint64(c.seeds) {
			s, _ := newGame(t, "base+rivers", c.players, seed)
			sp := pipSpread(s.Board)
			if sp <= fairBand {
				in++
			}
			worst = math.Max(worst, sp)
		}
		if in < c.floor {
			t.Errorf("%dp: %d of %d fair-mode boards inside the %.2f pip band, want at least %d",
				c.players, in, c.seeds, fairBand, c.floor)
		}
		if worst > 0.75 {
			t.Errorf("%dp: a fair-mode board has a per-resource pip spread of %.3f", c.players, worst)
		}
	}
}
