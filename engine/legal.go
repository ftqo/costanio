package engine

import (
	"slices"

	"github.com/ftqo/costan.io/engine/board"
)

// ShipMoveTargets is one movable ship and the sea edges it may move to.
type ShipMoveTargets struct {
	From board.Edge   `json:"from"`
	To   []board.Edge `json:"to"`
}

// KnightMoveTargets is one movable (active, not freshly-activated) knight and
// the vertices it may move to. Displace lists the subset of `To` that are
// occupied by a strictly-weaker enemy knight (a displacement, not a plain move),
// so the FE can style/confirm them differently if it chooses.
type KnightMoveTargets struct {
	From     board.Vertex   `json:"from"`
	To       []board.Vertex `json:"to"`
	Displace []board.Vertex `json:"displace,omitempty"`
}

// LegalTargets are the positions where a player may place a piece right now.
// The frontend renders only these as build targets, so illegal spots are never
// offered. Positional legality only; resource and piece-count gating live on
// the build buttons and are still enforced by the command validators.
type LegalTargets struct {
	Settlements []board.Vertex
	Cities      []board.Vertex
	Roads       []board.Edge
	// Module-contributed targets (Knights expansion): vertices where a knight
	// may be placed, and the player's cities still eligible for a wall.
	Knights []board.Vertex
	Walls   []board.Vertex
	// Islands ship placement: sea edges where a ship may be built (play) or the
	// free setup ship may go, and per-movable-ship move destinations.
	Ships     []board.Edge
	ShipMoves []ShipMoveTargets
	// Knights expansion: per-movable-knight move destinations (incl. displacement).
	KnightMoves []KnightMoveTargets
	// RobberHexes/PirateHexes are the legal destinations for a pending robber/
	// pirate move (after a 7 or a played knight). Empty unless a move is owed.
	RobberHexes []board.Hex
	PirateHexes []board.Hex
	// Knights expansion interactions:
	//   - ChaseRobberHexes: where an activated knight may chase the robber.
	//   - ChasePirateHexes: where an activated knight on a sea-hex intersection
	//     may chase the pirate. Kept apart from the robber's list (one command
	//     answers both) so a knight is not offered the other piece's
	//     destinations.
	//   - DeserterPlacements: where a Deserter-stolen knight may be placed.
	//   - KnightRelocations: where a displaced knight may be relocated.
	//   - BarbarianDowngrades: the player's own cities the barbarians may raze,
	//     one of which they must pick after a lost defense.
	//   - MetropolisCities: the player's cities free of a metropolis, one of
	//     which they must pick for a metropolis they just earned.
	KnightEdgeChases    []KnightEdgeChase
	ChaseRobberHexes    []board.Hex
	ChasePirateHexes    []board.Hex
	DeserterPlacements  []board.Vertex
	KnightRelocations   []board.Vertex
	BarbarianDowngrades []board.Vertex
	MetropolisCities    []board.Vertex
	// ProgressTargets holds, per playable held progress card (keyed by its wire
	// id), the board positions that card may target, so the board offers only
	// valid picks once the player selects the card.
	ProgressTargets map[string]ProgressTarget
	// Harbours lists the vertices where the player may place or upgrade to a
	// harbour settlement (Explorers).
	Harbours []board.Vertex
	// ShipCargo lists, per movable Explorers ship, where it may go and what it
	// may do there. Empty outside that module.
	ExplorerShips []ExplorerShipTargets
	// Improvements lists the city-improvement track indices the player may
	// improve right now (Knights expansion): owns a city, below the cap, and has
	// a city free of a metropolis when the next level would claim/steal one.
	Improvements []int
	// CamelPaths lists the placements open to the seat that won a Caravans
	// camel vote (Caravans scenario). Empty unless this seat is the placer of
	// an open vote, so a client can render the picker from this alone.
	CamelPaths []CamelPath
	// Bridges lists the empty bridge sites this seat's network reaches (Rivers
	// scenario). A bridge site is the only edge a bridge may occupy and the
	// only edge a road may not, so the two lists are disjoint.
	Bridges []board.Edge
	// WagonSteps lists the intersections this seat's wagon may move to right
	// now (Wagons scenario): one path away, affordable in movement points, and
	// with the toll payable. A path whose toll cannot be paid in full is
	// illegal, so it is not offered.
	WagonSteps []board.Vertex
	// BarbarianEdges lists where a barbarian this seat owes a move for may go
	// (Wagons scenario): after a 7, after a Knight, or after a drive-off. Empty
	// unless the seat owes one.
	BarbarianEdges []board.Edge
}

// ExplorerShipTargets is one Explorers ship and what it may do this turn: the
// sea edges one movement point reaches, the corners it may act on (land a
// settler, work a shoal, storm a lair, befriend a farm), and how many movement
// points it has left. Keyed by the ship's stable id so a client can address it.
type ExplorerShipTargets struct {
	Ship  int          `json:"ship"`
	From  board.Edge   `json:"from"`
	Moves []board.Edge `json:"moves,omitempty"`
	Acts  []ShipAct    `json:"acts,omitempty"`
	Left  int          `json:"left"`
}

// ShipAct is one job an Explorers ship may do from where it stands, and which
// job it is.
//
// The job is published because two can be legal at the same corner and choosing
// wrong is costly: founding spends the ship and settler, landing a crew spends
// neither.
type ShipAct struct {
	// Job is the wire name of the command that does it: "found", "land_crew",
	// "take_crew" or "load_haul".
	Job string `json:"job"`
	// V is the corner the ship works from. H is the hex the job acts on, which
	// differs from V for every job but founding (where H is unset).
	V board.Vertex `json:"v"`
	H *board.Hex   `json:"h,omitempty"`
}

// The job names ShipAct carries. They are the module's own command names minus
// its prefix, so a client turns one into a command by prefixing it.
const (
	ShipActFound    = "found"
	ShipActLandCrew = "land_crew"
	ShipActTakeCrew = "take_crew"
	ShipActLoadHaul = "load_haul"
)

// CamelPath is one placement a pending camel may take: which of the three
// caravans it extends, and the edge it would sit on. Both are needed: an edge
// reachable from two caravan fronts is a different move for each, and only the
// pair says which chain the camel joins (and so which junctions become interior
// and score).
type CamelPath struct {
	Caravan int        `json:"caravan"`
	E       board.Edge `json:"e"`
}

// ProgressTarget is the set of board positions a single progress card may
// target. Different cards use different fields: Hexes
// (merchant/bishop/inventor), Vertices (medicine/intrigue), Edges (diplomat
// source), Moves (diplomat source to relocation destinations).
type ProgressTarget struct {
	Hexes    []board.Hex       `json:"hexes,omitempty"`
	Vertices []board.Vertex    `json:"vertices,omitempty"`
	Edges    []board.Edge      `json:"edges,omitempty"`
	Moves    []ShipMoveTargets `json:"moves,omitempty"`
}

// LegalRobberHexes returns the hexes mover may move the robber to right now,
// mirroring decideMoveRobber: any land hex other than the robber's current one,
// minus, under the friendly-robber rule when an unprotected victim is
// reachable, every hex that would rob nobody.
func (s *State) LegalRobberHexes(mover PlayerID) []board.Hex {
	forceVictim := s.FriendlyRobberActive() && friendlyRobberHasTarget(s, mover)
	var out []board.Hex
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		if !robberMayEnter(s, h) || h == s.Board.Robber {
			continue
		}
		if forceVictim && len(robberVictims(s, h, mover)) == 0 {
			continue
		}
		out = append(out, h)
	}
	return out
}

// KnightEdgeChase is an active knight at V that may chase off the edge blocker
// Barb (see Hooks.ChaseEdgeBlocker).
type KnightEdgeChase struct {
	V    board.Vertex `json:"v"`
	Barb int          `json:"barb"`
}

// LegalExtra is a module's contribution to a player's positional legal targets
// (see the LegalExtras hook). Fields mirror LegalTargets; an empty value adds
// nothing. Knights contributes Knights/Walls/KnightMoves; Islands contributes
// Ships/ShipMoves; neither sets the other's fields.
type LegalExtra struct {
	Knights []board.Vertex
	Walls   []board.Vertex
	// Settlements and Roads are contributed by a module that owns the setup
	// draft (Explorers), where the base LegalSettlements/LegalRoads describe a
	// draft nobody is running. Ignored otherwise.
	Settlements []board.Vertex
	Roads       []board.Edge
	// Harbours are the seat's own coastal settlements that may be upgraded to a
	// harbour settlement (Explorers), and, during that module's first setup
	// round, the coastal intersections a starting harbour settlement may take.
	Harbours    []board.Vertex
	Ships       []board.Edge
	ShipMoves   []ShipMoveTargets
	KnightMoves []KnightMoveTargets
	// Islands: legal pirate destinations while a robber/pirate move is pending.
	PirateHexes []board.Hex
	// Caravans: the placements open to the seat that won an open camel vote.
	CamelPaths []CamelPath
	// Rivers: the empty bridge sites this seat's own network reaches.
	// Positional only, like Ships: the 2 brick + 1 lumber and the 3-per-player
	// supply stay on the build command.
	Bridges []board.Edge
	// Wagons: where the active wagon may step, and where a barbarian this seat
	// owes a move for may be placed.
	WagonSteps     []board.Vertex
	BarbarianEdges []board.Edge
	// Knights: chase-robber destinations, pending-placement target vertices for a
	// Deserter-stolen knight / a displaced knight relocation, the cities a player
	// owing a barbarian sacrifice may choose between, and the cities an earned
	// metropolis may be placed on.
	KnightEdgeChases    []KnightEdgeChase
	ChaseRobberHexes    []board.Hex
	ChasePirateHexes    []board.Hex
	DeserterPlacements  []board.Vertex
	KnightRelocations   []board.Vertex
	BarbarianDowngrades []board.Vertex
	MetropolisCities    []board.Vertex
	// ExplorerShips is the per-ship movement and action offer for Explorers.
	ExplorerShips []ExplorerShipTargets
	// Per-progress-card target positions (keyed by card wire id).
	ProgressTargets map[string]ProgressTarget
	// Improvable city-improvement track indices (Knights expansion).
	Improvements []int
}

// boardVertices returns every unique vertex of the board.
func (s *State) boardVertices() []board.Vertex {
	seen := make(map[board.Vertex]bool)
	var out []board.Vertex
	for h := range s.Board.Tiles {
		for _, v := range h.Vertices() {
			if !seen[v] {
				seen[v] = true
				out = append(out, v)
			}
		}
	}
	return out
}

// boardEdges returns every unique (normalized) edge of the board.
func (s *State) boardEdges() []board.Edge {
	seen := make(map[board.Edge]bool)
	var out []board.Edge
	for h := range s.Board.Tiles {
		for _, e := range h.Edges() {
			ne := board.NewEdge(e.A, e.B)
			if !seen[ne] {
				seen[ne] = true
				out = append(out, ne)
			}
		}
	}
	return out
}

// LegalSettlements lists vertices where seat may place a settlement now. It
// reuses checkSettlementSpot (board/occupancy/distance/module blocks); in the
// play phase it additionally requires an adjacent friendly road, exactly as the
// build command does.
func (s *State) LegalSettlements(seat PlayerID) []board.Vertex {
	if s.Players[seat].SettlementsLeft == 0 {
		return nil // no settlement pieces left: nothing is buildable
	}
	play := s.Phase == PhasePlay
	var out []board.Vertex
	for _, v := range s.boardVertices() {
		if checkSettlementSpot(s, v) != nil {
			continue
		}
		if play && !s.hasAdjacentRoute(v, seat) {
			continue
		}
		if s.buildBlockedVertex(v, seat) {
			continue // a module bars this seat here (an unbefriended spice farm)
		}
		out = append(out, v)
	}
	return out
}

// LegalCities lists seat's own settlements that can be upgraded to a city.
func (s *State) LegalCities(seat PlayerID) []board.Vertex {
	if citiesDisabled(s) {
		return nil // a ruleset with no cities in it (Explorers)
	}
	if s.Players[seat].CitiesLeft == 0 {
		return nil // no city pieces left: nothing is upgradeable
	}
	// A module may pin the next upgrade to one vertex (a Knights city pillaged
	// with no settlement in supply lies on its side and must be stood back up
	// first). decideBuild refuses every other vertex while the pin holds, so
	// the list must too, or bots would propose cities the engine refuses.
	var pins []board.Vertex
	for _, m := range s.Modules() {
		if h := m.Hooks().MustUpgradeFirst; h != nil {
			if v, ok := h(s, seat); ok {
				pins = append(pins, v)
			}
		}
	}
	var out []board.Vertex
	for v, b := range s.Buildings {
		if slices.ContainsFunc(pins, func(pin board.Vertex) bool { return pin != v }) {
			continue
		}
		if b.Owner == seat && !b.City && s.BlocksCityUpgrade(v, seat) == nil {
			out = append(out, v)
		}
	}
	return out
}

// ModuleShipTargets lists the sea edges any module offers seat for a new ship
// right now (Islands' ship builds). Positional only, like LegalRoads: the cost
// stays on the build command. It exists for a card whose free builds may be
// ships (Knights' Road Building in an Islands game) to ask whether one could go
// down at all, without importing the module that owns ships.
func (s *State) ModuleShipTargets(seat PlayerID) []board.Edge {
	var out []board.Edge
	for _, m := range s.Modules() {
		if h := m.Hooks().LegalExtras; h != nil {
			out = append(out, h(s, seat).Ships...)
		}
	}
	return out
}

// LegalRoads lists edges where seat may place a road now. In setup the road
// must touch the just-placed settlement; in play it must connect to seat's
// network, matching decidePlaceRoad / decideBuild.
func (s *State) LegalRoads(seat PlayerID) []board.Edge {
	if s.Players[seat].RoadsLeft == 0 {
		return nil // no road pieces left: nothing is buildable
	}
	setup := s.Phase == PhaseSetup
	var out []board.Edge
	for _, e := range s.boardEdges() {
		if !e.Valid() || !s.Board.LandEdge(e) {
			continue
		}
		if _, ok := s.Roads[e]; ok {
			continue
		}
		if s.edgeBlockedByModule(e) {
			continue // a ship already holds this coastal edge
		}
		// An edge a module has closed to roads (a Rivers bridge site, a Raiders
		// conquered hex, an Explorers fog edge or uncaptured lair) is never a
		// legal road. Uses the same three predicates as the build, so offer and
		// validator agree.
		if s.EdgeRefusal(e, RouteRoad) != nil || s.newRoadBlocked(e) || s.buildBlockedEdge(e, seat) {
			continue
		}
		if setup {
			if !e.Touches(s.LastSettlement) {
				continue
			}
		} else if !s.roadConnects(e, seat) {
			continue
		}
		out = append(out, e)
	}
	return out
}

// LegalTargetsFor returns the placement targets available to seat right now, or
// an empty set when it isn't seat's turn or no placement is currently allowed
// (e.g. before rolling). Covers base-game pieces; module-specific placement
// (ships, knights) is handled by those modules' own targeting.
func (s *State) LegalTargetsFor(seat PlayerID) LegalTargets {
	var lt LegalTargets
	if seat < 0 {
		return lt
	}
	// Placements a module owes this seat (Deserter replacement knight,
	// displaced knight relocation, barbarian city sacrifice, metropolis
	// placement) can be due during an interrupt, possibly for a non-current
	// player. When one is owed it is the only legal action, so surface just
	// those.
	for _, m := range s.Modules() {
		h := m.Hooks().PendingTargets
		if h == nil {
			continue
		}
		ex := h(s, seat)
		lt.DeserterPlacements = append(lt.DeserterPlacements, ex.DeserterPlacements...)
		lt.KnightRelocations = append(lt.KnightRelocations, ex.KnightRelocations...)
		lt.BarbarianDowngrades = append(lt.BarbarianDowngrades, ex.BarbarianDowngrades...)
		lt.MetropolisCities = append(lt.MetropolisCities, ex.MetropolisCities...)
		lt.CamelPaths = append(lt.CamelPaths, ex.CamelPaths...)
		lt.BarbarianEdges = append(lt.BarbarianEdges, ex.BarbarianEdges...)
		lt.PirateHexes = append(lt.PirateHexes, ex.PirateHexes...)
	}
	if len(lt.DeserterPlacements) > 0 || len(lt.KnightRelocations) > 0 ||
		len(lt.BarbarianDowngrades) > 0 || len(lt.MetropolisCities) > 0 ||
		len(lt.CamelPaths) > 0 || len(lt.BarbarianEdges) > 0 || len(lt.PirateHexes) > 0 {
		return lt
	}
	if seat != s.Cur {
		return lt
	}
	switch s.Phase {
	case PhaseSetup:
		// A module that owns the whole setup draft (Explorers) reports its own
		// targets: the base NeedRoad/settlement split describes a draft it is not
		// running. See Hooks.OwnsSetup.
		if setupOwnedByModule(s) {
			for _, m := range s.Modules() {
				h := m.Hooks().LegalExtras
				if h == nil {
					continue
				}
				ex := h(s, seat)
				lt.Settlements = append(lt.Settlements, ex.Settlements...)
				lt.Roads = append(lt.Roads, ex.Roads...)
				lt.Ships = append(lt.Ships, ex.Ships...)
				lt.Harbours = append(lt.Harbours, ex.Harbours...)
			}
			return lt
		}
		if s.NeedRoad {
			lt.Roads = s.LegalRoads(seat)
			// Setup-ship targets: the Islands module reports the sea edges
			// touching the just-placed settlement when in setup, so the
			// Road/Ship toggle has real targets.
			for _, m := range s.Modules() {
				if h := m.Hooks().LegalExtras; h != nil {
					lt.Ships = append(lt.Ships, h(s, seat).Ships...)
				}
			}
		} else {
			lt.Settlements = s.LegalSettlements(seat)
		}
	case PhasePlay:
		// A pending robber/pirate move blocks every other action, so offer only
		// its legal destinations (robber on land, pirate on sea via a module).
		// While post-7 discards are still owed even the robber cannot move;
		// discarding is the only legal action, so offer no board targets.
		if s.RobberPending {
			if len(s.PendingDiscards) == 0 {
				lt.RobberHexes = s.LegalRobberHexes(seat)
				for _, m := range s.Modules() {
					if h := m.Hooks().LegalExtras; h != nil {
						lt.PirateHexes = append(lt.PirateHexes, h(s, seat).PirateHexes...)
					}
				}
			}
			return lt
		}
		actionable := requireActionableTurn(s, seat) == nil
		if actionable {
			lt.Settlements = s.LegalSettlements(seat)
			lt.Cities = s.LegalCities(seat)
			// Module-specific placement targets (knight vertices, wall-eligible
			// cities) are gated by the same actionable-turn condition as their
			// build commands.
			for _, m := range s.Modules() {
				h := m.Hooks().LegalExtras
				if h == nil {
					continue
				}
				ex := h(s, seat)
				lt.Knights = append(lt.Knights, ex.Knights...)
				lt.Walls = append(lt.Walls, ex.Walls...)
				lt.Ships = append(lt.Ships, ex.Ships...)
				lt.ShipMoves = append(lt.ShipMoves, ex.ShipMoves...)
				lt.KnightMoves = append(lt.KnightMoves, ex.KnightMoves...)
				lt.KnightEdgeChases = append(lt.KnightEdgeChases, ex.KnightEdgeChases...)
				lt.ChaseRobberHexes = append(lt.ChaseRobberHexes, ex.ChaseRobberHexes...)
				lt.ChasePirateHexes = append(lt.ChasePirateHexes, ex.ChasePirateHexes...)
				lt.Bridges = append(lt.Bridges, ex.Bridges...)
				lt.Harbours = append(lt.Harbours, ex.Harbours...)
				lt.ExplorerShips = append(lt.ExplorerShips, ex.ExplorerShips...)
				lt.Improvements = append(lt.Improvements, ex.Improvements...)
				lt.WagonSteps = append(lt.WagonSteps, ex.WagonSteps...)
				for card, pt := range ex.ProgressTargets {
					if lt.ProgressTargets == nil {
						lt.ProgressTargets = map[string]ProgressTarget{}
					}
					lt.ProgressTargets[card] = pt
				}
			}
		}
		// Road-building dev card lets roads be placed even when not otherwise
		// actionable (e.g. before rolling). Shares decideBuild's exemption
		// predicate so the offer and the validator move together.
		if actionable || freeRoadPlaceable(s, seat) {
			lt.Roads = s.LegalRoads(seat)
		}
		// The same free build may be a ship (Islands: "2 roads, 2 ships, or 1
		// of each"), which islands.decideBuildShip exempts from the roll on
		// this predicate. Only ship build targets: a ship move is not a free
		// build and still waits for the roll.
		if !actionable && freeRoadPlaceable(s, seat) {
			for _, m := range s.Modules() {
				if h := m.Hooks().LegalExtras; h != nil {
					lt.Ships = append(lt.Ships, h(s, seat).Ships...)
				}
			}
		}
	default: // other phases intentionally unhandled here
	}
	return lt
}
