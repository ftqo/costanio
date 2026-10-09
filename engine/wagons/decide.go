package wagons

import (
	"slices"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

func (m Wagons) Decide(s *engine.State, cmd engine.Command) ([]engine.Event, bool, error) {
	switch cmd.Type {
	case CmdMove:
		ev, err := m.decideMove(s, cmd)
		return ev, true, err
	case CmdHalt:
		ev, err := m.decideHalt(s, cmd)
		return ev, true, err
	case CmdBoost:
		ev, err := m.decideBoost(s, cmd)
		return ev, true, err
	case CmdCharge:
		ev, err := m.decideCharge(s, cmd)
		return ev, true, err
	case CmdBarbarian:
		ev, err := m.decideBarbarian(s, cmd)
		return ev, true, err
	case CmdUpgrade:
		ev, err := m.decideUpgrade(s, cmd)
		return ev, true, err
	case CmdBuy:
		ev, err := m.decideBuy(s, cmd)
		return ev, true, err
	case CmdSell:
		ev, err := m.decideSell(s, cmd)
		return ev, true, err
	case CmdSwift:
		ev, err := m.decideSwift(s, cmd)
		return ev, true, err
	default:
	}
	return nil, false, nil
}

// inPlay is the gate every wagon command shares: the scenario is on this board,
// the wagons are out, and it is this seat's own actionable turn.
func inPlay(s *engine.State, p engine.PlayerID) (*WagonsExt, error) {
	x := extRO(s)
	if !x.HasTrade || !x.Started {
		return nil, engine.ErrWrongPhase
	}
	if err := engine.RequireActionableTurn(s, p); err != nil {
		return nil, err
	}
	return x, nil
}

// openMP is how many movement points the action has, opening it at the full
// allowance when none is open yet. The four commands that may open an action
// all use it, so they agree on its starting value.
func openMP(s *engine.State, x *WagonsExt, p engine.PlayerID) int {
	if x.MoveOpen {
		return x.MP
	}
	return allowance(s, x.Level[p])
}

func (Wagons) decideMove(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	p := cmd.Player
	x, err := inPlay(s, p)
	if err != nil {
		return nil, err
	}
	if x.MoveDone {
		return nil, ErrMovementOver
	}
	d, err := engine.DecodeCommand[struct {
		To board.Vertex `json:"to"`
	}](cmd.Data)
	if err != nil {
		return nil, err
	}
	if !x.OnBoard[p] {
		return nil, ErrNoWagon
	}
	from := x.Wagon[p]
	var st step
	found := false
	for _, c := range steps(s, x, from) {
		if c.To == d.To {
			st, found = c, true
			break
		}
	}
	if !found {
		return nil, engine.ErrBadPlacement
	}
	cost, toll, to := price(s, x, p, st)
	if cost > openMP(s, x, p) {
		// The count is not derivable from the code, so it travels as a named
		// parameter.
		return nil, engine.WithParams(ErrNoMovement, engine.Params{"needed": cost})
	}
	if toll > goldAt(s, x, p) {
		return nil, engine.WithParams(ErrNoGold, engine.Params{"needed": toll})
	}
	events := []engine.Event{engine.NewEvent(EvMoved, movedData{
		Player: p, From: from, To: d.To, MP: cost, Toll: toll, Paid: to,
	})}

	// A wagon must stop when it enters a plaza, the only place cargo changes
	// hands. Deliver first, then draw if the wagon is empty, so a delivery and
	// the next load happen in one stop. Arriving with cargo this hex does not
	// accept does nothing and still ends the movement.
	if i := x.plazaIndex(d.To); i >= 0 {
		cargo := x.Cargo[p]
		if hexAccepts(x, i, cargo) {
			events = append(events, engine.NewEvent(EvDelivered, deliveredData{
				Player: p, Hex: i, Cargo: cargo, Gold: x.Level[p],
			}))
			cargo = CargoNone
		}
		if cargo == CargoNone {
			events = append(events, engine.NewEvent(EvLoaded, loadedData{
				Player: p, Hex: i, Cargo: topOfStack(s, x, i),
			}))
		}
	}
	return events, nil
}

func (Wagons) decideHalt(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	x, err := inPlay(s, cmd.Player)
	if err != nil {
		return nil, err
	}
	if x.MoveDone {
		return nil, ErrMovementOver
	}
	return []engine.Event{engine.NewEvent(EvHalted, playerData{Player: cmd.Player})}, nil
}

// decideBoost spends 1 grain for +2 MP, once per movement action. A turn
// normally has one action, but a Swift Journey's second may buy it again, so at
// most twice a turn. EvSwiftPlayed clears Boosted.
func (m Wagons) decideBoost(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	ev, err := m.freeBoost(s, cmd.Player)
	if err != nil {
		return nil, err
	}
	cost := engine.Hand{board.Wheat: 1}
	if !s.Players[cmd.Player].Hand.Has(cost) {
		return nil, engine.ErrNoResources
	}
	d := engine.DecodeEvent[boostedData](ev)
	d.Free = false
	return []engine.Event{engine.NewEvent(EvBoosted, d)}, nil
}

func (Wagons) freeBoost(s *engine.State, p engine.PlayerID) (engine.Event, error) {
	x, err := inPlay(s, p)
	if err != nil {
		return engine.Event{}, err
	}
	if x.MoveDone || x.Boosted {
		return engine.Event{}, ErrMovementOver
	}
	return engine.NewEvent(EvBoosted, boostedData{Player: p, MP: boostMP, Free: true}), nil
}

// decideCharge attempts to drive a barbarian off: one die against the level's
// range, from any intersection the wagon occupies during its movement.
//
// It costs no MP and does not end the movement, so a wagon parked between two
// barbarians may try both, once each. No card is stolen either way.
func (Wagons) decideCharge(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	p := cmd.Player
	x, err := inPlay(s, p)
	if err != nil {
		return nil, err
	}
	if x.MoveDone {
		return nil, ErrMovementOver
	}
	if x.Level[p] < 2 {
		return nil, ErrWagonLevel
	}
	d, err := engine.DecodeCommand[struct {
		Barb int `json:"barb"`
	}](cmd.Data)
	if err != nil {
		return nil, err
	}
	if _, ok := PathBarbarians(s)[d.Barb]; !ok {
		return nil, engine.ErrBadCommand
	}
	if TriedBarbarian(s, d.Barb) {
		return nil, ErrAlreadyCharged
	}
	if !x.OnBoard[p] {
		return nil, ErrNoWagon
	}
	at := x.Wagon[p]
	// "Adjacent" is the wagon standing on one of the two endpoints of the
	// barbarian's path.
	if !PathBarbarians(s)[d.Barb].Touches(at) {
		return nil, engine.ErrBadPlacement
	}
	die := engine.PublicRngForSeed(s.PublicSeed, engine.WagonsDieSeq(s.NextSeq)).IntN(6) + 1
	drove := die >= driveOffFloor(x.Level[p])
	return []engine.Event{engine.NewEvent(EvCharged, chargedData{
		Player: p, Barb: d.Barb, Die: die, Drove: drove,
	})}, nil
}

// decideBarbarian places a barbarian the seat owes.
//
// It does not use RequireActionableTurn: the obligation can open before the roll
// (a Knight played first thing), and this module's BlocksTurnActions is true while
// it is open, so the shared gate would refuse the only legal action.
func (Wagons) decideBarbarian(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	p := cmd.Player
	x := extRO(s)
	if !x.HasTrade || x.BarbSeat == engine.NoPlayer {
		return nil, ErrNoBarbarian
	}
	if s.Phase != engine.PhasePlay {
		return nil, engine.ErrWrongPhase
	}
	if p != x.BarbSeat {
		return nil, engine.ErrNotYourTurn
	}
	if len(s.PendingDiscards) > 0 {
		return nil, engine.ErrDiscardPending
	}
	d, err := engine.DecodeCommand[struct {
		Barb int        `json:"barb"`
		E    board.Edge `json:"e"`
		Hex  *board.Hex `json:"hex,omitempty"`
	}](cmd.Data)
	if err != nil {
		return nil, err
	}
	if _, ok := PathBarbarians(s)[d.Barb]; !ok {
		return nil, engine.ErrBadCommand
	}
	// A drive-off names its barbarian; a 7 and a Knight let the player choose.
	if x.BarbIdx >= 0 && d.Barb != x.BarbIdx {
		return nil, engine.ErrBadCommand
	}
	e := board.NewEdge(d.E.A, d.E.B)
	if e == PathBarbarians(s)[d.Barb] {
		return nil, ErrBarbarianSpot // it must end somewhere other than where it started
	}
	if !slices.Contains(barbarianHomes(s, x), e) {
		return nil, ErrBarbarianSpot
	}
	events := []engine.Event{engine.NewEvent(EvBarbMoved, barbMovedData{
		Player: p, Barb: d.Barb, E: e,
	})}
	if _, shared := engine.SharedRaiders(s); shared {
		pop := engine.RaiderPopulation(s)
		var chosen *board.Hex
		for _, h := range pop.RaiderDestinations(s) {
			if (d.Hex == nil || *d.Hex == h) && slices.Contains((Wagons{}).RaiderPaths(s, h), e) {
				chosen = &h
				break
			}
		}
		if chosen == nil {
			return nil, ErrBarbarianSpot
		}
		moved, err := pop.RelocatePathRaider(s, p, d.Barb, *chosen, e)
		if err != nil {
			return nil, err
		}
		events = append(moved, events...)
	}
	// Landing on a road steals one random resource from that road's owner.
	// Gold is never stolen: it is not in the hand the draw reads.
	if x.BarbSteal {
		if owner, roaded := s.Roads[e]; roaded && owner != p && s.DiscardableCount(owner) > 0 {
			if ev, ok := engine.StealCardFromModules(s, p, owner, len(events)); ok {
				events = append(events, ev)
			} else if res, ok := engine.RandomCard(engine.RngFor(s, len(events)), s.Players[owner].Hand); ok {
				events = append(events, engine.NewEvent(engine.EvCardStolen, engine.CardStolenData{Thief: p, Victim: owner, Res: res}, p, owner))
			}
		}
	}

	return events, nil
}

func (Wagons) decideUpgrade(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	p := cmd.Player
	x, err := inPlay(s, p)
	if err != nil {
		return nil, err
	}
	// "During trading and building (not during the movement phase)."
	if x.MoveOpen {
		return nil, ErrMovementOver
	}
	if x.Level[p] >= maxLevel {
		return nil, ErrMaxLevel
	}
	cost := upgradeCost(x.Level[p])
	if !s.Players[p].Hand.Has(cost) {
		return nil, engine.ErrNoResources
	}
	return []engine.Event{engine.NewEvent(EvUpgraded, upgradedData{
		Player: p, Level: x.Level[p] + 1, Cost: cost,
	})}, nil
}

func (Wagons) decideBuy(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	p := cmd.Player
	x, err := inPlay(s, p)
	if err != nil {
		return nil, err
	}
	if purchases(s, x) >= buysPerTurn {
		return nil, ErrGoldLimit
	}
	if goldAt(s, x, p) < goldPerResource {
		return nil, engine.WithParams(ErrNoGold, engine.Params{"needed": goldPerResource})
	}
	d, err := engine.DecodeCommand[struct {
		Res board.Resource `json:"res"`
	}](cmd.Data)
	if err != nil {
		return nil, err
	}
	if !d.Res.Producing() {
		return nil, engine.ErrBadCommand
	}
	if s.Bank[d.Res] < 1 {
		return nil, engine.ErrNoResources // bank-limited like any other payout
	}
	return []engine.Event{engine.NewEvent(EvBought, boughtData{
		Player: p, Res: d.Res, Gold: goldPerResource,
	})}, nil
}

// decideSell is maritime trade paid out in gold, at the seat's port rate.
//
// Ruling: 4:1, 3:1 and 2:1 ports can all buy gold (we do not take the reading
// that denies the 2:1). The rate is engine.State.CurrencyRatio, shared with the
// Rivers coin and Raiders gold so the three cannot disagree.
func (Wagons) decideSell(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	p := cmd.Player
	if _, err := inPlay(s, p); err != nil {
		return nil, err
	}
	d, err := engine.DecodeCommand[struct {
		Res board.Resource `json:"res"`
	}](cmd.Data)
	if err != nil {
		return nil, err
	}
	if !d.Res.Producing() {
		return nil, engine.ErrBadCommand
	}
	n := s.CurrencyRatio(p, d.Res)
	var cost engine.Hand
	cost[d.Res] = n
	if !s.Players[p].Hand.Has(cost) {
		return nil, engine.WithParams(engine.ErrNoResources,
			engine.Params{"missing": map[string]int{d.Res.String(): n - s.Players[p].Hand[d.Res]}})
	}
	return []engine.Event{engine.NewEvent(EvSold, soldData{
		Player: p, Res: d.Res, Count: n, Gold: 1,
	})}, nil
}

// decideSwift plays a Swift Journey: a second movement action, with a fresh full
// allowance at the current level rather than a resumption of the first.
//
// Decision: fresh rather than resumed, since the first action usually ended at a
// plaza, where an unfinished allowance would be worthless. The grain boost is once
// per movement action, so the fold clears Boosted and the second trip may buy it
// again.
func (Wagons) decideSwift(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	p := cmd.Player
	x := extRO(s)
	if !x.HasTrade || !x.Started {
		return nil, engine.ErrWrongPhase
	}
	if s.Phase != engine.PhasePlay || p != s.Cur {
		return nil, engine.ErrNotYourTurn
	}
	if err := engine.RequireUninterruptedTurn(s, p); err != nil {
		return nil, err
	}
	// One development card per turn, and a Swift Journey is one. The fold
	// sets both the base flag and this module's, so the limit holds in both
	// directions.
	if s.PlayedDevThisTurn {
		return nil, engine.ErrDevAlreadyPlayed
	}
	if x.Swift[p] <= 0 {
		return nil, ErrNoSwift
	}
	if !x.Moved || !x.MoveDone {
		return nil, ErrNoJourney
	}
	return []engine.Event{engine.NewEvent(EvSwiftPlayed, playerData{Player: p})}, nil
}

func (Wagons) edgeBlockerTargets(s *engine.State, from board.Vertex) []int {
	x := extRO(s)
	if !x.HasTrade || !x.Started || len(barbarianHomes(s, x)) == 0 {
		return nil
	}
	var out []int
	for i, e := range PathBarbarians(s) {
		if e.Touches(from) {
			out = append(out, i)
		}
	}
	slices.Sort(out)
	return out
}

func (m Wagons) chaseEdgeBlocker(s *engine.State, p engine.PlayerID, from board.Vertex, blocker int) ([]engine.Event, error) {
	if _, err := inPlay(s, p); err != nil {
		return nil, err
	}
	if !slices.Contains(m.edgeBlockerTargets(s, from), blocker) {
		return nil, engine.ErrBadPlacement
	}
	return []engine.Event{engine.NewEvent(EvBarbPending, barbPendingData{Player: p, Idx: blocker, Steal: true})}, nil
}
