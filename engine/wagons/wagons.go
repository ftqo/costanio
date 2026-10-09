// Package wagons implements the Wagons scenario: a trade-route game in which
// every player owns one wagon that hauls cargo around the road network between
// three trade hexes, paying road tolls in gold, working around barbarians who
// squat on paths, and scoring a victory point for every load delivered.
//
// It replaces base-game fixtures rather than adding to them: no robber, a
// different development deck, and no Longest Road award. The spec is
// docs/rules/wagons.md.
//
// What a wagon hauls is "cargo", not "commodities", which Knights already uses.
// Knights' coin and this scenario's gold are unrelated.
package wagons

import (
	"encoding/gob"
	"encoding/json"
	"math/rand/v2"
	"slices"
	"strings"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// WagonsName is the ruleset part this module answers to.
const WagonsName = "wagons"

// Command types. Every one is refused unless it is this seat's own play turn
// with the interrupts clear; see the decide functions.
const (
	// CmdMove drives the wagon one path along, paying that path in full.
	CmdMove engine.CommandType = "wagons_move"
	// CmdHalt ends the movement action, and when no action has been opened this
	// turn it is the decline that lets the turn end.
	CmdHalt engine.CommandType = "wagons_halt"
	// CmdBoost spends 1 grain (or 2 fish under Fishermen) for +2 MP, once per
	// movement action (so twice in a turn with a Swift Journey), allowed after
	// the allowance is already spent.
	CmdBoost engine.CommandType = "wagons_boost"
	// CmdCharge attempts to drive a barbarian off, one die against the level's
	// range, once per barbarian per turn.
	CmdCharge engine.CommandType = "wagons_charge"
	// CmdBarbarian places a barbarian the player owes: after a 7, after a
	// Knight, or after a successful drive-off.
	CmdBarbarian engine.CommandType = "wagons_barbarian"
	// CmdUpgrade buys the next level on the wagon's track.
	CmdUpgrade engine.CommandType = "wagons_upgrade"
	// CmdBuy takes a resource from the bank for 2 gold, twice per turn.
	CmdBuy engine.CommandType = "wagons_buy"
	// CmdSell is maritime trade paid out in gold, at the seat's port rate.
	CmdSell engine.CommandType = "wagons_sell"
	// CmdSwift plays a Swift Journey: a second movement action this turn.
	CmdSwift engine.CommandType = "wagons_swift"
)

// Event types. All public; see drawSwift for the Swift Journey purchase.
const (
	EvStart       engine.EventType = "wagons_started"
	EvTurn        engine.EventType = "wagons_turn"
	EvMoved       engine.EventType = "wagons_moved"
	EvHalted      engine.EventType = "wagons_halted"
	EvBoosted     engine.EventType = "wagons_boosted"
	EvCharged     engine.EventType = "wagons_charged"
	EvBarbPending engine.EventType = "wagons_barbarian_owed"
	EvBarbMoved   engine.EventType = "wagons_barbarian_moved"
	EvLoaded      engine.EventType = "wagons_loaded"
	EvDelivered   engine.EventType = "wagons_delivered"
	EvUpgraded    engine.EventType = "wagons_upgraded"
	EvBought      engine.EventType = "wagons_bought"
	EvSold        engine.EventType = "wagons_sold"
	EvGoldMoved   engine.EventType = "wagons_gold_moved"
	EvSwiftBought engine.EventType = "wagons_swift_bought"
	EvSwiftPlayed engine.EventType = "wagons_swift_played"
)

// The three trade-hex roles.
const (
	RoleCastle uint8 = iota
	RoleQuarry
	RoleGlassworks
)

// The four cargoes. CargoNone is "the wagon is empty", not a token.
const (
	CargoNone uint8 = iota
	CargoMarble
	CargoGlass
	CargoSand
	CargoTools
)

// accepts and ships are the cargo cycle. No trade hex ships a cargo it also
// accepts, so a load always sends the wagon elsewhere. See
// TestCargoCycleNeverShipsWhatItAccepts.
var accepts = [tradeHexCount][]uint8{
	RoleCastle:     {CargoMarble, CargoGlass},
	RoleQuarry:     {CargoTools},
	RoleGlassworks: {CargoSand},
}

// acceptsOf and shipsOf are the bounds-checked reads of those two tables.
//
// A role can come from an untrusted ext blob (POST /api/replay/frames) or an
// old snapshot, and an out-of-range index would panic in a view render.
func acceptsOf(role uint8) []uint8 {
	if int(role) >= tradeHexCount {
		return nil
	}
	return accepts[role]
}

func shipsOf(role uint8) [2]uint8 {
	if int(role) >= tradeHexCount {
		return [2]uint8{CargoNone, CargoNone}
	}
	return ships[role]
}

var ships = [tradeHexCount][2]uint8{
	RoleCastle:     {CargoTools, CargoSand},
	RoleQuarry:     {CargoMarble, CargoSand},
	RoleGlassworks: {CargoGlass, CargoTools},
}

// stackDepth is a cargo stack: 6 of each of the two cargoes its hex ships,
// drawn without replacement and refilled with a fresh shuffled 6-and-6 when it
// empties. See docs/rules/wagons.md for why refilling rather than exhausting.
const (
	perCargo   = 6
	stackDepth = perCargo * 2
)

// The movement-point track, at radius 2. Levels are 1..5, so index by level-1.
//
// Decision: the allowance scales with the board, +2 per ring beyond radius 2,
// because larger boards (radius 3 at 5-6 players, 4 at 7-10) lengthen the
// circuit between trade hexes. Gold values, die ranges and upgrade costs do not
// scale.
var mpTrack = [5]int{4, 5, 6, 7, 7}

const (
	maxLevel = 5
	// levelVP is the one point on the track: reaching level 5 is worth 1 VP,
	// levels 1 to 4 none.
	levelVP = 1
	// boostMP is what one grain (or two fish) buys, once per movement action.
	boostMP = 2
	// goldPerResource is the bank price of a resource in gold, and buysPerTurn
	// is how often.
	goldPerResource = 2
	buysPerTurn     = 2
	// tollPerRoad is what crossing an opponent's road pays its owner.
	tollPerRoad = 1
	// barbarianMP is the extra a barbarian on the path costs.
	barbarianMP = 2
	// bareMP / roadMP are the two path prices before a barbarian.
	bareMP = 2
	roadMP = 1
)

// startGold is 5, or 3 alongside Rivers, which re-prices gold across both
// scenarios (river placements pay, bridges cost, crossings cost).
const (
	startGold       = 5
	startGoldRivers = 3
)

// upgradeCost is what the next level costs, indexed by the current level
// (1..4). The four upgrades are 1/1/2/2 lumber, each with 1 wool and 1 ore.
func upgradeCost(level int) engine.Hand {
	lumber := 1
	if level >= 3 {
		lumber = 2
	}
	return engine.Hand{board.Wood: lumber, board.Sheep: 1, board.Ore: 1}
}

// driveOffFloor is the lowest die that drives a barbarian off at this level: 6
// at level 2, 5 at level 3, 4 at level 4, 3 at level 5. Level 1 cannot attempt
// at all, which the caller checks; this returns 7 for it, a roll no die makes.
func driveOffFloor(level int) int {
	if level < 2 {
		return 7
	}
	return 8 - level
}

// The victory target. 13 is this scenario's own number, written by
// DefaultConfig. The rest of the compatibility table:
//
//   - Knights: 15, a rule of the pair. Knights writes its own target first
//     ("cak" sorts before "wagons"), so AdjustTargetVP lifts it.
//   - Raiders: 14, also a rule of the pair (Raiders alone is 12). Raiders has no
//     adjuster, so AdjustTargetVP lifts this too. With both peers, Knights' 15
//     wins.
//   - Caravans: 15 by summation; Caravans adds 2 through its own adjuster.
//   - Harbormaster: 14, 13 plus that module's own +1.
//   - Fishermen and Rivers: 13. Fishermen's old boot still adds 1 to its
//     holder's threshold through WinThresholdDelta.
const (
	targetBase        = 13
	targetKnights     = 15
	targetRaidersPair = 14
)

const (
	knightsName      = "cak"
	caravansName     = "caravans"
	fishermenName    = "fishermen"
	riversName       = "rivers"
	raidersName      = "raiders"
	harbormasterName = "harbormaster"
)

// rulesetHas reports whether the ruleset string names a module. The names are
// string constants so modules do not import each other; TestModuleNamesMatch
// pins them.
func rulesetHas(ruleset, name string) bool {
	return slices.Contains(strings.Split(ruleset, "+"), name)
}

// pairingTarget reports the target a pairing this module owns is played to, and
// whether this is one of them. See the constants above.
//
// Knights first: a ruleset with both peers takes the higher, more specific row.
func pairingTarget(ruleset string) (int, bool) {
	switch {
	case rulesetHas(ruleset, knightsName):
		return targetKnights, true
	case rulesetHas(ruleset, raidersName):
		return targetRaidersPair, true
	}
	return 0, false
}

// WagonsExt is this module's state. The first block is derived from the board
// and recorded in EvBoardGenerated (see engine.ExtBoardInitializer); a fold
// reads the recorded blob, so changing the derivation affects only new games.
// verify/ re-derives and diffs it.
type WagonsExt struct {
	// --- board-derived ---
	Trade      [tradeHexCount]board.Hex  // the three trade hexes, in board order
	Roles      [tradeHexCount]uint8      // castle / quarry / glassworks, per hex
	HasTrade   bool                      // false only on a board with no cape triple
	Barbarians [tradeHexCount]board.Edge // where the three barbarians start

	// --- live ---
	SharedCurrency bool                      // recorded by new start events; old replays retain separate purses
	Barb           [tradeHexCount]board.Edge // where they stand now
	Started        bool                      // the wagons are on the board and the gold is dealt
	Gold           []int                     // per seat; a count, never cards
	Level          []int                     // per seat, 1..5
	Wagon          []board.Vertex            // per seat
	// OnBoard says whether that seat's wagon is on an intersection at all. It
	// is a flag because board.Vertex{} ({0,0,N}, the top corner of the centre
	// hex) is an ordinary intersection a setup city can occupy.
	OnBoard []bool
	Cargo   []uint8 // per seat; CargoNone when empty
	Landed  []int   // per seat: delivered tokens, 1 VP each

	// MPBonus is what the board adds to every entry of the movement track (+2
	// per ring past radius 2, see allowance). Set by the EvStart fold so the
	// view can publish the scaled track; allowance itself reads the board.
	MPBonus int

	// Drawn and Refill are the cargo stacks, kept as counters. The hidden stack
	// order is a pure function of the private seed and these two numbers (see
	// stackOrder), so it is never stored.
	Drawn  [tradeHexCount]int
	Refill [tradeHexCount]int

	// The Swift Journey deck. Held/New mirror the base deck's playable/locked
	// split: a card bought this turn cannot be played this turn.
	SwiftLeft int
	Swift     []int
	SwiftNew  []int

	// --- per turn, reset by EvTurn ---
	TurnSeat  engine.PlayerID // whose turn the fields below describe
	MoveOpen  bool            // a movement action is in progress
	MoveDone  bool            // the seat has moved or declined; the turn may end
	Moved     bool            // the wagon has actually travelled a path this turn
	MP        int             // movement points left in the open action
	Boosted   bool            // this movement action's grain (or fish) has been spent
	Tried     [tradeHexCount]bool
	PathTried []bool
	Bought    int  // gold-for-resource purchases made this turn
	Swifted   bool // a Swift Journey has been played this turn

	// --- the one interrupt ---
	BarbSeat  engine.PlayerID // owes a barbarian move, or NoPlayer
	BarbIdx   int             // which of the three
	BarbSteal bool            // whether landing on a road steals a card
}

// CloneExt deep-copies the module state for Decide. A shallow struct copy
// carries the value fields and arrays; each slice gets its own backing store.
// engine/ruletest.TestCloneExtCarriesEveryField checks every field.
func (e *WagonsExt) CloneExt() engine.Extension {
	c := *e
	c.PathTried = slices.Clone(e.PathTried)
	c.Gold = slices.Clone(e.Gold)
	c.Level = slices.Clone(e.Level)
	c.Wagon = slices.Clone(e.Wagon)
	c.OnBoard = slices.Clone(e.OnBoard)
	c.Cargo = slices.Clone(e.Cargo)
	c.Landed = slices.Clone(e.Landed)
	c.Swift = slices.Clone(e.Swift)
	c.SwiftNew = slices.Clone(e.SwiftNew)
	return &c
}

// RestoreExt is a no-op. The ext has no maps, and a per-seat slice that gob
// decodes as nil is sized by ensureSeats on the fold path, where the seat
// count is known.
func (e *WagonsExt) RestoreExt() {
}

// ensureSeats sizes the per-seat slices. It is idempotent and never shrinks, so
// it is safe on every fold and safe after a snapshot decode dropped a nil slice.
func (e *WagonsExt) ensureSeats(n int) {
	grow := func(s []int) []int {
		for len(s) < n {
			s = append(s, 0)
		}
		return s
	}
	e.Gold = grow(e.Gold)
	e.Landed = grow(e.Landed)
	e.Swift = grow(e.Swift)
	e.SwiftNew = grow(e.SwiftNew)
	e.Level = grow(e.Level)
	for i := range e.Level {
		if e.Level[i] == 0 {
			e.Level[i] = 1
		}
	}
	for len(e.Cargo) < n {
		e.Cargo = append(e.Cargo, CargoNone)
	}
	for len(e.Wagon) < n {
		e.Wagon = append(e.Wagon, board.Vertex{})
	}
	for len(e.OnBoard) < n {
		e.OnBoard = append(e.OnBoard, false)
	}
}

// StateExt returns the module's ext state for s and whether Wagons is active.
// Callers outside the fold path must not mutate the returned value.
func StateExt(s *engine.State) (*WagonsExt, bool) {
	e, ok := s.Ext[WagonsName].(*WagonsExt)
	return e, ok
}

func hasWagons(s *engine.State) bool {
	for _, m := range s.Modules() {
		if m.Name() == WagonsName {
			return true
		}
	}
	return false
}

// ext is the fold-path accessor: it creates the ext if the fold has not yet.
func ext(s *engine.State) *WagonsExt {
	if e, ok := s.Ext[WagonsName].(*WagonsExt); ok {
		e.ensureSeats(len(s.Players))
		return e
	}
	e := fresh(s)
	if s.Ext == nil {
		s.Ext = map[string]engine.Extension{}
	}
	s.Ext[WagonsName] = e
	return e
}

// extRO is the read-only accessor every hook uses. It derives without storing
// when the fold has not created the ext yet, as between game_created and
// board_generated in a replay.
func extRO(s *engine.State) *WagonsExt {
	if e, ok := s.Ext[WagonsName].(*WagonsExt); ok {
		return e
	}
	return fresh(s)
}

// fresh derives the module's opening state. Pure in (players, board, public
// seed), which is what lets InitExtBoard record it and a fold reproduce it.
func fresh(s *engine.State) *WagonsExt {
	e := &WagonsExt{
		TurnSeat: engine.NoPlayer,
		BarbSeat: engine.NoPlayer,
		BarbIdx:  -1,
	}
	e.ensureSeats(len(s.Players))
	e.SwiftLeft = swiftDeckFor(s.Config.Ruleset, len(s.Players))
	if s.Board == nil {
		return e
	}
	rng := engine.PublicRngForSeed(s.PublicSeed, engine.WagonsBoardSeq)
	capes := capeHexes(s.Board)
	capes = slices.DeleteFunc(capes, func(h board.Hex) bool { return !engine.TradeHexAllowed(s, h) })
	hexes, roles, ok := deriveTrade(capes, rng)
	if !ok {
		// No cape triple: every hook keys off HasTrade, so the module goes
		// inert. sim.TestWagonsAlwaysHasTradeHexes checks generated boards
		// always have one.
		return e
	}
	e.Trade, e.Roles, e.HasTrade = hexes, roles, true
	e.Barbarians = deriveBarbarians(s.Board, hexes, func(edge board.Edge) bool {
		return blockedEdgeOn(s.Board, hexes, edge)
	})
	e.Barb = e.Barbarians
	return e
}

// blockedEdgeOn reports whether an edge is one of a trade hex's three seaward
// edges: no road may stand there, no wagon may cross it, and no barbarian may
// make its home on it.
func blockedEdgeOn(b *board.Board, hexes [tradeHexCount]board.Hex, e board.Edge) bool {
	for _, h := range hexes {
		if slices.Contains(seawardEdges(b, h), e) {
			return true
		}
	}
	return false
}

// Wagons is the module.
type Wagons struct{}

func (Wagons) Name() string { return WagonsName }

// ReservedHexes claims every cape this module could make a trade hex. Rivers
// reads it (engine.HexReserver) and routes around these, so no trade hex sits
// on a river and no candidate triple is lost.
//
// It returns every cape (the first maxCapes in board order, all deriveTrade
// considers) because the pick needs this module's reserved stream. It depends
// only on the land mask, which nothing compatible with Wagons reshapes.
func (Wagons) ReservedHexes(b *board.Board) []board.Hex {
	capes := capeHexes(b)
	if len(capes) > maxCapes {
		capes = capes[:maxCapes]
	}
	return capes
}

// InitExtBoard seeds the module state as soon as the board exists, so the trade
// hexes and barbarians are in every view from the first frame and the
// derivation is recorded. Not InitExt, because s.Board is still nil there.
func (Wagons) InitExtBoard(s *engine.State) engine.Extension { return fresh(s) }

// SetupBoard takes the robber off the board and leaves it off.
//
// board.OffBoard is outside every board, so every robber-hex check answers no.
// NoRobber stops a 7 from setting RobberPending.
//
// The trade hexes are not claimed here: SetupBoard has nowhere to record them,
// and they change no tile. InitExtBoard records them instead.
func (Wagons) SetupBoard(b *board.Board, cfg engine.GameConfig, rng *rand.Rand) {
	b.Robber = board.OffBoard
}

// DefaultConfig writes this scenario's own target, 13, when nothing else has.
func (Wagons) DefaultConfig(cfg engine.GameConfig) engine.GameConfig {
	if cfg.TargetVP == 0 {
		cfg.TargetVP = targetBase
	}
	return cfg
}

// AdjustTargetVP lifts the ruleset default to the pairing's own number: 15
// alongside Knights, 14 alongside Raiders.
//
// It is an adjuster because DefaultConfig is first-writer-wins in name order
// and both peers sort before "wagons". It returns the difference from what
// they wrote.
//
// Caravans and Harbormaster add their own points through their adjusters, so
// they are not lifted here.
func (Wagons) AdjustTargetVP(cfg engine.GameConfig) int {
	if want, ok := pairingTarget(cfg.Ruleset); ok {
		return want - cfg.TargetVP
	}
	return 0
}

// swiftDeckFor is the Swift Journey supply: 3, flat across brackets, matching
// the base deck's 2 of each progress card staying at 2. See devDeck.
//
// Zero alongside Knights, per the pairing's rule: "Knights already deletes the
// development deck, so this scenario's deck is not used either: no Swift
// Journey, no Largest Army, and progress cards do the work."
func swiftDeckFor(ruleset string, _ int) int {
	if rulesetHas(ruleset, knightsName) || rulesetHas(ruleset, "raiders") {
		return 0
	}
	return 3
}

// devDeck is this scenario's deck: 16 Knight, 3 Road Building, 3 Victory Point
// and 3 Swift Journey, with no Year of Plenty and no Monopoly. The knights and
// the VP cards scale per player bracket exactly as the base deck's do (+6 and
// +3 an extension); the three Swift Journeys sit outside this array, in the
// module's own supply, and are shuffled into the same draw. See
// engine.Hooks.ExtraDevCards.
func devDeck(players int) engine.DevHand {
	b := engine.ScaleBracket(players)
	var d engine.DevHand
	d[engine.DevKnight] = 16 + 6*b
	d[engine.DevVictoryPoint] = 3 + 3*b
	d[engine.DevRoadBuilding] = 3
	return d
}

// MaxVPWithoutCards is this scenario's change to the winnable ceiling, which the
// lobby uses to refuse a target nobody could reach without drawing a victory
// point card.
//
//   - Minus two for the Longest Road award, which is not in play.
//   - Plus one for reaching level 5 on the wagon track.
//   - Plus twelve for delivered cargo tokens. Stacks refill, so deliveries are
//     unbounded; twelve (one stack) is enough to keep every target the scenario
//     names, at most 15, reachable.
func (Wagons) MaxVPWithoutCards(engine.GameConfig) int {
	return -2 + levelVP + stackDepth
}

func (m Wagons) Hooks() engine.Hooks {
	return engine.Hooks{
		OnEvents:           m.onEvents,
		OnSeven:            m.onSeven,
		Blocks:             m.blocks,
		BlocksTurnActions:  m.blocksTurnActions,
		BlocksBuildTrade:   m.blocksBuildTrade,
		Auto:               m.auto,
		PendingDeciders:    m.pendingDeciders,
		PendingTargets:     m.pendingTargets,
		LegalExtras:        m.legalExtras,
		FreeWagonBoost:     m.freeBoost,
		EdgeBlockerTargets: m.edgeBlockerTargets,
		ChaseEdgeBlocker:   m.chaseEdgeBlocker,
		VictoryCheck:       m.victory,
		SetupRound2City:    true,
		OccupiesEdge:       occupiesEdge,
		BlocksVertex:       blocksVertex,
		NoRobber:           func(*engine.State) bool { return true },
		RobberNeverInPlay:  true,
		NoLongestRoad:      true,
		DevDeck:            func(players int) (engine.DevHand, bool) { return devDeck(players), true },
		ExtraDevCards:      m.extraDevCards,
		DrawExtraDevCard:   m.drawSwift,
		TradeExtraHeld:     m.tradeExtraHeld,
		TradeExtraEvents:   m.tradeExtraEvents,
	}
}

// victory: 1 VP per delivered cargo token, plus 1 for reaching level 5. Gold is
// never a victory point, and the Longest Road award is not in play (see
// Hooks.NoLongestRoad).
func (Wagons) victory(s *engine.State, p engine.PlayerID) int {
	x := extRO(s)
	if int(p) >= len(x.Landed) {
		return 0
	}
	vp := x.Landed[p]
	if x.Level[p] >= maxLevel {
		vp += levelVP
	}
	return vp
}

func init() {
	engine.RegisterModule(WagonsName, func() engine.Module { return Wagons{} })
	gob.Register(&WagonsExt{})

	// No redactor for EvSwiftBought: the event is public. See drawSwift.
}

// raw marshals a command payload for Auto.
func raw(v any) json.RawMessage {
	b, _ := json.Marshal(v)
	return b
}
