package wagons

import "github.com/ftqo/costan.io/engine"

func sharedPurse(s *engine.State, x *WagonsExt) (engine.RiverEconomy, bool) {
	if !x.SharedCurrency {
		return nil, false
	}
	return engine.SharedRiverEconomy(s)
}
func goldAt(s *engine.State, x *WagonsExt, p engine.PlayerID) int {
	if purse, ok := sharedPurse(s, x); ok {
		return purse.RiverGold(p)
	}
	return seatInt(x.Gold, p)
}
func changeGold(s *engine.State, x *WagonsExt, p engine.PlayerID, delta int) {
	if purse, ok := sharedPurse(s, x); ok {
		purse.ChangeRiverGold(p, delta)
		return
	}
	if p >= 0 && int(p) < len(x.Gold) {
		x.Gold[p] += delta
	}
}
func purchases(s *engine.State, x *WagonsExt) int {
	if purse, ok := sharedPurse(s, x); ok {
		return purse.RiverPurchases()
	}
	return x.Bought
}
func (e *WagonsExt) ComposeView(s *engine.State, view any) any {
	v, ok := view.(map[string]any)
	if !ok {
		return view
	}
	if purse, shared := sharedPurse(s, e); shared {
		gold := make([]int, len(s.Players))
		for i := range gold {
			gold[i] = purse.RiverGold(engine.PlayerID(i))
		}
		v["gold"], v["bought"], v["shared_currency"] = gold, purse.RiverPurchases(), true
	}
	return v
}

func hasRiverEconomy(s *engine.State) bool { _, ok := engine.SharedRiverEconomy(s); return ok }

func (e *WagonsExt) UsesRiverPurse() bool { return e.SharedCurrency }
