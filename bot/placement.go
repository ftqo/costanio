package bot

import (
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

func (b *Strong) setup(s *engine.State, seat engine.PlayerID) (engine.Command, bool) {
	// A module may own the whole draft (Explorers), in which case the base
	// placement commands are unknown. Decline, so the caller falls through to
	// the module's AutoSetup.
	if s.SetupOwnedByModule() {
		return engine.Command{}, false
	}
	if s.NeedRoad {
		return b.setupRoad(s, seat)
	}
	return b.setupSettlement(s, seat)
}

func (b *Strong) setupSettlement(s *engine.State, seat engine.PlayerID) (engine.Command, bool) {
	bi := b.cache(s)
	var best board.Vertex
	bestScore := -1e18
	found := false
	for _, v := range bi.vertices {
		if engine.CheckSettlementSpot(s, v) != nil {
			continue
		}
		if b.naive == "placement" {
			return engine.Command{Player: seat, Type: engine.CmdPlaceSettlement,
				Data: raw2(map[string]any{"v": v})}, true
		}
		score := b.setupVertexScore(s, seat, v)
		if b.learnedPlacement {
			score = b.placementScore(s, seat, v)
		}
		if sc := score; sc > bestScore {
			bestScore, best, found = sc, v, true
		}
	}
	if !found {
		return b.simple.Act(s, seat)
	}
	return engine.Command{Player: seat, Type: engine.CmdPlaceSettlement, Data: raw2(map[string]any{"v": best})}, true
}

// setupVertexScore values a starting spot by pip-weighted production, breadth
// (resources the player lacks, weighted higher on the second settlement so the
// opening pair is buildable), ports, and the quality of open neighbor vertices
// it can expand into.
func (b *Strong) setupVertexScore(s *engine.State, seat engine.PlayerID, v board.Vertex) float64 {
	bi := b.cache(s)
	vi := bi.vert[v]
	have := perResourcePips(s, seat)

	// Breadth weight: value resources we lack more strongly on the second (or
	// later) settlement, so the opening pair is buildable. "Second" = the seat
	// already owns a building (independent of whether it produces anything).
	breadth := b.w.SetupBreadth1
	owned := 0
	for _, bld := range s.Buildings {
		if bld.Owner == seat {
			owned++
		}
	}
	if owned > 0 {
		breadth = b.w.SetupBreadth2
	}

	score := 0.0
	for _, r := range board.Resources {
		p := float64(vi.resPips[r])
		score += p * earlyResW[r]
		if have[r] == 0 && vi.resPips[r] > 0 {
			score += p * breadth
		}
	}
	if vi.harbor != nil {
		if vi.harbor.Ratio == 2 && vi.resPips[vi.harbor.Res] > 0 {
			score += b.w.SetupPort2 // 2:1 port on a resource this spot floods
		} else {
			score += b.w.SetupPort3 // 3:1 flexible
		}
	}
	// Expansion room: best open neighbor vertex's pips (discounted).
	bestN := 0.0
	for _, n := range vi.neighbors {
		if vi2 := bi.vert[n]; vi2 != nil {
			if engine.CheckSettlementSpot(s, n) == nil {
				if p := float64(vi2.pips); p > bestN {
					bestN = p
				}
			}
		}
	}
	score += bestN * b.w.SetupNeighbor
	return score
}

// setupRoad points the road toward the best reachable future settlement vertex.
func (b *Strong) setupRoad(s *engine.State, seat engine.PlayerID) (engine.Command, bool) {
	if b.learnedSetupRoad {
		if cmd, ok := b.setupRoadNetPick(s, seat); ok {
			return cmd, true
		}
	}
	bi := b.cache(s)
	from := s.LastSettlement
	var best board.Edge
	bestScore := -1e18
	found := false
	// engine.LegalSetupRoads, because a module may close an edge to roads (a
	// Rivers bridge site).
	for _, e := range engine.LegalSetupRoads(s) {
		if b.naive == "setup-road" {
			return engine.Command{Player: seat, Type: engine.CmdPlaceRoad,
				Data: raw2(map[string]any{"e": e})}, true
		}
		toward := e.Other(from)
		viToward := bi.vert[toward]
		if viToward == nil {
			continue
		}
		if b.roadOpens {
			// Score only what the road opens. See the note below.
			sc := 0.0
			for _, n := range toward.Neighbors() {
				if vi2 := bi.vert[n]; vi2 != nil && engine.CheckSettlementSpot(s, n) == nil {
					sc += float64(vi2.pips)
				}
			}
			if sc > bestScore {
				bestScore, best, found = sc, e, true
			}
			continue
		}
		// viToward.pips is the vertex the road runs into, which is adjacent to
		// the new settlement and so can never be built on. Scoring what the road
		// opens measured neutral against clones (which cannot price racing for a
		// spot), but human data favours it strongly. See WithRoadOpens.
		sc := float64(viToward.pips)
		for _, n := range toward.Neighbors() {
			if vi2 := bi.vert[n]; vi2 != nil {
				if engine.CheckSettlementSpot(s, n) == nil {
					sc += float64(vi2.pips) * 0.5
				}
			}
		}
		if sc > bestScore {
			bestScore, best, found = sc, e, true
		}
	}
	if !found {
		return b.simple.Act(s, seat)
	}
	return engine.Command{Player: seat, Type: engine.CmdPlaceRoad, Data: raw2(map[string]any{"e": best})}, true
}
