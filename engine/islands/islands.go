// Package islands implements the Islands expansion as an engine module:
// ships, sea/gold terrain, the pirate, and island victory chips.
package islands

import (
	"encoding/gob"
	"encoding/json"
	"maps"
	"slices"
	"sort"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

const Name = "islands"

const (
	CmdBuildShip  engine.CommandType = "build_ship"
	CmdMoveShip   engine.CommandType = "move_ship"
	CmdMovePirate engine.CommandType = "move_pirate"
	CmdChooseGold engine.CommandType = "choose_gold"
)

const (
	EvShipBuilt   engine.EventType = "ship_built"
	EvShipMoved   engine.EventType = "ship_moved"
	EvPirateMoved engine.EventType = "pirate_moved"
	EvGoldOwed    engine.EventType = "gold_owed"
	EvGoldChosen  engine.EventType = "gold_chosen"
	EvIslandChip  engine.EventType = "island_chip"
	EvTurnReset   engine.EventType = "islands_turn_reset"
)

var CostShip = engine.Hand{board.Wood: 1, board.Sheep: 1}

const MaxShips = 15

// Config is the module's slice of GameConfig.Modules["islands"].
type Config struct {
	IslandVP int  `json:"island_vp"` // VP per newly reached island; default 2
	Pirate   bool `json:"pirate"`    // default true
	// StartIsland is where the starting settlements may go: StartAuto (the
	// default, and what an empty or unknown value reads as) confines them to
	// the main island when the board has one; StartAny allows any island. See
	// MainIsland and docs/rules/islands.md "Setup".
	StartIsland string `json:"start_island,omitempty"`
}

func configFrom(cfg engine.GameConfig) Config {
	c := Config{IslandVP: 2, Pirate: true, StartIsland: StartAuto}
	if raw, ok := cfg.Modules[Name]; ok {
		if err := json.Unmarshal(raw, &c); err != nil {
			return Config{IslandVP: 2, Pirate: true, StartIsland: StartAuto}
		}
	}
	if c.IslandVP < 0 {
		c.IslandVP = 2
	}
	if c.StartIsland != StartAny {
		c.StartIsland = StartAuto
	}
	return c
}

// Ext is the module's state, stored in State.Ext[Name].
type Ext struct {
	Ships       map[board.Edge]engine.PlayerID
	ShipsLeft   []int
	BuiltTurn   map[board.Edge]bool // ships built this turn cannot move yet
	MovedShip   bool                // one ship move per turn
	Pirate      board.Hex
	HasPirate   bool
	PendingGold map[engine.PlayerID]int
	Reached     map[engine.PlayerID]map[int]bool // islands with an awarded chip
	IslandVP    map[engine.PlayerID]int
}

// CloneExt deep-copies the module state for Decide, which runs the rules
// against a copy.
//
// A shallow struct copy carries every value field (the pirate's hex, whether a
// ship moved this turn); each reference field is then replaced so a speculative
// write from a rejected command cannot reach the live game.
// TestCloneExtCarriesEveryField in engine/ruletest checks this by reflection.
//
// Reached is a map of maps, so each inner set is copied too.
func (e *Ext) CloneExt() engine.Extension {
	c := *e
	c.ShipsLeft = append([]int(nil), e.ShipsLeft...)
	c.Ships = maps.Clone(e.Ships)
	c.BuiltTurn = maps.Clone(e.BuiltTurn)
	c.PendingGold = maps.Clone(e.PendingGold)
	c.IslandVP = maps.Clone(e.IslandVP)
	if e.Reached != nil {
		c.Reached = make(map[engine.PlayerID]map[int]bool, len(e.Reached))
		for p, set := range e.Reached {
			c.Reached[p] = maps.Clone(set)
		}
	}
	return &c
}

// ShipView is a ship in a full state view.
type ShipView struct {
	E     board.Edge      `json:"e"`
	Owner engine.PlayerID `json:"owner"`
}

// ExtView is the JSON-friendly, per-viewer slice of the module state.
type ExtView struct {
	Ships       []ShipView              `json:"ships"`
	ShipsLeft   []int                   `json:"ships_left"`
	Pirate      *board.Hex              `json:"pirate,omitempty"`
	PendingGold map[engine.PlayerID]int `json:"pending_gold,omitempty"`
	IslandVP    map[engine.PlayerID]int `json:"island_vp,omitempty"`
	MovedShip   bool                    `json:"moved_ship"`
}

// ViewExt implements engine.Viewable. Nothing here is hidden information.
//
// Every map and slice is copied out of the live ext, never aliased: the view is
// serialized later on another goroutine while the actor may fold the next
// command into this ext, and a shared map would be a fatal concurrent map
// access. game/views.go copies the base State's Board, ActiveOffer and
// PendingDiscards for the same reason.
func (e *Ext) ViewExt(viewer engine.PlayerID) any {
	v := &ExtView{Ships: []ShipView{}, ShipsLeft: slices.Clone(e.ShipsLeft), MovedShip: e.MovedShip}
	for edge, owner := range e.Ships {
		v.Ships = append(v.Ships, ShipView{E: edge, Owner: owner})
	}
	vertexKey := func(v board.Vertex) [3]int { return [3]int{v.Q, v.R, int(v.Side)} }
	less := func(a, b [3]int) bool {
		for i := range a {
			if a[i] != b[i] {
				return a[i] < b[i]
			}
		}
		return false
	}
	sort.Slice(v.Ships, func(i, j int) bool {
		a, b := v.Ships[i].E, v.Ships[j].E
		if a.A != b.A {
			return less(vertexKey(a.A), vertexKey(b.A))
		}
		return less(vertexKey(a.B), vertexKey(b.B))
	})
	if e.HasPirate {
		p := e.Pirate
		v.Pirate = &p
	}
	if len(e.PendingGold) > 0 {
		v.PendingGold = maps.Clone(e.PendingGold)
	}
	if len(e.IslandVP) > 0 {
		v.IslandVP = maps.Clone(e.IslandVP)
	}
	return v
}

// RestoreExt reallocates the maps the fold writes to after a snapshot decode
// left them nil (see engine.ExtRestorer).
//
// Apply assigns into every map on this Ext (a ship laid, gold owed, an island
// first reached), so all four are here. Reached's inner maps are created on
// demand by the fold, so only the outer one needs restoring.
//
// Only fill in what is missing: events after the snapshot replay onto this
// state, so replacing a decoded map would lose data.
func (e *Ext) RestoreExt() {
	if e.Ships == nil {
		e.Ships = map[board.Edge]engine.PlayerID{}
	}
	if e.BuiltTurn == nil {
		e.BuiltTurn = map[board.Edge]bool{}
	}
	if e.PendingGold == nil {
		e.PendingGold = map[engine.PlayerID]int{}
	}
	if e.Reached == nil {
		e.Reached = map[engine.PlayerID]map[int]bool{}
	}
	if e.IslandVP == nil {
		e.IslandVP = map[engine.PlayerID]int{}
	}
}

func freshExt(players int) *Ext {
	e := &Ext{
		Ships:       map[board.Edge]engine.PlayerID{},
		BuiltTurn:   map[board.Edge]bool{},
		PendingGold: map[engine.PlayerID]int{},
		Reached:     map[engine.PlayerID]map[int]bool{},
		IslandVP:    map[engine.PlayerID]int{},
	}
	for range players {
		e.ShipsLeft = append(e.ShipsLeft, MaxShips)
	}
	return e
}

// ext fetches (or creates and stores) the module state. Only the fold path
// (Apply) and tests may call this: storing from Decide or hooks would mutate
// state outside the event log.
func ext(s *engine.State) *Ext {
	if e, ok := s.Ext[Name].(*Ext); ok {
		return e
	}
	e := freshExt(len(s.Players))
	s.Ext[Name] = e
	return e
}

// extRO is the read-only accessor for Decide and hooks: existing state, or a
// throwaway zero value that is never stored.
func extRO(s *engine.State) *Ext {
	if e, ok := s.Ext[Name].(*Ext); ok {
		return e
	}
	return freshExt(len(s.Players))
}

// StateExt returns the Islands module's ext for s and whether Islands is
// active. Read-only: callers outside the fold path must not mutate it. Returns
// (nil, false) when Islands is not active.
func StateExt(s *engine.State) (*Ext, bool) {
	e, ok := s.Ext[Name].(*Ext)
	return e, ok
}

type Module struct{}

func (Module) Name() string { return Name }

// InitExt seeds the module state at game creation (engine.ExtInitializer), so
// the ship supply is in State and every client view from event zero. Otherwise
// a setup that opens by road on a board with all its gold offshore would reach
// the first turn with no Islands state in State.Ext.
func (Module) InitExt(cfg engine.GameConfig) engine.Extension { return freshExt(cfg.Players) }

// RequiredTerrain: curated islands maps must actually have water.
func (Module) RequiredTerrain() []board.Resource {
	return []board.Resource{board.Sea}
}

func init() {
	engine.RegisterModule(Name, func() engine.Module { return Module{} })
	engine.RegisterRouteEvent(EvShipBuilt)
	engine.RegisterRouteEvent(EvShipMoved)
	// Sea is base-legal terrain: any map may carve open water to shape its
	// coastline (the base engine bars building on water via
	// LandVertex/LandEdge). Gold is Islands-only.
	engine.RegisterTerrain(board.Gold, Name)
	gob.Register(&Ext{})
}

// ChipVP is the victory points a seat earns for its first settlement on an
// island it did not start on (Config.IslandVP, default 2; 0 switches chips
// off). Exported for the bot, which prices the chip before it is earned.
func ChipVP(cfg engine.GameConfig) int { return configFrom(cfg).IslandVP }
