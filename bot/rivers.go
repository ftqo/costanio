package bot

import (
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/rivers"
)

// Strong's play for the Rivers scenario.
//
//  1. A bridge (2 brick + 1 lumber, at most 3 per player, one route segment,
//     pays 3 coins, 2 under Wagons) is priced like any other build, by
//     simulating it. The coins move the wealth tiles, which PublicVPWithModules
//     already reads, so the candidate only has to be offered.
//
//  2. Coins are not resources, so the hand term cannot see them. Two coins buy
//     one card, so a coin is worth about half a card; the hold term below prices
//     that, and the wealth tiles (+1 strict leader, -2 everyone tied last) come
//     through the VP term.
//
//  3. Every seat starts tied for fewest coins, so the first coin a seat earns is
//     worth two points to it. The VP term already captures this.

// riversActive reports whether this game is running the Rivers scenario.
func (b *Strong) riversActive(s *engine.State) bool { return riversOn(s) }

func riversOn(s *engine.State) bool {
	for _, m := range s.Modules() {
		if m.Name() == rivers.Name {
			return true
		}
	}
	return false
}

// coinHoldCap bounds the hold term below. A turn can spend at most four coins;
// beyond that a coin's value is the wealth tile, which the VP term carries.
const coinHoldCap = 4

// coinHoldWeightDefault is what one coin is worth to the evaluator, in the same
// units w.Hand values a resource card.
//
// Half a card, the scenario's exchange rate. Not tuned by self-play: identical
// bots tie on coins, so a ladder would measure the wealth tiles at zero.
const coinHoldWeightDefault = 0.5

// riversHoldValue is the evaluator's coin term: what the seat's own coins are
// worth beyond the victory points the tiles already contribute.
//
// Only for the viewer's own seat, like fishHoldValue: our candidate moves don't
// change an opponent's coins, so scoring them adds nothing.
//
// Linear, unlike the fish pile: coins spend at a flat rate with no higher rung
// to save toward.
func (b *Strong) riversHoldValue(s *engine.State, p, viewer engine.PlayerID) float64 {
	if p != viewer {
		return 0
	}
	return coinHoldWeightDefault * float64(min(rivers.Coins(s, p), coinHoldCap))
}

// riversCandidates offers the scenario's plays, each scored by the same eval as
// every other action: the bridges this seat's network reaches, and the coin
// conversions in both directions.
//
// Legality is left to the engine via score.
func (b *Strong) riversCandidates(s *engine.State, seat engine.PlayerID, consider func(engine.Command)) {
	x, ok := rivers.StateExt(s)
	if !ok || len(x.Rivers) == 0 {
		return
	}
	hand := s.Players[seat].Hand
	// A bridge is never free: free-road credits cannot pay for one.
	if hand.Has(rivers.CostBridge) && rivers.BridgesLeft(s, seat) > 0 {
		for _, e := range s.LegalTargetsFor(seat).Bridges {
			consider(engine.Command{Player: seat, Type: rivers.CmdBuildBridge, Data: raw2(builtE(e))})
		}
	}
	// Two coins for one card. Offered for every resource; the evaluator picks.
	if rivers.Coins(s, seat) >= rivers.CoinsPerResource {
		for _, r := range board.Resources {
			consider(engine.Command{Player: seat, Type: rivers.CmdSpendCoins, Data: raw2(map[string]any{"res": r})})
		}
	}
	// Resources for a coin, at the seat's CurrencyRatio. Offered only from a
	// surplus that leaves every wanted build payable; otherwise the bot can sell
	// cards for a coin and buy them back in the same turn.
	for _, r := range board.Resources {
		ratio := s.CurrencyRatio(seat, r)
		if hand[r] < ratio || simpleNeedsResource(s, seat, r, hand[r]-ratio) {
			continue
		}
		consider(engine.Command{Player: seat, Type: rivers.CmdBuyCoin, Data: raw2(map[string]any{"res": r})})
	}
}

// --- the greedy baseline ---------------------------------------------------

// simpleRiversPlay is the Simple bot's minimal Rivers policy: build a bridge
// when it is affordable and there is somewhere to put one, turn coins into the
// card a build is short of, and turn a genuine surplus into coins.
//
// It exists so the sim's adversarial ledger exercises the scenario's commands.
// It is kept simple because Simple is the baseline Strong is measured against.
//
// Every branch is bounded, to avoid livelock: bridges run out at three, coin
// spends are capped at two a turn, and coin purchases need a surplus above what
// any build needs.
func simpleRiversPlay(s *engine.State, seat engine.PlayerID) (engine.Command, bool) {
	x, ok := rivers.StateExt(s)
	if !ok || len(x.Rivers) == 0 {
		return engine.Command{}, false
	}
	hand := s.Players[seat].Hand

	// Coins into the card a build is short of, before the build steps.
	if rivers.Coins(s, seat) >= rivers.CoinsPerResource {
		for _, want := range simpleWants(s, seat) {
			for _, r := range board.Resources {
				if hand[r] >= want[r] || s.Bank[r] == 0 {
					continue
				}
				cmd := engine.Command{Player: seat, Type: rivers.CmdSpendCoins,
					Data: raw(map[string]any{"res": r})}
				if cmdLegal(s, cmd) {
					return cmd, true
				}
			}
		}
	}

	// A bridge, when we can pay for one and our network reaches a site.
	if hand.Has(rivers.CostBridge) && rivers.BridgesLeft(s, seat) > 0 {
		for _, e := range s.LegalTargetsFor(seat).Bridges {
			cmd := engine.Command{Player: seat, Type: rivers.CmdBuildBridge,
				Data: raw(map[string]any{"e": e})}
			if cmdLegal(s, cmd) {
				return cmd, true
			}
		}
	}

	// A surplus into a coin, only if every wanted build stays payable.
	for _, r := range board.Resources {
		// The seat's own rate for that resource, 2:1 harbor included.
		ratio := s.CurrencyRatio(seat, r)
		if hand[r] < ratio+simpleCoinReserve {
			continue
		}
		if simpleNeedsResource(s, seat, r, hand[r]-ratio) {
			continue
		}
		cmd := engine.Command{Player: seat, Type: rivers.CmdBuyCoin,
			Data: raw(map[string]any{"res": r})}
		if cmdLegal(s, cmd) {
			return cmd, true
		}
	}
	return engine.Command{}, false
}

// simpleCoinReserve is how many cards of a resource must survive the sale
// before a coin is bought out of it.
const simpleCoinReserve = 2

// simpleWants is the list of buildable costs simpleBankDig digs toward, plus
// the bridge.
func simpleWants(s *engine.State, seat engine.PlayerID) []engine.Hand {
	p := &s.Players[seat]
	var wants []engine.Hand
	if _, ok := upgradableSettlement(s, seat); ok && p.CitiesLeft > 0 {
		wants = append(wants, engine.CostCity)
	}
	if _, ok := settleableSpot(s, seat); ok && p.SettlementsLeft > 0 {
		wants = append(wants, engine.CostSettlement)
	}
	if rivers.BridgesLeft(s, seat) > 0 && len(s.LegalTargetsFor(seat).Bridges) > 0 {
		wants = append(wants, rivers.CostBridge)
	}
	if _, ok := extendingRoadSpot(s, seat, true); ok && p.RoadsLeft > 0 {
		wants = append(wants, engine.CostRoad)
	}
	return wants
}

// simpleNeedsResource reports whether leaving `left` cards of resource r would
// short any build the seat has a use for.
func simpleNeedsResource(s *engine.State, seat engine.PlayerID, r board.Resource, left int) bool {
	for _, want := range simpleWants(s, seat) {
		if want[r] > left {
			return true
		}
	}
	return false
}
