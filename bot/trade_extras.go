package bot

import (
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/raiders"
	"github.com/ftqo/costan.io/engine/rivers"
	"github.com/ftqo/costan.io/engine/wagons"
)

func hasTradeExtras(o *engine.TradeOffer) bool {
	return len(o.GiveCom) > 0 || len(o.WantCom) > 0
}

// previewTradeResponse applies the public terms and checks only the responder's
// own ability to pay. Running ExecuteTrade here would inspect the offerer's
// hidden hand and victory cards. An offer already advertises its stake; neither
// those other cards nor a hypothetical victory may inform the response.
func previewTradeResponse(s *engine.State, seat engine.PlayerID) (*engine.State, bool) {
	o := s.ActiveOffer
	if !s.Players[seat].Hand.Has(o.Want) {
		return nil, false
	}
	after := s.Clone()
	after.Players[seat].Hand.Add(o.Give)
	after.Players[seat].Hand.Sub(o.Want)
	if !hasTradeExtras(o) {
		return after, true
	}
	for _, m := range s.Modules() {
		if h := m.Hooks().TradeExtraHeld; h != nil {
			if n, held := h(s, seat, o.WantCom); n > 0 && !held {
				return nil, false
			}
		}
	}
	var events []engine.Event
	for _, m := range s.Modules() {
		if h := m.Hooks().TradeExtraEvents; h != nil {
			events = append(events, h(s, o.By, seat, o.GiveCom)...)
			events = append(events, h(s, seat, o.By, o.WantCom)...)
		}
	}
	apply := func(e engine.Event) bool {
		e.Seq = after.NextSeq
		return engine.Apply(after, e) == nil
	}
	for _, e := range events {
		if !apply(e) {
			return nil, false
		}
	}
	// Public standings, particularly the Rivers wealth tiles, change with coins.
	for _, m := range after.Modules() {
		if h := m.Hooks().AfterEvents; h != nil {
			for _, e := range h(after, events) {
				if !apply(e) {
					return nil, false
				}
				events = append(events, e)
			}
		}
	}
	return after, true
}

// A currency offered to another player keeps its future purchasing value even
// beyond this turn's spending cap. The normal build evaluator caps the Rivers
// reserve and does not carry a Raiders/Wagons reserve, so supplement those terms
// when pricing trades. Shared Rivers/Wagons coins are counted once.
func (b *Strong) tradeValue(s *engine.State, seat engine.PlayerID, extras bool) float64 {
	v := b.withFollowUp(s, seat)
	if !extras {
		return v
	}
	coins := 0
	if x, ok := rivers.StateExt(s); ok {
		coins += max(0, x.Coins[seat]-coinHoldCap)
	}
	if x, ok := raiders.StateExt(s); ok {
		coins += x.Gold[seat]
	}
	if x, ok := wagons.StateExt(s); ok && !x.SharedCurrency {
		coins += wagons.Gold(s, seat)
	}
	return v + coinHoldWeightDefault*float64(coins)
}
