package rivers

import "github.com/ftqo/costan.io/engine"

// Apply folds the module's events. Every change to a coin count, bridge supply
// or wealth tile happens here and nowhere else, so a replay reproduces the live
// state: AfterEvents (where the ledger diff runs) does not run on replay.
func (Module) Apply(s *engine.State, e engine.Event) (bool, error) {
	switch e.Type {
	case EvBridgeBuilt:
		d := engine.DecodeEvent[bridgeData](e)
		x := ext(s)
		x.Bridges[d.E] = d.Player
		if int(d.Player) < len(x.BridgesLeft) {
			x.BridgesLeft[d.Player]--
		}
		if !d.Free {
			s.Players[d.Player].Hand.Sub(CostBridge)
			s.Bank.Add(CostBridge)
		}
		return true, nil

	case EvCoinsChanged:
		d := engine.DecodeEvent[coinsChangedData](e)
		x := ext(s)
		if int(d.Player) >= 0 && int(d.Player) < len(x.Coins) {
			x.Coins[d.Player] = max(0, x.Coins[d.Player]+d.Delta)
		}
		// The ledger's memory. A payment names the position it was made for;
		// reclaiming one names the same position with a negative (or clamped
		// to zero) delta, and clears it.
		switch {
		case d.E != nil && d.Delta > 0:
			x.PaidEdge[*d.E] = paid{P: d.Player, N: d.Delta}
		case d.E != nil:
			delete(x.PaidEdge, *d.E)
		case d.V != nil && d.Delta > 0:
			x.PaidVertex[*d.V] = paid{P: d.Player, N: d.Delta}
		case d.V != nil:
			delete(x.PaidVertex, *d.V)
		}
		return true, nil

	case EvCoinBought:
		d := engine.DecodeEvent[coinBoughtData](e)
		var pay engine.Hand
		pay[d.Res] = d.Paid
		s.Players[d.Player].Hand.Sub(pay)
		s.Bank.Add(pay)
		return true, nil

	case EvCoinsSpent:
		d := engine.DecodeEvent[coinsSpentData](e)
		var gain engine.Hand
		gain[d.Res] = 1
		s.Players[d.Player].Hand.Add(gain)
		s.Bank.Sub(gain)
		ext(s).SpentThisTurn++
		return true, nil

	case EvCoinTraded:
		d := engine.DecodeEvent[coinTradeData](e)
		x := ext(s)
		if int(d.From) >= 0 && int(d.From) < len(x.Coins) {
			x.Coins[d.From] = max(0, x.Coins[d.From]-d.Coins)
		}
		if int(d.To) >= 0 && int(d.To) < len(x.Coins) {
			x.Coins[d.To] += d.Coins
		}
		return true, nil

	case EvTurnReset:
		// The per-turn coin-spend counter. Emitted by onEvents on EvTurnStarted
		// rather than folded off that base event, because a module's Apply
		// never sees base events (it is reached only from State.Apply's default
		// branch). Mirrors islands.EvTurnReset.
		ext(s).SpentThisTurn = 0
		return true, nil

	case EvWealthChanged:
		d := engine.DecodeEvent[wealthChangedData](e)
		x := ext(s)
		x.Wealthiest = d.Wealthiest
		for i := range x.Poorest {
			x.Poorest[i] = false
		}
		for _, p := range d.Poorest {
			if int(p) >= 0 && int(p) < len(x.Poorest) {
				x.Poorest[p] = true
			}
		}
		return true, nil
	default:
	}
	return false, nil
}
