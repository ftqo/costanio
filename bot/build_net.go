package bot

import (
	_ "embed"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// A build chooser cloned from human play.
//
// Trained on 2357092 in-turn decisions from the same 40329 games: every road,
// settlement, city and development card a strong player bought, and every
// point where they stopped, each with the legal alternatives. It picks the
// human's choice 67.2% of the time against a mean of 7.6 options ("take the
// most production available" gets 48.6%).
//
// Ending the turn is a candidate like any other, so the net can learn when to
// hold resources, which self-play does not teach. It also sees roads without
// the hand-written road gate, so the ladder can test that gate.
//
// Features must match the training order, recorded in build_net.json's
// "features" list.

//go:embed build_net.json
var buildNetJSON []byte

const buildFeatures = 26

var buildNet = newLazyNet(&buildNetJSON, buildFeatures, "build net")

// buildKind mirrors the action one-hot the network was trained on.
type buildKind int

const (
	kindRoad buildKind = iota
	kindSettlement
	kindCity
	kindDev
	kindEnd
)

type buildCand struct {
	kind buildKind
	cmd  engine.Command
	v    board.Vertex
	e    board.Edge
}

// buildNetPick ranks the five build actions and returns the best. The bool
// reports whether the pick is a build: false means the network chose to stop,
// which the caller must honor.
func (b *Strong) buildNetPick(s *engine.State, seat engine.PlayerID) (engine.Command, bool) {
	net, err := buildNet.get()
	if err != nil {
		return engine.Command{}, false
	}
	cands := b.buildCandidates(s, seat)
	if len(cands) < 2 {
		return engine.Command{}, false
	}
	best, bestScore := -1, -1e18
	var x [buildFeatures]float64
	for i, c := range cands {
		b.buildInputs(s, seat, c, x[:0])
		if sc := net.score(x[:buildFeatures]); sc > bestScore {
			best, bestScore = i, sc
		}
	}
	if best < 0 || cands[best].kind == kindEnd {
		return engine.Command{}, false
	}
	return cands[best].cmd, true
}

// buildCandidates enumerates the legal build actions plus ending the turn.
//
// Roads are not filtered by the hand-written gate, so the network ranks the
// same set a human chose from.
func (b *Strong) buildCandidates(s *engine.State, seat engine.PlayerID) []buildCand {
	hand := s.Players[seat].Hand
	out := []buildCand{{kind: kindEnd}}
	if hand.Has(engine.CostCity) {
		for _, v := range ownSettlements(s, seat) {
			out = append(out, buildCand{kind: kindCity, v: v,
				cmd: engine.Command{Player: seat, Type: engine.CmdBuildCity, Data: raw2(builtV(v))}})
		}
	}
	if hand.Has(engine.CostSettlement) {
		for _, v := range b.frontierVertices(s, seat) {
			if engine.CheckSettlementSpot(s, v) != nil {
				continue
			}
			out = append(out, buildCand{kind: kindSettlement, v: v,
				cmd: engine.Command{Player: seat, Type: engine.CmdBuildSettlement, Data: raw2(builtV(v))}})
		}
	}
	if hand.Has(engine.CostRoad) {
		for _, e := range b.frontierEdges(s, seat) {
			out = append(out, buildCand{kind: kindRoad, e: e,
				cmd: engine.Command{Player: seat, Type: engine.CmdBuildRoad, Data: raw2(builtE(e))}})
		}
	}
	if hand.Has(engine.CostDevCard) && s.DevDeck.Count() > 0 {
		out = append(out, buildCand{kind: kindDev,
			cmd: engine.Command{Player: seat, Type: engine.CmdBuyDevCard}})
	}
	return out
}

// buildInputs fills the feature vector for one candidate, in the trained
// order (build_net.json's "features"). It reads only the acting seat's own
// hand and public board facts.
func (b *Strong) buildInputs(s *engine.State, seat engine.PlayerID, c buildCand, x []float64) []float64 {
	bi := b.cache(s)
	hand := s.Players[seat].Hand

	var cost engine.Hand
	switch c.kind {
	case kindRoad:
		cost = engine.CostRoad
	case kindSettlement:
		cost = engine.CostSettlement
	case kindCity:
		cost = engine.CostCity
	case kindDev:
		cost = engine.CostDevCard
	case kindEnd:
		// Ending the turn costs nothing; the zero Hand is correct.
	}

	x = append(x,
		btof(c.kind == kindRoad), btof(c.kind == kindSettlement),
		btof(c.kind == kindCity), btof(c.kind == kindDev), btof(c.kind == kindEnd))

	pipsGained, newDistinct, opens, port := 0.0, 0.0, 0.0, 0.0
	dist := 9.0
	vpAfter := float64(s.PublicVP(seat))
	have := perResourcePips(s, seat)
	switch c.kind {
	case kindSettlement, kindCity:
		vi := bi.vert[c.v]
		for _, r := range board.Resources {
			p := float64(vi.resPips[r])
			pipsGained += p
			if p > 0 && have[r] == 0 {
				newDistinct++
			}
		}
		if c.kind == kindSettlement && vi.harbor != nil {
			port = 1
		}
		dist = b.placementDist(s, seat, c.v)
		vpAfter++
	case kindDev, kindEnd:
		// Neither touches the board, so every positional feature stays zero.
	case kindRoad:
		for _, v := range []board.Vertex{c.e.A, c.e.B} {
			if _, taken := s.Buildings[v]; !taken && engine.CheckSettlementSpot(s, v) == nil {
				opens++
			}
			if d := b.placementDist(s, seat, v); d < dist {
				dist = d
			}
		}
	}

	after := 0
	var left [6]float64
	for _, r := range board.Resources {
		n := hand[r] - cost[r]
		left[r] = float64(n)
		after += n
	}

	leader := 0
	for p := range s.Players {
		if engine.PlayerID(p) == seat {
			continue
		}
		if vp := s.PublicVP(engine.PlayerID(p)); vp > leader {
			leader = vp
		}
	}
	set, cities, roads := 0, 0, 0
	for _, bld := range s.Buildings {
		if bld.Owner != seat {
			continue
		}
		if bld.City {
			cities++
		} else {
			set++
		}
	}
	for _, r := range s.Roads {
		if r == seat {
			roads++
		}
	}

	x = append(x, pipsGained, newDistinct, opens, dist, port, vpAfter, float64(after),
		left[board.Wood], left[board.Brick], left[board.Sheep], left[board.Wheat], left[board.Ore],
		float64(s.TurnsCompleted), float64(leader), float64(s.PublicVP(seat)-leader),
		float64(set), float64(cities), float64(roads), float64(s.DevDeck.Count()),
		btof(after > 7), btof(dist == 1))
	return x
}

func btof(b bool) float64 {
	if b {
		return 1
	}
	return 0
}
