package bot

import (
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/wagons"
)

// The Wagons lane.
//
// Obligations (an owed barbarian move, the movement phase that holds the pass)
// are dispatched by rule. Purchases (an upgrade, buying or selling for gold) are
// ordinary spends scored by the evaluator.
//
// Movement is by rule because a wagon's value is a multi-turn route the
// evaluator cannot see. The route uses the engine's prices (wagons.Distances),
// and every step comes from wagons.LegalSteps, so it is always legal.

// wagonsActive memoizes whether the Wagons module is in the ruleset.
func (b *Strong) wagonsActive(s *engine.State) bool {
	if b.noWagons {
		return false
	}
	if b.wagonsOn == nil {
		on := false
		for _, m := range s.Modules() {
			if m.Name() == wagons.WagonsName {
				on = true
				break
			}
		}
		b.wagonsOn = &on
	}
	return *b.wagonsOn
}

// wagonAction dispatches the two obligations: place an owed barbarian, and
// drive the wagon along its circuit.
func (b *Strong) wagonAction(s *engine.State, seat engine.PlayerID) (engine.Command, bool) {
	if idx, owed := wagons.OwesBarbarian(s, seat); owed {
		return barbarianMove(s, seat, idx)
	}
	if !wagons.MovePhase(s, seat) {
		// The first trip is over. Swift Journey is played by the baseline's
		// wagon lane (simpleWagonPlay), which Act falls through to.
		return engine.Command{}, false
	}
	// Drive off a barbarian before setting out: it costs no movement and saves
	// 2 MP on every later crossing.
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
	return engine.Command{Player: seat, Type: wagons.CmdHalt}, true
}

// swiftJourney plays a Swift Journey when the second trip it buys arrives
// somewhere: a delivery (a victory point and the level in gold) or, for an
// empty wagon, a pick-up. The engine accepts the card only once the first trip
// is over; that and the one-card-per-turn limit are asked of it (cmdLegal)
// rather than re-derived here.
//
// By rule because the evaluator sees no change from a fresh allowance and never
// plays it.
//
// "Reach" is the fresh allowance at the current level, plus the grain boost
// when a grain is in hand (the second trip may buy the boost again). A trip
// that only gets closer is not worth the card.
func swiftJourney(s *engine.State, seat engine.PlayerID) (engine.Command, bool) {
	if wagons.SwiftHeld(s, seat) <= 0 {
		return engine.Command{}, false
	}
	cmd := engine.Command{Player: seat, Type: wagons.CmdSwift}
	if !cmdLegal(s, cmd) {
		return engine.Command{}, false
	}
	budget := wagons.Allowance(s, seat)
	if s.Players[seat].Hand[board.Wheat] > 0 {
		budget += wagons.BoostMP
	}
	if d, ok := arrivalDistance(s, seat); !ok || d > budget {
		return engine.Command{}, false
	}
	return cmd, true
}

// arrivalDistance is the movement-point cost from the wagon to the nearest
// place it wants to be, and false when there is none worth a trip: no route,
// or the wagon is already there.
func arrivalDistance(s *engine.State, seat engine.PlayerID) (int, bool) {
	at, ok := wagons.WagonAt(s, seat)
	if !ok {
		return 0, false
	}
	d, known := wagonRoute(s, seat)[at]
	if !known || d <= 0 {
		return 0, false
	}
	return d, true
}

// boostToArrive buys the grain boost when, and only when, it turns this
// action into an arrival: the destination is beyond the movement points left
// and within them plus the boost. Once per movement action (so a Swift
// Journey's second trip may buy it again); the engine checks.
func boostToArrive(s *engine.State, seat engine.PlayerID) (engine.Command, bool) {
	d, ok := arrivalDistance(s, seat)
	if !ok {
		return engine.Command{}, false
	}
	left := wagons.MovementLeft(s, seat)
	if d <= left || d > left+wagons.BoostMP {
		return engine.Command{}, false
	}
	cmd := engine.Command{Player: seat, Type: wagons.CmdBoost}
	if !cmdLegal(s, cmd) {
		return engine.Command{}, false
	}
	return cmd, true
}

// barbarianMove picks where an owed barbarian goes.
//
// Prefer a road of whoever is furthest ahead: the move steals a card from that
// road's owner (after a 7 or a Knight, not a drive-off) and tolls a path the
// leader is likely to use. An unbuilt path is the fallback.
func barbarianMove(s *engine.State, seat engine.PlayerID, idx int) (engine.Command, bool) {
	homes := wagons.BarbarianHomes(s)
	if len(homes) == 0 {
		return engine.Command{}, false
	}
	if idx < 0 {
		idx = 0
	}
	best, bestScore := homes[0], -1
	for _, e := range homes {
		owner, roaded := s.Roads[e]
		if !roaded || owner == seat {
			continue
		}
		score := engine.WinThreshold(s, owner) - victoryOf(s, owner)
		// Fewer points needed is a bigger threat: score them so the leader wins.
		score = 100 - score
		if s.Players[owner].Hand.Count() > 0 {
			score += 10 // a card to steal
		}
		if score > bestScore {
			best, bestScore = e, score
		}
	}
	return engine.Command{Player: seat, Type: wagons.CmdBarbarian,
		Data: raw2(map[string]any{"barb": idx, "e": best})}, true
}

// victoryOf is a seat's whole victory total, module contributions included.
func victoryOf(s *engine.State, p engine.PlayerID) int {
	vp := s.VP(p)
	for _, m := range s.Modules() {
		if h := m.Hooks().VictoryCheck; h != nil {
			vp += h(s, p)
		}
	}
	return vp
}

// chargeAdjacentBarbarian tries the drive-off on any barbarian the wagon is
// standing beside, once each per turn. Legality (the level, the adjacency, the
// once-per-turn) is asked of the engine rather than duplicated here.
func chargeAdjacentBarbarian(s *engine.State, seat engine.PlayerID) (engine.Command, bool) {
	for _, i := range wagons.BarbarianIDs(s) {
		cmd := engine.Command{Player: seat, Type: wagons.CmdCharge,
			Data: raw2(map[string]any{"barb": i})}
		if cmdLegal(s, cmd) {
			return cmd, true
		}
	}
	return engine.Command{}, false
}

// wagonRoute is the movement-point distance from every intersection to the
// nearest place this wagon wants to reach: the plaza that accepts what it is
// carrying, or any of the three when it is empty and looking for a load.
//
// Prices are symmetric, so one search from each destination covers every
// candidate step.
func wagonRoute(s *engine.State, seat engine.PlayerID) map[board.Vertex]int {
	out := map[board.Vertex]int{}
	for _, d := range wagons.Destination(s, seat) {
		for v, c := range wagons.Distances(s, seat, d) {
			if o, ok := out[v]; !ok || c < o {
				out[v] = c
			}
		}
	}
	return out
}

// driveWagon takes the step that gets closest to the delivery, and stops when
// none does.
//
// "Closest" is measured on the whole remaining route, not this step: a step
// onto an opponent's road costs a gold and 1 MP where a bare path costs 2, and
// only the route shows which is the shortcut.
func driveWagon(s *engine.State, seat engine.PlayerID) (engine.Command, bool) {
	at, ok := wagons.WagonAt(s, seat)
	if !ok {
		return engine.Command{}, false
	}
	steps := wagons.LegalSteps(s, seat)
	if len(steps) == 0 {
		return engine.Command{}, false
	}
	route := wagonRoute(s, seat)
	here, known := route[at]
	if !known {
		// Unreachable (walled in by tolls we cannot pay): stay put.
		return engine.Command{}, false
	}
	best, bestDist := wagons.Step{}, here
	found := false
	for _, st := range steps {
		d, ok := route[st.To]
		if !ok || d >= bestDist {
			continue
		}
		// Break distance ties by the cheaper step.
		best, bestDist, found = st, d, true
	}
	if !found {
		return engine.Command{}, false
	}
	return engine.Command{Player: seat, Type: wagons.CmdMove,
		Data: raw2(map[string]any{"to": best.To})}, true
}

// wagonsCandidates offers the spends: the next level on the track, a resource
// bought from the bank with gold, a resource sold to the bank for gold, and a
// Swift Journey. Each is scored against every other action of the turn, so the
// evaluator decides whether a level is worth the lumber this turn.
func (b *Strong) wagonsCandidates(s *engine.State, seat engine.PlayerID, consider func(engine.Command)) {
	consider(engine.Command{Player: seat, Type: wagons.CmdUpgrade})
	for _, r := range board.Resources {
		consider(engine.Command{Player: seat, Type: wagons.CmdBuy,
			Data: raw2(map[string]any{"res": r})})
	}
	// Selling is only worth it to pay tolls, so offer it only when short of gold;
	// otherwise the evaluator sells every surplus every turn.
	if wagons.Gold(s, seat) < 2 {
		for _, r := range board.Resources {
			consider(engine.Command{Player: seat, Type: wagons.CmdSell,
				Data: raw2(map[string]any{"res": r})})
		}
	}
	if wagons.SwiftHeld(s, seat) > 0 {
		consider(engine.Command{Player: seat, Type: wagons.CmdSwift})
	}
}
