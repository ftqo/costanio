package bot

import (
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// declineOffer is a bot's explicit "no" to the standing offer. Every bot that
// trades answers every offer aimed at it, so the offerer's card can resolve as
// soon as the table has spoken rather than when the offer times out.
func declineOffer(seat engine.PlayerID) engine.Command {
	return engine.Command{Player: seat, Type: engine.CmdRespondTrade,
		Data: raw2(map[string]any{"accept": false})}
}

// respond decides how the bot reacts to an offer it did not make: accept when
// settling would improve its position, counter a near miss, or abstain.
//
// Acceptance is decided by the evaluator on the resulting position. Comparing
// resource weights almost never accepts, since the requested card is usually
// the more valuable one by construction.
//
// Refuses to trade with a player one build from winning, whatever the terms.
func (b *Strong) respond(s *engine.State, seat engine.PlayerID) (engine.Command, bool) {
	if b.acceptProbe != nil {
		b.acceptProbe()
	}
	o := s.ActiveOffer
	hand := s.Players[seat].Hand
	phase := gamePhase(s, seat)
	if !hand.Has(o.Want) {
		return engine.Command{}, false // cannot pay
	}

	// Use the offerer's own threshold (engine.WinThreshold): the Fishermen boot
	// raises it by one.
	if s.PublicVPWithModules(o.By) >= engine.WinThreshold(s, o.By)-1 {
		return engine.Command{}, false
	}

	// The cloned acceptance policy, when enabled, replaces the evaluator's
	// judgement. The leader refusal above still applies; human data cannot
	// distinguish it from declining a bad price.
	if b.acceptThreshold > 0 && !hasTradeExtras(o) {
		p, ok := b.acceptProbability(s, seat)
		if !ok {
			return engine.Command{}, false
		}
		if p < b.acceptThreshold {
			return engine.Command{}, false
		}
		return engine.Command{Player: seat, Type: engine.CmdRespondTrade,
			Data: raw2(map[string]any{"accept": true})}, true
	}

	// Would settling improve our position? The cards are known, so simulating
	// reveals nothing hidden.
	after, ok := previewTradeResponse(s, seat)
	if !ok {
		return engine.Command{}, false
	}
	// Judge the trade by what it lets us build: a one-for-one swap barely moves
	// the evaluator, so score the best follow-up on each side (as lookahead does).
	if b.tradeValue(after, seat, hasTradeExtras(o)) > b.tradeValue(s, seat, hasTradeExtras(o))+1e-9 {
		return engine.Command{Player: seat, Type: engine.CmdRespondTrade,
			Data: raw2(map[string]any{"accept": true})}, true
	}

	// Near miss: we want what is on the table but not at this price. Counter with
	// one card of our most abundant resource for exactly what was offered.
	if o.Give.Count() == 0 {
		return engine.Command{}, false
	}
	best := board.Resource(0)
	for _, r := range board.Resources {
		if hand[r] > hand[best] {
			best = r
		}
	}
	if best == 0 || hand[best] == 0 {
		return engine.Command{}, false
	}
	want := o.Give
	if want[best] > 0 {
		return engine.Command{}, false // same-resource churn
	}
	var give engine.Hand
	give[best] = 1
	counter := s.Clone()
	counter.Players[seat].Hand.Add(want)
	counter.Players[seat].Hand.Sub(give)
	if !counter.Players[seat].Hand.NonNegative() || b.withFollowUp(counter, seat) <= b.withFollowUp(s, seat)+1e-9 {
		return engine.Command{}, false
	}
	_ = phase
	return engine.Command{Player: seat, Type: engine.CmdCounterTrade,
		Data: raw2(map[string]any{"give": give, "want": want})}, true
}

// withFollowUp scores a position by the better of standing pat and taking the
// single best action available from it.
//
// Cards are only worth what they buy, so a trade has to be priced on the build
// it unlocks. Evaluating the resulting hand alone cannot see that.
func (b *Strong) withFollowUp(s *engine.State, seat engine.PlayerID) float64 {
	best := b.eval(s, seat)
	// The follow-up is found on a seat-local clone with the turn handed over, so
	// bestPlay will generate this seat's builds even when it is not their turn.
	c := s.Clone()
	c.Cur = seat
	c.Rolled = true
	c.ActiveOffer = nil
	plain := *b
	plain.lookahead = 0 // one probe, not a nested search
	cmd, ok := plain.bestPlay(c, seat)
	if !ok {
		return best
	}
	after := c.Clone()
	if err := engine.DecideForEval(after, cmd); err != nil {
		return best
	}
	if v := b.eval(after, seat); v > best {
		return v
	}
	return best
}
