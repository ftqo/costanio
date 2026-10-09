package explorers

import (
	"slices"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

func (m Module) Decide(s *engine.State, cmd engine.Command) ([]engine.Event, bool, error) {
	switch cmd.Type {
	case CmdPlaceHarbour:
		ev, err := decidePlaceHarbour(s, cmd)
		return ev, true, err
	case CmdPlaceSettlement:
		ev, err := decidePlaceSettlement(s, cmd)
		return ev, true, err
	case CmdPlaceStart:
		ev, err := decidePlaceStart(s, cmd)
		return ev, true, err
	case CmdBuildHarbour:
		ev, err := decideBuildHarbour(s, cmd)
		return ev, true, err
	case CmdBuildShip:
		ev, err := decideBuildShip(s, cmd)
		return ev, true, err
	case CmdBuyCargo:
		ev, err := decideBuyCargo(s, cmd)
		return ev, true, err
	case CmdJettison:
		ev, err := decideJettison(s, cmd)
		return ev, true, err
	case CmdGoldBuy:
		ev, err := decideGoldBuy(s, cmd)
		return ev, true, err
	case CmdGoldSell:
		ev, err := decideGoldSell(s, cmd)
		return ev, true, err
	case CmdBankGold:
		ev, err := decideBankGold(s, cmd)
		return ev, true, err
	case CmdEnterMovement:
		ev, err := decideEnterMovement(s, cmd)
		return ev, true, err
	case CmdMoveShip:
		ev, err := decideMoveShip(s, cmd)
		return ev, true, err
	case CmdSpeedShip:
		ev, err := decideSpeedShip(s, cmd)
		return ev, true, err
	case CmdLoad, CmdUnload:
		ev, err := decideTransfer(s, cmd, cmd.Type == CmdLoad)
		return ev, true, err
	case CmdLandCrew:
		ev, err := decideLandCrew(s, cmd)
		return ev, true, err
	case CmdTakeCrew:
		ev, err := decideTakeCrew(s, cmd)
		return ev, true, err
	case CmdLoadHaul:
		ev, err := decideLoadHaul(s, cmd)
		return ev, true, err
	case CmdDeliver:
		ev, err := decideDeliver(s, cmd)
		return ev, true, err
	case CmdFound:
		ev, err := decideFound(s, cmd)
		return ev, true, err
	case CmdFishRoll:
		ev, err := decideFishRoll(s, cmd)
		return ev, true, err
	case CmdChasePirate:
		ev, err := decideChasePirate(s, cmd)
		return ev, true, err
	case CmdMovePirate:
		ev, err := decideMovePirate(s, cmd)
		return ev, true, err
	default:
	}
	return nil, false, nil
}

// ---- gates ------------------------------------------------------------------

// requireSetup is the module's own setup gate: the draft is running, it is this
// seat's go, and the round is the one this command belongs to.
func requireSetup(s *engine.State, x *Ext, p engine.PlayerID, round int) error {
	if s.Phase != engine.PhaseSetup {
		return engine.ErrWrongPhase
	}
	if p != s.Cur {
		return engine.ErrNotYourTurn
	}
	if x.Round != round {
		return engine.ErrWrongPhase
	}
	return nil
}

// requireAction gates the Action phase: an actionable turn that has not yet
// entered the Movement phase.
func requireAction(s *engine.State, x *Ext, p engine.PlayerID) error {
	if err := engine.RequireActionableTurn(s, p); err != nil {
		return err
	}
	if x.Movement {
		return engine.ErrBuildingOver
	}
	return nil
}

// requireMovement gates the Movement phase. It cannot use
// RequireActionableTurn, because this module's Blocks (an owed pirate
// activation) is the interrupt that must clear first, and the phase gate is the
// module's own.
func requireMovement(s *engine.State, x *Ext, p engine.PlayerID) error {
	if s.Phase != engine.PhasePlay {
		return engine.ErrWrongPhase
	}
	if p != s.Cur {
		return engine.ErrNotYourTurn
	}
	if !s.Rolled {
		return engine.ErrMustRoll
	}
	if len(s.PendingDiscards) > 0 {
		return engine.ErrDiscardPending
	}
	if x.PiratePending {
		return ErrPiratePending
	}
	if !x.Movement {
		return ErrNotMovement
	}
	return nil
}

// ---- setup ------------------------------------------------------------------

// harbourRound is which setup round places the harbour settlement, and
// buildingRound the other starting building. In plain Explorers the first piece
// is a harbour settlement and the second a settlement; the Knights pairing
// places a city first and the harbour settlement second. The snake (forward,
// reverse, forward) is the same either way, so advanceSetup does not need to
// know.
func harbourRound(s *engine.State) int {
	if WithKnights(s) {
		return 1
	}
	return 0
}

func buildingRound(s *engine.State) int { return 1 - harbourRound(s) }

// decidePlaceHarbour is the harbour-settlement setup round (the first, or the
// second with Knights): a harbour settlement, with no road, on any coastal
// intersection of the home island.
//
// Every coastal intersection is legal because our island is fully ringed by
// home waters, so every one faces open sea.
func decidePlaceHarbour(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	x := extRO(s)
	if err := requireSetup(s, x, cmd.Player, harbourRound(s)); err != nil {
		return nil, err
	}
	d, err := engine.DecodeCommand[struct {
		V board.Vertex `json:"v"`
	}](cmd.Data)
	if err != nil {
		return nil, err
	}
	if err := checkStartSpot(s, x, d.V, true); err != nil {
		return nil, err
	}
	events := []engine.Event{engine.NewEvent(EvHarbourPlaced, placeData{Player: cmd.Player, V: d.V})}
	return append(events, setupTail(s, x)...), nil
}

// decidePlaceSettlement is the other starting building's round (the second,
// or the first with Knights): a settlement, with no road, anywhere on the home
// island under the usual distance rule, which applies between all pieces placed
// so far, harbour settlements included. It is the only starting building that
// collects resources.
func decidePlaceSettlement(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	x := extRO(s)
	if err := requireSetup(s, x, cmd.Player, buildingRound(s)); err != nil {
		return nil, err
	}
	d, err := engine.DecodeCommand[struct {
		V board.Vertex `json:"v"`
	}](cmd.Data)
	if err != nil {
		return nil, err
	}
	if err := checkStartSpot(s, x, d.V, false); err != nil {
		return nil, err
	}
	var gain engine.Hand
	for _, h := range d.V.Hexes() {
		if t, ok := s.Board.Tiles[h]; ok && t.Res.Producing() {
			gain[t.Res]++
		}
	}
	// cak+explorers rule C: this placement is a city in the Knights pairing
	// (and comes first there), so every player opens with one city and one
	// harbour settlement. The starting grant is unchanged: 1 card per adjacent
	// producing hex, even for a city, and only the base resource from a
	// commodity hex.
	city := WithKnights(s)
	if city && s.Players[cmd.Player].CitiesLeft == 0 {
		return nil, engine.ErrNoPieces
	}
	events := []engine.Event{engine.NewEvent(EvSettlementPlace, placeData{
		Player: cmd.Player, V: d.V, Gain: gain, City: city,
	})}
	return append(events, setupTail(s, x)...), nil
}

// decidePlaceStart is the third setup round: one road on an edge touching the
// player's settlement, and one ship carrying a settler on a sea edge touching
// their harbour settlement.
func decidePlaceStart(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	x := extRO(s)
	if err := requireSetup(s, x, cmd.Player, 2); err != nil {
		return nil, err
	}
	d, err := engine.DecodeCommand[struct {
		Road board.Edge `json:"road"`
		Ship board.Edge `json:"ship"`
	}](cmd.Data)
	if err != nil {
		return nil, err
	}
	road := board.NewEdge(d.Road.A, d.Road.B)
	ship := board.NewEdge(d.Ship.A, d.Ship.B)
	if !road.Valid() || !ship.Valid() {
		return nil, engine.ErrBadPlacement
	}
	if !slices.Contains(startRoads(s, x, cmd.Player), road) {
		return nil, engine.ErrBadPlacement
	}
	if !slices.Contains(startShips(s, x, cmd.Player), ship) {
		return nil, engine.ErrBadPlacement
	}
	events := []engine.Event{engine.NewEvent(EvStartPlaced, startData{
		Player: cmd.Player, Road: road, Ship: ship, ShipID: x.NextShip,
	})}
	return append(events, setupTail(s, x)...), nil
}

// setupTail starts the first real turn when the last connector of the draft goes
// down. The base draft emits the same event from decidePlaceRoad; this module
// owns the draft, so it owns the handover.
func setupTail(s *engine.State, x *Ext) []engine.Event {
	if x.Round == 2 && int(s.Cur) == s.Config.Players-1 {
		return []engine.Event{engine.NewEvent(engine.EvTurnStarted, engine.TurnStartedData{Player: 0})}
	}
	return nil
}

// checkStartSpot is the placement rule both starting buildings share: on the
// home island, unoccupied, and the distance rule against everything placed so
// far. A harbour settlement must additionally be coastal, which every island
// intersection is except the ones deep inside a wide island.
func checkStartSpot(s *engine.State, x *Ext, v board.Vertex, harbour bool) error {
	if v.Side > board.S || !onHomeIsland(x, v) || !s.Board.LandVertex(v) {
		return engine.ErrBadPlacement
	}
	if _, taken := s.Buildings[v]; taken {
		return engine.ErrOccupied
	}
	for _, n := range v.Neighbors() {
		if _, taken := s.Buildings[n]; taken {
			return engine.ErrTooClose
		}
	}
	if harbour && !coastal(s, x, v) {
		return ErrNotCoastal
	}
	return nil
}

// startRoads is every edge the seat's round-3 road may take: an edge of their
// own settlement, on land, free.
func startRoads(s *engine.State, x *Ext, p engine.PlayerID) []board.Edge {
	v, ok := ownSettlement(s, x, p)
	if !ok {
		return nil
	}
	var out []board.Edge
	for _, e := range v.Edges() {
		if !e.Valid() || !s.Board.LandEdge(e) {
			continue
		}
		if _, taken := s.Roads[e]; taken {
			continue
		}
		if !buildableEdge(x, e, p) {
			continue
		}
		out = append(out, e)
	}
	sort := slices.Clone(out)
	slices.SortFunc(sort, func(a, b board.Edge) int {
		if edgeLess(a, b) {
			return -1
		}
		return 1
	})
	return sort
}

// startShips is every sea edge the seat's round-3 ship may take: an edge of
// their own harbour settlement.
func startShips(s *engine.State, x *Ext, p engine.PlayerID) []board.Edge {
	v, ok := ownHarbour(s, x, p)
	if !ok {
		return nil
	}
	var out []board.Edge
	for _, e := range v.Edges() {
		if e.Valid() && shipSpotOK(s, x, e, p, 0) == nil {
			out = append(out, e)
		}
	}
	slices.SortFunc(out, func(a, b board.Edge) int {
		if edgeLess(a, b) {
			return -1
		}
		return 1
	})
	return out
}

// ownSettlement is p's one plain (non-harbour) starting settlement.
func ownSettlement(s *engine.State, x *Ext, p engine.PlayerID) (board.Vertex, bool) {
	var best board.Vertex
	found := false
	for v, b := range s.Buildings {
		if b.Owner != p {
			continue
		}
		if _, harbour := x.Harbours[v]; harbour {
			continue
		}
		if !found || vertexLess(v, best) {
			best, found = v, true
		}
	}
	return best, found
}

// ownHarbour is p's one starting harbour settlement.
func ownHarbour(s *engine.State, x *Ext, p engine.PlayerID) (board.Vertex, bool) {
	var best board.Vertex
	found := false
	for v, owner := range x.Harbours {
		if owner != p {
			continue
		}
		if !found || vertexLess(v, best) {
			best, found = v, true
		}
	}
	return best, found
}

// ---- action phase -----------------------------------------------------------

// decideBuildHarbour upgrades one of the player's own coastal settlements.
// There are no cities in Explorers.
func decideBuildHarbour(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	x := extRO(s)
	if err := requireAction(s, x, cmd.Player); err != nil {
		return nil, err
	}
	d, err := engine.DecodeCommand[struct {
		V board.Vertex `json:"v"`
	}](cmd.Data)
	if err != nil {
		return nil, err
	}
	if err := checkHarbourSpot(s, x, d.V, cmd.Player); err != nil {
		return nil, err
	}
	if !s.Players[cmd.Player].Hand.Has(CostHarbour) {
		return nil, engine.ErrNoResources
	}
	return []engine.Event{engine.NewEvent(EvHarbourBuilt, placeData{Player: cmd.Player, V: d.V})}, nil
}

// checkHarbourSpot is every placement rule for the harbour-settlement upgrade,
// without the price. Split out so the free upgrade (engine.Hooks.FreeHarbour,
// reached by the Knights Medicine card under cak+explorers rule H) is checked
// by the same rules.
func checkHarbourSpot(s *engine.State, x *Ext, v board.Vertex, p engine.PlayerID) error {
	b, ok := s.Buildings[v]
	if !ok || b.Owner != p {
		return engine.ErrBadPlacement
	}
	// cak+explorers rule A: a city took the other branch of the one-way upgrade
	// choice. Outside the pairing there are no cities, so this cannot fire.
	if b.City {
		return ErrUpgradeIsFinal
	}
	if _, already := x.Harbours[v]; already {
		return engine.ErrOccupied
	}
	if !coastal(s, x, v) {
		return ErrNotCoastal
	}
	if x.Seats[p].HarboursLeft == 0 {
		return engine.ErrNoPieces
	}
	return nil
}

// freeHarbour is engine.Hooks.FreeHarbour: the upgrade with the resources
// already paid for by whatever card bought it.
func freeHarbour(s *engine.State, p engine.PlayerID, v board.Vertex) (engine.Event, error) {
	if err := checkHarbourSpot(s, extRO(s), v, p); err != nil {
		return engine.Event{}, err
	}
	return engine.NewEvent(EvHarbourBuilt, placeData{Player: p, V: v, Free: true}), nil
}

// decideBuildShip places a ship on a sea edge with room, one of whose ends is
// the intersection of one of the builder's harbour settlements.
//
// Recycling: only when all three ships are on the board (supply empty), the
// player may first return any one of them to the supply; its cargo goes back to
// its own supply and is lost. This is how a stranded ship gets home.
func decideBuildShip(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	x := extRO(s)
	if err := requireAction(s, x, cmd.Player); err != nil {
		return nil, err
	}
	d, err := engine.DecodeCommand[struct {
		E        board.Edge `json:"e"`
		Recycled int        `json:"recycled,omitempty"`
	}](cmd.Data)
	if err != nil {
		return nil, err
	}
	e := board.NewEdge(d.E.A, d.E.B)
	if d.Recycled != 0 {
		// Recycling is allowed only with an empty supply. Otherwise it would be
		// a cheap teleport that ignores movement points.
		if x.Seats[cmd.Player].ShipsLeft > 0 {
			return nil, engine.ErrBadCommand
		}
		sh, ok := x.Ships[d.Recycled]
		if !ok || sh.Owner != cmd.Player {
			return nil, engine.ErrBadPlacement
		}
	} else if x.Seats[cmd.Player].ShipsLeft == 0 {
		return nil, engine.ErrNoPieces
	}
	if err := shipSpotOK(s, x, e, cmd.Player, d.Recycled); err != nil {
		return nil, err
	}
	if !s.Players[cmd.Player].Hand.Has(CostShip) {
		return nil, engine.ErrNoResources
	}
	return []engine.Event{engine.NewEvent(EvShipBuilt, shipData{
		Player: cmd.Player, ShipID: x.NextShip, E: e, Recycled: d.Recycled,
	})}, nil
}

// shipSpotOK is the ship placement rule, shared by the build command and the
// setup ship.
//
// A ship may not be built on the edge of an unexplored hex because that would
// reveal it immediately; the reveal is triggered by a ship end at a corner, so
// the test is on corners.
//
// A coastal intersection of the home island always has at least one legal
// placement: an edge between a home-island hex and a home-water hex has both
// endpoints on home hexes only, never on the pool.
func shipSpotOK(s *engine.State, x *Ext, e board.Edge, p engine.PlayerID, excl int) error {
	if !e.Valid() || !sailable(s, x, e) {
		return ErrNotSeaEdge
	}
	if vertexTouchesFog(x, e.A) || vertexTouchesFog(x, e.B) {
		return ErrIntoTheFog
	}
	if !roomOn(x, e, excl) {
		return engine.ErrOccupied
	}
	if _, ok := shipAtHarbour(x, e, p); !ok {
		return ErrNoShipyard
	}
	return nil
}

// decideBuyCargo puts a settler or a crew into an empty slot of one of the
// player's harbour settlements, or of one of their ships adjacent to one. A
// settler needs both slots, a crew one. Neither is ever placed on land; they
// move only by ship.
func decideBuyCargo(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	x := extRO(s)
	if err := requireAction(s, x, cmd.Player); err != nil {
		return nil, err
	}
	d, err := engine.DecodeCommand[struct {
		Settler bool         `json:"settler"`
		ShipID  int          `json:"ship_id,omitempty"`
		V       board.Vertex `json:"v"`
		AtShip  bool         `json:"at_ship"`
	}](cmd.Data)
	if err != nil {
		return nil, err
	}
	piece := Cargo{Crew: 1}
	cost := CostCrew
	if d.Settler {
		piece = Cargo{Settler: 1}
		cost = CostSettler
	}
	if d.Settler && x.Seats[cmd.Player].SettlersLeft == 0 {
		return nil, engine.ErrNoPieces
	}
	if !d.Settler && x.Seats[cmd.Player].CrewsLeft == 0 {
		return nil, engine.ErrNoPieces
	}
	if !s.Players[cmd.Player].Hand.Has(cost) {
		return nil, engine.ErrNoResources
	}
	out := cargoData{Player: cmd.Player, Cargo: piece, Cost: cost, AtShip: d.AtShip}
	if d.AtShip {
		sh, ok := x.Ships[d.ShipID]
		if !ok || sh.Owner != cmd.Player {
			return nil, engine.ErrBadPlacement
		}
		if _, at := shipAtHarbour(x, sh.E, cmd.Player); !at {
			return nil, ErrNotAtHarbour
		}
		if !add(sh.Hold, piece).Fits() {
			return nil, ErrHoldFull
		}
		out.ShipID = d.ShipID
	} else {
		if !hasHarbourAt(x, d.V, cmd.Player) {
			return nil, ErrNotAtHarbour
		}
		if !add(x.Basins[d.V], piece).Fits() {
			return nil, ErrHoldFull
		}
		out.V = d.V
	}
	return []engine.Event{engine.NewEvent(EvCargoBought, out)}, nil
}

// decideJettison discards one piece to the supply to make room. Legal only when
// every slot in the player's harbour settlements and adjacent ships is full, so
// a full board never deadlocks.
func decideJettison(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	x := extRO(s)
	if err := requireAction(s, x, cmd.Player); err != nil {
		return nil, err
	}
	d, err := engine.DecodeCommand[struct {
		ShipID int          `json:"ship_id,omitempty"`
		V      board.Vertex `json:"v"`
		AtShip bool         `json:"at_ship"`
		Cargo  Cargo        `json:"cargo"`
	}](cmd.Data)
	if err != nil {
		return nil, err
	}
	if d.Cargo.Slots() == 0 || !d.Cargo.Fits() {
		return nil, engine.ErrBadCommand
	}
	if !everySlotFull(x, cmd.Player) {
		return nil, ErrRoomRemains
	}
	out := cargoData{Player: cmd.Player, Cargo: d.Cargo, AtShip: d.AtShip}
	if d.AtShip {
		sh, ok := x.Ships[d.ShipID]
		if !ok || sh.Owner != cmd.Player {
			return nil, engine.ErrBadPlacement
		}
		if !sub(sh.Hold, d.Cargo).Fits() {
			return nil, engine.ErrBadCommand
		}
		out.ShipID = d.ShipID
	} else {
		if !hasHarbourAt(x, d.V, cmd.Player) {
			return nil, ErrNotAtHarbour
		}
		if !sub(x.Basins[d.V], d.Cargo).Fits() {
			return nil, engine.ErrBadCommand
		}
		out.V = d.V
	}
	return []engine.Event{engine.NewEvent(EvJettisoned, out)}, nil
}

// everySlotFull reports whether p has nowhere left to put a bought piece: every
// harbour settlement basin and every ship touching one is at capacity.
func everySlotFull(x *Ext, p engine.PlayerID) bool {
	for v, owner := range x.Harbours {
		if owner != p {
			continue
		}
		if x.Basins[v].Slots() < 2 {
			return false
		}
	}
	for _, sh := range x.Ships {
		if sh.Owner != p {
			continue
		}
		if _, at := shipAtHarbour(x, sh.E, p); at && sh.Hold.Slots() < 2 {
			return false
		}
	}
	return true
}

// decideGoldBuy spends 2 gold on any 1 resource, twice per turn.
func decideGoldBuy(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	x := extRO(s)
	if err := requireAction(s, x, cmd.Player); err != nil {
		return nil, err
	}
	res, err := decodeResource(cmd)
	if err != nil {
		return nil, err
	}
	if x.Seats[cmd.Player].GoldBuys >= GoldBuysPerTurn {
		return nil, ErrGoldSpent
	}
	if x.Seats[cmd.Player].Gold < GoldPerResource {
		return nil, ErrNoGold
	}
	var get engine.Hand
	get[res] = 1
	if !s.Bank.Has(get) {
		return nil, engine.ErrNoResources
	}
	return []engine.Event{engine.NewEvent(EvGoldTraded, goldTradeData{
		Player: cmd.Player, Get: get, Gold: -GoldPerResource, Reason: GoldBuy,
	})}, nil
}

// decideGoldSell is the Fast Gold advantage: sell 1 resource for 1 gold, once
// per Action phase, twice with both villages.
//
// It is in addition to the two 2-gold purchases: a player with both villages
// may sell two and buy two in the same Action phase.
func decideGoldSell(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	x := extRO(s)
	if err := requireAction(s, x, cmd.Player); err != nil {
		return nil, err
	}
	allowed := villages(x, cmd.Player, VillageGold)
	if allowed == 0 {
		return nil, ErrNoFastGold
	}
	if x.Seats[cmd.Player].FastGold >= allowed {
		return nil, ErrGoldSpent
	}
	// cak+explorers rule G: with Fast Gold a player may sell a commodity
	// instead of a resource for 1 gold. The commodity belongs to another
	// module, so the good is named and its owning module produces the events
	// (engine.Hooks.SellGood). The allowance is shared: one sale, or two with
	// both villages, of either kind.
	//
	// Gated on the good being named, not on the pairing: a payload with no
	// `good` is a resource sale, and outside the pairing no module answers to a
	// good name.
	if good, err := decodeGood(cmd); err != nil {
		return nil, err
	} else if good != "" {
		events, ok, err := s.SellGoodToModule(cmd.Player, good)
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, engine.ErrBadCommand
		}
		return append(events, engine.NewEvent(EvGoldTraded, goldTradeData{
			Player: cmd.Player, Gold: 1, Reason: GoldSell,
		})), nil
	}
	res, err := decodeResource(cmd)
	if err != nil {
		return nil, err
	}
	var give engine.Hand
	give[res] = 1
	if !s.Players[cmd.Player].Hand.Has(give) {
		return nil, engine.ErrNoResources
	}
	return []engine.Event{engine.NewEvent(EvGoldTraded, goldTradeData{
		Player: cmd.Player, Give: give, Gold: 1, Reason: GoldSell,
	})}, nil
}

// decideBankGold is the gold half of the flat 3:1 bank trade: three identical
// resource cards buy one gold. (Three for a different resource is the base bank
// trade, priced by the BankRatio hook.)
func decideBankGold(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	x := extRO(s)
	if err := requireAction(s, x, cmd.Player); err != nil {
		return nil, err
	}
	res, err := decodeResource(cmd)
	if err != nil {
		return nil, err
	}
	var give engine.Hand
	give[res] = BankRatio
	if !s.Players[cmd.Player].Hand.Has(give) {
		return nil, engine.ErrNoResources
	}
	return []engine.Event{engine.NewEvent(EvGoldTraded, goldTradeData{
		Player: cmd.Player, Give: give, Gold: 1, Reason: GoldBank,
	})}, nil
}

// decodeGood reads the optional `good` field: the name of another module's good
// (cak+explorers rule G sells a commodity for gold). Empty means a plain
// resource, which is all the command carries outside the pairing.
func decodeGood(cmd engine.Command) (string, error) {
	d, err := engine.DecodeCommand[struct {
		Good string `json:"good"`
	}](cmd.Data)
	if err != nil {
		return "", err
	}
	return d.Good, nil
}

func decodeResource(cmd engine.Command) (board.Resource, error) {
	d, err := engine.DecodeCommand[struct {
		Res board.Resource `json:"res"`
	}](cmd.Data)
	if err != nil {
		return 0, err
	}
	if !d.Res.Producing() {
		return 0, engine.ErrBadCommand
	}
	return d.Res, nil
}

// ---- movement ---------------------------------------------------------------

// decideEnterMovement enters the Movement phase, which has no way back. An open
// trade offer is cancelled: the offerer is the one entering, and nobody could
// settle it any more.
func decideEnterMovement(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	x := extRO(s)
	if err := requireAction(s, x, cmd.Player); err != nil {
		return nil, err
	}
	events := []engine.Event{engine.NewEvent(EvMovementBegan, movementData{Player: cmd.Player})}
	if s.ActiveOffer != nil {
		events = append(events, engine.NewEvent(engine.EvTradeCancelled, struct{}{}))
	}
	return events, nil
}

// moveResult is where a path actually ends and what it revealed on the way.
type moveResult struct {
	end     board.Edge
	reveals []board.Hex
}

// walkPath validates one ship's movement step by step and reports where it
// stops.
//
// Each step costs one movement point and must land on an adjacent sea edge
// (sharing an endpoint). Direction is free, including doubling back.
//
// After every point, if either end of the ship is a corner of an unexplored
// hex, that hex is revealed. This is mandatory and ends the ship's movement
// immediately, forfeiting remaining points, wool-bought ones included.
//
// A path that runs past its stopping point is refused rather than truncated:
// the client can see every fog hex and knows where a move ends, and silently
// dropping the tail would put the ship somewhere the player did not ask for.
func walkPath(s *engine.State, x *Ext, sh Ship, path []board.Edge) (moveResult, error) {
	cur := sh.E
	for i, raw := range path {
		e := board.NewEdge(raw.A, raw.B)
		if !e.Valid() || e == cur || !e.Connects(cur) {
			return moveResult{}, engine.ErrBadPlacement
		}
		if !sailable(s, x, e) {
			return moveResult{}, ErrNotSeaEdge
		}
		cur = e
		if fogs := fogAt(x, cur); len(fogs) > 0 {
			if i != len(path)-1 {
				return moveResult{}, ErrStopsAtTheFog
			}
			return moveResult{end: cur, reveals: fogs}, nil
		}
	}
	return moveResult{end: cur}, nil
}

func decideMoveShip(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	x := extRO(s)
	if err := requireMovement(s, x, cmd.Player); err != nil {
		return nil, err
	}
	d, err := engine.DecodeCommand[struct {
		ShipID int          `json:"ship_id"`
		Path   []board.Edge `json:"path"`
	}](cmd.Data)
	if err != nil {
		return nil, err
	}
	sh, ok := x.Ships[d.ShipID]
	if !ok || sh.Owner != cmd.Player {
		return nil, engine.ErrBadPlacement
	}
	if len(d.Path) == 0 || len(d.Path) > MaxMP {
		return nil, engine.ErrBadCommand
	}
	if left := mpLeft(x, sh); len(d.Path) > left {
		return nil, ErrNoMovement
	}
	res, err := walkPath(s, x, sh, d.Path)
	if err != nil {
		return nil, err
	}
	// A ship may move past a full edge but may not end its movement on one.
	if !roomOn(x, res.end, sh.ID) {
		return nil, engine.ErrOccupied
	}
	tribute := 0
	if tributeDue(x, sh, d.Path) {
		if x.Seats[cmd.Player].Gold < Tribute {
			// Tribute is not a debt: a player who will not or cannot pay may
			// not use those edges this turn.
			return nil, ErrNoTribute
		}
		tribute = Tribute
	}
	events := []engine.Event{engine.NewEvent(EvShipMoved, shipMoveData{
		Player: cmd.Player, ShipID: sh.ID, From: sh.E, To: res.end,
		Path: normalizePath(d.Path), Steps: len(d.Path),
		Tribute: tribute, Stopped: len(res.reveals) > 0,
	})}
	return append(events, revealEvents(s, x, cmd.Player, res.reveals, len(events))...), nil
}

func normalizePath(path []board.Edge) []board.Edge {
	out := make([]board.Edge, len(path))
	for i, e := range path {
		out[i] = board.NewEdge(e.A, e.B)
	}
	return out
}

// revealEvents turns newly touched fog hexes into events, in ascending axial
// order, each paying its own reward.
//
// Every touched hex is revealed. The rule is per hex with no cap, and leaving
// one would make it permanently unreachable from that position (the ship is
// already there).
func revealEvents(s *engine.State, x *Ext, p engine.PlayerID, hexes []board.Hex, offset int) []engine.Event {
	if len(hexes) == 0 {
		return nil
	}
	used := slices.Clone(x.ChitsUsed)
	var out []engine.Event
	for _, h := range hexes {
		pool, ok := poolOf(x, h)
		if !ok {
			continue
		}
		d := revealData{Player: p, H: h, Region: pool.Region, Kind: pool.Kind, Shoal: pool.Shoal}
		if pool.Kind == SpecialSpice {
			d.Village = pool.Village
		}
		gold := RevealGold
		if t, ok := s.Board.Tiles[h]; ok {
			d.Res = t.Res
			if pool.Kind == SpecialNone && t.Res.Producing() {
				// Producing land: draw the top chit of the region's stack, face up,
				// and pay the explorer one resource of that terrain.
				d.Number = drawChit(x, pool.Region, used)
				var gain engine.Hand
				gain[t.Res] = 1
				if s.Bank.Has(gain) {
					d.Gain = gain
				}
				gold = 0
			}
		}
		out = append(out, engine.NewEvent(EvHexRevealed, d))
		if gold > 0 {
			out = append(out, engine.NewEvent(EvGoldChanged, goldData{
				Gains: []goldGain{{Player: p, Amount: gold}}, Reason: GoldReveal,
			}))
		}
	}
	return out
}

// drawChit takes the next chit off a region's stack, tracking a local cursor so
// that several reveals in one move consume the stack in order.
func drawChit(x *Ext, region int, used []int) int {
	stack := x.Chits[region]
	if used[region] >= len(stack) {
		return 0 // the stack ran dry: the hex is revealed with no number
	}
	n := stack[used[region]]
	used[region]++
	return n
}

// decideSpeedShip buys one ship +2 movement points for 1 wool, once per ship per
// turn. Pay separately for each ship you want to speed up.
func decideSpeedShip(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	x := extRO(s)
	if err := requireMovement(s, x, cmd.Player); err != nil {
		return nil, err
	}
	d, err := engine.DecodeCommand[struct {
		ShipID int `json:"ship_id"`
	}](cmd.Data)
	if err != nil {
		return nil, err
	}
	sh, ok := x.Ships[d.ShipID]
	if !ok || sh.Owner != cmd.Player {
		return nil, engine.ErrBadPlacement
	}
	if sh.Bonus > 0 {
		return nil, ErrAlreadySped
	}
	if sh.Done {
		return nil, ErrNoMovement
	}
	var wool engine.Hand
	wool[board.Sheep] = 1
	if !s.Players[cmd.Player].Hand.Has(wool) {
		return nil, engine.ErrNoResources
	}
	return []engine.Event{engine.NewEvent(EvShipSped, shipRefData{Player: cmd.Player, ShipID: sh.ID})}, nil
}

// decideTransfer moves cargo between a ship's hold and one of the player's own
// harbour settlements, when either end of the ship is that settlement's
// intersection. It costs no movement points and may happen mid-move; the ship
// then keeps moving with what it has left.
//
// Ship to ship is not allowed directly; a shared harbour settlement works as a
// relay.
//
// A swap is the same command with `back`: what travels the other way in the
// same transfer. It must be one command because the case it covers has no free
// slot on either side (a ship with a settler beside a basin with two crews).
// Both sides are checked as they stand after the exchange.
func decideTransfer(s *engine.State, cmd engine.Command, load bool) ([]engine.Event, error) {
	x := extRO(s)
	if err := requireMovement(s, x, cmd.Player); err != nil {
		return nil, err
	}
	d, err := engine.DecodeCommand[struct {
		ShipID int   `json:"ship_id"`
		Cargo  Cargo `json:"cargo"`
		Back   Cargo `json:"back"`
	}](cmd.Data)
	if err != nil {
		return nil, err
	}
	sh, ok := x.Ships[d.ShipID]
	if !ok || sh.Owner != cmd.Player {
		return nil, engine.ErrBadPlacement
	}
	v, at := shipAtHarbour(x, sh.E, cmd.Player)
	if !at {
		return nil, ErrNotAtHarbour
	}
	if d.Cargo.Slots() == 0 || !d.Cargo.Fits() || !d.Back.Fits() {
		return nil, engine.ErrBadCommand
	}
	from, to := x.Basins[v], sh.Hold
	if !load {
		from, to = sh.Hold, x.Basins[v]
	}
	// What leaves `to` in exchange has to be there: a swap cannot hand back a
	// piece the far side was not holding.
	if !sub(to, d.Back).Fits() || !sub(from, d.Cargo).Fits() {
		return nil, engine.ErrBadCommand
	}
	if !add(sub(from, d.Cargo), d.Back).Fits() || !add(sub(to, d.Back), d.Cargo).Fits() {
		return nil, ErrHoldFull
	}
	return []engine.Event{engine.NewEvent(EvCargoMoved, cargoMoveData{
		Player: cmd.Player, ShipID: sh.ID, V: v, Cargo: d.Cargo, ToShip: load, Back: d.Back,
	})}, nil
}

// decideLandCrew unloads one crew onto an uncaptured pirate lair or a spice
// farm. On a farm the crew stays permanently and the ship takes one spice sack
// in exchange: one crew and one sack per player per farm for the whole game.
func decideLandCrew(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	x := extRO(s)
	if err := requireMovement(s, x, cmd.Player); err != nil {
		return nil, err
	}
	d, err := engine.DecodeCommand[struct {
		ShipID int       `json:"ship_id"`
		H      board.Hex `json:"h"`
	}](cmd.Data)
	if err != nil {
		return nil, err
	}
	sh, ok := x.Ships[d.ShipID]
	if !ok || sh.Owner != cmd.Player {
		return nil, engine.ErrBadPlacement
	}
	if sh.Hold.Crew == 0 {
		return nil, ErrNoCrew
	}
	if !touchesHex(sh.E, d.H) {
		return nil, ErrOutOfReach
	}
	pool, ok := poolOf(x, d.H)
	if !ok || !x.Revealed[d.H] {
		return nil, engine.ErrBadPlacement
	}
	out := crewData{Player: cmd.Player, ShipID: sh.ID, H: d.H}
	switch pool.Kind {
	case SpecialGold:
		if x.Captured[d.H] {
			return nil, ErrLairCaptured
		}
	case SpecialSpice:
		if x.FarmCrew[d.H][cmd.Player] {
			return nil, ErrFarmBefriended
		}
		// The sack goes aboard as the crew steps off, so the hold has to have
		// room for it once the crew has left.
		if !add(sub(sh.Hold, Cargo{Crew: 1}), Cargo{Spice: 1}).Fits() {
			return nil, ErrHoldFull
		}
		out.Sack = true
		out.Village = pool.Village
		out.Region = pool.Region
	default:
		return nil, engine.ErrBadPlacement // crews may not be unloaded onto ordinary land
	}
	return []engine.Event{engine.NewEvent(EvCrewLanded, out)}, nil
}

// decideTakeCrew picks one of the player's own surviving crews back up from a
// captured lair. Crews on a farm are spent.
func decideTakeCrew(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	x := extRO(s)
	if err := requireMovement(s, x, cmd.Player); err != nil {
		return nil, err
	}
	d, err := engine.DecodeCommand[struct {
		ShipID int       `json:"ship_id"`
		H      board.Hex `json:"h"`
	}](cmd.Data)
	if err != nil {
		return nil, err
	}
	sh, ok := x.Ships[d.ShipID]
	if !ok || sh.Owner != cmd.Player {
		return nil, engine.ErrBadPlacement
	}
	if !touchesHex(sh.E, d.H) {
		return nil, ErrOutOfReach
	}
	crews, ok := x.LairCrew[d.H]
	if !ok || !x.Captured[d.H] || crews[cmd.Player] == 0 {
		return nil, ErrNoCrew
	}
	if !add(sh.Hold, Cargo{Crew: 1}).Fits() {
		return nil, ErrHoldFull
	}
	return []engine.Event{engine.NewEvent(EvCrewTaken, crewData{Player: cmd.Player, ShipID: sh.ID, H: d.H})}, nil
}

// decideLoadHaul takes a fish haul off a shoal. A haul is a large piece, so the
// ship must be otherwise empty. It costs no movement points and the ship may
// keep moving.
func decideLoadHaul(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	x := extRO(s)
	if err := requireMovement(s, x, cmd.Player); err != nil {
		return nil, err
	}
	d, err := engine.DecodeCommand[struct {
		ShipID int       `json:"ship_id"`
		H      board.Hex `json:"h"`
	}](cmd.Data)
	if err != nil {
		return nil, err
	}
	sh, ok := x.Ships[d.ShipID]
	if !ok || sh.Owner != cmd.Player {
		return nil, engine.ErrBadPlacement
	}
	if !touchesHex(sh.E, d.H) {
		return nil, ErrOutOfReach
	}
	if !x.Hauls[d.H] {
		return nil, ErrNoHaul
	}
	if !add(sh.Hold, Cargo{Haul: 1}).Fits() {
		return nil, ErrHoldFull
	}
	return []engine.Event{engine.NewEvent(EvHaulLoaded, haulData{Player: cmd.Player, ShipID: sh.ID, H: d.H})}, nil
}

// decideDeliver unloads everything the Council takes: a fish haul is +1 space on
// the fish track, and each spice sack is +1 on the spice track. Delivery is at
// either anchor of the Council hex.
func decideDeliver(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	x := extRO(s)
	if err := requireMovement(s, x, cmd.Player); err != nil {
		return nil, err
	}
	d, err := engine.DecodeCommand[struct {
		ShipID int `json:"ship_id"`
	}](cmd.Data)
	if err != nil {
		return nil, err
	}
	sh, ok := x.Ships[d.ShipID]
	if !ok || sh.Owner != cmd.Player {
		return nil, engine.ErrBadPlacement
	}
	if !atCouncil(x, sh.E) {
		return nil, ErrNotAtCouncil
	}
	if sh.Hold.Haul == 0 && sh.Hold.Spice == 0 {
		return nil, ErrNothingToDeliver
	}
	return []engine.Event{engine.NewEvent(EvDelivered, deliverData{
		Player: cmd.Player, ShipID: sh.ID, Hauls: sh.Hold.Haul, Sacks: sh.Hold.Spice,
	})}, nil
}

// decideFound lands a settler as a settlement on a corner of an explored land
// hex the ship touches. Both the settler and the ship return to the supply.
//
// Such a settlement needs only the distance rule; the settler replaces the
// connecting road.
func decideFound(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	x := extRO(s)
	if err := requireMovement(s, x, cmd.Player); err != nil {
		return nil, err
	}
	d, err := engine.DecodeCommand[struct {
		ShipID int          `json:"ship_id"`
		V      board.Vertex `json:"v"`
	}](cmd.Data)
	if err != nil {
		return nil, err
	}
	sh, ok := x.Ships[d.ShipID]
	if !ok || sh.Owner != cmd.Player {
		return nil, engine.ErrBadPlacement
	}
	if sh.Hold.Settler == 0 {
		return nil, ErrNoSettler
	}
	if !sh.E.Touches(d.V) {
		return nil, ErrOutOfReach
	}
	if err := foundSpotOK(s, x, d.V, cmd.Player); err != nil {
		return nil, err
	}
	if s.Players[cmd.Player].SettlementsLeft == 0 {
		return nil, engine.ErrNoPieces
	}
	return []engine.Event{engine.NewEvent(EvFounded, foundData{Player: cmd.Player, ShipID: sh.ID, V: d.V})}, nil
}

func foundSpotOK(s *engine.State, x *Ext, v board.Vertex, p engine.PlayerID) error {
	if v.Side > board.S || !s.Board.LandVertex(v) {
		return engine.ErrBadPlacement
	}
	if _, taken := s.Buildings[v]; taken {
		return engine.ErrOccupied
	}
	for _, n := range v.Neighbors() {
		if _, taken := s.Buildings[n]; taken {
			return engine.ErrTooClose
		}
	}
	if !buildableVertex(x, v, p) {
		return engine.ErrBadPlacement
	}
	return nil
}

// decideFishRoll is the fish mission's one die per Movement phase. If the
// result matches an explored fish shoal's number, a haul is placed there; an
// unexplored shoal's number does nothing.
//
// It is rolled before or after moving a ship, never during: the roll's fold
// ends the move of any ship under way (finishOtherShips), so a player cannot
// see the die and then decide where to finish sailing.
//
// A miss is still an event, because the roll is a public draw from the seeded
// stream that a replay must reproduce, and it is what caps the roll at one per
// phase.
func decideFishRoll(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	x := extRO(s)
	if err := requireMovement(s, x, cmd.Player); err != nil {
		return nil, err
	}
	if x.FishRolled {
		return nil, ErrAlreadyFished
	}
	die := engine.PublicRngForSeed(s.PublicSeed, engine.ExplorersDieSeq(s.NextSeq)).IntN(6) + 1
	for _, pool := range x.Pool {
		if pool.Kind != SpecialShoal || pool.Shoal != die {
			continue
		}
		if !x.Revealed[pool.H] || x.Hauls[pool.H] || x.HaulsLeft == 0 {
			break
		}
		if x.HasPirate && x.Pirate == pool.H {
			break
		}
		return []engine.Event{engine.NewEvent(EvHaulPlaced, haulData{Player: cmd.Player, H: pool.H, Die: die})}, nil
	}
	return []engine.Event{engine.NewEvent(EvHaulMissed, haulData{Player: cmd.Player, Die: die})}, nil
}

// decideChasePirate tries to drive off an opponent's pirate ship with the
// player's battle-ready ships: ships that have not moved this turn and have an
// end at a corner of the pirate's hex.
//
// The player nominates the rolling order and rolling stops once the pirate is
// driven off. The order is fixed because it affects the RNG stream.
func decideChasePirate(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	x := extRO(s)
	if err := requireMovement(s, x, cmd.Player); err != nil {
		return nil, err
	}
	d, err := engine.DecodeCommand[struct {
		Ships []int `json:"ships"`
	}](cmd.Data)
	if err != nil {
		return nil, err
	}
	ready := battleReady(x, cmd.Player)
	if len(ready) == 0 {
		return nil, ErrNoChase
	}
	if len(d.Ships) == 0 {
		return nil, engine.ErrBadCommand
	}
	seen := map[int]bool{}
	for _, id := range d.Ships {
		if seen[id] || !slices.Contains(ready, id) {
			return nil, engine.ErrBadPlacement
		}
		seen[id] = true
	}
	hits := chaseHits(x, cmd.Player)
	// Every die comes from the seeded public stream, like the production dice,
	// so a chase is auditable. One generator for the whole resolution, drawn in
	// the nominated order.
	rng := engine.PublicRngForSeed(s.PublicSeed, engine.ExplorersDieSeq(s.NextSeq))
	var rolls []int
	won := false
	for range d.Ships {
		r := rng.IntN(6) + 1
		rolls = append(rolls, r)
		if slices.Contains(hits, r) {
			won = true
			break
		}
	}
	events := []engine.Event{engine.NewEvent(EvPirateChased, chaseData{
		Player: cmd.Player, Ships: d.Ships[:len(rolls)], Rolls: rolls, Need: hits[0], Hits: hits, Won: won,
	})}
	return events, nil
}

// decideMovePirate resolves the activation a 7 or a won chase owes.
//
// Exactly one case applies: no pirate on the board, place yours; your own on
// the board, move it to a different legal hex; an opponent's on the board,
// return it to its owner and place yours on a different legal hex
// (pirateLeaves).
func decideMovePirate(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	x := extRO(s)
	if s.Phase != engine.PhasePlay {
		return nil, engine.ErrWrongPhase
	}
	if !x.PiratePending || x.PirateBy != cmd.Player {
		return nil, engine.ErrWrongPhase
	}
	if len(s.PendingDiscards) > 0 {
		return nil, engine.ErrDiscardPending
	}
	d, err := engine.DecodeCommand[struct {
		H      board.Hex        `json:"h"`
		Victim *engine.PlayerID `json:"victim"`
	}](cmd.Data)
	if err != nil {
		return nil, err
	}
	if !pirateHexLegal(s, x, d.H) {
		return nil, engine.ErrBadPlacement
	}
	if !pirateLeaves(x, d.H) {
		return nil, ErrPirateMustMove
	}
	out := pirateData{Player: cmd.Player, H: d.H}
	if x.HasPirate {
		from := x.Pirate
		out.From = &from
		if x.PirateOwner != cmd.Player {
			owner := x.PirateOwner
			out.Displaced = &owner
		}
	}
	if x.Hauls[d.H] {
		// A pirate ship landing on a shoal removes the haul sitting there and
		// blocks a new one while it stays.
		out.Haul = true
	}
	victims := pirateVictims(x, d.H, cmd.Player)
	var visible []engine.PlayerID
	if len(victims) == 0 {
		if d.Victim != nil {
			return nil, engine.ErrBadVictim
		}
	} else {
		if d.Victim == nil || !victims[*d.Victim] {
			return nil, engine.ErrBadVictim
		}
		v := *d.Victim
		out.Victim = &v
		if s.Players[v].Hand.Count() == 0 {
			// Gold is never stolen except by this one route: a victim with no
			// resource cards at all may be taken 1 gold instead.
			if x.Seats[v].Gold > 0 {
				out.Gold = 1
			} else {
				out.Victim = nil
			}
		} else {
			res, _ := engine.RandomCard(engine.RngFor(s, 0), s.Players[v].Hand)
			out.Res = res
			visible = []engine.PlayerID{cmd.Player, v}
		}
	}
	return []engine.Event{engine.NewEvent(EvPirateMoved, out, visible...)}, nil
}
