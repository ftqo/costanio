package bot

import (
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/wagons"
)

// simpleWagonPlay is the baseline's Wagons policy: drive toward the nearest
// delivery, and take the cheap things that make the next trip shorter.
//
// It runs before engine.AutoCommand, whose module Auto declines every turn, so
// that the adversarial ledger sees deliveries, tolls, loads and drive-offs.
//
// Every candidate is confirmed with cmdLegal rather than re-derived here.
func (b Simple) simpleWagonPlay(s *engine.State, seat engine.PlayerID) (engine.Command, bool) {
	if !wagons.Active(s) {
		return engine.Command{}, false
	}
	// A barbarian this seat owes a move for, whoever's turn it is.
	if idx, owed := wagons.OwesBarbarian(s, seat); owed {
		if cmd, ok := barbarianMove(s, seat, idx); ok && cmdLegal(s, cmd) {
			return cmd, true
		}
	}
	if !wagons.MovePhase(s, seat) {
		// The first trip is over: a Swift Journey buys a second one when it
		// arrives somewhere (see swiftJourney).
		if !b.noSwift {
			if cmd, ok := swiftJourney(s, seat); ok {
				return cmd, true
			}
		}
		return engine.Command{}, false
	}
	// The track, before setting out (an upgrade is refused once an action is
	// open).
	upgrade := engine.Command{Player: seat, Type: wagons.CmdUpgrade}
	if cmdLegal(s, upgrade) {
		return upgrade, true
	}
	// A barbarian beside us costs 2 MP on every crossing; trying is free.
	if cmd, ok := chargeAdjacentBarbarian(s, seat); ok {
		return cmd, true
	}
	if !b.noSwift {
		if cmd, ok := boostToArrive(s, seat); ok {
			return cmd, true
		}
	}
	if cmd, ok := driveWagon(s, seat); ok {
		return cmd, true
	}
	// Out of road for this turn. Spend the leftovers on the next one: gold buys
	// a resource, a surplus resource buys the gold a toll will want.
	if cmd, ok := simpleWagonSpend(s, seat); ok {
		return cmd, true
	}
	return engine.Command{Player: seat, Type: wagons.CmdHalt}, true
}

// simpleWagonSpend is the baseline's two gold lanes: buy while there is gold and
// the turn's two purchases are unspent, then sell only from a surplus. Each
// shrinks something per call, so neither can repeat forever.
func simpleWagonSpend(s *engine.State, seat engine.PlayerID) (engine.Command, bool) {
	hand := s.Players[seat].Hand
	if wagons.Gold(s, seat) >= 2 {
		// Buy the resource we hold least of, which is the one a build is
		// waiting on. Board order breaks a tie, so the choice is deterministic.
		want, wantN := board.ResNone, 1<<30
		for _, r := range board.Resources {
			if hand[r] < wantN {
				want, wantN = r, hand[r]
			}
		}
		cmd := engine.Command{Player: seat, Type: wagons.CmdBuy,
			Data: raw(map[string]any{"res": want})}
		if cmdLegal(s, cmd) {
			return cmd, true
		}
	}
	if wagons.Gold(s, seat) < 2 {
		for _, r := range board.Resources {
			// Sell only a surplus, never the last of a resource.
			if hand[r] < s.BankRatio(seat, r)+2 {
				continue
			}
			cmd := engine.Command{Player: seat, Type: wagons.CmdSell,
				Data: raw(map[string]any{"res": r})}
			if cmdLegal(s, cmd) {
				return cmd, true
			}
		}
	}
	return engine.Command{}, false
}
