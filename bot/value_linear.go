package bot

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"sync"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// A win-probability term learned from human games, added to the evaluator.
//
// Unlike the other clones, which each replace one decision, this enters eval()
// and so prices every candidate. It is weighted; a zero weight reproduces the
// previous evaluator exactly.
//
// The linear model is used rather than the MLP: validation Brier 0.1643 vs
// 0.1621 on 40329 held-out games, at 50 multiply-adds a call instead of 111232.
//
// The model predicts an outcome, while the evaluator chooses a move, so its
// individual coefficients are not move advice (three hypotheses read off them
// failed on the ladder). Whether the whole term helps is for the ladder to say.
//
// Public information only, as in training: piece counts, production pips,
// visible VP, dev cards played, and hand size. Never hand contents or unplayed
// VP cards.
//
// eval runs hundreds of times a move, so cost matters. Features are computed in
// one pass by owner, and longest road and harbor features were dropped (no
// measurable loss, Brier 0.1642 with 41 features).

//go:embed value_linear.json
var valueLinearJSON []byte

const valueFeatures = 41

// perPlayerFeatures is the block repeated for me / max-opponent / mean-opponent.
const perPlayerFeatures = 13

type linearModel struct {
	Mu    []float64 `json:"mu"`
	Sd    []float64 `json:"sd"`
	Names []string  `json:"features"`
	W     []float64 `json:"w"`
	B     float64   `json:"b"`
}

var (
	valueLinearOnce sync.Once
	valueLinear     *linearModel
	valueLinearErr  error
)

func valueLinearModel() (*linearModel, error) {
	valueLinearOnce.Do(func() {
		m := &linearModel{}
		if err := json.Unmarshal(valueLinearJSON, m); err != nil {
			valueLinearErr = fmt.Errorf("value linear: %w", err)
			return
		}
		if len(m.W) != valueFeatures || len(m.Mu) != valueFeatures {
			valueLinearErr = fmt.Errorf("value linear: %d weights, want %d", len(m.W), valueFeatures)
			return
		}
		valueLinear = m
	})
	return valueLinear, valueLinearErr
}

// allBlocks fills the 16 public facts for every seat in one pass, indexed by
// owner (a pass per seat was too slow for eval's hot path).
func (b *Strong) allBlocks(s *engine.State, out *[][perPlayerFeatures]float64) {
	bi := b.cache(s)
	n := len(s.Players)
	if cap(*out) < n {
		*out = make([][perPlayerFeatures]float64, n)
	}
	*out = (*out)[:n]
	for i := range *out {
		(*out)[i] = [perPlayerFeatures]float64{}
	}
	blocks := *out

	for v, bld := range s.Buildings {
		o := int(bld.Owner)
		if o < 0 || o >= n {
			continue
		}
		mult := 1.0
		if bld.City {
			mult = 2
			blocks[o][7]++ // cities
		} else {
			blocks[o][6]++ // settlements
		}
		vi := bi.vert[v]
		if vi == nil {
			continue
		}
		for i, r := range board.Resources {
			p := mult * float64(vi.resPips[r])
			blocks[o][i] += p
			blocks[o][5] += p // total
		}
	}
	for _, o := range s.Roads {
		if int(o) >= 0 && int(o) < n {
			blocks[o][8]++
		}
	}
	for p := range s.Players {
		q := engine.PlayerID(p)
		blocks[p][9] = float64(s.PublicVP(q))
		blocks[p][10] = float64(s.Players[p].KnightsPlayed)
		blocks[p][11] = float64(s.Players[p].DevCards.Count())
		hand := 0
		for _, r := range board.Resources {
			hand += s.Players[p].Hand[r]
		}
		blocks[p][12] = float64(hand)
	}
}

// valueLinearScore returns the model's log-odds that this seat wins.
//
// Log-odds rather than probability: the evaluator is a sum of unbounded terms,
// and a probability would saturate where games are decided.
func (b *Strong) valueLinearScore(s *engine.State, seat engine.PlayerID) float64 {
	m, err := valueLinearModel()
	if err != nil {
		return 0
	}
	b.allBlocks(s, &b.vlBlocks)
	blocks := b.vlBlocks
	if int(seat) >= len(blocks) {
		return 0
	}

	// Opponents enter as order-invariant summaries: the model should not care
	// which seat is which, only how the field is doing.
	var maxB, sumB [perPlayerFeatures]float64
	n := 0
	for p := range blocks {
		if engine.PlayerID(p) == seat {
			continue
		}
		for i, v := range blocks[p] {
			if n == 0 || v > maxB[i] {
				maxB[i] = v
			}
			sumB[i] += v
		}
		n++
	}
	if n == 0 {
		return 0
	}

	me := blocks[seat]
	z := m.B
	add := func(off int, v float64) {
		z += m.W[off] * (v - m.Mu[off]) / m.Sd[off]
	}
	for i := range perPlayerFeatures {
		add(i, me[i])
		add(perPlayerFeatures+i, maxB[i])
		add(2*perPlayerFeatures+i, sumB[i]/float64(n))
	}
	add(3*perPlayerFeatures, float64(s.TurnsCompleted))
	add(3*perPlayerFeatures+1, btof(s.Cur == seat))
	return z
}
