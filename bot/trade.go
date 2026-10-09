package bot

import (
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// wantedCost returns the cost of the highest-eval build the seat cannot yet
// afford, or false when nothing is worth trading toward. Shared by the bank lane
// and player offers so both chase the same target.
func (b *Strong) wantedCost(s *engine.State, seat engine.PlayerID) (engine.Hand, bool) {
	if b.naive == "trade" {
		return engine.Hand{}, false
	}
	// Identify the best target build ignoring cost, plus its missing resource.
	type target struct {
		cost engine.Hand
		gain float64
	}
	var targets []target

	// City upgrades (deterministic order).
	for _, v := range ownSettlements(s, seat) {
		g := b.evalAfterPaidBuild(s, seat, engine.CmdBuildCity, engine.CostCity, builtV(v))
		targets = append(targets, target{engine.CostCity, g})
	}
	// Settlements at frontier.
	frontier := b.frontierVertices(s, seat)
	for _, v := range frontier {
		g := b.evalAfterPaidBuild(s, seat, engine.CmdBuildSettlement, engine.CostSettlement, builtV(v))
		targets = append(targets, target{engine.CostSettlement, g})
	}
	// Roads, only when there is no other target at all. Otherwise a seat with no
	// open spot and nothing to upgrade, lacking road resources, ends every turn
	// and the game never finishes. Gating on an empty target list (not just an
	// empty frontier) keeps a road from outranking a city upgrade.
	//
	// Also gated on bestPlay's road budget, so it never chases Longest Road
	// (sim.TestStrongDoesNotChaseLongestRoad).
	if len(targets) == 0 && roadCount(s, seat) < buildingCount(s, seat)*2+2 {
		for _, e := range b.frontierEdges(s, seat) {
			g := b.evalAfterPaidBuild(s, seat, engine.CmdBuildRoad, engine.CostRoad, builtE(e))
			targets = append(targets, target{engine.CostRoad, g})
		}
	}

	best := -1e18
	var want engine.Hand
	for _, t := range targets {
		if t.gain > best {
			best = t.gain
			want = t.cost
		}
	}
	if best <= b.eval(s, seat) {
		return engine.Hand{}, false // no build worth trading for
	}
	return want, true
}

// tradeTowardBuild finds the highest-eval build the player cannot afford and, if
// a 4:1 or port bank trade out of surplus moves toward affording it, returns
// that trade.
func (b *Strong) tradeTowardBuild(s *engine.State, seat engine.PlayerID) (engine.Command, bool) {
	want, ok := b.wantedCost(s, seat)
	if !ok {
		return engine.Command{}, false
	}
	hand := s.Players[seat].Hand
	// What we still need.
	var need board.Resource
	haveNeed := false
	for _, r := range board.Resources {
		if hand[r] < want[r] {
			need, haveNeed = r, true
			break
		}
	}
	if !haveNeed {
		return engine.Command{}, false // already affordable; bestPlay handles it
	}
	// First try to buy the whole shortfall in one basket trade, paying from what
	// the build doesn't need. The solver picks the cheapest kinds, so it never
	// costs more than one card at a time.
	var shortfall, pool engine.Hand
	for _, r := range board.Resources {
		if d := want[r] - hand[r]; d > 0 {
			shortfall[r] = d
		} else {
			pool[r] = hand[r] - want[r]
		}
	}
	if spend, ok := s.SolveBankSpend(seat, pool, shortfall); ok {
		cmd := engine.Command{Player: seat, Type: engine.CmdBankTrade,
			Data: raw2(map[string]any{"spend": spend, "want": shortfall})}
		if _, ok := b.score(s, seat, cmd); ok {
			return cmd, true
		}
	}
	// Can't cover it all. Find a surplus resource we can spare at our best ratio
	// for `need` and move one card closer, confirming the trade is actually
	// legal (bank stocked, etc.) before committing to it.
	for _, give := range board.Resources {
		if give == need {
			continue
		}
		ratio := s.BankRatio(seat, give)
		if hand[give]-want[give] < ratio {
			continue // not enough to spare
		}
		cmd := engine.Command{Player: seat, Type: engine.CmdBankTrade,
			Data: raw2(map[string]any{"give": give, "get": need})}
		if _, ok := b.score(s, seat, cmd); ok {
			return cmd, true
		}
	}
	return engine.Command{}, false
}

// evalAfterPaidBuild scores the position as if the build happened (used to
// rank trade targets independent of current affordability). The cost is passed
// in rather than derived from the command type so roads can be ranked too.
func (b *Strong) evalAfterPaidBuild(s *engine.State, seat engine.PlayerID, typ engine.CommandType, cost engine.Hand, data map[string]any) float64 {
	c := s.Clone()
	// Grant the cost so the simulated build is legal, then build.
	c.Players[seat].Hand.Add(cost)
	cmd := engine.Command{Player: seat, Type: typ, Data: raw2(data)}
	events, err := engine.Decide(c, cmd)
	if err != nil {
		return -1e18
	}
	for _, e := range events {
		if err := engine.Apply(c, e); err != nil {
			return -1e18
		}
	}
	return b.eval(c, seat)
}
