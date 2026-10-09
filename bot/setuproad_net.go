package bot

import (
	_ "embed"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// The opening road, cloned from human play. Pairs with the settlement clone.
//
// Trained on 322632 opening roads: which of the 2-3 edges touching the
// settlement just placed a strong player actually took. It picks theirs 67.0% of
// the time, where the best heuristic (point toward open space) gets 46.8% and
// random 33.5%.
//
// "Point at the richest far corner", which is roughly what setupRoad does,
// scores 0.232, below random. See WithRoadOpens.
//
// Features must match the training order, which setuproad_net.json records in
// its "features" list.

//go:embed setuproad_net.json
var setupRoadNetJSON []byte

const setupRoadFeatures = 16

var setupRoadNet = newLazyNet(&setupRoadNetJSON, setupRoadFeatures, "setup road net")

// setupRoadNetPick scores each legal opening road with the cloned network.
func (b *Strong) setupRoadNetPick(s *engine.State, seat engine.PlayerID) (engine.Command, bool) {
	net, err := setupRoadNet.get()
	if err != nil {
		return engine.Command{}, false
	}
	from := s.LastSettlement
	best, bestScore, found := board.Edge{}, -1e18, false
	var x [setupRoadFeatures]float64
	// Same list the engine would accept; see engine.LegalSetupRoads.
	for _, e := range engine.LegalSetupRoads(s) {
		if sc := net.score(b.setupRoadInputs(s, seat, e, from, x[:0])); sc > bestScore {
			bestScore, best, found = sc, e, true
		}
	}
	if !found {
		return engine.Command{}, false
	}
	return engine.Command{Player: seat, Type: engine.CmdPlaceRoad,
		Data: raw2(map[string]any{"e": best})}, true
}

// setupRoadInputs describes where the road points, not the road itself: a road
// is worth what it reaches. Order is fixed by setuproad_net.json's "features".
func (b *Strong) setupRoadInputs(s *engine.State, seat engine.PlayerID,
	e board.Edge, from board.Vertex, x []float64) []float64 {
	bi := b.cache(s)
	far := e.Other(from)
	vi := bi.vert[far]
	if vi == nil {
		// Off-board: fill zeros rather than leaving stale buffer contents.
		for len(x) < setupRoadFeatures {
			x = append(x, 0)
		}
		return x
	}

	have := perResourcePips(s, seat)
	farPips, farDistinct, farNew := 0.0, 0.0, 0.0
	for _, r := range board.Resources {
		p := float64(vi.resPips[r])
		farPips += p
		if p > 0 {
			farDistinct++
			if have[r] == 0 {
				farNew++
			}
		}
	}
	farBuildable := btof(engine.CheckSettlementSpot(s, far) == nil)
	farPort := btof(vi.harbor != nil)
	farDist := b.placementDist(s, seat, far)

	// What lies one hop beyond, through that corner.
	beyondPips, beyondDistinct, beyondN := 0.0, 0.0, 0.0
	for _, c2 := range far.Neighbors() {
		if c2 == from {
			continue
		}
		vi2 := bi.vert[c2]
		if vi2 == nil || engine.CheckSettlementSpot(s, c2) != nil {
			continue
		}
		beyondN++
		p := 0.0
		d := 0.0
		for _, r := range board.Resources {
			if v := float64(vi2.resPips[r]); v > 0 {
				p += v
				d++
			}
		}
		if p > beyondPips {
			beyondPips, beyondDistinct = p, d
		}
	}

	oppNear, ownNear := 0.0, 0.0
	for _, e2 := range far.Edges() {
		if o, taken := s.Roads[e2]; taken {
			if o == seat {
				ownNear++
			} else {
				oppNear++
			}
		}
	}
	openSpace := 0.0
	for _, c2 := range far.Neighbors() {
		if bi.vert[c2] != nil && engine.CheckSettlementSpot(s, c2) == nil {
			openSpace++
		}
	}

	owned, myPips, myDistinct := 0, 0.0, 0.0
	for _, bld := range s.Buildings {
		if bld.Owner == seat {
			owned++
		}
	}
	for _, r := range board.Resources {
		myPips += have[r]
		if have[r] > 0 {
			myDistinct++
		}
	}

	x = append(x, farPips, farDistinct, farNew, farBuildable, farPort, farDist,
		beyondPips, beyondDistinct, beyondN, oppNear, ownNear, openSpace,
		// pick_index is the road's 0-based index. s.Buildings already contains the
		// settlement this road pairs with, so it runs one ahead.
		float64(len(s.Buildings)-1), btof(owned >= 2), myPips, myDistinct)
	return x
}
