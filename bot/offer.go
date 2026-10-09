package bot

import (
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// Player-to-player trading. The turn-holder offers (CmdOfferTrade), other seats
// accept or counter (CmdRespondTrade / CmdCounterTrade), and the turn-holder
// settles against one of them (CmdExecuteTrade). This file covers the first and
// last steps.

// offerTrade proposes one surplus card for one the bot is short of.
//
// A rule rather than a scored candidate: an offer only creates a pending, which
// a one-step evaluator sees as no change.
//
// Terms are plain: one or two spare cards for one card that completes a build.
func (b *Strong) offerTrade(s *engine.State, seat engine.PlayerID) (engine.Command, bool) {
	if !b.playerTrades || s.ActiveOffer != nil {
		return engine.Command{}, false
	}
	want, ok := b.shortfallFor(s, seat)
	if !ok {
		return engine.Command{}, false
	}
	hand := s.Players[seat].Hand
	phase := gamePhase(s, seat)

	// Offer the spare card opponents most likely want; our least useful card is
	// usually everyone's least useful. Holdings are hidden, so scarcity comes
	// from publicHandEstimate.
	scarcity := [6]float64{}
	for p := range s.Players {
		q := engine.PlayerID(p)
		if q == seat {
			continue
		}
		est := publicHandEstimate(s, q)
		for _, r := range board.Resources {
			scarcity[r] += 1 / (1 + est[r]) // fewer expected cards, more wanted
		}
	}
	give, bestVal := board.Resource(0), -1e18
	for _, r := range board.Resources {
		if r == want || hand[r] == 0 {
			continue
		}
		// Spare-ness to us, weighed against how badly the table likely needs it.
		v := scarcity[r] / (b.resourceWeight(r, phase) + 0.1) * float64(hand[r])
		if v > bestVal {
			give, bestVal = r, v
		}
	}
	if give == 0 {
		return engine.Command{}, false
	}
	// Opponents rarely accept a one-for-one, so consider overpaying with two.
	// Giving two can break another build, so simulate the swap (our hand only)
	// and keep the largest n that still improves our position. An unconditional
	// two-for-one measured negative.
	best, bestN := b.eval(s, seat), 0
	for n := 1; n <= 2; n++ {
		if hand[give] < n {
			break
		}
		c := s.Clone()
		c.Players[seat].Hand[give] -= n
		c.Players[seat].Hand[want]++
		if v := b.eval(c, seat); v > best {
			best, bestN = v, n
		}
	}
	if b.ungatedOffers {
		bestN = 1
		if hand[give] >= 2 {
			bestN = 2
		}
	}
	if bestN == 0 {
		return engine.Command{}, false
	}
	var g, w engine.Hand
	g[give] = bestN
	w[want] = 1
	cmd := engine.Command{Player: seat, Type: engine.CmdOfferTrade,
		Data: raw2(engine.TradeOfferedData{Player: seat, Give: g, Want: w})}
	if _, err := engine.Decide(s.Clone(), cmd); err != nil {
		return engine.Command{}, false
	}
	return cmd, true
}

// shortfallFor returns the single resource standing between the bot and the
// build it most wants, reusing tradeTowardBuild's notion of "best build we
// cannot yet afford" so the offer and the bank lane chase the same target.
func (b *Strong) shortfallFor(s *engine.State, seat engine.PlayerID) (board.Resource, bool) {
	want, ok := b.wantedCost(s, seat)
	if !ok {
		return 0, false
	}
	hand := s.Players[seat].Hand
	short := 0
	var need board.Resource
	for _, r := range board.Resources {
		if d := want[r] - hand[r]; d > 0 {
			short += d
			need = r
		}
	}
	// Only when a single card away: one offer cannot close a two-card gap.
	if short != 1 {
		return 0, false
	}
	return need, true
}

// executeTrade settles our standing offer, against an acceptance or a counter.
//
// Both are scored by simulating the settlement: the cards are known, so there
// is nothing hidden to peek at. Counters are far more common than acceptances.
//
// A partner one build from winning is refused whatever the terms; the evaluator
// does not otherwise price who receives our cards.
func (b *Strong) executeTrade(s *engine.State, seat engine.PlayerID) (engine.Command, bool) {
	o := s.ActiveOffer
	if o == nil || o.By != seat || !b.playerTrades {
		return engine.Command{}, false
	}
	partners := append([]engine.PlayerID(nil), o.Accepted...)
	for _, c := range o.Counters {
		partners = append(partners, c.By)
	}

	base := b.eval(s, seat)
	best, bestScore := engine.NoPlayer, base
	for _, p := range partners {
		// Use the partner's own threshold (engine.WinThreshold): the Fishermen
		// boot raises it by one.
		if s.PublicVPWithModules(p) >= engine.WinThreshold(s, p)-1 {
			continue // never feed a player one build from the win
		}
		cmd := engine.Command{Player: seat, Type: engine.CmdExecuteTrade,
			Data: raw2(map[string]any{"with": p})}
		sc, ok := b.score(s, seat, cmd)
		if !ok {
			continue
		}
		// Ties break toward the player furthest from winning.
		if sc > bestScore+1e-9 || (best != engine.NoPlayer && sc > bestScore-1e-9 &&
			s.PublicVPWithModules(p) < s.PublicVPWithModules(best)) {
			best, bestScore = p, sc
		}
	}
	if best == engine.NoPlayer {
		return engine.Command{}, false
	}
	return engine.Command{Player: seat, Type: engine.CmdExecuteTrade,
		Data: raw2(map[string]any{"with": best})}, true
}
