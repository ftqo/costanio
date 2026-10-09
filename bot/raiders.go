package bot

import (
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/raiders"
	"github.com/ftqo/costan.io/engine/scenarios"
)

// Strong's play for the Raiders scenario.
//
// Two facts shape this file:
//
//  1. Buildings alone cannot win. The target is 12 VP, with no Largest Army or
//     development-card points, and every build triggers a landing on the coast.
//     A bot that only builds never finishes; prisoners (from riders, from the
//     scenario's development deck) make up the difference.
//
//  2. A battle resolves at the end of the turn, not when the rider moves, so the
//     evaluator cannot see what a march is worth. Rider movement is chosen by
//     rule, as with the Knights free-progress plays.
//
// The numbers here are hand-set, not ladder-measured. The goals are that every
// command the scenario adds is reachable and no proposed command is illegal.

// riderOnBoardVP prices a rider on the board in victory points. Two prisoners
// make a point and a rider is only a chance at one, so it is under half a point.
const riderOnBoardVP = 0.35

// conqueredPipVP prices, in victory points, one pip of a seat's own production
// that a saturated hex has taken off the table, like the robber-denial term.
// Since DecideForEval folds the landing, a scored build already carries it.
const conqueredPipVP = 0.06

// raidersActive memoizes whether the Raiders module is in the ruleset.
func (b *Strong) raidersActive(s *engine.State) bool {
	if b.raidersOn == nil {
		on := raidersInRuleset(s)
		b.raidersOn = &on
	}
	return *b.raidersOn
}

func raidersInRuleset(s *engine.State) bool {
	for _, m := range s.Modules() {
		if m.Name() == raiders.Name {
			return true
		}
	}
	return false
}

// raidersEval is the module's evaluation term: the riders a seat has on the
// board, and the production a saturated hex is denying it.
//
// Prisoner points and the points a conquered building stops scoring are not
// here: they come through the module's VictoryCheck, which selfScore already
// reads via PublicVPWithModules.
func (b *Strong) raidersEval(s *engine.State, p, _ engine.PlayerID) float64 {
	x, ok := raiders.StateExt(s)
	if !ok {
		return 0
	}
	riders := 0
	for _, owner := range x.RiderAt {
		if owner == p {
			riders++
		}
	}
	score := b.w.VP * riderOnBoardVP * float64(riders)
	for v, bl := range s.Buildings {
		if bl.Owner != p {
			continue
		}
		n := 1
		if bl.City {
			n = 2
		}
		for _, h := range v.Hexes() {
			if !x.Conquered(h) {
				continue
			}
			score -= b.w.VP * conqueredPipVP * float64(n*pipsOf(s, h))
		}
	}
	return score
}

// pipsOf is how many of the 36 dice combinations a hex pays on.
func pipsOf(s *engine.State, h board.Hex) int {
	n := s.Board.Tiles[h].Number
	if n <= 0 || n == 7 {
		return 0
	}
	d := 7 - n
	if d < 0 {
		d = -d
	}
	return 6 - d
}

// raidersPending answers whatever the scenario is waiting on. It runs before the
// turn gate in Act, because BlocksTurnActions freezes the seat until answered.
func (b *Strong) raidersPending(s *engine.State, seat engine.PlayerID) (engine.Command, bool) {
	x, ok := raiders.StateExt(s)
	if !ok {
		return engine.Command{}, false
	}
	// A landed figure must receive its path before the next landing-hex choice.
	// Use the engine's interrupt order, including any outstanding discards.
	if len(x.PathQueue) > 0 {
		return engine.AutoCommandFor(s, seat)
	}
	if x.Pend.Kind == raiders.PendNone || x.Pend.Seat != seat {
		return engine.Command{}, false
	}

	// Discards come first; the engine refuses anything else while they are owed.
	if len(s.PendingDiscards) > 0 {
		return engine.Command{}, false
	}
	switch x.Pend.Kind {
	case raiders.PendLanding:
		// Send them where they hurt us least. Tied hexes hold the same number of
		// raiders, so choose on what the hex is worth to us.
		if h, ok := leastCostlyHex(s, x, seat, x.Pend.Hexes); ok {
			return engine.Command{Player: seat, Type: raiders.CmdPickHex,
				Data: raw2(map[string]any{"hex": h})}, true
		}
	case raiders.PendIntrigue:
		// Take the raider off the hex that costs us the most.
		if h, ok := mostCostlyHex(s, x, seat, x.Pend.Hexes); ok {
			return engine.Command{Player: seat, Type: raiders.CmdPickHex,
				Data: raw2(map[string]any{"hex": h})}, true
		}
	case raiders.PendMuster:
		if e, ok := bestCastlePath(x, x.Pend.Edges); ok {
			return engine.Command{Player: seat, Type: raiders.CmdPlaceRider,
				Data: raw2(map[string]any{"e": e})}, true
		}
	case raiders.PendSwift:
		// Swift Rider is optional. Take it only beside a hex the raiders hold;
		// anywhere else is three turns of marching away.
		if e, ok := bestSwiftPath(x, x.Pend.Edges); ok {
			return engine.Command{Player: seat, Type: raiders.CmdPlaceRider,
				Data: raw2(map[string]any{"e": e})}, true
		}
		return engine.Command{Player: seat, Type: raiders.CmdDeclineOffer}, true
	case raiders.PendTreason:
		// Validate before sending. Our greedy plan uses this bot's costing and
		// can differ in length or pairs from what the module accepts
		// (raiders.treasonCount); if refused, fall through to the module's Auto.
		if moves, ok := treasonPlan(s, x, seat); ok {
			cmd := engine.Command{Player: seat, Type: raiders.CmdTreason,
				Data: raw2(map[string]any{"moves": moves})}
			if _, err := engine.Decide(s.Clone(), cmd); err == nil {
				return cmd, true
			}
		}
	case raiders.PendSteal:
		payload := map[string]any{}
		if v, ok := richestVictim(s, seat); ok {
			payload["victim"] = v
		}
		return engine.Command{Player: seat, Type: raiders.CmdSteal, Data: raw2(payload)}, true
	}
	// Nothing we can improve on: let the module's own Auto answer.
	return engine.Command{}, false
}

// hexCost is what a hex is worth to seat: the production its buildings draw from
// it, weighted by the number. It prices both halves of a landing choice.
func hexCost(s *engine.State, seat engine.PlayerID, h board.Hex) int {
	cost := 0
	for _, v := range h.Vertices() {
		if bl, ok := s.Buildings[v]; ok && bl.Owner == seat {
			n := 1
			if bl.City {
				n = 2
			}
			cost += n * pipsOf(s, h)
		}
	}
	return cost
}

func leastCostlyHex(s *engine.State, x *raiders.Ext, seat engine.PlayerID, hexes []board.Hex) (board.Hex, bool) {
	best, found, bestCost := board.Hex{}, false, 0
	for _, h := range hexes {
		c := hexCost(s, seat, h)
		// A hex one raider short of saturation is worse than its pips say: the
		// next landing there stops it producing for everybody.
		if x.RaidersOn(h) == 2 {
			c += 2
		}
		if !found || c < bestCost {
			best, bestCost, found = h, c, true
		}
	}
	return best, found
}

func mostCostlyHex(s *engine.State, x *raiders.Ext, seat engine.PlayerID, hexes []board.Hex) (board.Hex, bool) {
	best, found, bestCost := board.Hex{}, false, 0
	for _, h := range hexes {
		c := hexCost(s, seat, h)*4 + x.RaidersOn(h)
		if !found || c > bestCost {
			best, bestCost, found = h, c, true
		}
	}
	return best, found
}

// bestCastlePath picks the castle path closest to the raiders. Every castle path
// is one hex from every other, so this only matters for the first step of the
// march, but the first step is three of the rider's five.
func bestCastlePath(x *raiders.Ext, edges []board.Edge) (board.Edge, bool) {
	best, found, bestD := board.Edge{}, false, 0
	for _, e := range edges {
		d, ok := distanceToRaiders(x, e)
		if !ok {
			continue
		}
		if !found || d < bestD {
			best, bestD, found = e, d, true
		}
	}
	if !found && len(edges) > 0 {
		return edges[0], true
	}
	return best, found
}

// bestSwiftPath takes a Swift Rider only where it lands beside raiders. Anywhere
// else it is a rider three turns from the fight and a card spent on nothing.
func bestSwiftPath(x *raiders.Ext, edges []board.Edge) (board.Edge, bool) {
	for _, e := range edges {
		for _, h := range board.EdgeHexes(e) {
			if x.RaidersOn(h) > 0 {
				return e, true
			}
		}
	}
	return board.Edge{}, false
}

// distanceToRaiders is the hex distance from a path to the nearest hex the
// raiders hold, or false when they hold none.
func distanceToRaiders(x *raiders.Ext, e board.Edge) (int, bool) {
	best, found := 0, false
	for i, h := range x.Coast {
		if x.RaiderCount[i] == 0 {
			continue
		}
		for _, eh := range board.EdgeHexes(e) {
			d := hexDistance(eh, h)
			if !found || d < best {
				best, found = d, true
			}
		}
	}
	return best, found
}

func hexDistance(a, c board.Hex) int {
	abs := func(n int) int {
		if n < 0 {
			return -n
		}
		return n
	}
	return (abs(a.Q-c.Q) + abs(a.R-c.R) + abs(a.Q+a.R-c.Q-c.R)) / 2
}

// treasonPlan moves raiders off the hexes that cost us most, onto the ones that
// cost us least. The engine fixes how many moves the card makes, so the plan is
// built to that length and validated by the module.
func treasonPlan(s *engine.State, x *raiders.Ext, seat engine.PlayerID) ([]map[string]any, bool) {
	var from []board.Hex
	var to []board.Hex
	for i, h := range x.Coast {
		if x.RaiderCount[i] > 0 {
			from = append(from, h)
		}
		if x.RaiderCount[i] < 3 {
			to = append(to, h)
		}
	}
	// Sources: the hexes that hurt us most. Destinations: the ones that hurt us
	// least, and never a source (the card says "2 OTHER unconquered hexes").
	sortByCost(s, seat, from, true)
	sortByCost(s, seat, to, false)
	var moves []map[string]any
	usedFrom := map[board.Hex]bool{}
	usedTo := map[board.Hex]bool{}
	for range 2 {
		var src *board.Hex
		for _, h := range from {
			if !usedFrom[h] && !usedTo[h] {
				hh := h
				src = &hh
				break
			}
		}
		var dst *board.Hex
		for _, h := range to {
			if usedTo[h] || usedFrom[h] || (src != nil && h == *src) {
				continue
			}
			hh := h
			dst = &hh
			break
		}
		if dst == nil {
			break
		}
		mv := map[string]any{"to": *dst}
		if src != nil {
			mv["from"] = *src
			usedFrom[*src] = true
		}
		usedTo[*dst] = true
		moves = append(moves, mv)
	}
	// The module decides how many moves the card makes; the caller validates the
	// plan and falls back to the module's Auto if it is refused.
	return moves, len(moves) > 0
}

func sortByCost(s *engine.State, seat engine.PlayerID, hs []board.Hex, desc bool) {
	for i := 1; i < len(hs); i++ {
		for j := i; j > 0; j-- {
			a, c := hexCost(s, seat, hs[j-1]), hexCost(s, seat, hs[j])
			if (desc && c > a) || (!desc && c < a) {
				hs[j-1], hs[j] = hs[j], hs[j-1]
				continue
			}
			break
		}
	}
}

// richestVictim is who the 7 should take from: the biggest hand, then the
// highest standing. The same rule the robber's victim choice uses.
func richestVictim(s *engine.State, thief engine.PlayerID) (engine.PlayerID, bool) {
	best, found, bestScore := engine.NoPlayer, false, 0
	for i := range s.Players {
		p := engine.PlayerID(i)
		if p == thief || s.Players[p].Hand.Count() == 0 || s.FriendlyRobberProtected(p) {
			continue
		}
		sc := s.Players[p].Hand.Count()*100 + s.PublicVPWithModules(p)
		if !found || sc > bestScore {
			best, bestScore, found = p, sc, true
		}
	}
	return best, found
}

// raidersBuild is the scenario's voluntary spending: a development card, which
// is how an army is raised here, and the gold lane.
//
// Chosen by rule rather than scored: the card resolves the moment it is bought,
// so simulating the purchase would peek at the deck (see expectedDevBuyValue).
func (b *Strong) raidersBuild(s *engine.State, seat engine.PlayerID) (engine.Command, bool) {
	x, ok := raiders.StateExt(s)
	if !ok || x.Pend.Kind != raiders.PendNone {
		return engine.Command{}, false
	}
	// These are ordinary turn actions, so another module's open interrupt (e.g. a
	// Knights metropolis pick) refuses them.
	if engine.RequireActionableTurn(s, seat) != nil {
		return engine.Command{}, false
	}
	// Gold first: it is the cheapest way to finish a build, and it is capped at
	// two purchases a turn so it cannot crowd anything else out.
	if cmd, ok := b.raidersGold(s, x, seat); ok {
		return cmd, true
	}
	// Locked out of building, the card is the only thing left to save for.
	if cmd, ok := b.raidersSaveForCard(s, x, seat); ok {
		return cmd, true
	}
	if x.RidersLeft[seat] == 0 || !s.Players[seat].Hand.Has(engine.CostDevCard) {
		return engine.Command{}, false
	}
	// Buy only while there are raiders on the board to fight.
	if x.RaidersOnBoard() == 0 {
		return engine.Command{}, false
	}
	// ... and only while a card would not cost us a building we could put up
	// this turn.
	if s.Players[seat].Hand.Has(engine.CostSettlement) && len(b.frontierVertices(s, seat)) > 0 {
		return engine.Command{}, false
	}
	if s.Players[seat].Hand.Has(engine.CostCity) && len(ownSettlements(s, seat)) > 0 {
		return engine.Command{}, false
	}
	return engine.Command{Player: seat, Type: raiders.CmdBuyCard}, true
}

// raidersGold spends the counter. Two gold buy one bank resource, at most twice
// a turn; four identical resources sell for one gold (three with a generic
// harbour), taken only to dump a surplus the bank trade cannot use.
func (b *Strong) raidersGold(s *engine.State, x *raiders.Ext, seat engine.PlayerID) (engine.Command, bool) {
	hand := s.Players[seat].Hand
	if x.Gold[seat] >= 2 && x.Buys < 2 {
		// Buy the card that completes the most valuable thing we are one short of,
		// preferring a city, then a settlement, then a development card.
		for _, want := range []engine.Hand{engine.CostCity, engine.CostSettlement, engine.CostDevCard} {
			if res, ok := oneShortOf(want, hand); ok && s.Bank[res] > 0 {
				return engine.Command{Player: seat, Type: raiders.CmdBuyResource,
					Data: raw2(map[string]any{"res": res})}, true
			}
		}
	}
	// Selling surplus for gold is half price, which beats discarding it on a 7.
	if hand.Count() > s.DiscardThreshold(seat) {
		for _, r := range board.Resources {
			ratio := raiders.GoldRatio(s, seat, r)
			if hand[r] >= ratio+2 {
				return engine.Command{Player: seat, Type: raiders.CmdSellForGold,
					Data: raw2(map[string]any{"res": r, "count": 1})}, true
			}
		}
	}
	return engine.Command{}, false
}

// raidersSaveForCard works toward a development card when the seat has nowhere
// left to build a settlement or a city: gold first (two gold a resource, twice a
// turn), then the bank out of whatever the card does not need.
//
// A conquered hex refuses builds on its corners, so a saturated coast can lock a
// seat out of every settlement and city at once. The trade planner (wantedCost)
// prices only builds, so without this a locked-out seat never trades or spends
// gold toward the card that is its only way back, and the game stalls.
//
// Only runs when the seat has no build available.
func (b *Strong) raidersSaveForCard(s *engine.State, x *raiders.Ext, seat engine.PlayerID) (engine.Command, bool) {
	if !raidersWantsCard(s, seat) {
		return engine.Command{}, false
	}
	hand := s.Players[seat].Hand
	if hand.Has(engine.CostDevCard) {
		return engine.Command{}, false // the buy below takes it
	}
	if len(ownSettlements(s, seat)) > 0 || len(b.frontierVertices(s, seat)) > 0 {
		return engine.Command{}, false
	}
	var short, pool engine.Hand
	for _, r := range board.Resources {
		if d := engine.CostDevCard[r] - hand[r]; d > 0 {
			short[r] = d
		} else {
			pool[r] = hand[r] - engine.CostDevCard[r]
		}
	}
	if x.Gold[seat] >= 2 && x.Buys < 2 {
		for _, r := range board.Resources {
			if short[r] > 0 && s.Bank[r] > 0 {
				return engine.Command{Player: seat, Type: raiders.CmdBuyResource,
					Data: raw2(map[string]any{"res": r})}, true
			}
		}
	}
	legal := func(cmd engine.Command) bool {
		_, err := engine.Decide(s.Clone(), cmd)
		return err == nil
	}
	if spend, ok := s.SolveBankSpend(seat, pool, short); ok {
		cmd := engine.Command{Player: seat, Type: engine.CmdBankTrade,
			Data: raw2(map[string]any{"spend": spend, "want": short})}
		if legal(cmd) {
			return cmd, true
		}
	}
	// Not all of it: move one card closer, out of a surplus at our own rate.
	for _, need := range board.Resources {
		if short[need] == 0 {
			continue
		}
		for _, give := range board.Resources {
			if give == need || pool[give] < s.BankRatio(seat, give) {
				continue
			}
			cmd := engine.Command{Player: seat, Type: engine.CmdBankTrade,
				Data: raw2(map[string]any{"give": give, "get": need})}
			if legal(cmd) {
				return cmd, true
			}
		}
	}
	return engine.Command{}, false
}

// raidersWantsCard is whether a scenario card is worth saving for: a rider left
// to hire and a raider on the board. Shared with the purchase so the trade
// lanes and the buy agree.
func raidersWantsCard(s *engine.State, seat engine.PlayerID) bool {
	x, ok := raiders.StateExt(s)
	if !ok || int(seat) >= len(x.RidersLeft) {
		return false
	}
	return x.RidersLeft[seat] > 0 && x.RaidersOnBoard() > 0
}

// oneShortOf reports the single resource a cost is short by, when it is short by
// exactly one card of one kind.
func oneShortOf(cost, hand engine.Hand) (board.Resource, bool) {
	var missing board.Resource
	short := 0
	for _, r := range board.Resources {
		if d := cost[r] - hand[r]; d > 0 {
			short += d
			missing = r
		}
	}
	if short == 1 {
		return missing, true
	}
	return 0, false
}

// raidersMarch moves one rider per call. It runs after building and trading,
// where the scenario puts movement.
//
// A rider on a castle path goes first: the turn cannot end while one is there.
func (b *Strong) raidersMarch(s *engine.State, seat engine.PlayerID) (engine.Command, bool) {
	x, ok := raiders.StateExt(s)
	if !ok || x.Pend.Kind != raiders.PendNone {
		return engine.Command{}, false
	}
	// A move is an ordinary turn action, so another module's open interrupt
	// refuses it.
	if engine.RequireActionableTurn(s, seat) != nil {
		return engine.Command{}, false
	}
	moves := raiders.MovesFor(s, seat)
	if len(moves) == 0 {
		return engine.Command{}, false
	}
	// The must-leave riders first, in the order the module lists them.
	ordered := make([]raiders.RiderMoves, 0, len(moves))
	for _, m := range moves {
		if m.MustLeave {
			ordered = append(ordered, m)
		}
	}
	for _, m := range moves {
		if !m.MustLeave {
			ordered = append(ordered, m)
		}
	}
	wheat := s.Players[seat].Hand[board.Wheat] > 0
	// Under Fishermen two fish can pay for the hurry instead of a wheat. Wheat is
	// preferred; fish pay only when there is no wheat, for the same reach.
	fishHurry := !wheat && engine.HasFreeRiderHurry(s) && ownFish(s, seat) >= 2
	for _, m := range ordered {
		to, hurry, ok := bestMarchTarget(s, x, seat, m, wheat || fishHurry)
		if !ok {
			continue
		}
		if hurry && !wheat {
			return engine.Command{Player: seat, Type: scenarios.CmdSpendFish, Data: raw2(map[string]any{
				"use": scenarios.FishRiderHurry, "from": m.From, "to": to,
			})}, true
		}
		payload := map[string]any{"from": m.From, "to": to}
		if hurry {
			payload["hurry"] = true
		}
		return engine.Command{Player: seat, Type: raiders.CmdMoveRider, Data: raw2(payload)}, true
	}
	return engine.Command{}, false
}

// bestMarchTarget picks where one rider goes.
//
// A destination that completes a victory (riders on the hex outnumbering its
// raiders after this move) always wins, since it is the only source of
// prisoners. Otherwise prefer getting closer to the nearest raided hex.
//
// Wheat is paid for the hurry only when the extra reach completes a victory.
func bestMarchTarget(s *engine.State, x *raiders.Ext, seat engine.PlayerID, m raiders.RiderMoves, wheat bool) (board.Edge, bool, bool) {
	pick := func(cands []board.Edge) (board.Edge, int, bool) {
		best, bestScore, found := board.Edge{}, 0, false
		for _, to := range cands {
			sc := marchScore(s, x, seat, m.From, to)
			if !found || sc > bestScore {
				best, bestScore, found = to, sc, true
			}
		}
		return best, bestScore, found
	}
	base, baseScore, baseOK := pick(m.To)
	if wheat && len(m.Hurry) > 0 {
		if far, farScore, ok := pick(m.Hurry); ok && farScore > baseScore && farScore >= victoryScore {
			return far, true, true
		}
	}
	return base, false, baseOK
}

// victoryScore is the floor a march score reaches when the destination completes
// a battle. A sentinel, not a tuned number.
const victoryScore = 1000

// marchScore prices one destination for one rider.
func marchScore(s *engine.State, x *raiders.Ext, seat engine.PlayerID, from, to board.Edge) int {
	best := 0
	for _, h := range board.EdgeHexes(to) {
		n := x.RaidersOn(h)
		if n == 0 {
			continue
		}
		// Count the riders that would be on this hex's six paths after the move.
		strength := 0
		for _, e := range h.Edges() {
			if e == from {
				continue // this rider is leaving that path
			}
			if _, ok := x.RiderAt[e]; ok {
				strength++
			}
		}
		strength++ // ... and arriving here
		if strength > n {
			// A prisoner, plus a little for the ones we take alongside it.
			if sc := victoryScore + n*10 + hexCost(s, seat, h); sc > best {
				best = sc
			}
			continue
		}
		// Not a win yet, but standing on a raided hex is one rider from one.
		if sc := 100 + n*10; sc > best {
			best = sc
		}
	}
	if best > 0 {
		return best
	}
	// Otherwise: get closer to the fight.
	if d, ok := distanceToRaiders(x, to); ok {
		return 50 - d
	}
	return 0
}

// --- Simple ----------------------------------------------------------------

// simpleRaidersPlay is the baseline's Raiders policy: hire a rider when it can,
// march one toward the nearest raided hex, and spend the gold.
//
// engine.AutoCommand only answers pendings, so without this Simple would never
// hire, march or fight. Simple is what the adversarial battery plays, and that
// battery is where checkRuleInvariants runs.
func simpleRaidersPlay(s *engine.State, seat engine.PlayerID) (engine.Command, bool) {
	x, ok := raiders.StateExt(s)
	if !ok || x.Pend.Kind != raiders.PendNone {
		return engine.Command{}, false
	}
	// Ordinary turn actions; another module's open interrupt refuses them.
	if engine.RequireActionableTurn(s, seat) != nil {
		return engine.Command{}, false
	}
	target, hasTarget := simpleTarget(x)
	pick := func(cands []board.Edge) board.Edge {
		if hasTarget {
			return towardTarget(cands, target)
		}
		return nearestToRaiders(x, cands)
	}
	// A rider on a castle path has to go, or the turn cannot end.
	moves := raiders.MovesFor(s, seat)
	for _, m := range moves {
		if !m.MustLeave || len(m.To) == 0 {
			continue
		}
		return engine.Command{Player: seat, Type: raiders.CmdMoveRider,
			Data: raw2(map[string]any{"from": m.From, "to": pick(m.To)})}, true
	}
	// Hire, while there is anywhere for a rider to go and anything to fight.
	if x.RidersLeft[seat] > 0 && x.RaidersOnBoard() > 0 && s.Players[seat].Hand.Has(engine.CostDevCard) {
		return engine.Command{Player: seat, Type: raiders.CmdBuyCard}, true
	}
	// Two gold buy a resource: one the card is missing first, otherwise the one
	// the bank has most of.
	if x.Gold[seat] >= 2 && x.Buys < 2 {
		best, found := board.Wood, false
		if raidersWantsCard(s, seat) {
			for _, r := range board.Resources {
				if s.Players[seat].Hand[r] < engine.CostDevCard[r] && s.Bank[r] > 0 {
					best, found = r, true
					break
				}
			}
		}
		if !found {
			for _, r := range board.Resources {
				if s.Bank[r] > 0 && (!found || s.Bank[r] > s.Bank[best]) {
					best, found = r, true
				}
			}
		}
		if found {
			return engine.Command{Player: seat, Type: raiders.CmdBuyResource,
				Data: raw2(map[string]any{"res": best})}, true
		}
	}
	// March, one rider a call, all of them at the same hex.
	if hasTarget {
		for _, m := range moves {
			if len(m.To) == 0 {
				continue
			}
			to := pick(m.To)
			// Skip a rider that cannot get closer.
			if riderDist(m.From, target) <= riderDist(to, target) {
				continue
			}
			return engine.Command{Player: seat, Type: raiders.CmdMoveRider,
				Data: raw2(map[string]any{"from": m.From, "to": to})}, true
		}
	}
	// A surplus that will only be discarded on the next 7 is worth half price.
	if s.Players[seat].Hand.Count() > s.DiscardThreshold(seat) {
		for _, r := range board.Resources {
			ratio := raiders.GoldRatio(s, seat, r)
			if s.Players[seat].Hand[r] >= ratio+2 {
				return engine.Command{Player: seat, Type: raiders.CmdSellForGold,
					Data: raw2(map[string]any{"res": r, "count": 1})}, true
			}
		}
	}
	return engine.Command{}, false
}

// simpleTarget is the one hex the baseline sends every rider at. Victory needs
// riders to outnumber the raiders on a single hex, so spreading out never wins.
//
// Easiest fight first: fewest raiders, then nearest the castle (where riders
// enter), then board order.
func simpleTarget(x *raiders.Ext) (board.Hex, bool) {
	best, found, bestKey := board.Hex{}, false, [2]int{}
	for i, h := range x.Coast {
		n := x.RaiderCount[i]
		if n == 0 {
			continue
		}
		d := 0
		if x.HasCastle {
			d = hexDistance(h, x.Castle)
		}
		key := [2]int{n, d}
		if !found || key[0] < bestKey[0] || (key[0] == bestKey[0] && key[1] < bestKey[1]) {
			best, bestKey, found = h, key, true
		}
	}
	return best, found
}

// towardTarget is the destination that gets a rider closest to `target`,
// preferring one that stands on the target hex itself.
func towardTarget(cands []board.Edge, target board.Hex) board.Edge {
	best, bestD, found := cands[0], 0, false
	for _, e := range cands {
		d := 99
		for _, h := range board.EdgeHexes(e) {
			if x := hexDistance(h, target); x < d {
				d = x
			}
		}
		if !found || d < bestD {
			best, bestD, found = e, d, true
		}
	}
	return best
}

// riderDist is how far a path is from a hex, in hexes.
func riderDist(e board.Edge, h board.Hex) int {
	best := 99
	for _, eh := range board.EdgeHexes(e) {
		if d := hexDistance(eh, h); d < best {
			best = d
		}
	}
	return best
}

// nearestToRaiders is the destination closest to the raiders, in the module's own
// deterministic order.
func nearestToRaiders(x *raiders.Ext, cands []board.Edge) board.Edge {
	best, bestD, found := cands[0], 0, false
	for _, e := range cands {
		d, ok := distanceToRaiders(x, e)
		if !ok {
			continue
		}
		if !found || d < bestD {
			best, bestD, found = e, d, true
		}
	}
	return best
}
