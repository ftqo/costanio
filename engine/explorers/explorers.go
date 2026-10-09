// Package explorers implements the Explorers expansion as a standalone engine
// module: a home island, a fog of face-down hexes that ships reveal, cargo
// ships carrying settlers and crews, pirate lairs to storm, fish shoals to
// work, spice villages to befriend, and gold as a second currency.
//
// It replaces large parts of the base game (no development cards, cities,
// robber, Longest Route, Largest Army, ports or desert), so it is `Standalone`.
// See docs/rules/explorers.md.
package explorers

import (
	"encoding/gob"
	"maps"
	"slices"
	"strings"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

const Name = "explorers"

// Per-player piece supplies. The small ship supply is what forces the recycling
// rule (see decideBuildShip).
//
// There is no road supply here: Explorers uses the base game's 15 roads, dealt
// into PlayerState.RoadsLeft from engine.MaxRoads.
const (
	MaxSettlements = engine.MaxSettlements
	MaxHarbours    = 4
	MaxShips       = 3
	MaxSettlers    = 2
	MaxCrews       = 9
)

const (
	// TargetVP does not scale with player count: the scenario keeps 17 at 5-6
	// players, per-player supplies are identical at every count, and mission
	// tracks cap at 9. The board and the fish-haul and spice-sack supplies
	// scale instead.
	TargetVP = 17
	// GoldFieldsPerRegion, ShoalsPerRegion and FarmsPerRegion are the nine
	// special hexes each region carries.
	GoldFieldsPerRegion = 3
	ShoalsPerRegion     = 3
	FarmsPerRegion      = 3
	// LairCrews is how many crews spring a pirate lair.
	LairCrews = 3
	// ShipMP is a ship's base movement allowance; WoolMP is what one wool buys,
	// once per ship per turn; MaxMP is the ceiling with both spice villages.
	ShipMP = 4
	WoolMP = 2
	MaxMP  = 8
	// ShipsPerEdge is how many ships may END their movement on one sea edge.
	// A ship may pass through a full edge; it may not stop on one.
	ShipsPerEdge = 2
	// GoldBuysPerTurn is how many times 2 gold may buy 1 resource.
	GoldBuysPerTurn = 2
	// GoldPerResource is the price of that purchase.
	GoldPerResource = 2
	// BankRatio is flat for everyone, everywhere: there are no ports.
	BankRatio = 3
	// RevealGold is what a revealed sea hex, shoal, gold field or spice farm
	// pays the explorer. Revealed producing land pays a resource instead.
	RevealGold = 2
	// LairGold is what each involved player takes when a lair falls.
	LairGold = 2
	// GoldFieldYield is what a captured gold field pays per adjacent building.
	GoldFieldYield = 2
	// Tribute is what one ship pays, once per turn, to use the edges of a hex
	// an opponent's pirate ship sits on.
	Tribute = 1
	// StartingGold is what every player takes at setup.
	StartingGold = 2
	// TrackSpaces is the number of scoring spaces on a mission track past the
	// start space S.
	TrackSpaces = 7
	// BonusTileVP is what leading a mission track is worth.
	BonusTileVP = 1
	// HarbourVP is what a harbour settlement scores on top of the settlement it
	// replaced, which the base game already counts as 1.
	HarbourVP = 1
)

// TrackVP is the victory value of each space of a mission track: the start
// space S, then spaces 1 through 7.
var TrackVP = [TrackSpaces + 1]int{0, 1, 1, 2, 2, 2, 3, 3}

// The three mission tracks.
const (
	TrackLairs = iota
	TrackFish
	TrackSpice
	TrackCount
)

// The two unexplored regions, split about the board's equator.
const (
	RegionNorth = 0
	RegionSouth = 1
	RegionCount = 2
)

// Village is which of the three spice villages a farm holds. Each exists once
// per region, so twice on the board; holding both crews doubles the advantage.
type Village uint8

const (
	// VillageSwift is Swift Voyage: +1 MP to all your ships, +2 with both.
	VillageSwift Village = iota
	// VillagePirate is Pirate Bonus: chase the pirate on a 5 or 6 with the north
	// region's copy, a 4 or better with the south's, 4 or better with both.
	VillagePirate
	// VillageGold is Fast Gold: once per Action phase sell 1 resource for 1
	// gold, twice with both.
	VillageGold
	VillageCount
)

// Special is what a pool hex turns out to be. Producing land and open sea carry
// SpecialNone; the nine per region that do not are the ones the layout places
// first, subject to the no-two-adjacent rule.
type Special uint8

const (
	SpecialNone Special = iota
	// SpecialGold is a gold field: revealed with a face-down pirate lair over
	// its chit, producing nothing and buildable by nobody until the lair falls.
	SpecialGold
	// SpecialShoal is a fish shoal: water, carrying one of the six die faces.
	SpecialShoal
	// SpecialSpice is a spice farm: land carrying one sack per player, closed to
	// every player who has not landed a crew on it.
	SpecialSpice
)

// PoolHex is one face-down hex of the unexplored pool, as the layout derived
// it. Everything here is hidden until the hex is revealed; the MaskBoard hook
// and the module's view keep it that way.
//
// It is a slice element rather than a map value because the layout is recorded
// in EvBoardGenerated as JSON (see engine.ExtBoardInitializer), which cannot
// marshal a struct-keyed map.
type PoolHex struct {
	H      board.Hex `json:"h"`
	Region int       `json:"region"`
	Kind   Special   `json:"kind,omitempty"`
	// Shoal is the die face this shoal answers to, 1..3 in the north region and
	// 4..6 in the south. Zero unless Kind is SpecialShoal.
	Shoal int `json:"shoal,omitempty"`
	// Village is which spice village this farm holds. Meaningless unless Kind is
	// SpecialSpice (and VillageSwift is the zero value, which is why Kind is
	// what a reader must switch on).
	Village Village `json:"village,omitempty"`
}

// Cargo is what a ship's hold or a harbour settlement's basin is carrying. Both
// have the same capacity: 1 large piece (a settler or a fish haul) OR 2 small
// ones (crews, spice sacks).
type Cargo struct {
	Settler int `json:"settler,omitempty"`
	Haul    int `json:"haul,omitempty"`
	Crew    int `json:"crew,omitempty"`
	Spice   int `json:"spice,omitempty"`
}

// Slots is the capacity Cargo occupies, counting a large piece as both slots.
func (c Cargo) Slots() int { return 2*(c.Settler+c.Haul) + c.Crew + c.Spice }

// Empty reports whether nothing is aboard.
func (c Cargo) Empty() bool { return c.Slots() == 0 }

// Fits reports whether c is a legal hold: no negative count, at most one large
// piece, and at most two slots in total.
func (c Cargo) Fits() bool {
	if c.Settler < 0 || c.Haul < 0 || c.Crew < 0 || c.Spice < 0 {
		return false
	}
	if c.Settler+c.Haul > 1 {
		return false
	}
	return c.Slots() <= 2
}

// Ship is one cargo vessel on the board. Ships are vehicles, not connectors:
// they do not link to roads, form no network, block nothing and score nothing.
// Up to two share a sea edge, in any mix of owners, and a coastal edge can hold
// a road at the same time.
type Ship struct {
	ID    int             `json:"id"`
	Owner engine.PlayerID `json:"owner"`
	E     board.Edge      `json:"e"`
	Hold  Cargo           `json:"hold"`
	// Used is the movement points spent this turn, Bonus the +2 bought with
	// wool, and Done marks a ship whose movement is over (it revealed a hex, or
	// its owner moved on to another ship; movement is not interleaved). All
	// three clear at turn start.
	Used  int  `json:"used,omitempty"`
	Bonus int  `json:"bonus,omitempty"`
	Done  bool `json:"done,omitempty"`
	// Moved records that this ship has moved at least once this turn, which is
	// what disqualifies it from a pirate chase (a chase is made by a
	// battle-ready ship, and battle-ready means it has not moved yet).
	Moved bool `json:"moved,omitempty"`
	// Fought records that this ship has already rolled at a pirate this turn.
	// A ship that rolled may still move afterwards, successfully or not; what it
	// may not do is roll again at the same pirate.
	Fought bool `json:"fought,omitempty"`
	// Bow is the end of E the ship arrived at, which is the only record of
	// which way it points.
	//
	// Not a rule (an edge is an unordered pair), but the art has a bow and
	// stern. A move sets it to the endpoint the ship did not come through; a
	// ship that has never moved leaves it zero, and the renderer falls back to
	// the edge's axis.
	Bow board.Vertex `json:"bow,omitzero"`
}

// Build costs. There are no cities and no development cards, so this is the
// whole price list. Road and settlement keep the base costs (engine.CostRoad,
// engine.CostSettlement) and are built with the base commands.
var (
	CostHarbour = engine.Hand{board.Wheat: 2, board.Ore: 2}
	CostShip    = engine.Hand{board.Wood: 1, board.Sheep: 1}
	CostSettler = engine.Hand{board.Wood: 1, board.Brick: 1, board.Sheep: 1, board.Wheat: 1}
	CostCrew    = engine.Hand{board.Sheep: 1, board.Ore: 1}
)

// poolOf returns the pool entry for hex h, if h is a pool hex at all.
func poolOf(x *Ext, h board.Hex) (PoolHex, bool) {
	for _, p := range x.Pool {
		if p.H == h {
			return p, true
		}
	}
	return PoolHex{}, false
}

// regionOf is which region a pool hex belongs to; RegionNorth for anything not
// in the pool, which no caller reaches with a non-pool hex.
func regionOf(x *Ext, h board.Hex) int {
	if p, ok := poolOf(x, h); ok {
		return p.Region
	}
	return RegionNorth
}

// isFog reports whether h is a pool hex nobody has revealed yet.
func isFog(x *Ext, h board.Hex) bool {
	_, ok := poolOf(x, h)
	return ok && !x.Revealed[h]
}

// Seat is one player's Explorers-side state.
type Seat struct {
	Gold          int  `json:"gold"`
	ShipsLeft     int  `json:"ships_left"`
	SettlersLeft  int  `json:"settlers_left"`
	CrewsLeft     int  `json:"crews_left"`
	HarboursLeft  int  `json:"harbours_left"`
	PirateOnBoard bool `json:"pirate_on_board"`
	// Track is the seat's position on each mission track, 0 (the start space)
	// through TrackSpaces. Arrived is when the marker last entered that space,
	// on a monotonic clock, which settles the bonus tile: markers stack and the
	// first to arrive keeps it.
	Track   [TrackCount]int `json:"track"`
	Arrived [TrackCount]int `json:"-"`
	// Villages[v][region] records the crew this seat has landed on that copy of
	// village v. The advantages last the rest of the game and cannot be lost.
	Villages [VillageCount][RegionCount]bool `json:"villages"`
	// Per-turn counters, all cleared at turn start.
	GoldBuys int `json:"gold_buys,omitempty"`
	FastGold int `json:"fast_gold,omitempty"`
}

// Ext is the module's state, stored in State.Ext[Name].
//
// The JSON tags separate two halves. The layout half is derived from the board
// once, at creation, and recorded in EvBoardGenerated so later changes to the
// derivation do not rewrite played games (see engine.ExtBoardInitializer). The
// play half is json:"-": it is empty at creation, and its maps are
// struct-keyed, which encoding/json cannot marshal.
type Ext struct {
	// ---- layout ----------------------------------------------------------
	// Home is the home island's land hexes and Waters the one-hex ring of sea
	// around it, both sorted. Pool is everything else inside the rim: the
	// face-down hexes.
	Home   []board.Hex `json:"home"`
	Waters []board.Hex `json:"waters"`
	Pool   []PoolHex   `json:"pool"`
	// Chits is each region's face-down number-chit stack, drawn from the base
	// distribution with 2 and 12 removed, consumed from the front on reveal.
	Chits [][]int `json:"chits"`
	// Council is the home-waters hex the missions are delivered to, and Anchors
	// its two opposite berths. A ship docks when either of its ends is an anchor.
	Council board.Hex      `json:"council"`
	Anchors []board.Vertex `json:"anchors"`

	// ---- play ------------------------------------------------------------
	ChitsUsed []int              `json:"-"`
	Revealed  map[board.Hex]bool `json:"-"`
	// Harbours are the vertices carrying a harbour settlement, and Basins what
	// each basin holds. A harbour settlement is a base settlement in
	// State.Buildings; this set marks it as a harbour.
	Harbours map[board.Vertex]engine.PlayerID `json:"-"`
	Basins   map[board.Vertex]Cargo           `json:"-"`
	Ships    map[int]Ship                     `json:"-"`
	NextShip int                              `json:"-"`
	// LairCrew is the crews standing on each uncaptured lair, per seat, and
	// Captured the lairs that have fallen.
	LairCrew map[board.Hex][]int `json:"-"`
	Captured map[board.Hex]bool  `json:"-"`
	// FarmCrew and FarmSack record, per seat, the one crew it has landed on a
	// spice farm and the one sack it has taken. Both are once per player per
	// farm for the whole game.
	FarmCrew map[board.Hex][]bool `json:"-"`
	FarmSack map[board.Hex][]bool `json:"-"`
	// Hauls are the shoals carrying a fish haul, and HaulsLeft the supply.
	Hauls     map[board.Hex]bool `json:"-"`
	HaulsLeft int                `json:"-"`
	Seats     []Seat             `json:"-"`
	// The pirate ship: at most one stands on the board at a time, whoever it
	// belongs to. PiratePending is the activation a 7 (or a won chase) owes.
	Pirate        board.Hex       `json:"-"`
	PirateOwner   engine.PlayerID `json:"-"`
	HasPirate     bool            `json:"-"`
	PiratePending bool            `json:"-"`
	PirateBy      engine.PlayerID `json:"-"`
	// Chased and Vacated carry the hex a won chase just drove a pirate ship
	// off, which the winner's own activation may not retake: the chase
	// activates the pirate as on a 7, and on a 7 the displaced ship's hex is
	// closed to its replacement.
	Chased  bool      `json:"-"`
	Vacated board.Hex `json:"-"`
	// Tribute records which ships have already paid this turn.
	Tribute map[int]bool `json:"-"`
	// Movement is whether the active turn has entered its Movement phase, after
	// which no building or trading is allowed. FishRolled caps the fishing die
	// at one per Movement phase.
	Movement   bool `json:"-"`
	FishRolled bool `json:"-"`
	// Clock stamps marker arrivals so the bonus tile can be settled by who got
	// to the leading space first.
	Clock int `json:"-"`
	// Setup is the three-round draft this module owns: round 0 in turn order,
	// round 1 in reverse, round 2 a road and a settler-loaded ship in turn
	// order. Rounds 0 and 1 place a harbour settlement then a settlement, or
	// with Knights a city then a harbour settlement (harbourRound). At 3 the
	// draft is over and the module flips to PhasePlay.
	Round int `json:"-"`
}

// CloneExt deep-copies the module state for Decide, which runs the rules
// against a copy.
//
// It starts from a shallow struct copy so every value field carries over, then
// replaces every reference field so a speculative write cannot reach the live
// game. ruletest.TestCloneExtCarriesEveryField checks this by reflection.
func (x *Ext) CloneExt() engine.Extension {
	c := *x
	c.Home = slices.Clone(x.Home)
	c.Waters = slices.Clone(x.Waters)
	c.Pool = slices.Clone(x.Pool)
	c.Chits = make([][]int, len(x.Chits))
	for i, st := range x.Chits {
		c.Chits[i] = slices.Clone(st)
	}
	c.Anchors = slices.Clone(x.Anchors)
	c.ChitsUsed = slices.Clone(x.ChitsUsed)
	c.Revealed = maps.Clone(x.Revealed)
	c.Harbours = maps.Clone(x.Harbours)
	c.Basins = maps.Clone(x.Basins)
	c.Ships = maps.Clone(x.Ships)
	c.Captured = maps.Clone(x.Captured)
	c.Hauls = maps.Clone(x.Hauls)
	c.Tribute = maps.Clone(x.Tribute)
	c.Seats = slices.Clone(x.Seats)
	// Maps of slices: cloning the outer map alone would leave every hex's
	// per-seat row shared.
	c.LairCrew = cloneRows(x.LairCrew, slices.Clone[[]int])
	c.FarmCrew = cloneRows(x.FarmCrew, slices.Clone[[]bool])
	c.FarmSack = cloneRows(x.FarmSack, slices.Clone[[]bool])
	return &c
}

func cloneRows[T any](m map[board.Hex][]T, cl func([]T) []T) map[board.Hex][]T {
	if m == nil {
		return nil
	}
	out := make(map[board.Hex][]T, len(m))
	for k, v := range m {
		out[k] = cl(v)
	}
	return out
}

// RestoreExt reallocates the maps the fold writes to after a snapshot decode
// left them nil (see engine.ExtRestorer).
//
// It fills in only what is missing: events after the snapshot replay onto this
// state, so replacing a decoded map would lose data.
func (x *Ext) RestoreExt() {
	if x.Revealed == nil {
		x.Revealed = map[board.Hex]bool{}
	}
	if x.Harbours == nil {
		x.Harbours = map[board.Vertex]engine.PlayerID{}
	}
	if x.Basins == nil {
		x.Basins = map[board.Vertex]Cargo{}
	}
	if x.Ships == nil {
		x.Ships = map[int]Ship{}
	}
	if x.LairCrew == nil {
		x.LairCrew = map[board.Hex][]int{}
	}
	if x.Captured == nil {
		x.Captured = map[board.Hex]bool{}
	}
	if x.FarmCrew == nil {
		x.FarmCrew = map[board.Hex][]bool{}
	}
	if x.FarmSack == nil {
		x.FarmSack = map[board.Hex][]bool{}
	}
	if x.Hauls == nil {
		x.Hauls = map[board.Hex]bool{}
	}
	if x.Tribute == nil {
		x.Tribute = map[int]bool{}
	}
}

// freshExt is the module's state at game creation, before the board exists.
func freshExt(players int) *Ext {
	e := &Ext{
		Revealed:    map[board.Hex]bool{},
		Harbours:    map[board.Vertex]engine.PlayerID{},
		Basins:      map[board.Vertex]Cargo{},
		Ships:       map[int]Ship{},
		LairCrew:    map[board.Hex][]int{},
		Captured:    map[board.Hex]bool{},
		FarmCrew:    map[board.Hex][]bool{},
		FarmSack:    map[board.Hex][]bool{},
		Hauls:       map[board.Hex]bool{},
		Tribute:     map[int]bool{},
		ChitsUsed:   make([]int, RegionCount),
		Chits:       make([][]int, RegionCount),
		HaulsLeft:   players + 2,
		PirateOwner: engine.NoPlayer,
		PirateBy:    engine.NoPlayer,
		NextShip:    1,
	}
	e.Seats = make([]Seat, players)
	for i := range e.Seats {
		e.Seats[i] = Seat{
			Gold:         StartingGold,
			ShipsLeft:    MaxShips,
			SettlersLeft: MaxSettlers,
			CrewsLeft:    MaxCrews,
			HarboursLeft: MaxHarbours,
		}
	}
	return e
}

// ext fetches (or creates and stores) the module state. Only the fold path
// (Apply) and tests may call this: storing from Decide or a hook would mutate
// state outside the event log.
func ext(s *engine.State) *Ext {
	if e, ok := s.Ext[Name].(*Ext); ok {
		return e
	}
	e := freshExt(len(s.Players))
	if s.Ext == nil {
		s.Ext = map[string]engine.Extension{}
	}
	s.Ext[Name] = e
	return e
}

// extRO is the read-only accessor for Decide and the hooks: existing state, or a
// throwaway zero value that is never stored.
func extRO(s *engine.State) *Ext {
	if e, ok := s.Ext[Name].(*Ext); ok {
		return e
	}
	return freshExt(len(s.Players))
}

// StateExt returns the module's state for s and whether Explorers is active.
// Read-only: callers outside the fold path must not mutate it.
func StateExt(s *engine.State) (*Ext, bool) {
	e, ok := s.Ext[Name].(*Ext)
	return e, ok
}

// Module is the Explorers plug-in.
type Module struct{}

func (Module) Name() string { return Name }

// Standalone marks the ruleset as its own whole game: `explorers`, never
// `base+explorers`. See docs/rules/explorers.md's compatibility table and
// engine/compat.go, which carries one refusal per partner with its own reason.
func (Module) Standalone() {}

// StandaloneCompanions names the one module this scenario plays beside: Knights,
// through its own combination rules. `cak+explorers` is a real ruleset;
// everything else is refused by engine.Conflicts with a reason of its own, and
// `base+explorers` stays refused whatever this returns.
//
// The rules live in "Knights in an Explorers game" (docs/rules/explorers.md) and
// the seams are marked in this package with `// cak+explorers:` comments.
func (Module) StandaloneCompanions() []string { return []string{knightsName} }

// knightsName is the Knights module's registered name. A literal rather than an
// import of engine/knights, so the pairing's two halves do not depend on each other
// to link. TestExplorersCompanionIsRegistered pins it against the registry.
const knightsName = "cak"

// withKnightsRuleset is WithKnights for a ruleset string, which is all the board
// pass has: SetupBoardSeeded runs before any State exists.
func withKnightsRuleset(ruleset string) bool {
	return slices.Contains(strings.Split(ruleset, "+"), knightsName)
}

// WithKnights reports whether this game is the Knights pairing.
//
// Every rule the pairing changes is guarded on it, so a plain `explorers` game
// has no city, no commodity, no event die and plays to 17. Use it rather than
// testing s.Config.Ruleset by hand.
func WithKnights(s *engine.State) bool {
	for _, m := range s.Modules() {
		if m.Name() == knightsName {
			return true
		}
	}
	return false
}

// DefaultConfig sets the scenario's own target. 17 at every player count.
func (Module) DefaultConfig(cfg engine.GameConfig) engine.GameConfig {
	if cfg.TargetVP == 0 {
		cfg.TargetVP = TargetVP
	}
	return cfg
}

// MaxVPWithoutCards reports how far above the base ceiling a single Explorers
// player can reach, which engine.MaxVPWithoutCards adds.
//
// The base ceiling is 13 (four cities, one settlement, both special cards).
// Explorers reaches 25: a harbour settlement returns its settlement piece, so
// five settlements and four harbour settlements can stand at once (5 + 8 = 13
// VP), plus three mission markers on space 7 (9) and all three bonus tiles (3).
// The delta is 12.
//
// Without it the lobby would refuse the game, since 17 exceeds the base 13.
func (Module) MaxVPWithoutCards(engine.GameConfig) int {
	const explorersMaxVP = MaxSettlements*1 + MaxHarbours*(1+HarbourVP) +
		TrackCount*3 /*a marker on space 7*/ + TrackCount*BonusTileVP
	const baseCeiling = 13
	return explorersMaxVP - baseCeiling
}

// BoardRadius: the home island, a ring of home waters, a large unexplored pool
// and open sea do not fit inside the radius the player count would imply.
func (Module) BoardRadius(players int) int { return board.RadiusFor(players) + 3 }

// InitExt seeds per-seat state at EvGameCreated, one event before the board
// exists, so the opening 2 gold and supply counts are visible from the start
// rather than appearing partway through turn one.
func (Module) InitExt(cfg engine.GameConfig) engine.Extension { return freshExt(cfg.Players) }

func init() {
	engine.RegisterModule(Name, func() engine.Module { return Module{} })
	gob.Register(&Ext{})
}
