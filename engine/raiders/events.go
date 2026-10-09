package raiders

import (
	"encoding/json"
	"fmt"
	"slices"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// The scenario's commands.
const (
	CmdBuyCard      engine.CommandType = "raiders_buy_card"
	CmdPlaceRider   engine.CommandType = "raiders_place_rider"
	CmdMoveRider    engine.CommandType = "raiders_move_rider"
	CmdPickHex      engine.CommandType = "raiders_pick_hex"
	CmdTreason      engine.CommandType = "raiders_treason"
	CmdSteal        engine.CommandType = "raiders_steal"
	CmdBuyResource  engine.CommandType = "raiders_buy_resource"
	CmdSellForGold  engine.CommandType = "raiders_sell_for_gold"
	CmdDeclineOffer engine.CommandType = "raiders_decline"
)

// The scenario's events. All are public except the resource a 7 takes: nothing
// in this scenario is held in hand.
const (
	EvLanding      engine.EventType = "raiders_landing"
	EvLanded       engine.EventType = "raiders_landed"
	EvCard         engine.EventType = "raiders_card"
	EvRiderPlaced  engine.EventType = "raiders_rider_placed"
	EvRiderMoved   engine.EventType = "raiders_rider_moved"
	EvDeclined     engine.EventType = "raiders_declined"
	EvTreason      engine.EventType = "raiders_treason"
	EvIntrigue     engine.EventType = "raiders_intrigue"
	EvBattle       engine.EventType = "raiders_battle"
	EvSweep        engine.EventType = "raiders_sweep"
	EvSevenOpened  engine.EventType = "raiders_seven"
	EvSevenStolen  engine.EventType = "raiders_stolen"
	EvGoldSpent    engine.EventType = "raiders_gold_spent"
	EvGoldGained   engine.EventType = "raiders_gold_gained"
	EvGoldTransfer engine.EventType = "raiders_gold_moved"
)

// Card is one of the scenario's four development cards.
//
// It travels as a self-describing string, as board.Resource does, so the
// vocabulary is append-only and a client that does not know a card renders a
// generic line rather than misreading a renumbered int.
type Card int8

const (
	CardMuster Card = iota
	CardSwiftRider
	CardTreason
	CardIntrigue
	cardKinds
)

var cardNames = map[Card]string{
	CardMuster:     "muster",
	CardSwiftRider: "swift_rider",
	CardTreason:    "treason",
	CardIntrigue:   "intrigue",
}

var cardsByName = func() map[string]Card {
	out := make(map[string]Card, len(cardNames))
	for c, n := range cardNames {
		out[n] = c
	}
	return out
}()

func (c Card) String() string {
	if n, ok := cardNames[c]; ok {
		return n
	}
	return fmt.Sprintf("card(%d)", int8(c))
}

func (c Card) MarshalJSON() ([]byte, error) {
	n, ok := cardNames[c]
	if !ok {
		return nil, fmt.Errorf("raiders: unknown card %d", int8(c))
	}
	return json.Marshal(n)
}

func (c *Card) UnmarshalJSON(data []byte) error {
	var s string
	if err := json.Unmarshal(data, &s); err != nil {
		return fmt.Errorf("raiders: bad card %s", data)
	}
	v, ok := cardsByName[s]
	if !ok {
		return fmt.Errorf("raiders: unknown card %q", s)
	}
	*c = v
	return nil
}

// freshDeck is the composition, 14 : 4 : 4 : 4. The discards are reshuffled
// when the deck empties, so these counts only set the odds.
func freshDeck() [cardKinds]int {
	return [cardKinds]int{CardMuster: 14, CardSwiftRider: 4, CardTreason: 4, CardIntrigue: 4}
}

func deckCount(d [cardKinds]int) int {
	n := 0
	for _, c := range d {
		n += c
	}
	return n
}

// --- Event payloads --------------------------------------------------------

type landingData struct {
	Player engine.PlayerID `json:"player"`
	// Numbers is the whole queue this batch rolled: three distinct non-7
	// numbers per triggering build, in roll order. A batch with two builds
	// would queue six.
	Numbers []int `json:"numbers"`
}

type landedData struct {
	// Hex is where the raider went, or nil when the number named no eligible
	// hex (placing nothing, not re-rolled) or the supply ran out mid-landing.
	Hex *board.Hex `json:"hex,omitempty"`
	// Rest is the queue still outstanding after this one; empty ends the
	// landing. Carried explicitly rather than popped in the fold so one event
	// can end a landing early when the supply empties.
	Rest []int `json:"rest,omitempty"`
}

type cardData struct {
	Player engine.PlayerID `json:"player"`
	Card   Card            `json:"card"`
	// Void marks a card revealed and discarded with no effect: a Muster with no
	// rider left and no free castle path, an Intrigue drawn with no raider
	// anywhere to take (which redraws, so a Void Intrigue is followed by another
	// card in the same batch).
	Void bool `json:"void,omitempty"`
	// Gold is what the card paid on the spot (Treason's 2).
	Gold int `json:"gold,omitempty"`
	// Free marks a card granted rather than bought (the Fishermen seven-fish
	// spend), so the fold does not take the price.
	Free bool `json:"free,omitempty"`
}

type riderPlacedData struct {
	Player engine.PlayerID `json:"player"`
	E      board.Edge      `json:"e"`
	// Card names which card put it there, for the log line.
	Card Card `json:"card"`
}

type riderMovedData struct {
	Player engine.PlayerID `json:"player"`
	From   board.Edge      `json:"from"`
	To     board.Edge      `json:"to"`
	// Hurry is the 1 grain that raises this one rider from 3 paths to 5.
	Hurry bool `json:"hurry,omitempty"`
	// Fish marks a hurry paid in fish rather than grain (the Fishermen
	// combination: 2 fish instead of 1 grain). The fish leave in the
	// EvFishSpent that precedes this event; no grain is taken.
	Fish bool `json:"fish,omitempty"`
}

type declinedData struct {
	Player engine.PlayerID `json:"player"`
	Card   Card            `json:"card"`
}

// treasonMove is one raider Treason picks up and puts down. From is nil when it
// comes out of the supply instead, which the card allows only when fewer than
// two raiders are on the board.
type treasonMove struct {
	From *board.Hex `json:"from,omitempty"`
	To   board.Hex  `json:"to"`
}

type treasonData struct {
	Player engine.PlayerID `json:"player"`
	Moves  []treasonMove   `json:"moves,omitempty"`
}

type intrigueData struct {
	Player engine.PlayerID `json:"player"`
	Hex    board.Hex       `json:"hex"`
}

// seatCount is a per-seat number in a battle result: prisoners taken, or gold.
type seatCount struct {
	Player engine.PlayerID `json:"player"`
	Count  int             `json:"count"`
}

// riderAt is one rider on the board, named by seat and path.
type riderAt struct {
	Player engine.PlayerID `json:"player"`
	E      board.Edge      `json:"e"`
}

// battleData is one whole battle, resolved. The sweep checks every coastal hex
// once in ascending (Q, R) and resolves each victory in full, losses included,
// before the next hex, so a rider lost here cannot defend the next one.
type battleData struct {
	Hex board.Hex `json:"hex"`
	// Raiders is how many stood there, all of whom become prisoners.
	Raiders int `json:"raiders"`
	// Strength is what beat them: the number of riders on the hex's six paths.
	Strength int `json:"strength"`
	// Involved is every rider that fought, in seat then path order.
	Involved []riderAt `json:"involved"`
	// Prisoners and Gold are the split, already settled. Gold covers both the
	// empty-handed roll-off consolation and the 3 per rider lost below.
	Prisoners []seatCount `json:"prisoners,omitempty"`
	Gold      []seatCount `json:"gold,omitempty"`
	// Die is the loss roll and Dir the edge direction it names, (die-1) mod 3.
	// Every involved rider standing on a path of that direction goes home.
	Die  int       `json:"die"`
	Dir  int       `json:"dir"`
	Lost []riderAt `json:"lost,omitempty"`
}

// sweepData opens the end-of-turn sweep. The battles that follow are separate
// events. It clears the per-turn bookkeeping (which riders moved, gold spent on
// resources) as an explicit fold step, so a client reading only the ext can
// tell which riders may move. See Ext.Moved.
type sweepData struct {
	Player engine.PlayerID `json:"player"`
}

type sevenData struct {
	Player engine.PlayerID `json:"player"`
}

// stolenData is the only payload in this scenario with something to hide: which
// resource the 7 took. Thief and victim see it; the redactor blanks it for
// everyone else.
type stolenData struct {
	Thief  engine.PlayerID `json:"thief"`
	Victim engine.PlayerID `json:"victim"`
	Res    board.Resource  `json:"res"`
	// Nothing marks a 7 that took nothing, because no seat had a card left.
	Nothing bool `json:"nothing,omitempty"`
}

type goldSpentData struct {
	Player engine.PlayerID `json:"player"`
	Res    board.Resource  `json:"res"`
	Gold   int             `json:"gold"`
}

type goldGainedData struct {
	Player engine.PlayerID `json:"player"`
	Give   engine.Hand     `json:"give"`
	Gold   int             `json:"gold"`
}

type goldTransferData struct {
	From engine.PlayerID `json:"from"`
	To   engine.PlayerID `json:"to"`
	Gold int             `json:"gold"`
}

func registerEvents() {
	// The 7's steal is the only hidden payload. The landing dice, loss die,
	// prisoner roll-offs and drawn cards are all public under the rules.
	engine.RegisterRedactor(EvSevenStolen, func(e engine.Event) json.RawMessage {
		d := engine.DecodeEvent[stolenData](e)
		public := map[string]any{"thief": d.Thief, "victim": d.Victim}
		if d.Nothing {
			public["nothing"] = true
		}
		raw, _ := json.Marshal(public)
		return raw
	})
	// Conquest switches a building off, and an inert building no longer joins
	// its owner's road and ship networks (engine/route.go). So every event that
	// can change a hex's conquest can change longest-route standings, and the
	// title is recomputed on the same batch.
	for _, t := range []engine.EventType{EvLanded, EvBattle, EvTreason, EvIntrigue, EvPathPlaced} {
		engine.RegisterRouteEvent(t)
	}
}

// --- Apply -----------------------------------------------------------------

// seatOK reports whether p is a seat this game has. Checked before any per-seat
// index in the fold, so a malformed or foreign log becomes
// engine.ErrMalformedEvent (paused-error, log preserved) rather than a panic or
// a misplaced write.
func seatOK(s *engine.State, p engine.PlayerID) bool { return p >= 0 && int(p) < len(s.Players) }

// Apply folds the scenario's events. It is reached only through State.Apply's
// default branch, so it never sees a base event; turn boundaries arrive as this
// module's own EvSweep.
func (Module) Apply(s *engine.State, e engine.Event) (bool, error) {
	x := ext(s)
	switch e.Type {
	case EvPathPlaced:
		d, err := engine.DecodeEventChecked[pathPlacedData](e)
		if err != nil {
			return true, err
		}
		if d.ID < 0 || d.ID >= len(x.PathFigures) || !x.PathFigures[d.ID].Alive {
			return true, engine.ErrBadCommand
		}
		x.PathFigures[d.ID].Hex, x.PathFigures[d.ID].Edge, x.PathFigures[d.ID].OnPath = d.Hex, d.E, true
		if len(x.PathQueue) > 0 && x.PathQueue[0] == d.ID {
			x.PathQueue = x.PathQueue[1:]
		}
		x.syncCounts()
		x.refreshPaths(s)
	case EvLanding:
		d, err := engine.DecodeEventChecked[landingData](e)
		if err != nil {
			return true, err
		}
		if !seatOK(s, d.Player) {
			return true, engine.MalformedEvent(e, "seat out of range")
		}
		x.Pend = Pending{Kind: PendLanding, Seat: d.Player, Numbers: slices.Clone(d.Numbers)}
		x.refreshChoices(s)

	case EvLanded:
		d, err := engine.DecodeEventChecked[landedData](e)
		if err != nil {
			return true, err
		}
		if d.Hex != nil {
			if i := x.coastIndex(*d.Hex); i >= 0 {
				x.RaiderCount[i]++
				if x.Shared {
					x.queueFigure(*d.Hex, s.Cur)
				}
				x.takeFromSupply(hasKnights(s))
			}
		}
		x.Pend.Numbers = slices.Clone(d.Rest)
		if len(x.Pend.Numbers) == 0 {
			x.clearPend()
		} else {
			x.refreshChoices(s)
		}

	case EvCard:
		d, err := engine.DecodeEventChecked[cardData](e)
		if err != nil {
			return true, err
		}
		if !seatOK(s, d.Player) {
			return true, engine.MalformedEvent(e, "seat out of range")
		}
		// Card's UnmarshalJSON already refuses unknown names, so this cannot
		// fire from a log; it guards a wrongly built in-process Payload.
		if d.Card < 0 || int(d.Card) >= len(x.Deck) {
			return true, engine.MalformedEvent(e, "card %d", d.Card)
		}
		if !d.Free {
			s.Players[d.Player].Hand.Sub(engine.CostDevCard)
			s.Bank.Add(engine.CostDevCard)
		}
		x.Deck[d.Card]--
		if deckCount(x.Deck) == 0 {
			// The discards are reshuffled and become the new deck.
			x.Deck = freshDeck()
		}
		x.Gold[d.Player] += d.Gold
		x.clearPend()
		if !d.Void {
			switch d.Card {
			case CardMuster:
				x.Pend = Pending{Kind: PendMuster, Seat: d.Player}
			case CardSwiftRider:
				x.Pend = Pending{Kind: PendSwift, Seat: d.Player}
			case CardTreason:
				x.Pend = Pending{Kind: PendTreason, Seat: d.Player}
			case CardIntrigue:
				x.Pend = Pending{Kind: PendIntrigue, Seat: d.Player}
			default:
				// cardKinds, the count sentinel. See deck.go's drawCards.
			}
			x.refreshChoices(s)
		}

	case EvRiderPlaced:
		d, err := engine.DecodeEventChecked[riderPlacedData](e)
		if err != nil {
			return true, err
		}
		if !seatOK(s, d.Player) {
			return true, engine.MalformedEvent(e, "seat out of range")
		}
		x.RiderAt[d.E] = d.Player
		x.RidersLeft[d.Player]--
		x.clearPend()

	case EvRiderMoved:
		d, err := engine.DecodeEventChecked[riderMovedData](e)
		if err != nil {
			return true, err
		}
		if !seatOK(s, d.Player) {
			return true, engine.MalformedEvent(e, "seat out of range")
		}
		delete(x.RiderAt, d.From)
		x.RiderAt[d.To] = d.Player
		x.markMoved(d.To)
		if d.Hurry && !d.Fish {
			var cost engine.Hand
			cost[board.Wheat] = 1
			s.Players[d.Player].Hand.Sub(cost)
			s.Bank.Add(cost)
		}

	case EvDeclined:
		x.clearPend()

	case EvTreason:
		d, err := engine.DecodeEventChecked[treasonData](e)
		if err != nil {
			return true, err
		}
		if !seatOK(s, d.Player) {
			return true, engine.MalformedEvent(e, "seat out of range")
		}
		for _, mv := range d.Moves {
			if x.Shared {
				if mv.From != nil {
					for id, r := range x.PathFigures {
						if r.Alive && r.Hex == *mv.From {
							x.PathFigures[id] = engine.PathRaider{Hex: mv.To, Alive: true}
							x.PathQueue = append(x.PathQueue, id)
							x.PathSeat = d.Player
							break
						}
					}
				} else {
					x.takeFromSupply(hasKnights(s))
					x.queueFigure(mv.To, d.Player)
				}
				continue
			}
			if mv.From != nil {
				if i := x.coastIndex(*mv.From); i >= 0 && x.RaiderCount[i] > 0 {
					x.RaiderCount[i]--
				}
			} else {
				x.takeFromSupply(hasKnights(s))
			}
			if i := x.coastIndex(mv.To); i >= 0 {
				x.RaiderCount[i]++
			}
		}
		x.clearPend()

	case EvIntrigue:
		d, err := engine.DecodeEventChecked[intrigueData](e)
		if err != nil {
			return true, err
		}
		if !seatOK(s, d.Player) {
			return true, engine.MalformedEvent(e, "seat out of range")
		}
		if x.Shared {
			if x.removeFigure(d.Hex) {
				x.Prisoners[d.Player]++
			}
		} else if i := x.coastIndex(d.Hex); i >= 0 && x.RaiderCount[i] > 0 {
			x.RaiderCount[i]--
			x.Prisoners[d.Player]++
		}
		x.clearPend()

	case EvSweep:
		x.Moved = map[board.Edge]bool{}
		x.Buys = 0

	case EvBattle:
		d, err := engine.DecodeEventChecked[battleData](e)
		if err != nil {
			return true, err
		}
		for _, p := range d.Prisoners {
			if !seatOK(s, p.Player) {
				return true, engine.MalformedEvent(e, "prisoners for seat %d", p.Player)
			}
		}
		for _, g := range d.Gold {
			if !seatOK(s, g.Player) {
				return true, engine.MalformedEvent(e, "gold for seat %d", g.Player)
			}
		}
		for _, l := range d.Lost {
			if !seatOK(s, l.Player) {
				return true, engine.MalformedEvent(e, "rider lost by seat %d", l.Player)
			}
		}
		if x.Shared {
			for x.removeFigure(d.Hex) {
			}
		}
		if i := x.coastIndex(d.Hex); i >= 0 {
			// Every raider on the hex becomes a prisoner. Prisoners never
			// return to the supply.
			x.RaiderCount[i] = 0
		}
		for _, p := range d.Prisoners {
			x.Prisoners[p.Player] += p.Count
		}
		for _, g := range d.Gold {
			x.Gold[g.Player] += g.Count
		}
		for _, l := range d.Lost {
			delete(x.RiderAt, l.E)
			x.RidersLeft[l.Player]++
		}

	case EvSevenOpened:
		d, err := engine.DecodeEventChecked[sevenData](e)
		if err != nil {
			return true, err
		}
		if !seatOK(s, d.Player) {
			return true, engine.MalformedEvent(e, "seat out of range")
		}
		x.Pend = Pending{Kind: PendSteal, Seat: d.Player}

	case EvSevenStolen:
		d, err := engine.DecodeEventChecked[stolenData](e)
		if err != nil {
			return true, err
		}
		if !d.Nothing {
			if !seatOK(s, d.Thief) || !seatOK(s, d.Victim) {
				return true, engine.MalformedEvent(e, "seat out of range")
			}
			if d.Res < board.Wood || d.Res > board.Ore {
				return true, engine.MalformedEvent(e, "resource %d", d.Res)
			}
		}
		if !d.Nothing {
			var h engine.Hand
			h[d.Res] = 1
			s.Players[d.Victim].Hand.Sub(h)
			s.Players[d.Thief].Hand.Add(h)
		}
		x.clearPend()

	case EvGoldSpent:
		d, err := engine.DecodeEventChecked[goldSpentData](e)
		if err != nil {
			return true, err
		}
		if !seatOK(s, d.Player) {
			return true, engine.MalformedEvent(e, "seat out of range")
		}
		if d.Res < board.Wood || d.Res > board.Ore {
			return true, engine.MalformedEvent(e, "resource %d", d.Res)
		}
		x.Gold[d.Player] -= d.Gold
		var h engine.Hand
		h[d.Res] = 1
		s.Players[d.Player].Hand.Add(h)
		s.Bank.Sub(h)
		x.Buys++

	case EvGoldGained:
		d, err := engine.DecodeEventChecked[goldGainedData](e)
		if err != nil {
			return true, err
		}
		if !seatOK(s, d.Player) {
			return true, engine.MalformedEvent(e, "seat out of range")
		}
		s.Players[d.Player].Hand.Sub(d.Give)
		s.Bank.Add(d.Give)
		x.Gold[d.Player] += d.Gold

	case EvConquest:
		if _, err := engine.DecodeEventChecked[conquestData](e); err != nil {
			return true, err
		}
		x.foldAnnounced(s)

	case EvGoldTransfer:
		d, err := engine.DecodeEventChecked[goldTransferData](e)
		if err != nil {
			return true, err
		}
		if !seatOK(s, d.From) || !seatOK(s, d.To) {
			return true, engine.MalformedEvent(e, "seat out of range")
		}
		x.Gold[d.From] -= d.Gold
		x.Gold[d.To] += d.Gold

	default:
		return false, nil
	}
	if x.Shared {
		x.syncCounts()
		x.refreshPaths(s)
	}
	return true, nil
}

func (e *Ext) clearPend() { e.Pend = Pending{Seat: engine.NoPlayer} }

// refreshChoices recomputes the current pending offer's candidate set, so a
// client reads the picks off the ext and Auto never re-derives them.
//
// It runs inside the fold and is a pure function of the state.
func (e *Ext) refreshChoices(s *engine.State) {
	e.Pend.Hexes, e.Pend.Edges, e.Pend.Count = nil, nil, 0
	switch e.Pend.Kind {
	case PendLanding:
		if len(e.Pend.Numbers) == 0 || s.Board == nil {
			return
		}
		for _, i := range e.landingCandidates(s.Board, e.Pend.Numbers[0]) {
			e.Pend.Hexes = append(e.Pend.Hexes, e.Coast[i])
		}
	case PendIntrigue:
		e.Pend.Hexes = e.occupiedCoast()
	case PendMuster:
		e.Pend.Edges = e.freePaths(e.castlePaths())
	case PendSwift:
		e.Pend.Edges = e.freePaths(e.allRiderPaths())
	case PendTreason:
		// Treason names its whole plan in one command, so the pick lists are
		// where a raider may be taken from and where one may be put.
		e.Pend.Hexes = e.unconqueredCoast()
		e.Pend.Count = treasonCount(e, hasKnights(s))
	}
}

// markMoved records that the rider now standing on ed has already moved this
// turn. EvSweep clears the set at every turn end; see Ext.Moved.
func (e *Ext) markMoved(ed board.Edge) {
	if e.Moved == nil {
		e.Moved = map[board.Edge]bool{}
	}
	e.Moved[ed] = true
}

func (e *Ext) hasMoved(ed board.Edge) bool { return e.Moved[ed] }
