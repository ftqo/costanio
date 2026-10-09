package engine

import (
	"encoding/json"
	"slices"

	"github.com/ftqo/costan.io/engine/board"
)

// AutoCommand returns the minimal legal command to keep the game moving, for
// turn-timer expiry and auto-pass seats. The bool is false when no action is
// owed (e.g. game finished). Choices derive from the game seed and log
// position, never from the clock or map iteration order.
func AutoCommand(s *State) (Command, bool) {
	// Module pendings (gold picks, progress interrupts) resolve first.
	if s.Phase == PhasePlay {
		for _, m := range s.Modules() {
			h := m.Hooks()
			if h.Blocks != nil && h.Auto != nil && h.Blocks(s) {
				if cmd, ok := h.Auto(s, NoPlayer); ok {
					return cmd, true
				}
			}
		}
	}
	return baseAutoCommand(s)
}

// baseAutoCommand is AutoCommand without the module-first branch: the minimal
// legal base command the state owes. AutoCommandFor uses it for a seat a
// blocking module does not gate (a caravans vote the seat already answered).
func baseAutoCommand(s *State) (Command, bool) {
	switch {
	case s.Phase == PhaseFinished:
		return Command{}, false

	case s.Phase == PhaseSetup:
		// A module running its own draft answers for it; the base commands below
		// would be refused (Hooks.OwnsSetup).
		for _, m := range s.Modules() {
			if h := m.Hooks().AutoSetup; h != nil {
				if c, ok := h(s); ok {
					return c, true
				}
			}
		}
		if s.NeedRoad {
			edges := legalSetupRoads(s)
			if len(edges) == 0 {
				return Command{}, false // degenerate board: no legal road
			}
			e := edges[rngFor(s.Seed, s.NextSeq).IntN(len(edges))]
			return cmd(s.Cur, CmdPlaceRoad, RoadPlacedData{E: e}), true
		}
		spots := allLegalSettlementSpots(s)
		if len(spots) == 0 {
			return Command{}, false // degenerate board: no legal settlement spot
		}
		v := spots[rngFor(s.Seed, s.NextSeq).IntN(len(spots))]
		return cmd(s.Cur, CmdPlaceSettlement, SettlementPlacedData{V: v}), true

	case len(s.PendingDiscards) > 0:
		// Lowest-numbered pending seat discards first; cards spread evenly.
		p := PlayerID(-1)
		for q := range s.Players {
			if _, ok := s.PendingDiscards[PlayerID(q)]; ok {
				p = PlayerID(q)
				break
			}
		}
		// A module (Knights) discards its own cards too when resources fall short.
		for _, m := range s.Modules() {
			if h := m.Hooks().AutoDiscard; h != nil {
				if c, ok := h(s, p, s.PendingDiscards[p]); ok {
					return c, true
				}
			}
		}
		return cmd(p, CmdDiscardCards, CardsDiscardedData{Cards: spreadDiscard(s.Players[p].Hand, s.PendingDiscards[p])}), true

	case s.RobberPending:
		hex, victim := autoRobberTarget(s)
		payload := map[string]any{"hex": hex}
		if victim != NoPlayer {
			payload["victim"] = victim
		}
		return cmd(s.Cur, CmdMoveRobber, payload), true

	case !s.Rolled:
		return cmd(s.Cur, CmdRollDice, nil), true

	default:
		return cmd(s.Cur, CmdEndTurn, nil), true
	}
}

// AutoCommandFor returns the minimal legal command for one seat's outstanding
// obligation, or false when that seat owes nothing. Unlike AutoCommand, which
// resolves whatever comes next for the lowest owed seat, this lets a bot
// resolve its own simultaneous obligation (an over-7 discard, an aqueduct /
// gold / harbor pick) without waiting on a lower seat. Still deterministic.
func AutoCommandFor(s *State, seat PlayerID) (Command, bool) {
	// A module pick owed by this seat resolves first, as in AutoCommand. A
	// blocking module that owes this seat nothing freezes it only as far as its
	// gate reaches: BlocksTurnActions, where defined, is narrower than Blocks
	// (caravans frees every seat its camel vote is not waiting on). Passing the
	// turn still requires the strict Blocks to clear; see the default branch.
	//
	// Module obligations are peers: two modules can owe different seats off the
	// same roll (a Knights defender draw for seat 3, Islands gold for seat 1), so
	// every module is asked before the seat is declared frozen. Decide still
	// validates each command, and requireUninterruptedTurn gates base actions on
	// every module's block, so the gates collected here only govern the
	// fall-through to base actions.
	moduleOpen := false
	gated := false
	if s.Phase == PhasePlay {
		for _, m := range s.Modules() {
			h := m.Hooks()
			if h.Blocks == nil || !h.Blocks(s) {
				continue
			}
			moduleOpen = true
			if h.Auto != nil {
				if cmd, ok := h.Auto(s, seat); ok {
					return cmd, true
				}
			}
			// This module blocks and owes this seat nothing. Its looser BlocksTurnActions
			// gate, if any, may let the seat keep playing below.
			gate := h.Blocks
			if h.BlocksTurnActions != nil {
				gate = h.BlocksTurnActions
			}
			if gate(s) {
				gated = true
			}
		}
		if gated {
			return Command{}, false
		}
	}
	switch {
	case s.Phase == PhaseFinished:
		return Command{}, false

	case len(s.PendingDiscards) > 0:
		// Only this seat's own discard, never a lower seat's.
		need, ok := s.PendingDiscards[seat]
		if !ok {
			return Command{}, false
		}
		for _, m := range s.Modules() {
			if h := m.Hooks().AutoDiscard; h != nil {
				if c, ok := h(s, seat, need); ok {
					return c, true
				}
			}
		}
		return cmd(seat, CmdDiscardCards, CardsDiscardedData{Cards: spreadDiscard(s.Players[seat].Hand, need)}), true

	default:
		// Setup, robber, roll and end-turn are all owed by the current player; let
		// AutoCommand resolve them, but only when this seat is the one up.
		if seat != s.Cur {
			return Command{}, false
		}
		c, ok := baseAutoCommand(s)
		if !ok || c.Player != seat {
			return Command{}, false
		}
		// While any module Blocks, the turn cannot be passed (decideEndTurn would
		// reject it), so the seat waits at the pass.
		if moduleOpen && c.Type == CmdEndTurn {
			return Command{}, false
		}
		return c, true
	}
}

// DecisionKind classifies the decision a state currently owes, so the game
// layer can size the turn timer per decision without re-deriving the rules.
type DecisionKind int

const (
	DecisionNone      DecisionKind = iota // nothing owed (e.g. game finished)
	DecisionModule                        // a module interrupt (gold pick, progress card)
	DecisionSetup                         // place a settlement during setup
	DecisionSetupRoad                     // place the road that anchors it
	DecisionDiscard                       // over-7 discard owed
	DecisionRobber                        // robber move pending
	DecisionRoll                          // turn started, dice not yet rolled
	DecisionMain                          // build / trade / end the turn
)

// PendingDecision reports what kind of decision the active state owes. Its
// branch order mirrors AutoCommand so the two always agree (guarded by a drift
// test).
func PendingDecision(s *State) DecisionKind {
	if s.Phase == PhasePlay {
		for _, m := range s.Modules() {
			h := m.Hooks()
			if h.Blocks != nil && h.Auto != nil && h.Blocks(s) {
				if _, ok := h.Auto(s, NoPlayer); ok {
					return DecisionModule
				}
			}
		}
	}
	switch {
	case s.Phase == PhaseFinished:
		return DecisionNone
	case s.Phase == PhaseSetup:
		// A module owning the draft still owes a placement. Which piece is the
		// module's business; the base split is the closest answer and uses the larger
		// budget.
		if s.NeedRoad {
			return DecisionSetupRoad
		}
		return DecisionSetup
	case len(s.PendingDiscards) > 0:
		return DecisionDiscard
	case s.RobberPending:
		return DecisionRobber
	case !s.Rolled:
		return DecisionRoll
	default:
		return DecisionMain
	}
}

// Decider is one seat that currently owes an action, with the kind of decision
// it owes (used for per-decision timer budgets). See PendingDeciders.
type Decider struct {
	Seat PlayerID
	Kind DecisionKind
	// Decisions names every module obligation this seat owes, by the ids modules
	// report (ModuleDecider.Decision). Empty for base-game kinds, where Kind alone
	// sizes the budget. The timer layer takes the longest cap among them; that
	// choice is policy and stays out of the engine.
	Decisions []string
}

// PendingDeciders enumerates every seat that currently owes an action, sorted
// by seat. Normally one (the active player); during simultaneous phases
// (discard-on-7, module gold/wedding/harbor/aqueduct) several. Pure; the timer
// layer maps each to a deadline. Precedence mirrors PendingDecision.
func PendingDeciders(s *State) []Decider {
	if s.Phase == PhaseFinished {
		return nil
	}
	// Module interrupts take precedence (mirrors PendingDecision's module-first
	// branch): while a module Blocks, the base turn cannot proceed.
	if s.Phase == PhasePlay {
		// One entry per seat even when several modules or pendings await the same
		// player, since the timer layer keys deadlines by seat. The obligations are
		// collected so the budget covers all of them.
		owed := map[PlayerID][]string{}
		var seats []PlayerID
		for _, m := range s.Modules() {
			h := m.Hooks()
			if h.PendingDeciders == nil {
				continue
			}
			for _, md := range h.PendingDeciders(s) {
				if _, ok := owed[md.Seat]; !ok {
					seats = append(seats, md.Seat)
				}
				owed[md.Seat] = append(owed[md.Seat], md.Decision)
			}
		}
		if len(seats) > 0 {
			slices.Sort(seats)
			ds := make([]Decider, len(seats))
			for i, seat := range seats {
				// Sorted and deduped so the same obligations always give the same Decider;
				// armTimer compares against the previous one to decide whether to keep a
				// running deadline.
				ids := owed[seat]
				slices.Sort(ids)
				ds[i] = Decider{Seat: seat, Kind: DecisionModule, Decisions: slices.Compact(ids)}
			}
			// The seat that is up may be free to play on around the interrupt (a module
			// whose BlocksTurnActions is narrower than Blocks, like the caravans vote).
			// Without an entry it would get no deadline, so it is added back with its base
			// decision, but only when a module is actually blocking and every blocking
			// module lets this seat act. Its budget is never smaller than a module
			// decision's (budgetFor caps those at the turn timer), so module obligations
			// still time out first.
			blocking, gated := moduleTurnGate(s)
			if _, already := owed[s.Cur]; !already && blocking && !gated {
				for _, d := range baseDeciders(s) {
					if d.Seat == s.Cur {
						ds = append(ds, d)
						slices.SortFunc(ds, func(a, b Decider) int { return int(a.Seat) - int(b.Seat) })
						break
					}
				}
			}
			return ds
		}
	}
	return baseDeciders(s)
}

// moduleTurnGate reports whether any module currently Blocks, and whether any
// blocking one stops the active seat from taking voluntary actions. Mirrors
// AutoCommandFor: BlocksTurnActions where defined, strict Blocks otherwise.
func moduleTurnGate(s *State) (blocking, gated bool) {
	for _, m := range s.Modules() {
		h := m.Hooks()
		if h.Blocks == nil || !h.Blocks(s) {
			continue
		}
		blocking = true
		gate := h.Blocks
		if h.BlocksTurnActions != nil {
			gate = h.BlocksTurnActions
		}
		if gate(s) {
			return true, true
		}
	}
	return blocking, false
}

// baseDeciders is PendingDeciders without the module-first branch: the seats
// the base state machine owes right now.
func baseDeciders(s *State) []Decider {
	switch {
	case s.Phase == PhaseSetup:
		// Settlement and road are separate kinds so the road re-arms on its own budget
		// instead of inheriting the settlement's countdown.
		if s.NeedRoad {
			return []Decider{{Seat: s.Cur, Kind: DecisionSetupRoad}}
		}
		return []Decider{{Seat: s.Cur, Kind: DecisionSetup}}
	case len(s.PendingDiscards) > 0:
		seats := make([]PlayerID, 0, len(s.PendingDiscards))
		for p := range s.PendingDiscards {
			seats = append(seats, p)
		}
		slices.Sort(seats)
		ds := make([]Decider, len(seats))
		for i, p := range seats {
			ds[i] = Decider{Seat: p, Kind: DecisionDiscard}
		}
		return ds
	case s.RobberPending:
		return []Decider{{Seat: s.Cur, Kind: DecisionRobber}}
	case !s.Rolled:
		return []Decider{{Seat: s.Cur, Kind: DecisionRoll}}
	default:
		return []Decider{{Seat: s.Cur, Kind: DecisionMain}}
	}
}

func cmd(p PlayerID, t CommandType, payload any) Command {
	var data json.RawMessage
	if payload != nil {
		data, _ = json.Marshal(payload)
	}
	return Command{Player: p, Type: t, Data: data}
}

func allLegalSettlementSpots(s *State) []board.Vertex {
	var out []board.Vertex
	seen := map[board.Vertex]bool{}
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, v := range h.Vertices() {
			if !seen[v] && checkSettlementSpot(s, v) == nil {
				seen[v] = true
				out = append(out, v)
			}
		}
	}
	return out
}

// LegalSetupRoads is the set of edges the setup connector may take right now:
// the free land edges of the settlement just placed that no module refuses.
// Exported so bots (bot/placement.go, bot/setuproad_net.go) use the same
// predicate as the engine.
func LegalSetupRoads(s *State) []board.Edge { return legalSetupRoads(s) }

// legalSetupRoads is the auto-mover's list of setup connectors. It must agree
// with decidePlaceRoad or setup stalls on a refused move, so it asks the same
// module predicates in the same order:
//
//   - EdgeRefusal (Rivers: a bridge site takes no road, and no bridge in setup)
//   - OccupiesEdge (Wagons: the three seaward edges of each trade hex)
//   - BlocksNewRoad (Raiders: a conquered hex)
//
// and an Islands ship on a coastal edge, which LandEdge already excludes.
func legalSetupRoads(s *State) []board.Edge {
	var out []board.Edge
	for _, e := range s.LastSettlement.Edges() {
		if _, taken := s.Roads[e]; taken {
			continue
		}
		if !s.Board.LandEdge(e) {
			continue
		}
		if s.edgeBlockedByModule(e) {
			continue
		}
		if s.EdgeRefusal(e, RouteRoad) != nil {
			continue
		}
		if s.newRoadBlocked(e) {
			continue
		}
		out = append(out, e)
	}
	return out
}

// spreadDiscard takes n cards round-robin across the hand's resources.
func spreadDiscard(h Hand, n int) Hand {
	var out Hand
	for n > 0 {
		took := false
		for r := range h {
			if h[r] > out[r] && n > 0 {
				out[r]++
				n--
				took = true
			}
		}
		if !took {
			break
		}
	}
	return out
}

// autoRobberTarget picks the first hex (deterministic board order) that
// yields a victim, else the first legal hex.
func autoRobberTarget(s *State) (board.Hex, PlayerID) {
	var fallback *board.Hex
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		if !robberMayEnter(s, h) || h == s.Board.Robber {
			continue
		}
		if fallback == nil {
			hh := h
			fallback = &hh
		}
		victims := robberVictims(s, h, s.Cur)
		for p := range s.Players {
			if victims[PlayerID(p)] {
				return h, PlayerID(p)
			}
		}
	}
	if fallback == nil {
		// No legal hex to move to: leave the robber where it is.
		return s.Board.Robber, NoPlayer
	}
	return *fallback, NoPlayer
}
