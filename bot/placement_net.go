package bot

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"sync"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// A placement scorer cloned from human play.
//
// Trained on 322632 opening placements from 40329 strong human games: every
// corner a player chose, alongside the ~41 legal alternatives they rejected. One
// small network scores a single corner and is applied to each candidate in turn,
// so it learned "how good is this corner, in context", the same shape as
// setupVertexScore, and cheap enough to run on 54 corners (20 -> 96 -> 96 -> 1,
// about 20k multiply-adds a corner).
//
// On held-out games it picks the exact corner a human picked 50.7% of the time
// against 41 options, where "most pips" gets 34.6% and a pips-plus-diversity
// rule close to our own scorer gets 36.0%. Top-3 covers 82.7%.
//
// It is the default because it also beats setupVertexScore on the pool. See
// WithLearnedPlacement.
//
// The features must match the training order (placement_net.json's "features"
// list). Resource slots are Wood, Brick, Sheep, Wheat, Ore (board.Resources),
// which was verified against the training data's build costs and tile counts.
// A wrong mapping would silently permute the learned weights.

//go:embed placement_net.json
var placementNetJSON []byte

const placementFeatures = 20

type netLayer struct {
	W [][]float64 `json:"w"`
	B []float64   `json:"b"`
}

type placementNet struct {
	Mu     []float64  `json:"mu"`
	Sd     []float64  `json:"sd"`
	Names  []string   `json:"features"`
	Layers []netLayer `json:"layers"`
}

// lazyNet parses an embedded net once, on first use, and validates its shape
// against what the calling code builds. Shared by every cloned policy.
//
// The parsed net is shared by bots running concurrently, so it must hold no
// scratch buffers.
type lazyNet struct {
	raw   *[]byte
	feats int
	name  string
	once  sync.Once
	net   *placementNet
	err   error
}

func newLazyNet(raw *[]byte, feats int, name string) *lazyNet {
	return &lazyNet{raw: raw, feats: feats, name: name}
}

func (l *lazyNet) get() (*placementNet, error) {
	l.once.Do(func() {
		n := &placementNet{}
		if err := json.Unmarshal(*l.raw, n); err != nil {
			l.err = fmt.Errorf("%s: %w", l.name, err)
			return
		}
		if len(n.Mu) != l.feats || len(n.Sd) != l.feats {
			l.err = fmt.Errorf("%s: %d features, want %d", l.name, len(n.Mu), l.feats)
			return
		}
		if len(n.Layers) == 0 || len(n.Layers[len(n.Layers)-1].B) != 1 {
			l.err = fmt.Errorf("%s: last layer must produce one score", l.name)
			return
		}
		for i, v := range n.Sd {
			if v <= 0 {
				l.err = fmt.Errorf("%s: feature %d has non-positive sd", l.name, i)
				return
			}
		}
		l.net = n
	})
	return l.net, l.err
}

var placementLazy = newLazyNet(&placementNetJSON, placementFeatures, "placement net")

func placementNetwork() (*placementNet, error) { return placementLazy.get() }

// score standardizes raw features the way training did, then runs the net.
func (n *placementNet) score(x []float64) float64 {
	z := make([]float64, len(x))
	for i := range x {
		z[i] = (x[i] - n.Mu[i]) / n.Sd[i]
	}
	return n.forward(z)
}

// forward runs the shared corner scorer. ReLU on every layer but the last.
func (n *placementNet) forward(x []float64) float64 {
	cur := x
	for i, l := range n.Layers {
		out := make([]float64, len(l.B))
		for j := range l.B {
			s := l.B[j]
			row := l.W[j]
			for k, v := range cur {
				s += row[k] * v
			}
			if i < len(n.Layers)-1 && s < 0 {
				s = 0 // ReLU
			}
			out[j] = s
		}
		cur = out
	}
	return cur[0]
}

// placementDist returns hops from v to the nearest opponent building, capped at
// 4 and reported as 9 beyond that. Must mirror the bounded search in
// policy_data.py, which the network was trained on.
func (b *Strong) placementDist(s *engine.State, seat engine.PlayerID, v board.Vertex) float64 {
	bi := b.cache(s)
	frontier := []board.Vertex{v}
	seen := map[board.Vertex]bool{v: true}
	for d := 1; d <= 4; d++ {
		var next []board.Vertex
		for _, u := range frontier {
			vi := bi.vert[u]
			if vi == nil {
				continue
			}
			for _, w := range vi.neighbors {
				if seen[w] {
					continue
				}
				seen[w] = true
				next = append(next, w)
				if bld, ok := s.Buildings[w]; ok && bld.Owner != seat {
					return float64(d)
				}
			}
		}
		frontier = next
		if len(frontier) == 0 {
			break
		}
	}
	return 9
}

// placementInputs fills the feature vector for one candidate corner. The order
// is fixed by the trained net (placement_net.json's "features") and must not
// be rearranged.
func (b *Strong) placementInputs(s *engine.State, seat engine.PlayerID, v board.Vertex) []float64 {
	bi := b.cache(s)
	vi := bi.vert[v]
	var arr [placementFeatures]float64
	x := arr[:0]

	have := perResourcePips(s, seat)
	total, distinct, newRes, high := 0.0, 0.0, 0.0, 0.0
	for _, r := range board.Resources {
		p := float64(vi.resPips[r])
		x = append(x, p)
		total += p
		if p > 0 {
			distinct++
			if have[r] == 0 {
				newRes++
			}
		}
	}
	nHexes, desert := 0.0, 0.0
	for _, h := range vi.hexes {
		if !s.Board.Land(h) {
			continue
		}
		t := s.Board.Tiles[h]
		nHexes++
		if t.Res == board.ResNone {
			desert = 1
		}
		if t.Number == 6 || t.Number == 8 {
			high += float64(6 - abs(7-t.Number))
		}
	}
	portAny, port2, portMatch := 0.0, 0.0, 0.0
	if vi.harbor != nil {
		portAny = 1
		if vi.harbor.Ratio == 2 {
			port2 = 1
			if vi.resPips[vi.harbor.Res] > 0 || have[vi.harbor.Res] > 0 {
				portMatch = 1
			}
		}
	}
	unionPips, unionDistinct := 0.0, 0.0
	for _, r := range board.Resources {
		u := have[r] + float64(vi.resPips[r])
		unionPips += u
		if u > 0 {
			unionDistinct++
		}
	}
	placed, owned := 0.0, 0.0
	for _, bld := range s.Buildings {
		placed++
		if bld.Owner == seat {
			owned++
		}
	}
	dist := b.placementDist(s, seat, v)
	blocks := 0.0
	if dist == 1 {
		blocks = 1
	}
	isSecond := 0.0
	if owned > 0 {
		isSecond = 1
	}

	x = append(x, total, nHexes, distinct, desert, portAny, port2, portMatch,
		high, newRes, unionPips, unionDistinct, dist, blocks, placed, isSecond)
	return x
}

// placementScore standardizes the features the way training did, then scores.
func (b *Strong) placementScore(s *engine.State, seat engine.PlayerID, v board.Vertex) float64 {
	net, err := placementNetwork()
	if err != nil {
		return 0
	}
	return net.score(b.placementInputs(s, seat, v))
}
