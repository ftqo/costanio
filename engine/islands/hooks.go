package islands

import (
	"encoding/json"
	"sort"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

func (m Module) Hooks() engine.Hooks {
	return engine.Hooks{
		OnDiceRolled: m.onDiceRolled,
		OnEvents:     m.onEvents,
		Blocks:       func(s *engine.State) bool { return len(extRO(s).PendingGold) > 0 },
		Auto:         m.auto,
		PendingDeciders: func(s *engine.State) []engine.ModuleDecider {
			var seats []engine.ModuleDecider
			for p, n := range extRO(s).PendingGold {
				if n > 0 {
					seats = append(seats, engine.ModuleDecider{Seat: p, Decision: DecisionGoldPick})
				}
			}
			return seats
		},
		RouteEdges:     routeEdges,
		VictoryCheck:   func(s *engine.State, p engine.PlayerID) int { return extRO(s).IslandVP[p] },
		SetupGrant:     setupGrant,
		SetupShipEvent: setupShipEvent,
		LegalExtras:    m.legalExtras,
		OccupiesEdge:   occupiesEdge,
		AnchorsVertex:  anchorsVertex,
		// The start-island rule (mainisland.go): setup only, and a no-op when
		// the board has no main island or the host chose "any island".
		BlocksNewConstruction: blocksNewSettlement,
		RouteEdge:             routeEdge,
		SeaBlockerHex:         seaBlockerHex,
		ChaseSeaBlocker:       chaseSeaBlocker,
	}
}

// seaBlockerHex reports where the pirate stands, so another module can tell
// whether one of its pieces is next to it (Knights: a knight on a sea
// intersection may chase the pirate). Silent when the pirate is switched off or
// not yet placed.
func seaBlockerHex(s *engine.State) (board.Hex, bool) {
	if !configFrom(s.Config).Pirate {
		return board.Hex{}, false
	}
	x := extRO(s)
	if !x.HasPirate {
		return board.Hex{}, false
	}
	return x.Pirate, true
}

// hexAdjacentToVertex reports whether hex h is one of vertex v's three hexes.
func hexAdjacentToVertex(v board.Vertex, h board.Hex) bool {
	for _, vh := range v.Hexes() {
		if vh == h {
			return true
		}
	}
	return false
}

// chaseSeaBlocker moves the pirate on another module's behalf (Knights on a sea
// intersection may chase the pirate as land knights chase the robber). The
// caller checks the chasing piece (an active, settled knight); this decides
// where the pirate may go and who may be robbed, as decideMovePirate does.
//
// The friendly-robber forcing rule decideMovePirate applies on a 7 is not
// applied here, matching the land chase: driving a blocker off your own water
// is defensive and is never forced onto a robbable hex. Who may be robbed is
// still gated by pirateVictims.
func chaseSeaBlocker(s *engine.State, mover engine.PlayerID, from board.Vertex, to board.Hex, victim *engine.PlayerID, offset int) ([]engine.Event, bool, error) {
	pirate, ok := seaBlockerHex(s)
	if !ok {
		return nil, false, nil // no pirate in this game: not ours to answer
	}
	if !hexAdjacentToVertex(from, pirate) {
		return nil, true, engine.ErrBadPlacement // the piece is not next to the pirate
	}
	if !s.Board.IsSea(to) || to == pirate {
		return nil, true, engine.ErrBadPlacement
	}
	events := []engine.Event{engine.NewEvent(EvPirateMoved, pirateData{Player: mover, Hex: to})}
	victims := pirateVictims(s, to, mover)
	if len(victims) == 0 {
		if victim != nil {
			return nil, true, engine.ErrBadVictim
		}
		return events, true, nil
	}
	if victim == nil || !victims[*victim] {
		return nil, true, engine.ErrBadVictim
	}
	// Steal through the module hook chain, as decideMovePirate does, so a
	// commodity-only victim is robbed correctly.
	if ev, ok := engine.StealCardFromModules(s, mover, *victim, offset+1); ok {
		return append(events, ev), true, nil
	}
	res, _ := engine.RandomCard(engine.RngFor(s, offset+1), s.Players[*victim].Hand)
	return append(events, engine.NewEvent(engine.EvCardStolen,
		engine.CardStolenData{Thief: mover, Victim: *victim, Res: res}, mover, *victim)), true, nil
}

// routeEdge reports the ship owner on edge e, so another module can walk a
// player's sea routes without reaching into this package's Ext. Knights uses it
// for knight movement along continuous routes of roads and ships.
func routeEdge(s *engine.State, e board.Edge) (engine.PlayerID, bool) {
	owner, ok := extRO(s).Ships[e]
	return owner, ok
}

// occupiesEdge reports whether a ship holds edge e, so the base road build and
// setup reject a road there: one road or one ship per coastal hex side.
func occupiesEdge(s *engine.State, e board.Edge) bool {
	_, taken := extRO(s).Ships[e]
	return taken
}

// anchorsVertex reports whether a ship of p touches vertex v, letting a
// settlement be founded at the end of a ship route (Islands colonization).
func anchorsVertex(s *engine.State, v board.Vertex, p engine.PlayerID) bool {
	ships := extRO(s).Ships
	for _, e := range v.Edges() {
		if owner, ok := ships[e]; ok && owner == p {
			return true
		}
	}
	return false
}

// setupShipEvent places a free starting ship on a sea edge bordering the new
// settlement (the base already checked the edge touches it). Used when a coastal
// start opens by sea instead of by road.
func setupShipEvent(s *engine.State, e board.Edge, p engine.PlayerID) (engine.Event, bool) {
	x := extRO(s)
	if !s.Board.SeaEdge(e) || x.ShipsLeft[p] == 0 {
		return engine.Event{}, false
	}
	if _, taken := x.Ships[e]; taken {
		return engine.Event{}, false
	}
	return engine.NewEvent(EvShipBuilt, shipData{Player: p, E: e, Free: true}), true
}

// setupGrant owes a gold pick for each gold hex bordering a round-2 setup
// settlement (the base grant pays only the five bankable resources).
func setupGrant(s *engine.State, p engine.PlayerID, v board.Vertex) []engine.Event {
	gold := 0
	for _, h := range v.Hexes() {
		if t, ok := s.Board.Tiles[h]; ok && t.Res == board.Gold {
			gold++
		}
	}
	if gold == 0 {
		return nil
	}
	return []engine.Event{engine.NewEvent(EvGoldOwed, goldOwedData{Owed: []engine.PlayerDiscard{{Player: p, Count: gold}}})}
}

// onDiceRolled owes gold picks for gold hexes hit by the roll.
func (Module) onDiceRolled(s *engine.State, d1, d2 int) []engine.Event {
	roll := d1 + d2
	owedBy := map[engine.PlayerID]int{}
	for h, t := range s.Board.Tiles {
		if t.Res != board.Gold || t.Number != roll || h == s.Board.Robber {
			continue
		}
		for _, v := range h.Vertices() {
			if b, ok := s.Buildings[v]; ok {
				n := 1
				if b.City {
					n = 2
				}
				owedBy[b.Owner] += n
			}
		}
	}
	if len(owedBy) == 0 {
		return nil
	}
	var owed []engine.PlayerDiscard
	for p, n := range owedBy {
		owed = append(owed, engine.PlayerDiscard{Player: p, Count: n})
	}
	sort.Slice(owed, func(i, j int) bool { return owed[i].Player < owed[j].Player })
	return []engine.Event{engine.NewEvent(EvGoldOwed, goldOwedData{Owed: owed})}
}

// onEvents resets per-turn ship state and awards island chips for settlements
// reaching new islands during play.
func (Module) onEvents(after *engine.State, events []engine.Event) []engine.Event {
	var out []engine.Event
	cfg := configFrom(after.Config)
	x := extRO(after)
	// Board.Islands() flood-fills the whole board, and this hook runs on every
	// command (thousands of times per turn through the Strong bot's
	// DecideForEval). It is computed lazily in the one arm that reads it, only
	// when chips are on.
	var islands map[board.Hex]int

	for _, e := range events {
		switch e.Type {
		case engine.EvTurnStarted:
			out = append(out, engine.NewEvent(EvTurnReset, struct{}{}))

		case engine.EvSettlementBuilt:
			if cfg.IslandVP == 0 {
				continue
			}
			d := engine.DecodeEvent[engine.BuiltData](e)
			if d.V == nil {
				continue
			}
			if islands == nil {
				islands = after.Board.Islands()
			}
			for _, island := range vertexIslands(*d.V, islands) {
				if x.Reached[d.Player][island] {
					continue
				}
				if playerOnIslandElsewhere(after, d.Player, island, *d.V, islands) {
					continue // home or already-settled island: no chip
				}
				out = append(out, engine.NewEvent(EvIslandChip,
					islandChipData{Player: d.Player, Island: island, VP: cfg.IslandVP}))
			}
		default:
		}
	}
	return out
}

func vertexIslands(v board.Vertex, islands map[board.Hex]int) []int {
	seen := map[int]bool{}
	var out []int
	for _, h := range v.Hexes() {
		if id, ok := islands[h]; ok && !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	sort.Ints(out)
	return out
}

// playerOnIslandElsewhere reports whether the player already has a building
// touching the island, other than at the just-built vertex.
func playerOnIslandElsewhere(s *engine.State, p engine.PlayerID, island int, except board.Vertex, islands map[board.Hex]int) bool {
	for v, b := range s.Buildings {
		if b.Owner != p || v == except {
			continue
		}
		for _, h := range v.Hexes() {
			if id, ok := islands[h]; ok && id == island {
				return true
			}
		}
	}
	return false
}

// auto resolves the lowest pending gold pick greedily (auto-pass support).
func (Module) auto(s *engine.State, target engine.PlayerID) (engine.Command, bool) {
	x := extRO(s)
	p := engine.NoPlayer
	if target != engine.NoPlayer {
		// Resolve only the requested seat's gold pick; gold is owed
		// simultaneously, so a bot must not wait on a lower-seated ower.
		if _, ok := x.PendingGold[target]; ok {
			p = target
		}
	} else {
		for q := range s.Players {
			if _, ok := x.PendingGold[engine.PlayerID(q)]; ok {
				p = engine.PlayerID(q)
				break
			}
		}
	}
	if p == engine.NoPlayer {
		return engine.Command{}, false
	}
	take := x.PendingGold[p]
	if bank := s.Bank.Count(); bank < take {
		take = bank
	}
	var gain engine.Hand
	for r := range s.Bank {
		for take > 0 && s.Bank[r] > gain[r] {
			gain[r]++
			take--
		}
	}
	raw, _ := json.Marshal(goldChosenData{Gain: gain})
	return engine.Command{Player: p, Type: CmdChooseGold, Data: raw}, true
}

// routeEdges adds the player's ships to the route network the engine walks. The
// rule that roads and ships join only at the player's own buildings is the
// engine's kind-switch rule (engine.RouteNet), so one walk covers a
// camel-doubled road (Caravans) on land and ships at sea.
func routeEdges(s *engine.State, p engine.PlayerID, net *engine.RouteNet) {
	for e, owner := range extRO(s).Ships {
		if owner == p {
			net.Add(e, engine.RouteShip)
		}
	}
}
