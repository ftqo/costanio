package raiders

import (
	"encoding/json"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// Gold is a counter, and each seat's total is public.
//
// Decision: the supply is unbounded. The rules never depend on running out, and
// a UI counter needs no denominations.
//
// Gold is not a resource: it does not count toward the 7-discard, cannot be
// taken by the 7-steal, and no effect naming resource cards sees it. This
// module registers no ExtraDiscardCount or DiscardLimitDelta, so the base
// hand-size arithmetic never sees it.
//
// Sources: 3 per rider of yours removed as a loss; 3 for rolling off in a
// prisoner split and coming away empty; 2 from Treason; maritime trade. Spent
// on a bank resource and in player trades.

// goldTradePayload is what rides in a player trade's opaque module slot.
// Several modules may each be handed the same blob: an unrecognised shape
// decodes to zero and this module reports (0, true), as TradeExtraHeld
// requires.
type goldTradePayload struct {
	Gold int `json:"gold,omitempty"`
}

func decodeGold(extra json.RawMessage) int {
	if len(extra) == 0 {
		return 0
	}
	var p goldTradePayload
	if err := json.Unmarshal(extra, &p); err != nil || p.Gold <= 0 {
		return 0
	}
	return p.Gold
}

// tradeGoldHeld reports how many cards a trade payload's gold represents and
// whether p can back it. Gold may be on either side of a player trade, in any
// mix with resources.
func (Module) tradeGoldHeld(s *engine.State, p engine.PlayerID, extra json.RawMessage) (int, bool) {
	n := decodeGold(extra)
	if n == 0 {
		return 0, true
	}
	return n, GoldOf(s, p) >= n
}

// tradeGoldEvents moves the gold a settled trade agreed.
func (Module) tradeGoldEvents(s *engine.State, from, to engine.PlayerID, extra json.RawMessage) []engine.Event {
	n := decodeGold(extra)
	if n == 0 {
		return nil
	}
	return []engine.Event{engine.NewEvent(EvGoldTransfer,
		goldTransferData{From: from, To: to, Gold: n})}
}

// decideBuyResource buys one resource from the bank for 2 gold, at most twice
// per turn. If the bank has none of that resource, the purchase is refused
// before the gold is spent.
func (Module) decideBuyResource(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	if err := engine.RequireActionableTurn(s, cmd.Player); err != nil {
		return nil, err
	}
	x := extRO(s)
	d, err := engine.DecodeCommand[struct {
		Res board.Resource `json:"res"`
	}](cmd.Data)
	if err != nil {
		return nil, err
	}
	if !d.Res.Producing() {
		return nil, engine.ErrBadCommand
	}
	if x.Buys >= goldBuysPerTurn {
		return nil, ErrGoldBuysUsed
	}
	if x.Gold[cmd.Player] < goldPerResource {
		return nil, ErrNoGold
	}
	if s.Bank[d.Res] < 1 {
		return nil, engine.ErrNoResources
	}
	return []engine.Event{engine.NewEvent(EvGoldSpent,
		goldSpentData{Player: cmd.Player, Res: d.Res, Gold: goldPerResource})}, nil
}

// GoldRatio is what maritime trade charges seat p for one gold, in cards of
// resource res: 4 identical resources, 3 at a generic harbour, 2 at that
// resource's own harbour.
//
// The rate comes from State.CurrencyRatio, which also honours a module's rate
// override (a Merchant Fleet's 2:1). A harbour at a building switched off by
// conquest does not count, as for resource trades.
//
// Exported so a client can price the sale and a bot can value it. Zero when the
// scenario is not running.
func GoldRatio(s *engine.State, p engine.PlayerID, res board.Resource) int {
	if !active(s) {
		return 0
	}
	return s.CurrencyRatio(p, res)
}

// decideSellForGold turns identical resources into gold at the maritime rate.
//
// Decision: implemented although strictly dominated (two gold buy one resource,
// so 4 resources for 1 gold is half the 4:1 bank trade). It is in the
// scenario's rules and a player who tries it should get the rule, not a
// refusal.
func (Module) decideSellForGold(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	if err := engine.RequireActionableTurn(s, cmd.Player); err != nil {
		return nil, err
	}
	d, err := engine.DecodeCommand[struct {
		Res   board.Resource `json:"res"`
		Count int            `json:"count"`
	}](cmd.Data)
	if err != nil {
		return nil, err
	}
	if !d.Res.Producing() {
		return nil, engine.ErrBadCommand
	}
	if d.Count <= 0 {
		d.Count = 1
	}
	ratio := s.CurrencyRatio(cmd.Player, d.Res)
	// Bound the ask by the hand before multiplying, so no client-supplied count
	// can overflow ratio*count past the affordability check.
	if d.Count > s.Players[cmd.Player].Hand[d.Res] {
		return nil, engine.ErrNoResources
	}
	var give engine.Hand
	give[d.Res] = ratio * d.Count
	if !s.Players[cmd.Player].Hand.Has(give) {
		return nil, engine.ErrNoResources
	}
	return []engine.Event{engine.NewEvent(EvGoldGained,
		goldGainedData{Player: cmd.Player, Give: give, Gold: d.Count})}, nil
}

// --- The 7 -----------------------------------------------------------------

// onSeven opens this scenario's 7: there is no robber, so nothing is moved or
// blocked. Every player over the limit discards half (gold is not counted),
// then the active player takes one random resource card from a player of their
// choice.
//
// The choice is a pending rather than part of the roll because the victim is
// picked after the discards: a seat that discards to nothing is not a legal
// target, and the discards have not happened when this hook runs.
func (Module) onSeven(s *engine.State) []engine.Event {
	if s.Cur < 0 || int(s.Cur) >= len(s.Players) {
		return nil
	}
	return []engine.Event{engine.NewEvent(EvSevenOpened, sevenData{Player: s.Cur})}
}

// stealVictims is every seat other than the thief holding at least one resource
// card, in seat order.
func stealVictims(s *engine.State, thief engine.PlayerID) []engine.PlayerID {
	var out []engine.PlayerID
	for i := range s.Players {
		p := engine.PlayerID(i)
		if p == thief || s.Players[p].Hand.Count() == 0 {
			continue
		}
		if s.FriendlyRobberProtected(p) {
			continue
		}
		out = append(out, p)
	}
	return out
}

// decideSteal resolves the 7's take.
func (Module) decideSteal(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	x := extRO(s)
	if x.Pend.Kind != PendSteal || x.Pend.Seat != cmd.Player {
		return nil, engine.ErrWrongPhase
	}
	if len(s.PendingDiscards) > 0 {
		return nil, engine.ErrDiscardPending
	}
	d, err := engine.DecodeCommand[struct {
		Victim *engine.PlayerID `json:"victim"`
	}](cmd.Data)
	if err != nil {
		return nil, err
	}
	victims := stealVictims(s, cmd.Player)
	if len(victims) == 0 {
		if d.Victim != nil {
			return nil, engine.ErrBadVictim
		}
		return []engine.Event{engine.NewEvent(EvSevenStolen,
			stolenData{Thief: cmd.Player, Victim: engine.NoPlayer, Nothing: true})}, nil
	}
	if d.Victim == nil {
		return nil, engine.ErrBadVictim
	}
	victim := *d.Victim
	found := false
	for _, v := range victims {
		if v == victim {
			found = true
		}
	}
	if !found {
		return nil, engine.ErrBadVictim
	}
	// The card is hidden information, so it comes off the private stream, keyed
	// to the log position of the event it produces (engine.RngFor).
	res, ok := engine.RandomCard(engine.RngFor(s, 0), s.Players[victim].Hand)
	if !ok {
		return []engine.Event{engine.NewEvent(EvSevenStolen,
			stolenData{Thief: cmd.Player, Victim: engine.NoPlayer, Nothing: true})}, nil
	}
	return []engine.Event{engine.NewEvent(EvSevenStolen,
		stolenData{Thief: cmd.Player, Victim: victim, Res: res}, cmd.Player, victim)}, nil
}
