package engine

import (
	"encoding/json"

	"github.com/ftqo/costan.io/engine/board"
)

// tradeExtraHeld sums a module trade payload's card count and reports whether
// player p holds it all. Only one module owns a given payload; others report
// (0, true), so the sum and the AND are well-defined.
func (s *State) tradeExtraHeld(p PlayerID, extra json.RawMessage) (count int, held bool) {
	held = true
	for _, m := range s.Modules() {
		if h := m.Hooks().TradeExtraHeld; h != nil {
			if n, ok := h(s, p, extra); n > 0 {
				count += n
				if !ok {
					held = false
				}
			}
		}
	}
	return count, held
}

// tradeExtraEvents collects the events that move a module trade payload from→to.
func (s *State) tradeExtraEvents(from, to PlayerID, extra json.RawMessage) []Event {
	var out []Event
	for _, m := range s.Modules() {
		if h := m.Hooks().TradeExtraEvents; h != nil {
			out = append(out, h(s, from, to, extra)...)
		}
	}
	return out
}

// bankRatios returns the player's best exchange rate for every resource, in one
// pass over the board: 4 by default, 3 with any generic harbor, 2 with that
// resource's own harbor, less if a module offers less.
//
// It takes the minimum over every source with no early exit on a 2:1 harbor,
// since a module hook may offer better than 2. A basket trade prices several
// kinds at once, so the whole vector is computed together; bankRatio below is a
// lookup into it.
func (s *State) bankRatios(p PlayerID) [6]int {
	var out [6]int
	for _, r := range board.Resources {
		out[r] = 4
	}
	for v, b := range s.Buildings {
		if b.Owner != p {
			continue
		}
		// A building a module has switched off cannot use its harbour (a Raiders
		// building with no unconquered neighbour). See Hooks.BuildingInert.
		if BuildingIsInert(s, v) {
			continue
		}
		h, ok := s.Board.HarborAt(v)
		if !ok {
			continue
		}
		// h.Res is a tradable resource on generated boards, but a hand-authored
		// map is untrusted: check before indexing.
		if h.Ratio == 2 && validResource(h.Res) && out[h.Res] > 2 {
			out[h.Res] = 2
		}
		if h.Ratio == 3 {
			for _, r := range board.Resources {
				if out[r] > 3 {
					out[r] = 3
				}
			}
		}
	}
	for _, m := range s.Modules() {
		hk := m.Hooks().BankRatio
		if hk == nil {
			continue
		}
		for _, r := range board.Resources {
			if ratio, ok := hk(s, p, r); ok && ratio < out[r] {
				out[r] = ratio
			}
		}
	}
	// A rate is a divisor and a price. Even a misbehaving module may not make it
	// zero (a free card) or negative.
	for _, r := range board.Resources {
		if out[r] < 1 {
			out[r] = 1
		}
	}
	return out
}

// bankRatio returns the player's best exchange rate for one resource.
func (s *State) bankRatio(p PlayerID, res board.Resource) int {
	if !validResource(res) {
		return 4
	}
	return s.bankRatios(p)[res]
}

// bankTradeCmd is the maritime trade payload, in either of two shapes:
//
//	{"give":"wheat","get":"ore","count":2}                  one kind for one kind
//	{"spend":[0,2,2,0,0,0],"want":[0,0,0,2,0,0]}            a whole basket
//
// The presence of "want" selects the basket form. Both stay supported: the
// scalar form is what bots emit and what older clients send. Neither needs a new
// event type (see decideBankBasket).
type bankTradeCmd struct {
	Give  board.Resource `json:"give"`
	Get   board.Resource `json:"get"`
	Count int            `json:"count"` // how many cards of Get to receive

	// Spend is what the player puts up, per resource. Omitted means "charge me
	// the cheapest legal payment for Want".
	Spend *Hand `json:"spend,omitempty"`
	// Want is what the player takes, per resource. Its presence selects the
	// basket form.
	Want *Hand `json:"want,omitempty"`
}

func decideBankTrade(s *State, cmd Command) ([]Event, error) {
	if err := requireBuildTurn(s, cmd.Player); err != nil {
		return nil, err
	}
	d, err := decodeCmd[bankTradeCmd](cmd.Data)
	if err != nil {
		return nil, err
	}
	if d.Want != nil {
		return decideBankBasket(s, cmd.Player, d.Spend, *d.Want)
	}
	if !validResource(d.Give) || !validResource(d.Get) {
		return nil, ErrBadCommand
	}
	if d.Give == d.Get {
		return nil, ErrSameResource // no like-for-like maritime trade
	}
	if d.Count <= 0 {
		d.Count = 1
	}
	// Bound Count by the bank before any arithmetic so a huge client value
	// can't overflow ratio*Count past the affordability checks.
	if s.Bank[d.Get] < d.Count {
		return nil, ErrNoResources
	}
	ratio := s.bankRatio(cmd.Player, d.Give)
	var give, get Hand
	give[d.Give] = ratio * d.Count
	get[d.Get] = d.Count
	if !s.Players[cmd.Player].Hand.Has(give) {
		return nil, ErrNoResources
	}
	return []Event{mustEvent(EvBankTraded, BankTradedData{Player: cmd.Player, Give: give, Get: get})}, nil
}

// decideBankBasket settles a whole maritime trade at once: any mix of give
// kinds funding any mix of take kinds, each give kind at its own rate. A player
// with 2:1 wood and 2:1 brick harbors pays 2 wood + 2 brick for 2 sheep in one
// command.
//
// The rule, given the player's rate r(g) for each kind:
//
//	L1 the ask is non-empty
//	L2 no kind appears on both sides
//	L3 r(g) divides spend(g), for every g
//	L4 sum(spend(g)/r(g)) equals the total asked for
//	L5 the player holds spend
//	L6 the bank holds the ask
//
// L3 and L4 make payment exact: no partial trade, no burned card, no change. L2
// matches ErrSameResource on the scalar path and handsOverlap for player trades,
// and keeps L3/L4 exact: without it, {spend: 4 ore, want: 1 ore + 1 brick} at
// 2:1 ore would pass while trading ore for ore.
//
// No search is needed because each resource has one price per player:
// bankRatios reduces harbors and hooks to a single minimum, and no rate is
// metered (the Knights lane in engine/knights/hooks.go is a flat 2 while the
// Merchant Fleet or merchant names the resource). A quantity-dependent rate
// would break per-kind division and make affordability a search.
//
// The basket is one EvBankTraded (Give and Get are already full hands with an
// additive fold), so the schema is unchanged, old trades replay unchanged, and
// the trade is atomic.
func decideBankBasket(s *State, p PlayerID, spend *Hand, want Hand) ([]Event, error) {
	if !want.NonNegative() || want[board.ResNone] != 0 {
		return nil, ErrBadCommand
	}
	if spend != nil && (!spend.NonNegative() || spend[board.ResNone] != 0) {
		return nil, ErrBadCommand
	}
	// L6 first, before any arithmetic: the bank's stock bounds every entry
	// of want, so no client number can overflow a later sum.
	if !s.Bank.Has(want) {
		return nil, ErrNoResources
	}
	get := want.Count()
	if get < 1 {
		return nil, ErrBadCommand // L1: a trade has to do something
	}
	ratios := s.bankRatios(p)
	if spend == nil {
		// No stake stated: charge the cheapest legal payment. The answer is then
		// put through the same predicate as a client-stated one.
		solved, ok := solveBankSpend(ratios, s.Players[p].Hand, want)
		if !ok {
			return nil, ErrNoResources
		}
		spend = &solved
	}
	// L5, also before the arithmetic, so every entry of spend is bounded
	// too.
	if !s.Players[p].Hand.Has(*spend) {
		return nil, ErrNoResources
	}
	if handsOverlap(*spend, want) {
		return nil, ErrSameResource // L2
	}
	units := 0
	for _, r := range board.Resources {
		n := spend[r]
		if n == 0 {
			continue
		}
		if n%ratios[r] != 0 {
			return nil, ErrBadTrade // L3
		}
		units += n / ratios[r]
	}
	if units != get {
		return nil, ErrBadTrade // L4
	}
	return []Event{mustEvent(EvBankTraded, BankTradedData{Player: p, Give: *spend, Get: want})}, nil
}

// SolveBankSpend picks the cheapest legal payment for want out of pool, at the
// player's own rates, or reports that pool cannot fund it. pool is what may be
// spent: the player's hand, or less for a bot holding cards back.
//
// Exported for the bots and client hints. It is not part of the legality test: a
// player may pay with wheat when ore would be cheaper.
func (s *State) SolveBankSpend(p PlayerID, pool, want Hand) (Hand, bool) {
	return solveBankSpend(s.bankRatios(p), pool, want)
}

// solveBankSpend spends cheapest kinds first, exhausting each before moving on.
// Greedy is optimal because each kind's price is independent of the others and
// of quantity. A metered or shared rate ("one 2:1 trade per turn") would break
// that; TestSolveBankSpendIsOptimal checks it.
//
// Kinds are considered in (rate, resource index) order, never map order, so the
// answer is deterministic.
func solveBankSpend(ratios [6]int, pool, want Hand) (Hand, bool) {
	var spend Hand
	var used [6]bool
	left := want.Count()
	for left > 0 {
		next := board.ResNone
		for _, r := range board.Resources {
			if used[r] || want[r] > 0 || pool[r] < ratios[r] {
				continue // spent already, being bought (L2), or can't fund a unit
			}
			if next == board.ResNone || ratios[r] < ratios[next] {
				next = r
			}
		}
		if next == board.ResNone {
			return Hand{}, false
		}
		used[next] = true
		units := min(pool[next]/ratios[next], left)
		spend[next] = units * ratios[next]
		left -= units
	}
	return spend, true
}

// BankRatio is the maritime trade ratio a player gets for a resource, after
// harbors and any module override (Knights Merchant Fleet). Exported for tests and
// client hints.
func (s *State) BankRatio(p PlayerID, res board.Resource) int {
	return s.bankRatio(p, res)
}

// BankRatios is BankRatio for every resource at once, indexed by
// board.Resource (index 0 unused). Exported for the per-viewer game view.
func (s *State) BankRatios(p PlayerID) [6]int {
	return s.bankRatios(p)
}

func validResource(r board.Resource) bool {
	return r >= board.Wood && r <= board.Ore
}

// handsOverlap reports whether any resource type appears on both sides of a
// trade. Trading matching resources (3 ore for 1 ore) is forbidden, even when
// other resources are also exchanged.
func handsOverlap(give, want Hand) bool {
	for i := range give {
		if give[i] > 0 && want[i] > 0 {
			return true
		}
	}
	return false
}

func decideOfferTrade(s *State, cmd Command) ([]Event, error) {
	if err := requireBuildTurn(s, cmd.Player); err != nil {
		return nil, err
	}
	d, err := decodeCmd[TradeOfferedData](cmd.Data)
	if err != nil {
		return nil, err
	}
	if !d.Give.NonNegative() || !d.Want.NonNegative() {
		return nil, ErrBadCommand
	}
	if !s.Players[cmd.Player].Hand.Has(d.Give) {
		return nil, ErrNoResources
	}
	giveComN, held := s.tradeExtraHeld(cmd.Player, d.GiveCom)
	if !held {
		return nil, ErrNoResources // offering module cards you don't hold
	}
	wantComN, _ := s.tradeExtraHeld(cmd.Player, d.WantCom) // count only; needn't hold what you want
	if d.Give.Count()+giveComN == 0 || d.Want.Count()+wantComN == 0 {
		return nil, ErrBadCommand // each side must put up at least one card
	}
	if handsOverlap(d.Give, d.Want) {
		return nil, ErrSameResource // no like-for-like resource trade
	}
	// A new offer silently replaces any open one.
	return []Event{mustEvent(EvTradeOffered, TradeOfferedData{
		Player: cmd.Player, Give: d.Give, Want: d.Want, GiveCom: d.GiveCom, WantCom: d.WantCom,
	})}, nil
}

// decideRespondTrade records (or revises) one seat's answer to the standing
// offer. A seat may change its answer while the offer stands (accept, decline,
// accept again, or retract), so a mis-click does not lock it out.
//
// Repeating the answer already on record gets ErrAlreadyResponded rather than a
// duplicate event, so a stuck client cannot flood the log. Revision cannot race an
// execute because one goroutine owns the game: a retraction lands either before
// decideExecuteTrade reads the offer (which then fails ErrBadVictim) or after it
// is settled (ErrNoOffer).
func decideRespondTrade(s *State, cmd Command) ([]Event, error) {
	if s.Phase != PhasePlay || s.ActiveOffer == nil {
		return nil, ErrNoOffer
	}
	if cmd.Player == s.ActiveOffer.By {
		return nil, ErrBadCommand // the offerer cancels or executes instead
	}
	d, err := decodeCmd[TradeRespondedData](cmd.Data)
	if err != nil {
		return nil, err
	}
	answered, accepted := s.ActiveOffer.respondedAccept(cmd.Player)
	if d.Retract {
		if !answered {
			return nil, ErrNoResponse
		}
		return []Event{mustEvent(EvTradeResponded, TradeRespondedData{Player: cmd.Player, Retract: true})}, nil
	}
	// A counter is an answer but neither of these, so re-answering after a
	// counter always says something new.
	if answered && accepted == d.Accept && !s.ActiveOffer.isCounterer(cmd.Player) {
		return nil, ErrAlreadyResponded
	}
	if d.Accept {
		if !s.Players[cmd.Player].Hand.Has(s.ActiveOffer.Want) {
			return nil, ErrNoResources
		}
		if _, held := s.tradeExtraHeld(cmd.Player, s.ActiveOffer.WantCom); !held {
			return nil, ErrNoResources
		}
	}
	return []Event{mustEvent(EvTradeResponded, TradeRespondedData{Player: cmd.Player, Accept: d.Accept})}, nil
}

func decideExecuteTrade(s *State, cmd Command) ([]Event, error) {
	if s.Phase != PhasePlay || s.ActiveOffer == nil {
		return nil, ErrNoOffer
	}
	o := s.ActiveOffer
	if cmd.Player != o.By {
		return nil, ErrNotYourTurn
	}
	d, err := decodeCmd[struct {
		With PlayerID `json:"with"`
	}](cmd.Data)
	if err != nil {
		return nil, err
	}
	// Resolve the deal terms. A plain acceptance settles on the offer's terms;
	// a counter settles on the counter-er's terms, mirrored onto the offerer's
	// side. give flows By→With, want flows With→By, in every case.
	var give, want Hand
	var giveCom, wantCom json.RawMessage
	switch {
	case o.accepted(d.With):
		give, want, giveCom, wantCom = o.Give, o.Want, o.GiveCom, o.WantCom
	default:
		c, ok := o.counterBy(d.With)
		if !ok {
			return nil, ErrBadVictim
		}
		// The counter-er (With) gives c.Give and wants c.Want from the offerer.
		give, want, giveCom, wantCom = c.Want, c.Give, c.WantCom, c.GiveCom
	}
	// Re-validate both hands (resources + module cards) at execution time.
	if !s.Players[o.By].Hand.Has(give) || !s.Players[d.With].Hand.Has(want) {
		return nil, ErrNoResources
	}
	if _, held := s.tradeExtraHeld(o.By, giveCom); !held {
		return nil, ErrNoResources
	}
	if _, held := s.tradeExtraHeld(d.With, wantCom); !held {
		return nil, ErrNoResources
	}
	events := []Event{mustEvent(EvTradeExecuted, TradeExecutedData{By: o.By, With: d.With, Give: give, Want: want})}
	events = append(events, s.tradeExtraEvents(o.By, d.With, giveCom)...)
	events = append(events, s.tradeExtraEvents(d.With, o.By, wantCom)...)
	return events, nil
}

func decideCancelTrade(s *State, cmd Command) ([]Event, error) {
	if s.Phase != PhasePlay || s.ActiveOffer == nil {
		return nil, ErrNoOffer
	}
	if cmd.Player != s.ActiveOffer.By {
		return nil, ErrNotYourTurn
	}
	return []Event{mustEvent(EvTradeCancelled, struct{}{})}, nil
}

// decideCounterTrade lets a non-active player post their own terms against the
// standing offer. Gated like decideRespondTrade, validated like
// decideOfferTrade. Terms are from the counter-er's side: Give is what they put
// up, Want is what they ask of the offerer.
//
// A seat has one counter at a time; countering again replaces it. There is no
// no-op check, since that would mean comparing opaque module payloads, and
// re-posting identical terms is harmless.
//
// One level deep only: the offerer can execute or ignore a counter, not counter
// it (see docs/protocol.md).
func decideCounterTrade(s *State, cmd Command) ([]Event, error) {
	if s.Phase != PhasePlay || s.ActiveOffer == nil {
		return nil, ErrNoOffer
	}
	if cmd.Player == s.ActiveOffer.By {
		return nil, ErrBadCommand // the offerer cancels or executes instead
	}
	d, err := decodeCmd[TradeCounteredData](cmd.Data)
	if err != nil {
		return nil, err
	}
	if !d.Give.NonNegative() || !d.Want.NonNegative() {
		return nil, ErrBadCommand
	}
	if !s.Players[cmd.Player].Hand.Has(d.Give) {
		return nil, ErrNoResources
	}
	giveComN, held := s.tradeExtraHeld(cmd.Player, d.GiveCom)
	if !held {
		return nil, ErrNoResources // countering with module cards you don't hold
	}
	wantComN, _ := s.tradeExtraHeld(cmd.Player, d.WantCom) // count only; needn't hold what you want
	if d.Give.Count()+giveComN == 0 || d.Want.Count()+wantComN == 0 {
		return nil, ErrBadCommand // each side must put up at least one card
	}
	if handsOverlap(d.Give, d.Want) {
		return nil, ErrSameResource // no like-for-like resource trade
	}
	return []Event{mustEvent(EvTradeCountered, TradeCounteredData{
		Player: cmd.Player, Give: d.Give, Want: d.Want, GiveCom: d.GiveCom, WantCom: d.WantCom,
	})}, nil
}

// CurrencyRatio is what one unit of a scenario currency (a Rivers coin, a
// Raiders or Wagons gold) costs seat p in cards of res, bought from the supply.
//
// It is the seat's ordinary maritime rate: 4:1, or 3:1/2:1 with a building at a
// port, including in combinations. We do not take the stricter reading that
// denies the 2:1 because a coin is not a resource. See docs/rules/wagons.md and
// docs/rules/rivers.md.
//
// All three currency scenarios call this so they agree, including on module
// overrides (a Merchant Fleet's 2:1, or a hook that worsens a rate), which live
// in BankRatio rather than on the board.
func (s *State) CurrencyRatio(p PlayerID, res board.Resource) int {
	return s.bankRatio(p, res)
}
