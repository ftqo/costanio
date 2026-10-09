package bot

import (
	"sort"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// bestDevPlay returns the best "choice" dev-card command to play this turn
// (monopoly / year-of-plenty / road-building), each scored via the eval, with
// its resulting score. Knight is scored generically by the caller. Returns
// found=false when none improves the position or none is holdable.
func (b *Strong) bestDevPlay(s *engine.State, seat engine.PlayerID) (engine.Command, float64, bool) {
	if s.PlayedDevThisTurn || devCardsDisabled(s) {
		return engine.Command{}, 0, false
	}
	dc := s.Players[seat].DevCards // bought-this-turn cards are in NewDevCards and locked
	best := engine.Command{}
	bestScore := -1e18
	found := false
	consider := func(cmd engine.Command) {
		if sc, ok := b.score(s, seat, cmd); ok && sc > bestScore {
			bestScore, best, found = sc, cmd, true
		}
	}

	if dc[engine.DevMonopoly] > 0 {
		if r, ok := b.monopolyResource(s, seat); ok {
			consider(engine.Command{Player: seat, Type: engine.CmdPlayDevCard,
				Data: raw2(map[string]any{"card": engine.DevMonopoly, "res": r})})
		}
	}
	if dc[engine.DevYearOfPlenty] > 0 {
		if gain, ok := b.yearOfPlentyGain(s, seat); ok {
			consider(engine.Command{Player: seat, Type: engine.CmdPlayDevCard,
				Data: raw2(map[string]any{"card": engine.DevYearOfPlenty, "gain": gain})})
		}
	}
	if dc[engine.DevRoadBuilding] > 0 {
		if b.shouldPlayRoadBuilding(s, seat) {
			consider(engine.Command{Player: seat, Type: engine.CmdPlayDevCard,
				Data: raw2(map[string]any{"card": engine.DevRoadBuilding})})
		}
	}
	return best, bestScore, found
}

// monopolyResource picks the resource opponents are most likely to be holding,
// weighted by usefulness.
//
// Hand contents are hidden, so it uses the same public estimate as handValue:
// card counts spread by production, both public.
func (b *Strong) monopolyResource(s *engine.State, seat engine.PlayerID) (board.Resource, bool) {
	phase := gamePhase(s, seat)
	best := board.Wood
	bestVal := 0.0
	for _, r := range board.Resources {
		total := 0.0
		for p := range s.Players {
			if engine.PlayerID(p) == seat {
				continue
			}
			if b.hiddenInfo {
				total += float64(s.Players[p].Hand[r])
				continue
			}
			total += publicHandEstimate(s, engine.PlayerID(p))[r]
		}
		val := total * (b.resourceWeight(r, phase) + 0.1)
		if val > bestVal {
			bestVal, best = val, r
		}
	}
	return best, bestVal > 0
}

// evalWithBestBuild returns the eval of s, or the higher eval reachable by making
// one affordable build this turn (a city upgrade on an owned settlement, or a
// settlement at a frontier spot). It scores resource-acquisition choices (year of
// plenty) by the build they actually enable, on the eval scale, instead of a
// separate weight table. b.score checks legality (including affordability), so
// only builds the gained cards can actually pay for contribute.
func (b *Strong) evalWithBestBuild(s *engine.State, seat engine.PlayerID) float64 {
	best := b.eval(s, seat)
	// Only simulate builds we can afford: Decide rejects the rest, so gating on
	// Hand.Has skips the clone+Decide. Hot path under yearOfPlentyGain.
	hand := s.Players[seat].Hand
	if hand.Has(engine.CostCity) {
		for _, v := range ownSettlements(s, seat) {
			if sc, ok := b.score(s, seat, engine.Command{Player: seat, Type: engine.CmdBuildCity, Data: raw2(builtV(v))}); ok && sc > best {
				best = sc
			}
		}
	}
	if hand.Has(engine.CostSettlement) {
		for _, v := range b.frontierVertices(s, seat) {
			if sc, ok := b.score(s, seat, engine.Command{Player: seat, Type: engine.CmdBuildSettlement, Data: raw2(builtV(v))}); ok && sc > best {
				best = sc
			}
		}
	}
	return best
}

// yearOfPlentyGain takes the two resources (with repetition) that most improve
// the position, valued by the best build they make affordable (evalWithBestBuild)
// so a pair that completes a city/settlement is preferred over merely high-weight
// cards. The full evaluation (clone + engine sim + build search) is expensive, so
// instead of running it on all 15 bank-supplied pairs it pre-ranks them cheaply
// and fully evaluates only the promising ones: every pair that newly affords a
// build (the decisive cases) plus the few highest-card-weight pairs. The full
// search then refines among those.
func (b *Strong) yearOfPlentyGain(s *engine.State, seat engine.PlayerID) (engine.Hand, bool) {
	// fullEvalFloor caps how many non-build-completing pairs get the expensive
	// evaluation. Build-completing pairs are always fully evaluated on top.
	const fullEvalFloor = 4

	phase := gamePhase(s, seat)
	hand := s.Players[seat].Hand
	type cand struct {
		gain      engine.Hand
		completes bool    // newly affords a city or settlement
		weight    float64 // value of the two gained cards
	}
	var cands []cand
	for i, r1 := range board.Resources {
		for _, r2 := range board.Resources[i:] {
			if s.Bank[r1] < 1 || s.Bank[r2] < 1 {
				continue
			}
			if r1 == r2 && s.Bank[r1] < 2 {
				continue
			}
			var gain engine.Hand
			gain[r1]++
			gain[r2]++
			nh := hand
			nh[r1]++
			nh[r2]++
			completes := (nh.Has(engine.CostCity) && !hand.Has(engine.CostCity)) ||
				(nh.Has(engine.CostSettlement) && !hand.Has(engine.CostSettlement))
			cands = append(cands, cand{gain, completes, b.resourceWeight(r1, phase) + b.resourceWeight(r2, phase)})
		}
	}
	// Build-completing pairs first, then by card weight; both keys are stable so
	// the choice stays seed-deterministic.
	sort.SliceStable(cands, func(i, j int) bool {
		if cands[i].completes != cands[j].completes {
			return cands[i].completes
		}
		return cands[i].weight > cands[j].weight
	})
	limit := fullEvalFloor
	for _, c := range cands {
		if c.completes {
			limit++
		}
	}
	if limit > len(cands) {
		limit = len(cands)
	}

	best := engine.Hand{}
	bestScore := -1e18
	found := false
	for _, cnd := range cands[:limit] {
		c := s.Clone()
		cmd := engine.Command{Player: seat, Type: engine.CmdPlayDevCard,
			Data: raw2(map[string]any{"card": engine.DevYearOfPlenty, "gain": cnd.gain})}
		events, err := engine.Decide(c, cmd)
		if err != nil {
			continue
		}
		ok := true
		for _, e := range events {
			if err := engine.Apply(c, e); err != nil {
				ok = false
				break
			}
		}
		if !ok {
			continue
		}
		if sc := b.evalWithBestBuild(c, seat); sc > bestScore {
			bestScore, best, found = sc, cnd.gain, true
		}
	}
	return best, found
}

// shouldPlayRoadBuilding reports whether playing Road Building reaches a
// worthwhile settlement spot (never for longest road).
func (b *Strong) shouldPlayRoadBuilding(s *engine.State, seat engine.PlayerID) bool {
	if s.Players[seat].RoadsLeft == 0 {
		return false
	}
	for _, e := range b.frontierEdges(s, seat) {
		for _, v := range []board.Vertex{e.A, e.B} {
			if engine.CheckSettlementSpot(s, v) == nil {
				return true
			}
		}
	}
	return false
}
