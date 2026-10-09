package bot

import (
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/explorers"
)

// The Explorers policy, shared by both bots.
//
// A policy over the module's planning surface (engine/explorers/plan.go), not
// a second reading of the rules: every command comes from a Job or path the
// module said was legal, so the engine never refuses it.
//
// A turn: buy what the missions need, enter the Movement phase, then work every
// ship. Choices are greedy and exploration is "sail at the nearest fog", but it
// exercises every command the module adds.

// explorersActive reports whether this game is an Explorers game.
func explorersActive(s *engine.State) bool {
	// The module being loaded is the test; the ruleset string may be a pairing
	// such as `cak+explorers`.
	_, ok := explorers.StateExt(s)
	return ok
}

// simpleExplorersPlay is the whole policy. The bool is "I have answered this
// call": in the Movement phase it is always true, because the base build ladder
// below it would propose builds the one-way door has already closed.
func simpleExplorersPlay(s *engine.State, seat engine.PlayerID) (engine.Command, bool) {
	if !explorersActive(s) || s.Phase != engine.PhasePlay || seat != s.Cur || !s.Rolled {
		return engine.Command{}, false
	}
	x, ok := explorers.StateExt(s)
	if !ok {
		return engine.Command{}, false
	}
	if by, pending := explorers.PiratePending(s); pending && by == seat {
		return engine.Command{}, false // AutoCommand owns the activation
	}
	if explorers.InMovement(s) {
		return explorersMovement(s, x, seat), true
	}
	if cmd, ok := explorersAction(s, x, seat); ok {
		return cmd, true
	}
	return engine.Command{}, false
}

// explorersAction is the Action-phase half: what to buy, in the order the
// missions reward.
//
// Crews before settlers before ships: a crew is the cheapest piece that moves a
// mission marker (a lair takes three, a farm one), a settler is the only way to
// build in a new region, and a ship is only worth buying once there is
// something to carry.
func explorersAction(s *engine.State, x *explorers.Ext, seat engine.PlayerID) (engine.Command, bool) {
	hand := s.Players[seat].Hand

	// A harbour settlement is 2 VP for 2 grain and 2 ore and it is what lets the
	// seat build ships at all, so it outranks everything else it can afford.
	if hand.Has(explorers.CostHarbour) {
		if vs := explorers.HarbourUpgrades(s, seat); len(vs) > 0 {
			return engine.Command{Player: seat, Type: explorers.CmdBuildHarbour,
				Data: raw(map[string]any{"v": vs[0]})}, true
		}
	}
	if hand.Has(explorers.CostSettler) && explorers.SettlersLeft(x, seat) > 0 &&
		explorers.FoundingSpots(s, seat) {
		if at, ok := explorers.CargoRoom(s, seat, true); ok {
			return engine.Command{Player: seat, Type: explorers.CmdBuyCargo, Data: at}, true
		}
	}
	if hand.Has(explorers.CostCrew) && explorers.CrewsLeft(x, seat) > 0 &&
		explorers.CrewWorthBuying(s, seat) {
		if at, ok := explorers.CargoRoom(s, seat, false); ok {
			return engine.Command{Player: seat, Type: explorers.CmdBuyCargo, Data: at}, true
		}
	}
	if hand.Has(explorers.CostShip) {
		if cmd, ok := explorersBuildShip(s, x, seat); ok {
			return cmd, true
		}
	}
	// The purchase, then the trade toward a want, then the sale. The sale is
	// last because it dumps the most-held card, which is often the pile a 3:1
	// trade would turn into the missing ore.
	if cmd, ok := explorersGoldBuy(s, x, seat); ok {
		return cmd, true
	}
	if cmd, ok := explorersBankDig(s, x, seat); ok {
		return cmd, true
	}
	return explorersGoldSell(s, seat)
}

// explorersWants is every Explorers build the seat can still use, most valuable
// first, considering placement and supply but not cost.
//
// Cost-blind, as simpleBankDig's road want is (docs/bots.md): these wants drive
// the trades that make a build affordable.
func explorersWants(s *engine.State, x *explorers.Ext, seat engine.PlayerID) []engine.Hand {
	var wants []engine.Hand
	if len(explorers.HarbourUpgrades(s, seat)) > 0 {
		wants = append(wants, explorers.CostHarbour)
	}
	// cak+explorers brings cities back (rule A). The base ladder's dig wants one
	// too, but runs after this lane, which sells first over the discard limit,
	// so the city must be one of this lane's wants.
	if !citiesDisabled(s) && s.Players[seat].CitiesLeft > 0 {
		if _, ok := upgradableSettlement(s, seat); ok {
			wants = append(wants, engine.CostCity)
		}
	}
	if explorers.SettlersLeft(x, seat) > 0 && explorers.FoundingSpots(s, seat) {
		if _, ok := explorers.CargoRoom(s, seat, true); ok {
			wants = append(wants, explorers.CostSettler)
		}
	}
	if explorers.CrewsLeft(x, seat) > 0 && explorers.CrewWorthBuying(s, seat) {
		if _, ok := explorers.CargoRoom(s, seat, false); ok {
			wants = append(wants, explorers.CostCrew)
		}
	}
	if s.Players[seat].SettlementsLeft > 0 {
		if _, ok := settleableSpot(s, seat); ok {
			wants = append(wants, engine.CostSettlement)
		}
	}
	if explorers.ShipsLeft(x, seat) > 0 && len(explorers.ShipBuildSpots(s, seat)) > 0 {
		wants = append(wants, explorers.CostShip)
	}
	return wants
}

// explorersBankDig trades surplus at the flat 3:1 toward the first want the
// hand is short of. simpleBankDig only trades toward cities, settlements, roads
// and development cards, so under Explorers it runs out of targets once a
// seat's settlements are placed (see sim.TestSimpleExplorersStalledSeedsTerminate).
//
// The give side uses the seat's real ratio (3:1 here; simpleBankDig's four-card
// floor would miss a trade of exactly three) and never spends below what the
// same want needs.
func explorersBankDig(s *engine.State, x *explorers.Ext, seat engine.PlayerID) (engine.Command, bool) {
	hand := s.Players[seat].Hand
	for _, want := range explorersWants(s, x, seat) {
		for _, get := range board.Resources {
			if hand[get] >= want[get] || s.Bank[get] == 0 {
				continue
			}
			for _, give := range board.Resources {
				ratio := s.BankRatio(seat, give)
				if give == get || hand[give]-ratio < want[give] {
					continue
				}
				cmd := engine.Command{Player: seat, Type: engine.CmdBankTrade,
					Data: raw(map[string]any{"give": give, "get": get})}
				if cmdLegal(s, cmd) {
					return cmd, true
				}
			}
		}
	}
	return engine.Command{}, false
}

// explorersGoldTrades moves cards and coins in the three ways the module adds.
//
// Gold has nothing to save for beyond a tribute float, so it is spent down; a
// surplus resource is sold for gold where a Fast Gold village allows it and
// traded at the flat 3:1 otherwise (there are no ports).
func explorersGoldTrades(s *engine.State, x *explorers.Ext, seat engine.PlayerID) (engine.Command, bool) {
	if cmd, ok := explorersGoldBuy(s, x, seat); ok {
		return cmd, true
	}
	return explorersGoldSell(s, seat)
}

// explorersGoldBuy is the purchase half of explorersGoldTrades.
func explorersGoldBuy(s *engine.State, x *explorers.Ext, seat engine.PlayerID) (engine.Command, bool) {
	if explorers.Gold(x, seat) >= explorers.GoldPerResource+explorers.Tribute {
		// Buy the scarcest card in hand. With no ports or development deck, two
		// gold is the only route to a resource the seat does not produce, so a
		// seat with no wool hex would otherwise never get a ship, crew or
		// settler. Scarcest rather than "what a build is short of": every build
		// here wants one or two of a kind, so they converge, and the bank-stock
		// and legality checks below still apply.
		best, fewest := board.ResNone, 0
		for _, r := range board.Resources {
			if s.Bank[r] == 0 {
				continue
			}
			if best == board.ResNone || s.Players[seat].Hand[r] < fewest {
				best, fewest = r, s.Players[seat].Hand[r]
			}
		}
		if best != board.ResNone {
			cmd := engine.Command{Player: seat, Type: explorers.CmdGoldBuy,
				Data: raw(map[string]any{"res": best})}
			if cmdLegal(s, cmd) {
				return cmd, true
			}
		}
	}
	return engine.Command{}, false
}

// explorersGoldSell is the sale half of explorersGoldTrades.
func explorersGoldSell(s *engine.State, seat engine.PlayerID) (engine.Command, bool) {
	// Selling is gated on the discard limit. Below it, selling churns: three
	// cards for one gold and two gold for one card is six cards for one. Over
	// it, the next 7 would halve those cards anyway, and gold is never
	// discarded.
	hand := s.Players[seat].Hand
	if hand.Count() <= s.DiscardThreshold(seat) {
		return engine.Command{}, false
	}
	best, most := board.ResNone, 0
	for _, r := range board.Resources {
		if hand[r] > most {
			best, most = r, hand[r]
		}
	}
	if best == board.ResNone {
		return engine.Command{}, false
	}
	for _, cmd := range []engine.Command{
		// One card for one gold beats three for one, so a Fast Gold village is
		// asked first.
		{Player: seat, Type: explorers.CmdGoldSell, Data: raw(map[string]any{"res": best})},
		{Player: seat, Type: explorers.CmdBankGold, Data: raw(map[string]any{"res": best})},
	} {
		if cmdLegal(s, cmd) {
			return cmd, true
		}
	}
	return engine.Command{}, false
}

// explorersSpeedShip buys a ship two more movement points for one wool, when it
// has somewhere to be that it cannot reach on what it has left. Once per ship
// per turn, which the engine enforces and this does not have to.
func explorersSpeedShip(s *engine.State, x *explorers.Ext, seat engine.PlayerID) (engine.Command, bool) {
	if s.Players[seat].Hand[board.Sheep] == 0 {
		return engine.Command{}, false
	}
	for _, sh := range explorers.ShipsOf(x, seat) {
		left := explorers.MPLeft(x, sh)
		if left == 0 || sh.Bonus > 0 {
			continue
		}
		// "Somewhere to be it cannot reach": the errand this ship is on runs out
		// of points before it arrives. searchPath truncates to the budget, so a
		// path exactly as long as the budget is the signal.
		var path []board.Edge
		switch {
		case sh.Hold.Haul > 0 || sh.Hold.Spice > 0:
			path = explorers.PathToCouncil(s, seat, sh.ID)
		default:
			path = explorers.PathToFog(s, seat, sh.ID)
		}
		if len(path) < left {
			continue
		}
		cmd := engine.Command{Player: seat, Type: explorers.CmdSpeedShip,
			Data: raw(map[string]any{"ship_id": sh.ID})}
		if cmdLegal(s, cmd) {
			return cmd, true
		}
	}
	return engine.Command{}, false
}

// explorersBuildShip places a ship, recycling one first when all three are out.
//
// It only recycles an empty ship, since recycling destroys the cargo.
func explorersBuildShip(s *engine.State, x *explorers.Ext, seat engine.PlayerID) (engine.Command, bool) {
	spots := explorers.ShipBuildSpots(s, seat)
	if len(spots) == 0 {
		return engine.Command{}, false
	}
	payload := map[string]any{}
	if explorers.ShipsLeft(x, seat) == 0 {
		// Only a stranded hull (no route back to one of our harbour
		// settlements) is worth recycling; otherwise the swap spends the wool a
		// crew needs.
		spare := -1
		for _, sh := range explorers.ShipsOf(x, seat) {
			if sh.Hold.Empty() && len(explorers.PathToHarbour(s, seat, sh.ID)) == 0 {
				spare = sh.ID
				break
			}
		}
		if spare < 0 {
			return engine.Command{}, false
		}
		payload["recycled"] = spare
	}
	// Replacement targets are a union over all owned hulls. A full edge
	// can be legal for one hull and occupied for the empty spare we chose.
	for _, spot := range spots {
		payload["e"] = spot
		cmd := engine.Command{Player: seat, Type: explorers.CmdBuildShip, Data: raw(payload)}
		if cmdLegal(s, cmd) {
			return cmd, true
		}
	}
	return engine.Command{}, false
}

// explorersMovement is the Movement-phase half. It always answers, ending the
// turn when there is nothing left to do.
//
// Order is by what cannot wait: deliveries and landings are free and may be
// undone by an opponent's next turn, the fishing die is one per phase, a chase
// has to happen before the ships that could make it have moved, and movement
// itself comes last because it is the only thing that spends anything.
func explorersMovement(s *engine.State, x *explorers.Ext, seat engine.PlayerID) engine.Command {
	jobs := explorers.Jobs(s, seat)
	for _, want := range []explorers.JobKind{
		explorers.JobDeliver, explorers.JobLandCrew, explorers.JobLoadHaul,
		explorers.JobFound, explorers.JobTakeCrew,
	} {
		for _, j := range jobs {
			if j.Kind == want {
				return explorers.Command(seat, j)
			}
		}
	}
	// The fishing die is rolled before or after a ship's move, never during one:
	// the roll ends the move of a ship already under way. So it waits while one
	// is, and is taken at the end of the phase if it waited all the way there.
	fish := !explorers.FishRolled(s) && explorers.FishWorthRolling(s)
	if fish && !shipUnderWay(x, seat) {
		return engine.Command{Player: seat, Type: explorers.CmdFishRoll}
	}
	// A chase is free and its ships may still move afterwards, so there is never
	// a reason to skip one.
	if ready := explorers.BattleReadyShips(s, seat); len(ready) > 0 {
		cmd := engine.Command{Player: seat, Type: explorers.CmdChasePirate,
			Data: raw(map[string]any{"ships": ready})}
		if cmdLegal(s, cmd) {
			return cmd
		}
	}
	if cmd, ok := explorersSpeedShip(s, x, seat); ok {
		return cmd
	}
	if cmd, ok := explorersSail(s, x, seat); ok {
		return cmd
	}
	if fish {
		return engine.Command{Player: seat, Type: explorers.CmdFishRoll}
	}
	return engine.Command{Player: seat, Type: engine.CmdEndTurn}
}

// shipUnderWay reports whether one of seat's ships has started moving this turn
// and could still go further, which is the one moment the fishing die may not
// be rolled without cutting that ship's move short.
func shipUnderWay(x *explorers.Ext, seat engine.PlayerID) bool {
	for _, sh := range explorers.ShipsOf(x, seat) {
		if sh.Moved && !sh.Done && explorers.MPLeft(x, sh) > 0 {
			return true
		}
	}
	return false
}

// explorersSail moves one ship, or fills its hold at a harbour settlement it is
// already standing at.
//
// The hold decides the errand: a haul or a sack goes to the Council, a crew to
// the nearest lair or farm, a settler to the nearest legal landing. An empty
// ship explores, and with no fog in reach goes back for cargo.
func explorersSail(s *engine.State, x *explorers.Ext, seat engine.PlayerID) (engine.Command, bool) {
	for _, sh := range explorers.ShipsOf(x, seat) {
		// Loading costs no movement point, so it happens wherever the ship is
		// standing rather than being planned around.
		if c, ok := explorers.LoadJob(s, seat, sh.ID); ok {
			return explorers.LoadCommand(seat, sh.ID, c), true
		}
	}
	for _, sh := range explorers.ShipsOf(x, seat) {
		if explorers.MPLeft(x, sh) == 0 {
			continue
		}
		var routes [][]board.Edge
		switch {
		case sh.Hold.Haul > 0 || sh.Hold.Spice > 0:
			routes = append(routes, explorers.PathToCouncil(s, seat, sh.ID))
		case sh.Hold.Settler > 0:
			routes = append(routes,
				explorers.PathToFound(s, seat, sh.ID),
				explorers.PathToFog(s, seat, sh.ID))
		case sh.Hold.Crew > 0:
			if h, ok := nearestCrewTarget(s, seat, sh.ID); ok {
				routes = append(routes, explorers.PathTo(s, seat, sh.ID, h))
			}
			routes = append(routes, explorers.PathToFog(s, seat, sh.ID))
		default:
			// Empty: explore first, then work the fish, then go home for cargo.
			routes = append(routes,
				explorers.PathToFog(s, seat, sh.ID),
				explorers.PathToHaul(s, seat, sh.ID))
			if explorers.BasinHoldings(s, seat) {
				routes = append(routes, explorers.PathToHarbour(s, seat, sh.ID))
			}
		}
		for _, path := range routes {
			if len(path) == 0 {
				continue
			}
			cmd := explorers.MoveCommand(seat, sh.ID, path)
			if cmdLegal(s, cmd) {
				return cmd, true
			}
		}
	}
	return engine.Command{}, false
}

// nearestCrewTarget is the closest revealed hex a crew aboard ship can be landed
// on: an uncaptured pirate lair, or a spice farm this seat has not befriended.
// "Closest" is measured by the path the module would allow, so an unreachable
// target is simply not offered.
func nearestCrewTarget(s *engine.State, seat engine.PlayerID, ship int) (board.Hex, bool) {
	// CrewTargets is already ordered farms-first (see its doc: a crew on a farm
	// pays immediately, a crew on a lair pays nothing until the third one lands),
	// so the first reachable one is the one to take.
	for _, r := range explorers.CrewTargets(s, seat) {
		if len(explorers.PathTo(s, seat, ship, r)) > 0 {
			return r, true
		}
	}
	return board.Hex{}, false
}

// explorersEnterMovement enters the one-way Movement phase once the Action
// phase has nothing left. It is the last thing tried before ending the turn.
func explorersEnterMovement(s *engine.State, seat engine.PlayerID) (engine.Command, bool) {
	if !explorersActive(s) || explorers.InMovement(s) {
		return engine.Command{}, false
	}
	cmd := engine.Command{Player: seat, Type: explorers.CmdEnterMovement}
	if !cmdLegal(s, cmd) {
		return engine.Command{}, false
	}
	return cmd, true
}

// citiesDisabled reports whether the ruleset has no cities in it, so the build
// ladder does not offer an upgrade the engine refuses outright.
func citiesDisabled(s *engine.State) bool {
	for _, m := range s.Modules() {
		if h := m.Hooks().NoCities; h != nil && h(s) {
			return true
		}
	}
	return false
}

// StrongExplorersPlay is the Strong bot's Explorers lane.
//
// Strong's evaluator scores a position (buildings, resources, the route, the
// titles), and Explorers' ships, crews and unexplored hexes are worth nothing
// there. So the shared policy owns the Movement phase outright, and in the
// Action phase this takes only the buys the evaluator cannot see and hands
// everything else back.
func StrongExplorersPlay(s *engine.State, seat engine.PlayerID) (engine.Command, bool) {
	if !explorersActive(s) || s.Phase != engine.PhasePlay || seat != s.Cur || !s.Rolled {
		return engine.Command{}, false
	}
	x, ok := explorers.StateExt(s)
	if !ok {
		return engine.Command{}, false
	}
	if by, pending := explorers.PiratePending(s); pending && by == seat {
		return engine.Command{}, false // the activation resolves through AutoCommand
	}
	// Any other module pending freezes the turn too, and this lane runs before
	// the code that answers one (e.g. a Knights Defender draw or progress hand
	// over its limit under cak+explorers). Ask the engine's gate rather than
	// keep a list of pendings here.
	if engine.RequireActionableTurn(s, seat) != nil {
		return engine.Command{}, false
	}
	if explorers.InMovement(s) {
		return explorersMovement(s, x, seat), true
	}
	hand := s.Players[seat].Hand
	afloat := len(explorers.ShipsOf(x, seat))

	// A seat with no ship on the water has no game: it cannot explore, cannot
	// carry a crew and cannot deliver. This outranks every other buy.
	if afloat == 0 && hand.Has(explorers.CostShip) {
		if cmd, ok := explorersBuildShip(s, x, seat); ok {
			return cmd, true
		}
	}
	// A harbour settlement is two victory points for four cards and it is the
	// only shipyard. A settlement is one point for the same four.
	if hand.Has(explorers.CostHarbour) {
		if vs := explorers.HarbourUpgrades(s, seat); len(vs) > 0 {
			return engine.Command{Player: seat, Type: explorers.CmdBuildHarbour,
				Data: raw(map[string]any{"v": vs[0]})}, true
		}
	}
	// Crews and settlers, but only where they have somewhere to go: a crew with
	// no revealed lair or farm to land on is a wasted wool and ore, and the
	// supply is nine for the whole game.
	if hand.Has(explorers.CostSettler) && explorers.SettlersLeft(x, seat) > 0 &&
		explorers.FoundingSpots(s, seat) {
		if at, ok := explorers.CargoRoom(s, seat, true); ok {
			return engine.Command{Player: seat, Type: explorers.CmdBuyCargo, Data: at}, true
		}
	}
	if hand.Has(explorers.CostCrew) && explorers.CrewsLeft(x, seat) > 0 &&
		explorers.CrewWorthBuying(s, seat) {
		if at, ok := explorers.CargoRoom(s, seat, false); ok {
			return engine.Command{Player: seat, Type: explorers.CmdBuyCargo, Data: at}, true
		}
	}
	// A second and third hull: one ship explores, two work the missions in
	// parallel, and the supply is three.
	if afloat < explorers.MaxShips && hand.Has(explorers.CostShip) {
		if cmd, ok := explorersBuildShip(s, x, seat); ok {
			return cmd, true
		}
	}
	// Gold buys cards, and holding it past a tribute float buys nothing.
	return explorersGoldTrades(s, x, seat)
}

// explorersCityChoice prices the irreversible city/harbour choice before the
// harbour-first purchase lane spends its ore. It can also fund the last ore
// with gold, preserving the usual tribute reserve; buying the scarcest card
// would never target a third ore while any other resource is missing.
func (b *Strong) explorersCityChoice(s *engine.State, seat engine.PlayerID) (engine.Command, bool) {
	if !explorersActive(s) || !b.knightsActive(s) || s.Phase != engine.PhasePlay || seat != s.Cur || !s.Rolled || explorers.InMovement(s) {
		return engine.Command{}, false
	}
	x, ok := explorers.StateExt(s)
	if !ok || len(explorers.ShipsOf(x, seat)) == 0 {
		return engine.Command{}, false
	}
	hand := s.Players[seat].Hand
	if hand[board.Wheat] < engine.CostCity[board.Wheat] || hand[board.Ore] < engine.CostCity[board.Ore]-1 {
		return engine.Command{}, false
	}
	bestScore := b.eval(s, seat)
	// The harbour is a real alternative, with the same evaluation and costs.
	if hand.Has(explorers.CostHarbour) {
		for _, v := range explorers.HarbourUpgrades(s, seat) {
			cmd := engine.Command{Player: seat, Type: explorers.CmdBuildHarbour, Data: raw(builtV(v))}
			if score, legal := b.score(s, seat, cmd); legal && score > bestScore {
				bestScore = score
			}
		}
	}
	funded := s
	var buy engine.Command
	if !hand.Has(engine.CostCity) {
		if explorers.Gold(x, seat) < explorers.GoldPerResource+explorers.Tribute {
			return engine.Command{}, false
		}
		buy = engine.Command{Player: seat, Type: explorers.CmdGoldBuy, Data: raw(map[string]any{"res": board.Ore})}
		events, err := engine.Decide(s, buy)
		if err != nil {
			return engine.Command{}, false
		}
		funded = s.Clone()
		for _, ev := range events {
			if err := engine.Apply(funded, ev); err != nil {
				return engine.Command{}, false
			}
		}
	}
	var best engine.Command
	found := false
	for _, v := range ownSettlements(funded, seat) {
		cmd := engine.Command{Player: seat, Type: engine.CmdBuildCity, Data: raw(builtV(v))}
		if score, legal := b.score(funded, seat, cmd); legal && score > bestScore+1e-9 {
			best, bestScore, found = cmd, score, true
		}
	}
	if found && funded != s {
		return buy, true
	}
	return best, found
}
