package bot

import (
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/scenarios"
)

// The camel auction: bidding and placement for Caravans.
//
//  1. A camel is worth what it does to this board. A settlement or city
//     between two camels of one caravan scores +1 VP, and a road sharing a path
//     with a camel counts double for the route. The value of winning is
//     measured by placing the camel on a clone and evaluating, like every other
//     Strong candidate.
//
//  2. Bid cards are real cards (they build, buy and trade), so the cost of a
//     bid is measured the same way: take the cards off a clone and evaluate.
//
//  3. It is an all-pay auction: `settle` charges every seat that named
//     something, not just the winner. The cost is certain and the prize is not,
//     so the bid is shaded by the chance of winning.

// camelBidCapDefault is the most cards this bot will name in one round unless
// WithCamelBidCap says otherwise.
//
// Not a game rule (the engine takes any bid the seat can back): past about four
// cards a bid stakes a settlement's worth of material on a prize capped at one
// victory point plus a route bonus. It is a backstop; correctly priced bids stop
// on cost first. Sweeping it to 2, 8 and 64 moved the ladder win rate by at
// most 4.8 points.
const camelBidCapDefault = 4

// camelBidCap is the bound on one bid, per instance (see WithCamelBidCap).
func (b *Strong) camelBidCap() int {
	if b.camelCap > 0 {
		return b.camelCap
	}
	return camelBidCapDefault
}

// bidPricer returns the evaluator the camel auction is priced with: this bot,
// with the opponent discount normalised to oppNeutralWeight. See neutralPricer
// for why the production weight cannot be used here.
//
// A copy of the receiver, so every other weight, option and the primed board
// cache carry over.
func (b *Strong) bidPricer() *Strong {
	if b.unpricedCamelBids {
		return b
	}
	return b.neutralPricer()
}

// neutralPricer is this bot with the opponent discount normalised to
// oppNeutralWeight, for any decision where a gain on the shared board is
// weighed against a price paid from our own side (the camel bid, the fish
// steal; see oppNeutralWeight).
//
// `eval` subtracts Weights.Opp (9.6) times the best opponent's selfScore. That
// weight was tuned to rank our own moves, across which the opponent term barely
// changes. A camel lands on a shared board and can score an opponent a point,
// so the opponent term varies most across candidates and, at 9.6x, dominates
// the gain, while it cancels out of the cost (our cards do not change their
// selfScore). Measured: median gain 157.6 at Opp 9.6 against 4.0 at zero, with
// a card costing 0.54.
//
// A copy of the receiver, so every other weight, option and the primed board
// cache carry over.
func (b *Strong) neutralPricer() *Strong {
	p := *b
	p.w.Opp = oppNeutralWeight
	p.vlBlocks = nil // scratch is not shared with the bot it was copied from
	return &p
}

// camelCardPrice is what one wool-or-grain card is worth, in the units the
// camel gain is measured in.
//
// `handValue` (about 0.54 a card, zero past the third of a resource) ranks
// positions but is not a price: elsewhere cards are only spent on builds whose
// cost the rules fix. So the price comes from the rules: a settlement costs four
// cards and is worth at least one victory point, so a card is a quarter of the
// next VP under selfScore's convex VP term, in the gain's own units.
//
// It is a floor: where the evaluator prices a card higher (one that completes a
// build), that price stands.
func (b *Strong) camelCardPrice(s *engine.State, seat engine.PlayerID) float64 {
	vp := float64(s.PublicVPWithModules(seat))
	// The marginal value of the next point under selfScore's convex VP terms:
	// d/dvp of (VP*vp + VPRush*vp^2), discretised as the exact step from vp to
	// vp+1 rather than the derivative, because vp is an integer count.
	next := b.w.VP + b.w.VPRush*(2*vp+1)
	return next / 4
}

// caravansActive memoizes whether the Caravans module is in the ruleset.
func (b *Strong) caravansActive(s *engine.State) bool {
	if b.noCamels {
		return false
	}
	if b.caravansOn == nil {
		on := false
		for _, m := range s.Modules() {
			if m.Name() == scenarios.CaravansName {
				on = true
				break
			}
		}
		b.caravansOn = &on
	}
	return *b.caravansOn
}

// camelAction returns this seat's camel-vote move, if it owes one.
//
// It runs in Strong.Act before the turn gate: a camel round opens as a turn
// ends, so the bidders and usually the placer are not the current player, and
// bestPlay only runs when s.Cur is us.
func (b *Strong) camelAction(s *engine.State, seat engine.PlayerID) (engine.Command, bool) {
	x, ok := scenarios.CaravansStateExt(s)
	if !ok || !x.Voting {
		return engine.Command{}, false
	}
	if x.Placer == engine.NoPlayer {
		// Only when the round is waiting on us. Bidding is sequential (the
		// finisher, then clockwise), and bidding early is refused with
		// ErrNotYourTurn.
		if scenarios.NextBidder(s) != seat {
			return engine.Command{}, false
		}
		return b.camelBid(s, x, seat)
	}
	if x.Placer != seat {
		return engine.Command{}, false
	}
	return b.camelPlace(s, seat)
}

// camelPlace chooses where the camel goes, now that we have won the right to.
//
// Scored like any other action: simulate the command and evaluate the result.
// One path may put a camel beside our settlement or double one of our roads,
// another may hand that to a neighbour.
func (b *Strong) camelPlace(s *engine.State, seat engine.PlayerID) (engine.Command, bool) {
	paths := scenarios.CamelPaths(s)
	bestScore, bestCmd, found := 0.0, engine.Command{}, false
	for _, p := range paths {
		cmd := camelPlaceCmd(seat, p)
		sc, ok := b.score(s, seat, cmd)
		if !ok {
			continue
		}
		if !found || sc > bestScore+1e-9 {
			bestScore, bestCmd, found = sc, cmd, true
		}
	}
	return bestCmd, found
}

func camelPlaceCmd(seat engine.PlayerID, p engine.CamelPath) engine.Command {
	return engine.Command{Player: seat, Type: scenarios.CmdPlaceCamel,
		Data: raw2(map[string]any{"caravan": p.Caravan, "e": p.E})}
}

// camelBid names this seat's bid.
//
// The shape is a one-line expected-value maximisation over how many cards to
// name:
//
//	EV(k) = P(we win | k) * gain  -  cost(k)
//
// with `gain` the eval swing between the placement we would choose and the
// placement we expect with no say, `cost(k)` the eval given up by spending k
// cards, unconditional because the auction is all-pay. k = 0 is always a
// candidate, so abstaining wins whenever no bid clears the price of the cards.
func (b *Strong) camelBid(s *engine.State, x *scenarios.CaravansExt, seat engine.PlayerID) (engine.Command, bool) {
	pass := func() (engine.Command, bool) {
		return engine.Command{Player: seat, Type: scenarios.CmdBidCamel,
			Data: raw2(map[string]any{"cards": [2]int{0, 0}})}, true
	}
	if b.camelNoBid {
		return pass()
	}
	gain, ok := b.camelGain(s, seat)
	if !ok || gain <= 0 {
		return pass()
	}
	hand := s.Players[seat].Hand
	// The two piles the ruleset bids in (wool and grain, or brick and lumber
	// alongside Knights), read from the engine.
	res := scenarios.BidResources(s)
	maxK := min(hand[res[0]]+hand[res[1]], b.camelBidCap())
	if maxK <= 0 {
		return pass()
	}
	// The cost of each successive card, and the split across the two piles that
	// spends the k cheapest ones. Both come out of one greedy pass.
	cost, cards := b.camelBidCosts(s, seat, maxK)

	// In practice the cost term rarely decides: gains that pass the gate are
	// far above the price (median 176.6 against 1.08 for the whole bid), so cost
	// only turns thin rounds into passes (TestCamelBidRefusesThinRound). On a
	// typical round the bid is limited by the hand (bestK == maxK on 349 of 372
	// bids) and the win-chance ceiling (TestCamelBidWinChanceCeiling).
	bestEV, bestK := 0.0, 0
	for k := range maxK + 1 {
		ev := b.camelWinChance(s, x, seat, k)*gain - cost[k]
		if k == 0 || ev > bestEV+1e-9 {
			// k == 0 is evaluated, not assumed worth zero: the finisher wins a
			// round nobody bids in, so it should bid least.
			bestEV, bestK = ev, k
		}
	}
	if bestK <= 0 {
		return pass()
	}
	// TODO: no preferred placement is named, so the bot never joins a coalition
	// (bidders naming the same path with a majority between them beat the
	// largest single bidder). That needs a model of what other seats want.
	return engine.Command{Player: seat, Type: scenarios.CmdBidCamel,
		Data: raw2(map[string]any{"cards": cards[bestK]})}, true
}

// camelGain prices winning the placement: the best position we could reach by
// choosing where the camel goes, against the position we expect if we do not
// choose.
//
// The counterfactual is the mean over the legal paths: we do not know who wins
// or where they place, and the best or worst path would over- or under-price
// the swing.
func (b *Strong) camelGain(s *engine.State, seat engine.PlayerID) (float64, bool) {
	paths := scenarios.CamelPaths(s)
	if len(paths) == 0 {
		return 0, false
	}
	pricer := b.bidPricer()
	best, total, n := 0.0, 0.0, 0
	for _, p := range paths {
		// Nobody is the placer yet, so name us the placer on a clone and let
		// Decide apply the real placement rule.
		c := s.Clone()
		cx, ok := scenarios.CaravansStateExt(c)
		if !ok {
			return 0, false
		}
		cx.Placer = seat
		sc, ok := pricer.score(c, seat, camelPlaceCmd(seat, p))
		if !ok {
			continue
		}
		if n == 0 || sc > best {
			best = sc
		}
		total += sc
		n++
	}
	if n == 0 {
		return 0, false
	}
	return best - total/float64(n), true
}

// camelBidCosts returns, for every k from 0 to maxK, what naming k cards costs
// us in eval and which k cards those are, as a count against each of the
// round's two bid resources.
//
// Greedy: at each step spend the pile whose next card hurts least (one pile may
// hold the card that completes a settlement).
func (b *Strong) camelBidCosts(s *engine.State, seat engine.PlayerID, maxK int) (cost []float64, cards [][2]int) {
	cost = make([]float64, maxK+1)
	cards = make([][2]int, maxK+1)
	res := scenarios.BidResources(s)
	pricer := b.bidPricer()
	base := pricer.eval(s, seat)
	floor := pricer.camelCardPrice(s, seat)
	if b.unpricedCamelBids {
		floor = 0 // no price floor
	}
	c := s.Clone()
	var held [2]int
	for k := 1; k <= maxK; k++ {
		type opt struct {
			pile  int
			score float64
			ok    bool
		}
		var take opt
		for pile, r := range res {
			if c.Players[seat].Hand[r] <= 0 {
				continue
			}
			c.Players[seat].Hand[r]--
			sc := pricer.eval(c, seat)
			c.Players[seat].Hand[r]++
			if !take.ok || sc > take.score {
				take = opt{pile: pile, score: sc, ok: true}
			}
		}
		if !take.ok {
			// Out of cards: every larger k costs what k-1 did, and the EV loop
			// will not prefer it since the win chance is capped by the hand too.
			cost[k], cards[k] = cost[k-1], cards[k-1]
			continue
		}
		c.Players[seat].Hand[res[take.pile]]--
		held[take.pile]++
		// Never negative (floating point can nudge the evaluator's answer below
		// zero) and never below the card price floor (see camelCardPrice).
		cost[k] = max(float64(k)*floor, base-take.score)
		cards[k] = held
	}
	return cost, cards
}

// camelZeroBidMass is how much of a rival's bid distribution sits on
// abstaining rather than spread over the cards it could back.
//
// A rival abstains with probability camelZeroBidMass and otherwise draws
// uniformly over {0..m}. A plain uniform draw makes a one-card bid win
// (1/5)^3 = 0.008 of the time at four seats, which switches bidding off.
// Self-play measured 99.5% abstention, but that measures the bot itself; 0.9
// gives 0.92^3 = 77.8% for a one-card bid at four seats, matching the 77%
// measured win rate. That measurement predates open sequential bidding and has
// not been redone.
const camelZeroBidMass = 0.9

// camelWinChance estimates the probability that naming k cards takes the round.
//
// Bids are open, so a late bidder could read the standing bids; this model does
// not yet (TODO). Each rival abstains with probability camelZeroBidMass and
// otherwise names a bid drawn uniformly from 0 to the bid-resource cards
// (scenarios.BidResources) it is estimated to hold (publicHandEstimate), capped at our
// own bid cap. It is a weak model: it knows how often a seat bids, not what the
// board is worth to it.
//
// Ties go to the seat that ended the turn, as in pickPlacer, so the finisher
// wins on `<=` and everyone else needs `<`; the finisher's k = 0 is a free
// entry.
func (b *Strong) camelWinChance(s *engine.State, x *scenarios.CaravansExt, seat engine.PlayerID, k int) float64 {
	isFinisher := x.Finisher == seat
	if k == 0 && !isFinisher {
		return 0 // a zero bid earns no votes, and only the finisher wins on none
	}
	zero := camelZeroBidMass
	if b.camelUniformRivals {
		zero = 0 // measurement arm: plain uniform model
	}
	p := 1.0
	for q := range s.Players {
		rival := engine.PlayerID(q)
		if rival == seat {
			continue
		}
		est := publicHandEstimate(s, rival)
		res := scenarios.BidResources(s)
		m := int(est[res[0]] + est[res[1]] + 0.5)
		m = min(max(m, 0), b.camelBidCap())
		beat := k // strictly below us
		if isFinisher {
			beat = k + 1 // a tie falls to us
		}
		beat = min(max(beat, 0), m+1)
		// Mixture: mass at zero, plus the uniform tail. beat > 0 is exactly
		// "a rival that abstained is below us", which is what the point mass
		// contributes.
		below := (1 - zero) * float64(beat) / float64(m+1)
		if beat > 0 {
			below += zero
		}
		p *= below
	}
	return p
}
