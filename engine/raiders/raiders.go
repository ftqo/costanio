// Package raiders implements the Raiders scenario: a hostile force lands on the
// coast whenever anybody builds, hexes it saturates stop producing, buildings
// it surrounds stop scoring, and the seats put riders on the board and march
// them to the coast. See docs/rules/raiders.md.
//
// Vocabulary: a raider is a neutral enemy figure on a hex; a rider is a
// seat-tinted defender on a path (an edge). Identifiers always spell these out
// (Raider/RaiderCount, Rider/RiderAt) and never abbreviate to R.
package raiders

import (
	"encoding/gob"
	"encoding/json"
	"maps"
	"math/rand/v2"
	"slices"
	"strings"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// Name is the ruleset token and the State.Ext key.
const Name = "raiders"

const (
	// ridersPerSeat is the component limit, enforced like roads and settlements.
	ridersPerSeat = 6
	// riderMove is the base movement allowance in paths, and riderMoveHurry what
	// one grain buys for one rider.
	riderMove      = 3
	riderMoveHurry = 5
	// conquered is the number of raiders that saturates a hex. Conquest is
	// derived (raiders on hex == conquered), never stored, so every rule that
	// adds or removes a raider updates it automatically.
	conquered = 3
	// landingNumbers is how many distinct non-7 numbers one landing rolls.
	landingNumbers = 3
	// goldPerLoss is what a seat takes for each of its riders removed as a battle
	// loss, and for rolling off in a prisoner split and coming away empty.
	goldPerLoss = 3
	// goldPerTreason is what the Treason card pays.
	goldPerTreason = 2
	// goldPerResource is the bank price of one resource, and goldBuysPerTurn the
	// cap on that purchase.
	goldPerResource = 2
	goldBuysPerTurn = 2
	// winVP is the scenario's own target; winVPKnights is the target for
	// the Knights combination.
	winVP        = 12
	winVPKnights = 13
	// prisonersPerVP is how many prisoners make a victory point (three under
	// Knights). A lone prisoner is worth nothing, including when working out
	// who is leading.
	prisonersPerVP        = 2
	prisonersPerVPKnights = 3
)

// Module names of the partners whose combination rules this scenario carries.
// String constants rather than imports, so peer modules stay independent and
// compose through the engine. TestModuleNamesMatch pins them against those
// packages' constants.
const (
	knightsModuleName = "cak"
	islandsModuleName = "islands"
)

func rulesetHas(ruleset, name string) bool {
	return slices.Contains(strings.Split(ruleset, "+"), name)
}

// hasKnights reports whether the Knights combination rules apply.
func hasKnights(s *engine.State) bool { return rulesetHas(s.Config.Ruleset, knightsModuleName) }

func init() {
	engine.RegisterModule(Name, func() engine.Module { return Module{} })
	gob.Register(&Ext{})
	registerEvents()
}

// Ext is the scenario's state.
//
// The JSON tags split it in two. The board-derived half (castle, landmass,
// coastline, supply, and the raiders seeded at setup) is carried in
// EvBoardGenerated's ext blob (see engine.ExtBoardInitializer); it comes from
// the public seed, is audited by verify/, and must survive a JSON round trip.
//
// Everything else is `json:"-"`: either a constant of the player count (deck,
// rider supplies) or fold-only state. Two fields are struct-keyed maps, which
// encoding/json cannot marshal (as with CaravansExt.Occupied).
type Ext struct {
	Shared      bool                `json:"shared_paths,omitempty"`
	PathFigures []engine.PathRaider `json:"path_figures,omitempty"`
	PathQueue   []int               `json:"-"`
	PathEdges   []board.Edge        `json:"-"`
	PathSeat    engine.PlayerID     `json:"-"`
	// Castle is the hex riders enter the board from. It can never be conquered,
	// carries no number chip and produces nothing.
	Castle    board.Hex `json:"castle"`
	HasCastle bool      `json:"has_castle"`
	// Land is the main landmass: the hexes raiders and riders operate on. Under
	// Islands that is the largest connected component of land; otherwise it is
	// simply all the land. Ascending (Q, R).
	Land []board.Hex `json:"land"`
	// Coast is every landing-eligible hex, ascending (Q, R): coastal (a land hex
	// with a neighbouring position that is not land), numbered, and on the main
	// landmass. Fixed at setup, which is also what sizes the supply.
	Coast []board.Hex `json:"coast"`
	// RaiderCount[i] is how many raiders stand on Coast[i]. Parallel to Coast
	// rather than a map because struct-keyed maps cannot be transported, and
	// the seeded opening position is board-derived.
	RaiderCount []int `json:"raider_count"`
	// Supply is how many raiders are left in the neutral supply. When it is
	// empty, landings stop: no attack is rolled and building has no consequence
	// for the rest of the game. Unbounded under Knights (see supplyEmpty).
	Supply int `json:"supply"`

	// RiderAt is which seat's rider stands on each path. A path holds at most
	// one rider; riders and roads (and camels, and wagons) share a path freely.
	RiderAt map[board.Edge]engine.PlayerID `json:"-"`
	// Moved is the paths whose rider has already moved this turn, keyed by
	// where the rider ended (each of your riders moves once).
	//
	// It is cleared by an explicit EvSweep at every turn end rather than by a
	// stored turn stamp, because ViewExt gets a viewer and no State and could
	// not compare a stamp. A module also never sees base events (Apply is
	// reached only through State.Apply's default branch), so the turn boundary
	// must be one of this module's own events.
	Moved map[board.Edge]bool `json:"-"`

	RidersLeft []int `json:"-"` // per seat, out of ridersPerSeat
	Prisoners  []int `json:"-"` // per seat; never return to the supply
	Gold       []int `json:"-"` // per seat; a counter, not a resource

	// Buys counts the active seat's gold-for-resource purchases this turn (at
	// most two). Cleared by the same EvSweep, for the same reason.
	Buys int `json:"-"`

	// Deck is the scenario's own development deck, indexed by Card. Nothing is
	// held in hand: a card is revealed and resolved on purchase, then
	// discarded, and when the deck runs out the discards are reshuffled. So
	// these four counts are probabilities rather than a budget.
	Deck [cardKinds]int `json:"-"`

	// Pend is what the scenario is currently waiting on, or the zero value.
	Pend Pending `json:"-"`

	// Announced and AnnouncedLost are the conquest the log has announced: the
	// conquered hexes and the switched-off buildings as of the last
	// raiders_conquest. Written only by that event's fold, read only by the
	// announcement pass, and never by a rule; see announce.go.
	Announced     []board.Hex    `json:"-"`
	AnnouncedLost []board.Vertex `json:"-"`
}

// Pending is one outstanding Raiders decision.
//
// Hexes and Edges are the candidate set, recomputed by the fold
// (refreshChoices). They live in the ext because ViewExt has no State to derive
// them from, and Auto can read them without re-deriving the rule.
type Pending struct {
	Kind string
	Seat engine.PlayerID
	// Numbers are the landing numbers still to resolve, in the order they were
	// rolled. Only the landing pending uses it.
	Numbers []int
	Hexes   []board.Hex
	Edges   []board.Edge
	// Count is how many moves a Treason plan must carry (treasonCount), written
	// by the fold so the view can publish it. Re-deriving it from the two pick
	// lists is wrong when a destination can only be one of the sources, and a
	// plan of the wrong length is refused.
	Count int
}

// The Pending kinds. They double as the timer layer's decision ids (see
// engine.ModuleDecider.Decision and decisions.go).
const (
	PendNone     = ""
	PendLanding  = "raiders_landing"
	PendMuster   = "raiders_muster"
	PendSwift    = "raiders_swift"
	PendTreason  = "raiders_treason"
	PendIntrigue = "raiders_intrigue"
	PendSteal    = "raiders_steal"
)

// CloneExt deep-copies the module state for Decide, which runs the rules
// against a copy.
//
// A shallow struct copy carries every value field; reference fields are then
// replaced so a speculative write from a rejected command cannot reach the live
// game. TestCloneExtCarriesEveryField in engine/ruletest checks this by
// reflection.
func (e *Ext) CloneExt() engine.Extension {
	c := *e
	c.PathFigures = slices.Clone(e.PathFigures)
	c.PathQueue = slices.Clone(e.PathQueue)
	c.PathEdges = slices.Clone(e.PathEdges)
	c.Land = slices.Clone(e.Land)
	c.Coast = slices.Clone(e.Coast)
	c.RaiderCount = slices.Clone(e.RaiderCount)
	c.RiderAt = maps.Clone(e.RiderAt)
	c.Moved = maps.Clone(e.Moved)
	c.RidersLeft = slices.Clone(e.RidersLeft)
	c.Prisoners = slices.Clone(e.Prisoners)
	c.Gold = slices.Clone(e.Gold)
	c.Pend.Numbers = slices.Clone(e.Pend.Numbers)
	c.Pend.Hexes = slices.Clone(e.Pend.Hexes)
	c.Pend.Edges = slices.Clone(e.Pend.Edges)
	c.Announced = slices.Clone(e.Announced)
	c.AnnouncedLost = slices.Clone(e.AnnouncedLost)
	return &c
}

// RestoreExt reallocates the maps the fold writes to after a snapshot decode
// left them nil (see engine.ExtRestorer).
func (e *Ext) RestoreExt() {
	if e.RiderAt == nil {
		e.RiderAt = map[board.Edge]engine.PlayerID{}
	}
	if e.Moved == nil {
		e.Moved = map[board.Edge]bool{}
	}
}

// StateExt returns the module's ext for s and whether Raiders is active.
// Read-only: callers outside the fold path must not mutate it.
func StateExt(s *engine.State) (*Ext, bool) {
	e, ok := s.Ext[Name].(*Ext)
	return e, ok
}

func active(s *engine.State) bool {
	if _, ok := s.Ext[Name]; ok {
		return true
	}
	for _, m := range s.Modules() {
		if m.Name() == Name {
			return true
		}
	}
	return false
}

// ext is the fold-path accessor: it creates the state if nothing has written it
// yet. extRO is the read path and never writes to the live state.
func ext(s *engine.State) *Ext {
	if e, ok := s.Ext[Name].(*Ext); ok {
		return e
	}
	e := fresh(s)
	if s.Ext == nil {
		s.Ext = map[string]engine.Extension{}
	}
	s.Ext[Name] = e
	return e
}

func extRO(s *engine.State) *Ext {
	if e, ok := s.Ext[Name].(*Ext); ok {
		return e
	}
	return fresh(s)
}

// fresh is the ext a game opens with: per-seat counters and the deck, plus the
// board-derived layer when a board exists.
//
// The board may be nil here, between game_created and board_generated. A live
// game emits both in one batch, but replay.Fold snapshots a view after every
// event, frame zero included.
func fresh(s *engine.State) *Ext {
	n := len(s.Players)
	if n == 0 {
		n = s.Config.Players
	}
	e := &Ext{
		RiderAt:    map[board.Edge]engine.PlayerID{},
		Moved:      map[board.Edge]bool{},
		RidersLeft: filled(n, ridersPerSeat),
		Prisoners:  make([]int, n),
		Gold:       make([]int, n),
		Deck:       freshDeck(),
		Pend:       Pending{Seat: engine.NoPlayer},
	}
	if s.Board != nil {
		deriveBoard(e, s.Board, hasKnights(s), castleAvoid(s))
		if g := engine.RaiderGeometry(s); g != nil {
			starts := g.RaiderStartHexes(withBoardExt(s, e))
			if len(starts) > 0 {
				e.Shared = true
				clear(e.RaiderCount)
				e.Supply = conquered * len(e.Coast)
				if hasKnights(s) {
					e.Supply = 0
				}
				for _, h := range starts {
					e.addFigure(h)
					e.takeFromSupply(hasKnights(s))
				}
			}
		}
	}
	return e
}

// withBoardExt is s as another module should see it once this module's
// board-derived layer exists: a shallow copy whose Ext holds e. Wagons' start
// hexes ask TradeHexAllowed per candidate, which reads the castle from the
// stored ext; without this every candidate re-derived it, and under Rivers that
// means a watercourse derivation per cape. Read-only: s is never written.
func withBoardExt(s *engine.State, e *Ext) *engine.State {
	c := *s
	c.Ext = maps.Clone(s.Ext)
	if c.Ext == nil {
		c.Ext = map[string]engine.Extension{}
	}
	c.Ext[Name] = e
	return &c
}

func filled(n, v int) []int {
	out := make([]int, n)
	for i := range out {
		out[i] = v
	}
	return out
}

// Module is the scenario.
type Module struct{}

func (Module) Name() string { return Name }

// SetupBoard does nothing: the castle is placed in FinishBoard, because
// SetupBoard runs in lexicographic ruleset order and "caravans" and "fishermen"
// run before "raiders" and may still claim the centre for the oasis or the lake
// (see docs/engine.md).
func (Module) SetupBoard(*board.Board, engine.GameConfig, *rand.Rand) {}

// InitExt seeds the per-seat counters and the deck at game creation, so a
// client view carries the rider supplies and gold from event zero. See
// engine.ExtInitializer.
func (Module) InitExt(cfg engine.GameConfig) engine.Extension {
	return &Ext{
		RiderAt:    map[board.Edge]engine.PlayerID{},
		Moved:      map[board.Edge]bool{},
		RidersLeft: filled(cfg.Players, ridersPerSeat),
		Prisoners:  make([]int, cfg.Players),
		Gold:       make([]int, cfg.Players),
		Deck:       freshDeck(),
		Pend:       Pending{Seat: engine.NoPlayer},
	}
}

// InitExtBoard completes that value with the board-derived layer once the board
// exists: castle, main landmass, coastline, supply, and the raiders seeded onto
// the coast.
//
// It reads back the creation-time value rather than starting fresh, because
// State.Apply assigns what this returns over what InitExt seeded.
//
// Pure: deriveBoard scans HexesInRadius in fixed order with no randomness, so
// the recording pass in engine.New and the fold agree. See
// engine.ExtBoardInitializer.
func (Module) InitExtBoard(s *engine.State) engine.Extension {
	e, ok := s.Ext[Name].(*Ext)
	if !ok {
		e = fresh(s)
	} else if c, ok := e.CloneExt().(*Ext); ok {
		e = c
	} else {
		e = fresh(s)
	}
	if s.Board != nil {
		deriveBoard(e, s.Board, hasKnights(s), castleAvoid(s))
		if g := engine.RaiderGeometry(s); g != nil {
			starts := g.RaiderStartHexes(withBoardExt(s, e))
			if len(starts) > 0 {
				e.Shared = true
				clear(e.RaiderCount)
				e.Supply = conquered * len(e.Coast)
				if hasKnights(s) {
					e.Supply = 0
				}
				for _, h := range starts {
					e.addFigure(h)
					e.takeFromSupply(hasKnights(s))
				}
			}
		}
	}
	return e
}

// DefaultConfig: Raiders plays to 12 VP.
//
// A ConfigDefaulter rather than a TargetVPAdjuster, because Raiders owns its
// target (as Knights and Caravans do) rather than shifting another one, so the
// first writer wins.
//
// The 13 under Knights needs no code here: "cak" sorts before "raiders", so
// Knights' defaulter has already written 13 and this leaves it.
//
// Stacking two scenarios that each own a target is not resolved:
// "base+cak+caravans+raiders" plays to Caravans' 15 rather than 13. Recorded as
// a Decision in docs/rules/raiders.md.
func (Module) DefaultConfig(cfg engine.GameConfig) engine.GameConfig {
	if cfg.TargetVP == 0 {
		cfg.TargetVP = winVP
	}
	return cfg
}

func (m Module) Hooks() engine.Hooks {
	return engine.Hooks{
		// The robber and pirate are absent from every Raiders ruleset.
		// FinishBoard puts the robber beside the board and this keeps a 7 from
		// calling it back.
		NoRobber:          func(*engine.State) bool { return true },
		RobberNeverInPlay: true,
		// The base development deck is not used: Raiders ships its own, revealed
		// and resolved the moment it is bought.
		NoDevCards: true,
		// The second setup placement is a city paying one resource per adjacent
		// producing hex. This matches the Knights override, so base+cak+raiders
		// needs no third rule.
		SetupRound2City: true,

		OnEvents: m.onEvents,
		// AfterEvents rather than OnEvents: the sweep's battles are this
		// module's own OnEvents output, and the announcement has to see them
		// folded. See announce.go.
		AfterEvents:       m.announceConquest,
		OnSeven:           m.onSeven,
		Blocks:            m.blocks,
		BlocksTurnActions: m.blocksTurnActions,
		Auto:              m.auto,
		PendingDeciders:   m.pendingDeciders,

		// No LegalExtras or PendingTargets: every piece this scenario adds
		// lives on an edge or hex the shared LegalTargets struct has no field
		// for. The pick lists travel in this module's view instead (ViewExt:
		// `pend`, `rider_moves`, `castle_paths`).

		VictoryCheck: m.victory,

		HexInert:      m.hexInert,
		BuildingInert: m.buildingInert,
		// The same predicate for a different consumer. BuildingInert is the
		// engine's question (does this building produce, fish, use its harbour,
		// join route networks); BuildingVPSuppressed is what other modules ask
		// (is it worth nothing right now), which Harbormaster needs without
		// importing this package. One function answers both so they cannot
		// disagree.
		BuildingVPSuppressed:  m.buildingInert,
		BlocksNewConstruction: m.blocksNewConstruction,
		BlocksNewRoad:         m.blocksNewRoad,

		// The seven-fish spend's route into this scenario's deck: take one card
		// and resolve it immediately. The deck reshuffles its discards, so it
		// is never empty.
		ScenarioCard: func(s *engine.State, p engine.PlayerID, offset int) ([]engine.Event, bool) {
			return m.cardEvents(s, p, offset, true), true
		},

		TradeExtraHeld:   m.tradeGoldHeld,
		TradeExtraEvents: m.tradeGoldEvents,

		// The two-fish rung's substitution under Fishermen: a rider hurry paid
		// in fish instead of grain. See freeRiderHurry.
		FreeRiderHurry: m.freeRiderHurry,
	}
}

// raw marshals a command payload for the Auto path.
func raw(v any) json.RawMessage {
	b, _ := json.Marshal(v)
	return b
}
