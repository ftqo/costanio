package wagons

import (
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// Apply folds this module's events. Every branch is a pure function of the
// event and the state, so replay(events) reproduces the live game exactly.
//
// Every index read from an event is bounds-checked, since Apply also folds logs
// this server did not write. Out of range is engine.ErrMalformedEvent, which the
// game layer turns into paused-error with the log intact, rather than a panic or
// a silent no-op (changeGold would drop an out-of-range seat's gold).
func (Wagons) Apply(s *engine.State, e engine.Event) (bool, error) {
	x := ext(s)
	switch e.Type {
	case EvStart:
		d, err := engine.DecodeEventChecked[startData](e)
		if err != nil {
			return true, err
		}
		x.Started = true
		x.SharedCurrency = d.SharedCurrency
		x.MPBonus = allowance(s, 1) - mpTrack[0]
		for i := range x.Wagon {
			if i < len(d.At) && d.OnBoard(i) {
				x.Wagon[i], x.OnBoard[i] = d.At[i], true
			}
			if x.SharedCurrency {
				changeGold(s, x, engine.PlayerID(i), d.Gold)
			} else {
				x.Gold[i] = d.Gold
			}
		}
		// The scenario opens mid-turn on the first play batch, so the per-turn
		// bookkeeping must be armed for whoever is up. EvTurn cannot cover this
		// turn: its base event was emitted during setup, where OnEvents does not
		// run.
		x.TurnSeat = s.Cur
		x.MoveOpen, x.MoveDone, x.Moved, x.MP = false, false, false, 0

	case EvTurn:
		d, err := engine.DecodeEventChecked[turnData](e)
		if err != nil {
			return true, err
		}
		if !x.seatOK(d.Player) {
			return true, engine.MalformedEvent(e, "seat %d", d.Player)
		}
		x.TurnSeat = d.Player
		x.MoveOpen, x.MoveDone, x.Moved = false, false, false
		x.MP = 0
		x.Boosted = false
		x.Bought = 0
		x.Swifted = false
		x.Tried = [tradeHexCount]bool{}
		x.PathTried = nil
		// A Swift Journey bought last turn unlocks, exactly as a base
		// development card does at EvTurnStarted.
		if int(d.Player) < len(x.Swift) {
			x.Swift[d.Player] += x.SwiftNew[d.Player]
			x.SwiftNew[d.Player] = 0
		}

	case EvMoved:
		d, err := engine.DecodeEventChecked[movedData](e)
		if err != nil {
			return true, err
		}
		if !x.seatOK(d.Player) {
			return true, engine.MalformedEvent(e, "seat %d", d.Player)
		}
		if d.Paid != engine.NoPlayer && d.Toll > 0 && !x.seatOK(d.Paid) {
			return true, engine.MalformedEvent(e, "toll paid to seat %d", d.Paid)
		}
		mp := x.MP
		if !x.MoveOpen {
			mp = allowance(s, x.Level[d.Player])
		}
		x.MoveOpen = true
		x.Moved = true
		x.MP = mp - d.MP
		x.Wagon[d.Player] = d.To
		if d.Toll > 0 && d.Paid != engine.NoPlayer && int(d.Paid) < len(x.Gold) {
			changeGold(s, x, d.Player, -d.Toll)
			changeGold(s, x, d.Paid, d.Toll)
		}
		// Entering a plaza ends the movement action, so a wagon cannot deliver
		// at two plazas in one action; only a Swift Journey's second action
		// allows two in a turn.
		if x.plazaIndex(d.To) >= 0 {
			x.MoveOpen, x.MoveDone, x.MP = false, true, 0
		}

	case EvHalted:
		x.MoveOpen, x.MoveDone, x.MP = false, true, 0

	case EvBoosted:
		d, err := engine.DecodeEventChecked[boostedData](e)
		if err != nil {
			return true, err
		}
		if !x.seatOK(d.Player) {
			return true, engine.MalformedEvent(e, "seat %d", d.Player)
		}
		mp := x.MP
		if !x.MoveOpen {
			mp = allowance(s, x.Level[d.Player])
		}
		x.MoveOpen = true
		x.MP = mp + d.MP
		x.Boosted = true
		if !d.Free {
			cost := engine.Hand{board.Wheat: 1}
			s.Players[d.Player].Hand.Sub(cost)
			s.Bank.Add(cost)
		}

	case EvCharged:
		d, err := engine.DecodeEventChecked[chargedData](e)
		if err != nil {
			return true, err
		}
		if !x.seatOK(d.Player) {
			return true, engine.MalformedEvent(e, "seat %d", d.Player)
		}
		if _, ok := PathBarbarians(s)[d.Barb]; !ok {
			return true, engine.ErrBadCommand
		}
		// The attempt costs no MP and does not end the movement, but it opens
		// the action: a level-2 wagon that shoos a barbarian first keeps its
		// whole allowance.
		if !x.MoveOpen {
			x.MoveOpen, x.MP = true, allowance(s, x.Level[d.Player])
		}
		if sharedPaths(s) {
			if d.Barb >= len(x.PathTried) {
				x.PathTried = append(x.PathTried, make([]bool, d.Barb-len(x.PathTried)+1)...)
			}
			x.PathTried[d.Barb] = true
		} else {
			x.Tried[d.Barb] = true
		}
		if d.Drove {
			x.BarbSeat, x.BarbIdx, x.BarbSteal = d.Player, d.Barb, false
		}

	case EvBarbPending:
		d, err := engine.DecodeEventChecked[barbPendingData](e)
		if err != nil {
			return true, err
		}
		if !x.seatOK(d.Player) {
			return true, engine.MalformedEvent(e, "seat %d", d.Player)
		}
		if d.Idx < -1 || (!sharedPaths(s) && d.Idx >= tradeHexCount) {
			return true, engine.MalformedEvent(e, "barbarian %d", d.Idx)
		}
		x.BarbSeat, x.BarbIdx, x.BarbSteal = d.Player, d.Idx, d.Steal
		// The robber is out of this game, but the base fold sets RobberPending
		// on EvKnightPlayed unconditionally (a 7 goes through NoRobber). Clear
		// it here so a played Knight hands the player this module's barbarian
		// move, with no robber to place.
		s.RobberPending = false

	case EvBarbMoved:
		d, err := engine.DecodeEventChecked[barbMovedData](e)
		if err != nil {
			return true, err
		}
		if !sharedPaths(s) {
			if d.Barb < 0 || d.Barb >= tradeHexCount {
				return true, engine.MalformedEvent(e, "barbarian %d", d.Barb)
			}
			x.Barb[d.Barb] = d.E
		}
		x.BarbSeat, x.BarbIdx, x.BarbSteal = engine.NoPlayer, -1, false

	case EvLoaded:
		d, err := engine.DecodeEventChecked[loadedData](e)
		if err != nil {
			return true, err
		}
		if !x.seatOK(d.Player) {
			return true, engine.MalformedEvent(e, "seat %d", d.Player)
		}
		if d.Hex < 0 || d.Hex >= tradeHexCount {
			return true, engine.MalformedEvent(e, "trade hex %d", d.Hex)
		}
		x.Cargo[d.Player] = d.Cargo
		x.Drawn[d.Hex]++
		if x.Drawn[d.Hex] >= stackDepth {
			// The stack ran out and is refilled with a fresh shuffled 6-and-6.
			// Bumping Refill moves to the next reserved slot, so the new order is
			// independent and reproducible.
			x.Drawn[d.Hex] = 0
			x.Refill[d.Hex]++
		}

	case EvDelivered:
		d, err := engine.DecodeEventChecked[deliveredData](e)
		if err != nil {
			return true, err
		}
		if !x.seatOK(d.Player) {
			return true, engine.MalformedEvent(e, "seat %d", d.Player)
		}
		x.Cargo[d.Player] = CargoNone
		x.Landed[d.Player]++
		changeGold(s, x, d.Player, d.Gold)

	case EvUpgraded:
		d, err := engine.DecodeEventChecked[upgradedData](e)
		if err != nil {
			return true, err
		}
		if !x.seatOK(d.Player) {
			return true, engine.MalformedEvent(e, "seat %d", d.Player)
		}
		if d.Level < 1 || d.Level > maxLevel {
			return true, engine.MalformedEvent(e, "level %d", d.Level)
		}
		x.Level[d.Player] = d.Level
		s.Players[d.Player].Hand.Sub(d.Cost)
		s.Bank.Add(d.Cost)

	case EvBought:
		d, err := engine.DecodeEventChecked[boughtData](e)
		if err != nil {
			return true, err
		}
		if !x.seatOK(d.Player) {
			return true, engine.MalformedEvent(e, "seat %d", d.Player)
		}
		if d.Res < board.Wood || d.Res > board.Ore {
			return true, engine.MalformedEvent(e, "resource %d", d.Res)
		}
		changeGold(s, x, d.Player, -d.Gold)
		x.Bought++
		if purse, ok := sharedPurse(s, x); ok {
			purse.CountRiverPurchase()
		}
		var h engine.Hand
		h[d.Res] = 1
		s.Players[d.Player].Hand.Add(h)
		s.Bank.Sub(h)

	case EvSold:
		d, err := engine.DecodeEventChecked[soldData](e)
		if err != nil {
			return true, err
		}
		if !x.seatOK(d.Player) {
			return true, engine.MalformedEvent(e, "seat %d", d.Player)
		}
		if d.Res < board.Wood || d.Res > board.Ore {
			return true, engine.MalformedEvent(e, "resource %d", d.Res)
		}
		var h engine.Hand
		h[d.Res] = d.Count
		s.Players[d.Player].Hand.Sub(h)
		s.Bank.Add(h)
		changeGold(s, x, d.Player, d.Gold)

	case EvGoldMoved:
		d, err := engine.DecodeEventChecked[goldMovedData](e)
		if err != nil {
			return true, err
		}
		if !x.seatOK(d.From) {
			return true, engine.MalformedEvent(e, "seat %d", d.From)
		}
		if !x.seatOK(d.To) {
			return true, engine.MalformedEvent(e, "seat %d", d.To)
		}
		changeGold(s, x, d.From, -d.Gold)
		changeGold(s, x, d.To, d.Gold)

	case EvSwiftBought:
		d, err := engine.DecodeEventChecked[swiftBoughtData](e)
		if err != nil {
			return true, err
		}
		if !x.seatOK(d.Player) {
			return true, engine.MalformedEvent(e, "seat %d", d.Player)
		}
		x.SwiftNew[d.Player]++
		x.SwiftLeft--
		// The card is bought from the same deck at the same price, and this
		// event stands in for EvDevCardBought, so the base cost comes out of
		// the hand here.
		s.Players[d.Player].Hand.Sub(engine.CostDevCard)
		s.Bank.Add(engine.CostDevCard)

	case EvSwiftPlayed:
		d, err := engine.DecodeEventChecked[playerData](e)
		if err != nil {
			return true, err
		}
		if !x.seatOK(d.Player) {
			return true, engine.MalformedEvent(e, "seat %d", d.Player)
		}
		x.Swift[d.Player]--
		x.Swifted = true
		// A second movement action with a fresh allowance: the open action is
		// closed and the phase re-armed. Boosted is reset too, since the grain
		// (or fish) boost is once per movement action (so at most twice a
		// turn, with a Swift Journey).
		x.MoveOpen, x.MoveDone, x.MP = false, false, 0
		x.Boosted = false
		// One development card per turn covers this one too.
		s.PlayedDevThisTurn = true

	default:
		return false, nil
	}
	return true, nil
}

// seatOK reports whether p is a seat this game has. Every per-seat slice in
// the ext is sized to the seat count at InitExt, so any one of them answers.
func (e *WagonsExt) seatOK(p engine.PlayerID) bool { return p >= 0 && int(p) < len(e.Level) }

// sharedPaths reports whether barbarians live in Raiders' shared figure list
// (indexed by figure id, unbounded) rather than this module's fixed three.
func sharedPaths(s *engine.State) bool {
	_, shared := engine.SharedRaiders(s)
	return shared
}
