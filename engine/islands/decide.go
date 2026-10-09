package islands

import (
	"errors"
	"slices"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

var (
	ErrNotSeaEdge       = errors.New("islands: ships go on sea edges")
	ErrPirateBlocks     = errors.New("islands: the pirate blocks that water")
	ErrShipNotOpen      = errors.New("islands: only an open-ended ship may move")
	ErrShipJustBuilt    = errors.New("islands: a ship cannot move the turn it was built")
	ErrShipAlreadyMoved = errors.New("islands: only one ship move per turn")
	ErrNoGoldOwed       = errors.New("islands: no gold picks owed")
	ErrBadGoldPick      = errors.New("islands: pick does not match what is owed")
)

type shipData struct {
	Player engine.PlayerID `json:"player"`
	E      board.Edge      `json:"e"`
	Free   bool            `json:"free,omitempty"` // setup ship: no cost
}

type shipMoveData struct {
	Player engine.PlayerID `json:"player"`
	From   board.Edge      `json:"from"`
	To     board.Edge      `json:"to"`
}

type pirateData struct {
	Player engine.PlayerID `json:"player"`
	Hex    board.Hex       `json:"hex"`
}

type goldOwedData struct {
	Owed []engine.PlayerDiscard `json:"owed"`
}

type goldChosenData struct {
	Player engine.PlayerID `json:"player"`
	Gain   engine.Hand     `json:"gain"`
}

type islandChipData struct {
	Player engine.PlayerID `json:"player"`
	Island int             `json:"island"`
	VP     int             `json:"vp"`
}

func (m Module) Decide(s *engine.State, cmd engine.Command) ([]engine.Event, bool, error) {
	switch cmd.Type {
	case CmdBuildShip:
		ev, err := m.decideBuildShip(s, cmd)
		return ev, true, err
	case CmdMoveShip:
		ev, err := m.decideMoveShip(s, cmd)
		return ev, true, err
	case CmdMovePirate:
		ev, err := m.decideMovePirate(s, cmd)
		return ev, true, err
	case CmdChooseGold:
		ev, err := m.decideChooseGold(s, cmd)
		return ev, true, err
	default:
	}
	return nil, false, nil
}

func (m Module) decideBuildShip(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	if err := engine.RequireActionableTurn(s, cmd.Player); err != nil {
		// A Road Building card's free builds may be spent on a ship
		// (docs/rules/islands.md: "2 roads, 2 ships, or 1 ship and 1 road"),
		// and the card has no roll requirement, which is why engine.decideBuild
		// exempts CmdBuildRoad from the actionable-turn test. The ship gets the
		// same exemption so the card works the same for either piece. Every
		// interrupt still applies: this waits behind a discard, the robber and
		// any module pending, as the free road does.
		if s.FreeRoads == 0 || engine.RequireUninterruptedTurn(s, cmd.Player) != nil {
			return nil, err
		}
	}
	d, err := engine.DecodeCommand[shipData](cmd.Data)
	if err != nil {
		return nil, err
	}
	e := board.NewEdge(d.E.A, d.E.B)
	x := extRO(s)
	if err := m.checkShipSpot(s, x, e, cmd.Player, nil); err != nil {
		return nil, err
	}
	if x.ShipsLeft[cmd.Player] == 0 {
		return nil, engine.ErrNoPieces
	}
	// A Road Building card's free builds (FreeRoads) may be spent on ships, not
	// just roads (2 roads, 2 ships, or 1 of each; docs/rules/islands.md). Free
	// builds are spent first, mirroring base road building.
	free := s.FreeRoads > 0
	if !free && !s.Players[cmd.Player].Hand.Has(CostShip) {
		return nil, engine.ErrNoResources
	}
	return []engine.Event{engine.NewEvent(EvShipBuilt, shipData{Player: cmd.Player, E: e, Free: free})}, nil
}

// checkShipSpot validates placement; excl (for moves) is treated as absent.
func (m Module) checkShipSpot(s *engine.State, x *Ext, e board.Edge, p engine.PlayerID, excl *board.Edge) error {
	if !e.Valid() || !s.Board.SeaEdge(e) {
		return ErrNotSeaEdge
	}
	if _, taken := s.Roads[e]; taken {
		return engine.ErrOccupied
	}
	if owner, taken := x.Ships[e]; taken && (excl == nil || e != *excl || owner != p) {
		return engine.ErrOccupied
	}
	if x.HasPirate && bordersHex(e, x.Pirate) {
		return ErrPirateBlocks
	}
	// A module may close the edge to ships outright: a Rivers bridge site holds
	// a bridge or nothing, and every river's coastal outlet is exactly the kind
	// of land-and-sea edge a ship wants. Checked at this one choke point so
	// build, move and the legal set agree. See engine.Hooks.RefusesEdge.
	if err := s.EdgeRefusal(e, engine.RouteShip); err != nil {
		return err
	}
	if !m.shipConnects(s, x, e, p, excl) {
		return engine.ErrBadPlacement
	}
	return nil
}

// shipConnects: an endpoint holds the player's building, or continues the
// player's ship network through an unblocked vertex. Roads extend ships only
// through a building (covered by the first clause).
//
// Unblocked includes s.VertexBlocked, not just an opponent building: a Knights
// knight blocks road continuity like a settlement (docs/rules/knights.md), the
// base road test uses the same predicate (engine.roadConnects), and routeLength
// cuts routes there too, so build legality and route length agree.
func (Module) shipConnects(s *engine.State, x *Ext, e board.Edge, p engine.PlayerID, excl *board.Edge) bool {
	for _, v := range []board.Vertex{e.A, e.B} {
		if b, ok := s.Buildings[v]; ok {
			// A building a module has switched off does not anchor an
			// extension: under Raiders a ship route may only be extended from
			// one of your own unconquered buildings, so a route hanging off a
			// conquered settlement is frozen. It still blocks an opponent,
			// hence the continue. Always false without such a module.
			if b.Owner == p && !engine.BuildingIsInert(s, v) {
				return true
			}
			continue // opponent building blocks
		}
		if s.VertexBlocked(v, p) {
			continue // enemy knight blocks, exactly as it blocks a road
		}
		for _, ve := range v.Edges() {
			if ve == e || (excl != nil && ve == *excl) {
				continue
			}
			if owner, ok := x.Ships[ve]; ok && owner == p {
				return true
			}
		}
	}
	return false
}

func (m Module) decideMoveShip(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	if err := engine.RequireActionableTurn(s, cmd.Player); err != nil {
		return nil, err
	}
	d, err := engine.DecodeCommand[shipMoveData](cmd.Data)
	if err != nil {
		return nil, err
	}
	from := board.NewEdge(d.From.A, d.From.B)
	to := board.NewEdge(d.To.A, d.To.B)
	x := extRO(s)
	if x.MovedShip {
		return nil, ErrShipAlreadyMoved
	}
	if owner, ok := x.Ships[from]; !ok || owner != cmd.Player {
		return nil, engine.ErrBadPlacement
	}
	if x.BuiltTurn[from] {
		return nil, ErrShipJustBuilt
	}
	if x.HasPirate && bordersHex(from, x.Pirate) {
		return nil, ErrPirateBlocks
	}
	if !m.shipOpen(s, x, from, cmd.Player) {
		return nil, ErrShipNotOpen
	}
	if to == from {
		return nil, engine.ErrBadPlacement
	}
	if err := m.checkShipSpot(s, x, to, cmd.Player, &from); err != nil {
		return nil, err
	}
	// A module may price the move rather than forbid the destination: Rivers
	// charges a coin for taking a ship off a river edge and refuses the move
	// when the owner cannot pay. See engine.Hooks.RefusesRouteMove.
	if err := s.RouteMoveRefusal(cmd.Player, from, to, engine.RouteShip); err != nil {
		return nil, err
	}
	return []engine.Event{engine.NewEvent(EvShipMoved, shipMoveData{Player: cmd.Player, From: from, To: to})}, nil
}

// shipOpen reports whether ship e (owned by p) has an open end and may be
// moved. Movable if either endpoint is a dangling end (no own building, no
// continuing own ship), or e lies on a loop the rules treat as open: a ship
// circle with no settlement (every ship open), or a route leaving a settlement
// and returning with no building between (the ships bordering that settlement
// are open). See docs/rules/islands.md.
//
// Roads do not anchor a ship: a road and a ship join only through a settlement
// or city (as in shipConnects), so a road at the endpoint does not lock the
// ship.
func (m Module) shipOpen(s *engine.State, x *Ext, e board.Edge, p engine.PlayerID) bool {
	for _, v := range []board.Vertex{e.A, e.B} {
		if m.danglingEnd(s, x, e, v, p) {
			return true
		}
	}
	if !m.shipOnCycle(x, e, p) {
		return false // not on a cycle: only dangling ends count, handled above
	}
	buildings := m.shipComponentBuildings(s, x, e, p)
	switch len(buildings) {
	case 0:
		return true // pure ship circle: every ship is open
	case 1:
		b := buildings[0] // self-loop through one settlement: its border ships are open
		return e.A == b || e.B == b
	default:
		return false // two or more settlements: a genuine closed route, frozen
	}
}

// danglingEnd reports whether vertex v is an open dead end for ship e: no own
// building anchors it and no other own ship continues from it.
//
// A module piece of p's that anchors a route end (a Knights knight) counts as a
// building. The rules close a route once it connects two settlements, cities or
// (with Knights) knights, and a ship may not be moved if that would cut a
// knight off from its route.
func (Module) danglingEnd(s *engine.State, x *Ext, e board.Edge, v board.Vertex, p engine.PlayerID) bool {
	// A switched-off building does not close the end: a conquered settlement
	// stops anchoring under Raiders, so the ships beside it stay open and
	// movable.
	if b, ok := s.Buildings[v]; ok && b.Owner == p && !engine.BuildingIsInert(s, v) {
		return false
	}
	if s.RouteAnchoredByModule(v, p) {
		return false
	}
	for _, ve := range v.Edges() {
		if ve == e {
			continue
		}
		if owner, ok := x.Ships[ve]; ok && owner == p {
			return false
		}
	}
	return true
}

// shipOnCycle reports whether ship e lies on a cycle in p's ship graph: e's two
// endpoints stay connected through p's other ships when e is removed.
func (Module) shipOnCycle(x *Ext, e board.Edge, p engine.PlayerID) bool {
	seen := map[board.Vertex]bool{e.A: true}
	queue := []board.Vertex{e.A}
	for len(queue) > 0 {
		v := queue[0]
		queue = queue[1:]
		for _, ve := range v.Edges() {
			if ve == e {
				continue
			}
			if owner, ok := x.Ships[ve]; !ok || owner != p {
				continue
			}
			w := ve.Other(v)
			if w == e.B {
				return true
			}
			if !seen[w] {
				seen[w] = true
				queue = append(queue, w)
			}
		}
	}
	return false
}

// shipComponentBuildings returns the vertices carrying p's buildings in the
// connected component of p's ship graph that contains ship e. A module route
// anchor of p's counts as a building, for the reason danglingEnd gives: a route
// is closed when it connects two settlements or cities, or, with Knights, also
// knights. So a ship circle carrying one of p's knights is a self-loop
// through that knight rather than a free-for-all circle.
func (Module) shipComponentBuildings(s *engine.State, x *Ext, e board.Edge, p engine.PlayerID) []board.Vertex {
	seen := map[board.Vertex]bool{}
	var buildings []board.Vertex
	var visit func(v board.Vertex)
	visit = func(v board.Vertex) {
		if seen[v] {
			return
		}
		seen[v] = true
		if b, ok := s.Buildings[v]; ok && b.Owner == p {
			buildings = append(buildings, v)
		} else if s.RouteAnchoredByModule(v, p) {
			buildings = append(buildings, v)
		}
		for _, ve := range v.Edges() {
			if owner, ok := x.Ships[ve]; !ok || owner != p {
				continue
			}
			visit(ve.Other(v))
		}
	}
	visit(e.A)
	visit(e.B)
	return buildings
}

func bordersHex(e board.Edge, h board.Hex) bool {
	return slices.Contains(board.EdgeHexes(e), h)
}

// pirateVictims returns players (other than mover) with a ship bordering hex h
// and at least one stealable card: the legal pirate steal targets.
// Friendly-robber protected players are excluded, as for the base robber.
// Stealability uses DiscardableCount (module-aware), so a Knights player
// holding only commodities is a valid target, as for the land robber
// (robberVictims).
func pirateVictims(s *engine.State, h board.Hex, mover engine.PlayerID) map[engine.PlayerID]bool {
	out := map[engine.PlayerID]bool{}
	for e, owner := range extRO(s).Ships {
		if owner != mover && bordersHex(e, h) && s.DiscardableCount(owner) > 0 && !s.FriendlyRobberProtected(owner) {
			out[owner] = true
		}
	}
	return out
}

// legalPirateHexes returns the sea hexes mover may move the pirate to, mirroring
// decideMovePirate's placement rule (sea, not the current pirate hex, and under
// friendly-robber dropping no-victim hexes when an unprotected ship is reachable).
func legalPirateHexes(s *engine.State, mover engine.PlayerID) []board.Hex {
	x := extRO(s)
	forceVictim := s.FriendlyRobberActive() && pirateHasTarget(s, mover)
	var out []board.Hex
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		if !s.Board.IsSea(h) || (x.HasPirate && h == x.Pirate) {
			continue
		}
		if forceVictim && len(pirateVictims(s, h, mover)) == 0 {
			continue
		}
		out = append(out, h)
	}
	return out
}

// pirateHasTarget reports whether any legal sea hex would let mover rob an
// unprotected ship. Under the friendly-robber rule this forces the mover onto
// such a hex, mirroring friendlyRobberHasTarget for the land robber.
func pirateHasTarget(s *engine.State, mover engine.PlayerID) bool {
	x := extRO(s)
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		if !s.Board.IsSea(h) || (x.HasPirate && h == x.Pirate) {
			continue
		}
		if len(pirateVictims(s, h, mover)) > 0 {
			return true
		}
	}
	return false
}

func (m Module) decideMovePirate(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	cfg := configFrom(s.Config)
	if !cfg.Pirate {
		return nil, engine.ErrUnknownCommand
	}
	if s.Phase != engine.PhasePlay {
		return nil, engine.ErrWrongPhase
	}
	if cmd.Player != s.Cur {
		return nil, engine.ErrNotYourTurn
	}
	if !s.RobberPending {
		return nil, engine.ErrWrongPhase
	}
	if len(s.PendingDiscards) > 0 {
		return nil, engine.ErrDiscardPending
	}
	d, err := engine.DecodeCommand[struct {
		Hex    board.Hex        `json:"hex"`
		Victim *engine.PlayerID `json:"victim"`
	}](cmd.Data)
	if err != nil {
		return nil, err
	}
	x := extRO(s)
	if !s.Board.IsSea(d.Hex) || (x.HasPirate && d.Hex == x.Pirate) {
		return nil, engine.ErrBadPlacement
	}

	victims := pirateVictims(s, d.Hex, cmd.Player)
	// Friendly robber: if some sea hex would let us rob an unprotected ship,
	// the pirate must go there, not on a protected-only or empty hex.
	if s.FriendlyRobberActive() && len(victims) == 0 && pirateHasTarget(s, cmd.Player) {
		return nil, engine.ErrBadPlacement
	}
	events := []engine.Event{engine.NewEvent(EvPirateMoved, pirateData{Player: cmd.Player, Hex: d.Hex})}
	if len(victims) == 0 {
		if d.Victim != nil {
			return nil, engine.ErrBadVictim
		}
		return events, nil
	}
	if d.Victim == nil || !victims[*d.Victim] {
		return nil, engine.ErrBadVictim
	}
	victim := *d.Victim
	// A module may steal from a combined pool (Knights resources +
	// commodities); otherwise pick a uniformly random card from the victim's
	// resource hand. Mirrors the base decideMoveRobber so the pirate steal uses
	// the same cak StealCard hook. The stolen card occupies the next log
	// position (offset 1), after EvPirateMoved.
	if ev, ok := engine.StealCardFromModules(s, cmd.Player, victim, 1); ok {
		events = append(events, ev)
		return events, nil
	}
	res, _ := engine.RandomCard(engine.RngFor(s, 1), s.Players[victim].Hand)
	events = append(events, engine.NewEvent(engine.EvCardStolen,
		engine.CardStolenData{Thief: cmd.Player, Victim: victim, Res: res},
		cmd.Player, victim))
	return events, nil
}

func (Module) decideChooseGold(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	// Gold is owed in play (a roll hitting a gold hex) and during setup
	// (SetupGrant owes a pick for each gold hex bordering the round-2
	// settlement, since the base grant skips gold), so the pick is legal in
	// either phase. PhaseFinished is already rejected by the engine's dispatch.
	if s.Phase != engine.PhasePlay && s.Phase != engine.PhaseSetup {
		return nil, engine.ErrWrongPhase
	}
	x := extRO(s)
	owed, ok := x.PendingGold[cmd.Player]
	if !ok {
		return nil, ErrNoGoldOwed
	}
	d, err := engine.DecodeCommand[goldChosenData](cmd.Data)
	if err != nil {
		return nil, err
	}
	// A drained bank reduces what can be taken.
	take := owed
	if bank := s.Bank.Count(); bank < take {
		take = bank
	}
	if !d.Gain.NonNegative() || d.Gain.Count() != take || !s.Bank.Has(d.Gain) {
		return nil, ErrBadGoldPick
	}
	return []engine.Event{engine.NewEvent(EvGoldChosen, goldChosenData{Player: cmd.Player, Gain: d.Gain})}, nil
}
