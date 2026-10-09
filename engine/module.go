package engine

import (
	"encoding/json"
	"errors"
	"fmt"
	"math/rand/v2"
	"slices"
	"sort"
	"strings"
	"sync"

	"github.com/ftqo/costan.io/engine/board"
)

// Exported helpers for module packages (they live outside package engine).

// NewEvent builds a module event; Visible works like for base events.
func NewEvent(typ EventType, data any, visible ...PlayerID) Event {
	return mustEvent(typ, data, visible...)
}

// DecodeEvent unpacks a trusted module event payload (panics on corrupt logs,
// matching base-event semantics).
func DecodeEvent[T any](e Event) T { return decode[T](e) }

// DecodeEventChecked is DecodeEvent for a fold that wants a corrupt payload as
// an error rather than a panic: a module Apply returns it, and the game layer
// turns it into paused-error with the log preserved (see ErrMalformedEvent).
func DecodeEventChecked[T any](e Event) (T, error) {
	if e.Payload != nil {
		if v, ok := e.Payload.(T); ok {
			return v, nil
		}
	}
	var v T
	if err := json.Unmarshal(e.Data, &v); err != nil {
		return v, fmt.Errorf("%w: %s at seq %d: %w", ErrMalformedEvent, e.Type, e.Seq, err)
	}
	return v, nil
}

// ErrMalformedEvent is what a fold returns for an event it cannot apply without
// indexing outside its state: a seat that does not exist, a trade-hex index
// past the three there are, a payload that does not parse. This server never
// writes such an event, so it means a corrupt or foreign log, and the game
// layer freezes the game. Wrapped with the event type, seq and the field at
// fault.
var ErrMalformedEvent = errors.New("engine: malformed event")

// MalformedEvent builds the error a fold returns for a field out of range.
func MalformedEvent(e Event, format string, args ...any) error {
	return fmt.Errorf("%w: %s at seq %d: %s", ErrMalformedEvent, e.Type, e.Seq, fmt.Sprintf(format, args...))
}

// DecodeCommand parses untrusted module command payloads.
func DecodeCommand[T any](data json.RawMessage) (T, error) { return decodeCmd[T](data) }

// RequireActionableTurn exposes the standard "your turn, rolled, nothing
// pending" gate for module commands.
func RequireActionableTurn(s *State, p PlayerID) error { return requireActionableTurn(s, p) }

// RequireUninterruptedTurn is RequireActionableTurn without the roll
// requirement: p's own play turn with every interrupt (discards, robber, module
// pendings) cleared, but the dice not necessarily thrown yet.
//
// Road Building's free builds are exempt from the roll. decideBuild applies
// that exemption to CmdBuildRoad; a module piece the same card may pay for
// (Islands' ship) must use this same check rather than its own copy of the
// interrupt list.
func RequireUninterruptedTurn(s *State, p PlayerID) error { return requireUninterruptedTurn(s, p) }

// RngFor gives modules deterministic randomness from the private stream, tied
// to the log position the produced event will occupy (offset from s.NextSeq).
// Use it for anything whose outcome is hidden information: which card a steal
// took, which card a draw dealt.
//
// The offset must be the produced event's index in the batch (callers pass 0, 1
// or len(events)). rngFor is pure in (seed, seq), so two consumers reaching the
// same absolute seq share a stream; keying every draw to its event's log
// position keeps seqs unique because no two events share a position.
//
// A constant offset breaks this: RngFor(s, 100) is RngFor(s, 0) one hundred
// positions later, and offset 0 is baseAutoCommand's public setup pick
// (engine/auto.go). A draw not tied to one produced event takes a reserved
// negative run through RngForReserved and is registered below.
// TestPrivateSlotsDoNotCollide in seeds_test.go checks the two ranges are
// disjoint.
func RngFor(s *State, offset int) *rand.Rand { return rngFor(s.Seed, s.NextSeq+offset) }

// privateFishTilesSeqBase anchors the Fishermen fish-tile draw's reserved run
// on the private stream. See PrivateFishTilesSeq.
//
// The private stream is a different seed from the public one, so this base only
// has to avoid the other private consumer: RngFor's non-negative log-position
// range.
const privateFishTilesSeqBase = -1_000_000

// PrivateFishTilesSeq is the private stream slot for the Fishermen fish-tile
// draws made alongside the roll at log position nextSeq.
//
// The tiles a seat draws are hidden (they travel on a per-seat EvFishGained),
// so they use the private stream, and a reserved slot rather than a fixed
// offset (see RngFor). The run descends one slot per roll because a catch is
// resolved by an OnDiceRolled hook, so there is at most one per roll.
func PrivateFishTilesSeq(nextSeq int) int { return privateFishTilesSeqBase - nextSeq }

// privateWagonsStackSeqBase anchors the Wagons cargo stacks' reserved run on
// the private stream. See PrivateWagonsStackSeq.
//
// Two million below the fish tiles' base, which descends one slot per roll: a
// game would need a million rolls to reach it, and COSTAN_GAME_EVENT_CAP stops
// it long before.
const privateWagonsStackSeqBase = -3_000_000

// PrivateWagonsStackSeq is the private stream slot for the shuffle of trade hex
// `hex`'s cargo stack on its `refill`th filling.
//
// The stack order is the scenario's hidden information (the carried token is
// public), so it uses this stream. It is derived rather than recorded: a stack
// never written into an event cannot leak through redaction or a spectator's
// fold, and it is reproducible from the private seed plus two counters the fold
// already carries.
//
// Three stacks, each refilled every twelve draws, so refill*3+hex is unique per
// (hex, filling). Reserved rather than taken through RngFor because one stack
// answers many draws.
func PrivateWagonsStackSeq(hex, refill int) int {
	return privateWagonsStackSeqBase - (refill*3 + hex)
}

// RngForReserved is RngFor for a hidden draw that is not tied to the log
// position of the event it produces, so it needs a reserved slot (see RngFor).
// Callers pass a seq from a registered descending run, e.g.
// PrivateFishTilesSeq.
//
// It takes the State rather than a bare seed so that code outside the engine
// cannot derive hidden information from a number; PublicRngForSeed cannot reach
// the private stream either.
func RngForReserved(s *State, seq int) *rand.Rand { return rngFor(s.Seed, seq) }

// PublicRngFor is RngFor over the verifiable stream. Use it only where the
// outcome is public (the event die): the public seed is revealed at game end
// and verify/ re-derives every draw from it, so hidden information drawn from
// it would be published. See State.PublicSeed and docs/dice.md.
func PublicRngFor(s *State, offset int) *rand.Rand {
	return rngFor(s.PublicSeed, s.NextSeq+offset)
}

// ModuleDecider is one seat a module is awaiting input from, with how big a
// decision it is, so the timer layer can size a budget without knowing module
// rules.
type ModuleDecider struct {
	Seat PlayerID
	// Decision names the obligation with a stable id ("aqueduct",
	// "wedding_give", "defender_draw"), which the timer layer maps to a budget.
	//
	// Timer policy only: the id never reaches the event log. A module may emit
	// several entries for one seat; the timer layer keeps the longest budget.
	// An unknown id gets the default module budget, and a test asserts every id
	// a module can emit has an explicit cap.
	Decision string
}

// Module is the expansion plug-in contract (Islands, Knights, scenario modules).
// Modules add commands, fold their own events, intercept phases via hooks,
// and keep their state in State.Ext.
type Module interface {
	Name() string
	// SetupBoard customizes the generated board (sea hexes, fish, fog, ...)
	// with seeded randomness.
	SetupBoard(b *board.Board, cfg GameConfig, rng *rand.Rand)
	// Decide handles module commands. handled=false passes the command on.
	Decide(s *State, cmd Command) (events []Event, handled bool, err error)
	// Apply folds module events. handled=false passes the event on.
	Apply(s *State, e Event) (handled bool, err error)
	Hooks() Hooks
}

// Hooks are the points where modules intercept the base state machine. Any
// field may be nil.
type Hooks struct {
	// OnDiceRolled appends events after a roll (Knights event die, fish, gold).
	OnDiceRolled func(s *State, d1, d2 int) []Event
	// OnSeven runs when a 7 is rolled.
	OnSeven func(s *State) []Event
	// OnEvents reacts to a command's full event batch on the simulated
	// after-state (e.g. award an island VP chip when a settlement lands on a
	// new island). Returned events are appended to the batch.
	OnEvents func(after *State, events []Event) []Event
	// AfterEvents is a second event-reaction phase: it runs on the batch once
	// every module's OnEvents has run and been applied, and its returned events
	// are appended the same way.
	//
	// Hooks run in ruleset order, a lexicographic sort with no dependency
	// meaning (see CanonicalRuleset), so a module that re-derives a standing
	// from what other modules did needs a phase that runs after all of them.
	// Harbormaster re-derives harbour points, which Knights (barbarian
	// downgrade) and Raiders (conquest) can change; "harbormaster" sorts before
	// "raiders", so in OnEvents it would read stale standings.
	//
	// It runs before the victory check, so a title moved here counts toward a
	// win on the same turn.
	//
	// It is the only hook that also runs during setup (finalizeWith otherwise
	// returns early outside PhasePlay). Under Knights the round-2 placement is
	// a city, so a player can finish setup holding the Harbormaster.
	// Implementations must therefore work on a state with no roll, no offer and
	// no turn.
	//
	// Implementations must be idempotent and independent of the order they run
	// in among their peers.
	AfterEvents func(after *State, events []Event) []Event
	// BlocksTurnActions, when set, gates the active player's voluntary actions
	// (build/trade/knight) in requireActionableTurn instead of Blocks, so a
	// module can let the player keep acting while owing a soft reconcile
	// (Knights defers an over-limit progress hand to end of turn). It is also
	// the per-seat gate in AutoCommandFor: a seat it returns false for keeps
	// acting through a blocking interrupt it owes nothing to, short of ending
	// the turn. Blocks still governs auto-pass, timers and end-turn. Falls back
	// to Blocks when nil.
	BlocksTurnActions func(s *State) bool
	// Blocks pauses normal turn actions while the module awaits input
	// (gold picks, progress interrupts).
	Blocks func(s *State) bool
	// Auto produces the module's minimal legal command when it Blocks (the
	// module side of auto-pass). Pass a real seat to resolve only that seat's
	// obligation, so a bot can act without waiting on a lower seat owed the
	// same simultaneous decision, or NoPlayer to resolve the lowest owed seat
	// (the auto-pass/timer default). Returns false when that seat (or, for
	// NoPlayer, any seat) owes nothing.
	Auto func(s *State, seat PlayerID) (Command, bool)
	// PendingDeciders lists every seat the module is awaiting input from (gold
	// picks, wedding/harbor/aqueduct/spy), each tagged with its decision id so
	// the timer layer can size the budget. Mirrors the seats Auto would drive.
	// Nil when nothing is owed. Need not be sorted.
	PendingDeciders func(s *State) []ModuleDecider
	// RouteEdges contributes edges to the longest-route network the engine
	// walks once per player, e.g. Islands' ships. One shared walk lets a route
	// cross from a camel-doubled road onto a ship chain and count both.
	RouteEdges func(s *State, p PlayerID, net *RouteNet)
	// RouteWeights reweights edges already in that network (a camel doubles the
	// road or ship beside it). It is separate from RouteEdges because
	// reweighting must see every module's edges, and hooks run in ruleset
	// order: "caravans" sorts before "islands", so a reweight inside RouteEdges
	// would run before any ship exists. All RouteEdges hooks run, then all
	// RouteWeights hooks. Within a phase, key on the edge itself (Kind,
	// position), not on which module added it, and be idempotent.
	RouteWeights func(s *State, p PlayerID, net *RouteNet)
	// VictoryCheck adds module VP (island chips, missions, metropolises).
	VictoryCheck func(s *State, p PlayerID) int
	// WinThresholdDelta adjusts a player's victory target without changing
	// their displayed VP (Fishermen's "old boot" makes its holder need +1).
	WinThresholdDelta func(s *State, p PlayerID) int
	// DiscardLimitDelta adjusts a player's 7-roll discard threshold; the deltas
	// from every module are summed onto the base limit (Knights city walls each add
	// +2). Additive so the result is independent of ruleset ordering.
	DiscardLimitDelta func(s *State, p PlayerID) int
	// ExtraDiscardCount adds module-held cards (Knights commodities) to a player's
	// card total for the 7-roll discard threshold and the half-discard count.
	ExtraDiscardCount func(s *State, p PlayerID) int
	// HandleDiscard lets a module own a player's discard so it can spend its own
	// cards too (Knights commodities). Returns handled=false to fall back to the base
	// resource-only discard.
	HandleDiscard func(s *State, cmd Command, need int) (events []Event, handled bool, err error)
	// AutoDiscard supplies the module's minimal legal discard command (resources
	// then its own cards) for auto-pass/timeout when a discard is owed.
	AutoDiscard func(s *State, p PlayerID, need int) (Command, bool)
	// FixedDice preempts the production dice (Alchemist).
	FixedDice func(s *State) (d1, d2 int, ok bool)
	// BlocksVertex marks vertices roads may not pass through (knights).
	BlocksVertex func(s *State, v board.Vertex, p PlayerID) bool
	// BlocksNewConstruction refuses every new build at intersection v for a
	// module reason other than occupancy, the distance rule or the road network
	// (a Raiders hex saturated by raiders). A build is anything constructed at
	// v: a settlement, a city upgrade there, and under Knights a knight or a
	// city wall. Moving, promoting or activating a piece already there is not a
	// build.
	//
	// Consulted by checkSettlementSpot (setup included),
	// State.BlocksCityUpgrade (so the city build, LegalCities and Knights
	// Medicine agree), and the Knights knight and wall builds through
	// State.NewConstructionBlocked.
	//
	// Separate from BlocksVertex, which governs road continuity and the route
	// walk: a conquered hex stops new construction but must not sever roads,
	// and the buildings already there keep blocking opponents and keep their
	// place in the route network.
	BlocksNewConstruction func(s *State, v board.Vertex) bool
	// BlocksNewRoad refuses a new road on edge e for a module reason other than
	// occupancy (a Raiders conquered hex bars its six paths).
	//
	// Separate from OccupiesEdge, which means a piece stands there and answers
	// ErrOccupied: nothing stands on these edges, and under Islands a ship may
	// still be built on them.
	BlocksNewRoad func(s *State, e board.Edge) bool
	// HexInert reports whether hex h currently pays out nothing on any roll, for
	// a reason of the module's own (a Raiders hex saturated by raiders). It is
	// additive with the robber: production skips a hex any module calls inert.
	HexInert func(s *State, h board.Hex) bool
	// BuildingInert reports whether the building at v is switched off: it
	// produces nothing, draws no fish, cannot use its harbour, scores no VP,
	// and does not join two of its owner's route networks. It still exists and
	// still blocks an opponent's route.
	//
	// Only Raiders implements it (a settlement or city with no unconquered
	// neighbour). The VP part is handled by the module subtracting inert
	// buildings in VictoryCheck, which feeds PublicVPWithModules and every
	// leader test.
	BuildingInert func(s *State, v board.Vertex) bool
	// CityResourceYield overrides how many cards of resource res one city
	// collects from the resource bank when its hex comes up (base: 2). ok=false
	// keeps the base answer.
	//
	// Knights: a city on commodity terrain collects one resource and one
	// commodity from its own stack. The shortage rule reads this number, so a
	// bank holding 2 wood covers a Knights city and a settlement on the same
	// forest. The module pays the commodity itself, so this hook only lowers
	// the base claim.
	CityResourceYield func(s *State, res board.Resource) (n int, ok bool)
	// LegalExtras contributes the module's own positional placement targets
	// (knight vertices, wall-eligible cities) for the active player's view, so
	// the client offers only placeable spots. Called only for the active seat on
	// an actionable play turn; positional only (resource/count gating stays on
	// the build commands).
	LegalExtras func(s *State, seat PlayerID) LegalExtra
	// PendingTargets contributes placement targets a module owes `seat` right
	// now, whether or not it is an actionable turn (a Deserter replacement
	// knight, a displaced-knight relocation; possibly owed by a non-current
	// player). Empty means nothing is pending.
	PendingTargets func(s *State, seat PlayerID) LegalExtra
	// BankRatio lowers a player's bank-trade ratio for a resource (Knights
	// Merchant Fleet's turn-scoped 2:1). Return (ratio, true) to override; the
	// engine keeps the best (lowest) of the base and all module ratios.
	BankRatio func(s *State, p PlayerID, res board.Resource) (int, bool)
	// GoodRatios reports the viewer's best bank rate for each of the module's
	// own tradable goods, keyed by wire name. The module owns that rate rule,
	// which can differ from resources: in Knights a generic 3:1 harbor lowers a
	// commodity's rate but a 2:1 resource harbor does not, so it cannot be
	// inferred from BankRatios.
	//
	// "Best" is the cheapest lane the player can reach, not necessarily what
	// one command charges: Knights publishes 2:1 for a Trade-level-3 player
	// because the Trading House swaps two of a commodity for any good, though
	// commodity_trade still charges the maritime rate.
	GoodRatios func(s *State, p PlayerID) map[string]int
	// GoodMaritimeRatios reports, for the same goods, what the module's
	// maritime trade command charges. GoodRatios is what a good is worth; a
	// client staging a basket needs the cost (a Trade-3 player's cloth
	// published at 2:1 still costs 4 through this command). Nil means
	// GoodRatios is also the price.
	GoodMaritimeRatios func(s *State, p PlayerID) map[string]int
	// NoDevCards disables the base development deck (Knights replaces it).
	NoDevCards bool
	// NoLongestRoad removes the Longest Road award (Wagons has only Largest
	// Army; Explorers removes both special cards, so roads and ships never form
	// a shared network).
	//
	// It is a flag rather than a VictoryCheck of -2 because the award is more
	// than two points: EvLongestRoad is a public event, the badge is drawn in
	// the player rail and scoreboard, and bots read LongestRoadHolder to price
	// a road. Suppressing the event leaves LongestRoadHolder at NoPlayer, so
	// all of those stay correct and PublicVP's +2 never applies.
	//
	// Modules that contribute route pieces (Islands' ships) are unaffected:
	// RouteEdges and RouteWeights still run because the route length is still
	// shown on the scoreboard.
	NoLongestRoad bool
	// DevDeck replaces the composition of the base development deck for a
	// module that deals a different deck through the same machinery (Wagons: 16
	// Knight, 3 Road Building, 3 Victory Point, no Year of Plenty or Monopoly).
	// Return (deck, false) to keep the base deck.
	//
	// Unlike NoDevCards, which removes the deck, this keeps buying, playing,
	// Largest Army and the VP card as base rules.
	//
	// Called once, at EvGameCreated, with the seat count. It is part of the
	// fold, so it must be a pure function of that count.
	DevDeck func(players int) (DevHand, bool)
	// ExtraDevCards reports how many of the module's own cards are shuffled
	// into the development deck alongside the base kinds (Wagons' Swift
	// Journey). Zero or nil when none.
	//
	// The base buy draws one index uniformly over DevDeck.Count() plus every
	// module's extras, so a module card is drawn in proportion to its share of
	// the deck and runs out with its supply, which is what balances these
	// cards.
	ExtraDevCards func(s *State) int
	// DrawExtraDevCard produces the event for p drawing the idx'th of this
	// module's own deck cards (idx is relative to this module's block, so a
	// module with one kind always sees 0). offset seeds further randomness
	// through RngFor, as for StealCard. Return (_, false) to decline and fall
	// back to the base deck.
	DrawExtraDevCard func(s *State, p PlayerID, idx, offset int) (Event, bool)
	// NoCities removes the city: a settlement never upgrades, CmdBuildCity is
	// refused, and no city piece is placed.
	//
	// Explorers replaces the upgrade with its own harbour settlement (a base
	// settlement plus module state), because a city produces two of a resource
	// and a harbour settlement one.
	//
	// It takes the state because the answer depends on the ruleset: Explorers
	// removes the city alone but restores it in the Knights pairing, where a
	// coastal settlement may become either a city or a harbour settlement
	// (docs/rules/explorers.md, rule A).
	NoCities func(s *State) bool
	// ProgressDecks reports how many card decks the module offers a player who
	// gets to choose one (Knights' three disciplines). Zero or nil when none.
	// Lets another module validate a deck index without knowing the decks.
	ProgressDecks func(s *State) int
	// DrawProgressCard hands p one card off deck `deck`, returning the draw
	// event, or (_, false) when that deck is empty. It is for effects outside
	// the module that grant a progress card (Fishermen's seven-fish spend under
	// Knights). offset seeds RngFor, as for StealCard.
	DrawProgressCard func(s *State, p PlayerID, deck, offset int) (Event, bool)
	// ScenarioCard hands p one card off a module's own development deck and
	// resolves it, for an effect outside that module which grants one.
	//
	// DrawProgressCard returns one event, but a scenario deck whose cards
	// resolve on purchase can produce several (a Raiders Intrigue with no
	// raider to take is discarded and redrawn: two events and a pending), and
	// Knights already implements that signature, hence a second hook.
	//
	// The only caller is the Fishermen seven-fish spend, which under a ruleset
	// with no base deck takes one card and resolves it immediately. offset is
	// the log position of the first returned event and seeds the draw.
	ScenarioCard func(s *State, p PlayerID, offset int) ([]Event, bool)
	// MustUpgradeFirst, when it returns (v, true), forces the player's next
	// city upgrade to target vertex v (Knights: a city pillaged with no settlement
	// supply is laid on its side and must be upgraded before any other).
	MustUpgradeFirst func(s *State, p PlayerID) (board.Vertex, bool)
	// StealCard overrides the robber's resource-only steal so a module can draw
	// from a combined pool (Knights resources + commodities). It returns the steal
	// event (an EvCardStolen for a resource, or a module commodity-steal event)
	// or (_, false) to defer to the base resource-only steal. offset seeds the
	// replay-deterministic RNG via RngFor.
	StealCard func(s *State, thief, victim PlayerID, offset int) (Event, bool)
	// NoRobber, when non-nil and returning true, suppresses the robber on a 7
	// (discards still happen). Knights uses it to keep the robber out of play
	// until the first barbarian attack; a pirate-only variant could too.
	NoRobber func(s *State) bool
	// RobberNeverInPlay declares that no robber or pirate ever enters play in
	// any ruleset containing this module (Wagons and Explorers have none;
	// Raiders removes both in every combination). It is the static counterpart
	// of NoRobber, so a lobby can tell before a game exists that the robber
	// settings do nothing. Read through RulesetHasRobber. A module that sets it
	// must also keep the robber off the board and set NoRobber;
	// ruletest.TestEveryRulesetsRobberAnswer checks this.
	RobberNeverInPlay bool
	// RobberForbidden, when non-nil and returning true, keeps the robber off
	// hex h: no move, knight card, knight chase or progress card may send it
	// there. Every robber destination in the engine and bots goes through
	// RobberMayEnter, which includes this. Caravans uses it for the oasis.
	RobberForbidden func(s *State, h board.Hex) bool
	// MaskBoard rewrites the board for client views (fog of war). It must
	// return a copy; the live board is shared.
	MaskBoard func(s *State, b *board.Board) *board.Board
	// RevealHands lists seats whose full resource hand the viewer may currently
	// see, beyond their own (Knights Master Merchant: while looking at a victim's
	// hand, the thief sees its breakdown). Returned by the view layer, never the
	// engine state. Nil/empty when nothing is revealed.
	RevealHands func(s *State, viewer PlayerID) []PlayerID
	// SetupRound2City makes the second (reverse-order) setup placement a city
	// instead of a settlement (Knights, 2025 rules). Starting resources are still granted
	// at one card per adjacent hex.
	SetupRound2City bool
	// SetupGrant lets a module add starting-resource events for a round-2 setup
	// settlement on module terrain the base grant skips (Islands gold owes a
	// pick; the base grant only pays the five bankable resources).
	SetupGrant func(s *State, p PlayerID, v board.Vertex) []Event
	// TradeExtraHeld interprets a module-specific player-trade payload (Knights
	// commodities) the base engine treats as opaque: it returns how many cards the
	// payload represents and whether player p holds them all. A nil/empty or
	// unrecognized payload returns (0, true).
	TradeExtraHeld func(s *State, p PlayerID, extra json.RawMessage) (count int, held bool)
	// TradeExtraEvents returns the events that move a module-specific trade payload
	// from→to (a commodity transfer). A nil/empty payload returns nil.
	TradeExtraEvents func(s *State, from, to PlayerID, extra json.RawMessage) []Event
	// SellGood takes one unit of the module's own good `good` out of p's hand
	// and returns it to the module's supply, producing the events.
	//
	// It is the supply-side counterpart of TradeExtraEvents, which moves goods
	// between players. cak+explorers rule G needs it: with Fast Gold a player
	// may sell a commodity for 1 gold, and that commodity returns to its stack
	// (see "Commodity supply" in docs/rules/knights.md).
	//
	// `good` is a GoodRatios key. Return (_, false, nil) for a good this module
	// does not own, so a caller can ask every module in turn.
	SellGood func(s *State, p PlayerID, good string) (events []Event, ok bool, err error)
	// SetupShipEvent lets a module place a ship instead of a road for a coastal
	// starting settlement (Islands). The base calls it when a setup connector
	// targets a non-land edge touching the new settlement; the module returns its
	// placement event (a free ship) or (_, false) to reject.
	SetupShipEvent func(s *State, e board.Edge, p PlayerID) (Event, bool)
	// OccupiesEdge reports whether the module holds a piece on edge e (an
	// Islands ship). The base road build and setup refuse a road on such an
	// edge: a coastal hex side holds one road or one ship, not both (the ship
	// build already refuses a road's edge).
	OccupiesEdge func(s *State, e board.Edge) bool
	// AnchorsVertex reports whether the module gives player p a connection at
	// vertex v that may anchor a settlement beyond an adjacent road (an Islands
	// ship touching v). The base settlement build and legal set treat such a
	// vertex as road-adjacent, so a settlement can be founded at the end of a
	// ship route.
	AnchorsVertex func(s *State, v board.Vertex, p PlayerID) bool
	// RouteEdge reports the owner of the module's own route piece on edge e (an
	// Islands ship), if any.
	//
	// It lets a module that walks a player's routes see pieces it does not own
	// without importing their module (modules never import each other). Knights
	// needs it because a knight "may move along your continuous routes of roads
	// and ships". AnchorsVertex cannot carry a walk, which needs to know which
	// edge continues the route and in which network.
	//
	// Roads and module pieces are separate networks that join only at the
	// owner's buildings; a caller walking both enforces that (see
	// knights.knightReachable).
	RouteEdge func(s *State, e board.Edge) (PlayerID, bool)
	// RouteEdgeKind is RouteEdge plus the piece's kind, for a caller that must
	// tell a road-like module piece from a ship-like one.
	//
	// RouteEdge is enough to walk a route but not to decide whether a road is
	// attached at a vertex: Islands joins a road to a ship only through the
	// owner's building, so a ship touching a road's end leaves it open, while a
	// Rivers bridge is a road segment and closes it. The Knights Diplomat frees
	// an open road, so the two differ.
	//
	// A module that does not implement this reports nothing, and callers treat
	// that as no road-like piece, which keeps ships behaving as before. It is
	// separate from RouteEdge because some RouteEdge callers want the walk and
	// not the kind.
	RouteEdgeKind func(s *State, e board.Edge) (PlayerID, RouteKind, bool)
	// SeaBlockerHex reports where the module's sea blocker (the Islands pirate)
	// stands, when it is on the board, so another module that can drive it away
	// can check adjacency and offer destinations without owning the piece.
	SeaBlockerHex func(s *State) (board.Hex, bool)
	// ChaseSeaBlocker moves the module's sea blocker off its hex on another
	// module's behalf and resolves the steal that follows, as with the base
	// robber chase (knights on a sea intersection may chase the pirate as land
	// knights chase the robber).
	//
	// `from` is the chasing piece's intersection (the module re-checks it
	// touches the blocker), `to` is the destination, `victim` is the seat to
	// rob or nil. offset is the log position of the first returned event and
	// seeds the steal. handled=false means this module has no such blocker in
	// play.
	ChaseSeaBlocker func(s *State, mover PlayerID, from board.Vertex, to board.Hex, victim *PlayerID, offset int) (events []Event, handled bool, err error)
	// RefusesEdge reports why the module forbids a route piece of kind k on
	// edge e, or nil. It is the closed-edge check, distinct from OccupiesEdge.
	//
	// OccupiesEdge means a piece stands there and becomes ErrOccupied. A Rivers
	// bridge site is empty but permanently closed to everything except a
	// bridge, so ErrOccupied would mislead; the module returns its own error
	// code instead.
	//
	// Consulted by the base road build and setup connector (RouteRoad) and by
	// the ship-owning module (RouteShip), so the bridge-site rule covers every
	// piece kind in one place. The owning module exempts its own bridge by
	// checking the kind.
	RefusesEdge func(s *State, e board.Edge, k RouteKind) error
	// RefusesRouteMove reports why the module forbids player p moving a route
	// piece of kind k from one edge to another, or nil.
	//
	// A move is not priced as two builds. Rivers charges a coin to take a ship
	// off a river edge and pays one for placing it on another, so a
	// river-to-river move is free and a move off a river costs a coin the
	// player may lack. docs/rules/rivers.md refuses that move up front, like an
	// unaffordable build, since the engine has no debt.
	//
	// Consulted by the module that owns the piece, at its placement choke
	// point, before any event is produced. The payment itself happens in
	// AfterEvents; this only answers whether the player can afford it.
	RefusesRouteMove func(s *State, p PlayerID, from, to board.Edge, k RouteKind) error
	// OwnsSetup, when non-nil and returning true, hands the whole setup draft
	// to the module. The base place_settlement / place_road commands are
	// refused (ErrUnknownCommand) while it holds, and the module's own commands
	// drive the draft, folding s.Cur, s.SetupRound and the flip to PhasePlay
	// from its own Apply as advanceSetup would.
	//
	// Explorers needs it: three setup rounds, a different piece kind in each (a
	// harbour settlement, a settlement, then a road and a loaded ship), and
	// starting resources only from the second. That does not fit the base snake
	// draft.
	//
	// Nil leaves the base draft unchanged.
	OwnsSetup func(s *State) bool
	// AutoSetup supplies the module's minimal legal setup command for auto-pass
	// and the turn timer, as Auto does for a play-phase interrupt. Consulted
	// only from baseAutoCommand's setup branch. A module that OwnsSetup needs
	// it, or a seat would be handed a base place_settlement the module refuses,
	// and the game would deadlock.
	AutoSetup func(s *State) (Command, bool)
	// BlocksBuildTrade gates the active seat's building and trading and nothing
	// else: not the module's own commands, and not ending the turn.
	//
	// BlocksTurnActions goes through requireActionableTurn, which end_turn also
	// uses, so using it for a phase would leave the active seat unable to pass.
	// Explorers' movement phase forbids building and trading with no return to
	// the action phase, so it needs this narrower gate.
	//
	// Consulted through requireBuildTurn by decideBuild, the bank/offer/execute
	// trade deciders and the two dev-card deciders. Nil leaves those commands
	// unchanged.
	BlocksBuildTrade func(s *State) bool
	// BuildBlockedVertex reports whether the module bars player p from building
	// a settlement at vertex v right now, for a reason that depends on the
	// player.
	//
	// BlocksVertex is player-independent (checkSettlementSpot passes NoPlayer),
	// which fits a knight in the way but not an Explorers spice farm: a farm is
	// open to players who have landed a crew on it and closed to others.
	// Consulted by the settlement build and LegalSettlements, after
	// checkSettlementSpot.
	BuildBlockedVertex func(s *State, v board.Vertex, p PlayerID) bool
	// UnrevealedVertex reports whether vertex v touches something this module
	// has not revealed yet, so no piece may be placed or moved onto it.
	//
	// It is a hook because of the Knights pairing: knights may not be built on
	// or moved onto intersections next to an undiscovered hex, and engine/knights
	// cannot import Explorers.
	//
	// It is narrower than BuildBlockedVertex, which for Explorers also refuses
	// an uncaptured pirate lair and an unbefriended spice farm; the combination
	// rules do not extend those to knights.
	//
	// Player-independent: the fog is not one player's secret.
	UnrevealedVertex func(s *State, v board.Vertex) bool
	// BlocksCityUpgrade reports why the module bars player p from upgrading the
	// settlement at vertex v into a city, or nil.
	//
	// It returns an error, unlike the other Blocks* hooks, because a player can
	// attempt this with the resources in hand, and the module owns the refusal
	// message.
	//
	// BuildBlockedVertex answers whether a new settlement may go on v, which
	// every occupied vertex fails, so it cannot express an upgrade rule. The
	// Explorers/Knights pairing needs one: combination rule A lets a coastal
	// settlement become a city or a harbour settlement, and the choice is final
	// either way. A harbour settlement is a base settlement plus module state,
	// so without this hook the base city upgrade would convert it.
	//
	// Consulted by the CmdBuildCity decider and LegalCities so they agree.
	BlocksCityUpgrade func(s *State, v board.Vertex, p PlayerID) error
	// BuildBlockedEdge is BuildBlockedVertex for a road's edge: Explorers refuses
	// a road on any edge with an end at a corner of an unexplored hex, on an
	// uncaptured pirate lair, or on a spice farm this player has not befriended.
	// Consulted by the road build and by LegalRoads.
	BuildBlockedEdge func(s *State, e board.Edge, p PlayerID) bool
	// BuildingVPSuppressed reports whether the building at vertex v is
	// currently worth nothing: still on the board and still its owner's.
	//
	// Raiders: a building enclosed by conquered hexes scores no VP and its
	// harbour cannot be used. Harbormaster scores "victory points in buildings
	// on harbours", so such a building also earns no harbour points;
	// Harbormaster asks this hook rather than importing Raiders.
	//
	// A module answering true handles the base VP side itself through its own
	// VictoryCheck delta; this hook does not touch State.PublicVP.
	//
	// Any active module returning true suppresses the building. Only Raiders
	// (raiders.buildingInert) sets it; Harbormaster and Caravans read it.
	BuildingVPSuppressed func(s *State, v board.Vertex) bool
	// AnchorsRoute reports whether the module holds a piece of player p at
	// vertex v that closes a route end the way p's own building does (a Knights
	// knight).
	//
	// The Islands rules treat a shipping route as closed once it connects two
	// settlements, cities or (with Knights) knights. Islands consults this so a
	// ship with a knight on one end is not open, which also stops a ship move
	// from cutting a knight off from its route.
	//
	// This is not "joins two of p's networks": a building joins a road network
	// to a ship network, a knight does not.
	AnchorsRoute func(s *State, v board.Vertex, p PlayerID) bool
	// PillageBuyout lets a module sell the owner of a city about to be pillaged
	// a way out, returning the events that pay the price.
	//
	// Rivers with Knights: a player may spend 5 coins to keep a city that would
	// be pillaged. The pillage belongs to Knights and the coins to Rivers, so
	// the currency module states the price and folds the payment, and Knights
	// decides when the offer stands and clears the debt.
	//
	// The returned error is the module's own refusal (not enough coins) and
	// reaches the player unchanged. A module with no buyout leaves this nil;
	// see HasPillageBuyout.
	PillageBuyout func(s *State, p PlayerID) ([]Event, error)
	// FreeBridge builds one of the module's bridges at e for p, paid for by
	// something other than resources, and returns the placement event.
	//
	// For effects outside the module that buy a bridge: Fishermen's six-fish
	// spend under Rivers. All of the module's placement rules still apply and
	// the refusal is its own, so the caller charges only after success.
	//
	// Nil in every ruleset without a bridge module (see HasFreeBridge).
	FreeBridge func(s *State, p PlayerID, e board.Edge) (Event, error)

	// FreeWagonBoost validates and grants +2 wagon movement, paid for by
	// another module. The once-per-turn limit is shared with the grain boost.
	FreeWagonBoost func(s *State, p PlayerID) (Event, error)

	// FreeRiderHurry validates and makes one hurried rider move (up to five
	// paths instead of three) from `from` to `to`, paid for by another module
	// instead of grain: under Fishermen with Raiders, 2 fish replace the 1
	// grain. The returned event is the move; the caller charges only after
	// success.
	FreeRiderHurry func(s *State, p PlayerID, from, to board.Edge) (Event, error)

	// EdgeBlockerTargets lists the blockers adjacent to a knight's vertex.
	EdgeBlockerTargets func(s *State, from board.Vertex) []int
	// ChaseEdgeBlocker opens the owning module's mandatory relocation choice.
	ChaseEdgeBlocker func(s *State, p PlayerID, from board.Vertex, blocker int) ([]Event, error)
	// FreeHarbour upgrades p's settlement at v to one of the module's harbour
	// settlements, paid for outside the module's own cost, and returns the
	// placement event.
	//
	// For cak+explorers rule H, where Medicine offers both upgrades (1 ore and
	// 1 grain for a harbour settlement, 2 ore and 1 grain for a city). The
	// harbour settlement is Explorers' piece and the card is Knights'.
	//
	// All of the module's placement rules still apply (coastal, a piece left,
	// not already upgraded) and the refusal is its own, so the caller charges
	// only after success. See HasFreeHarbour.
	FreeHarbour func(s *State, p PlayerID, v board.Vertex) (Event, error)
	// ArmSeaBlocker makes the module owe p a placement of its sea blocker, as a
	// 7 does, and returns the event that arms it.
	//
	// For the Bishop under cak+explorers rule H (the card activates the pirate
	// ship instead of moving the robber). Arming the module's own placement,
	// rather than moving the piece from outside, reuses its legal hexes,
	// displacement rule (an opponent's ship returns to supply, your own moves
	// to another hex), victim choice, redaction and timeout pick.
	//
	// Return (_, false) when the module has no such piece.
	ArmSeaBlocker func(s *State, p PlayerID) (Event, bool)
}

// ModuleRouteEdge returns the owner of a module route piece (an Islands ship) on
// edge e, if one is there. See Hooks.RouteEdge.
func (s *State) ModuleRouteEdge(e board.Edge) (PlayerID, bool) {
	for _, m := range s.Modules() {
		if h := m.Hooks().RouteEdge; h != nil {
			if owner, ok := h(s, e); ok {
				return owner, true
			}
		}
	}
	return NoPlayer, false
}

// ModuleRouteEdgeKind returns the owner and kind of a module route piece on
// edge e, for a caller that must tell a road-like piece from a ship-like one.
// See Hooks.RouteEdgeKind; a module that does not answer is not guessed at.
func (s *State) ModuleRouteEdgeKind(e board.Edge) (PlayerID, RouteKind, bool) {
	for _, m := range s.Modules() {
		if h := m.Hooks().RouteEdgeKind; h != nil {
			if owner, kind, ok := h(s, e); ok {
				return owner, kind, true
			}
		}
	}
	return NoPlayer, RouteRoad, false
}

// RouteAnchoredByModule reports whether any active module holds a piece of
// player p at vertex v that closes a route end there (a Knights knight). See
// Hooks.AnchorsRoute.
func (s *State) RouteAnchoredByModule(v board.Vertex, p PlayerID) bool {
	for _, m := range s.Modules() {
		if h := m.Hooks().AnchorsRoute; h != nil && h(s, v, p) {
			return true
		}
	}
	return false
}

// SeaBlocker returns where a module's sea blocker stands (the Islands pirate),
// if one is in play. See Hooks.SeaBlockerHex.
func (s *State) SeaBlocker() (board.Hex, bool) {
	for _, m := range s.Modules() {
		if h := m.Hooks().SeaBlockerHex; h != nil {
			if hex, ok := h(s); ok {
				return hex, true
			}
		}
	}
	return board.Hex{}, false
}

// ChaseSeaBlockerFromModules drives a module's sea blocker off its hex on
// another module's behalf. See Hooks.ChaseSeaBlocker.
func ChaseSeaBlockerFromModules(s *State, mover PlayerID, from board.Vertex, to board.Hex, victim *PlayerID, offset int) ([]Event, bool, error) {
	for _, m := range s.Modules() {
		if h := m.Hooks().ChaseSeaBlocker; h != nil {
			if evs, handled, err := h(s, mover, from, to, victim, offset); handled || err != nil {
				return evs, handled, err
			}
		}
	}
	return nil, false, nil
}

// BuildingVPSuppressed reports whether any active module currently strips the
// building at vertex v of its value (a Raiders conquest). See
// Hooks.BuildingVPSuppressed.
func (s *State) BuildingVPSuppressed(v board.Vertex) bool {
	for _, m := range s.Modules() {
		if h := m.Hooks().BuildingVPSuppressed; h != nil && h(s, v) {
			return true
		}
	}
	return false
}

// vertexAnchoredByModule reports whether any active module anchors a settlement
// for player p at vertex v (an Islands ship touching v).
func (s *State) vertexAnchoredByModule(v board.Vertex, p PlayerID) bool {
	for _, m := range s.Modules() {
		if h := m.Hooks().AnchorsVertex; h != nil && h(s, v, p) {
			return true
		}
	}
	return false
}

// hasAdjacentRoute reports whether a settlement at v may connect to p's network
// via an adjacent road or a module connection (an Islands ship).
func (s *State) hasAdjacentRoute(v board.Vertex, p PlayerID) bool {
	return s.hasAdjacentRoad(v, p) || s.vertexAnchoredByModule(v, p)
}

// EdgeRefusal reports why an active module forbids a route piece of kind k on
// edge e, or nil when none does. See Hooks.RefusesEdge.
//
// Exported because engine/islands owns the ship and asks the same question of
// the same edge.
func (s *State) EdgeRefusal(e board.Edge, k RouteKind) error {
	for _, m := range s.Modules() {
		if h := m.Hooks().RefusesEdge; h != nil {
			if err := h(s, e, k); err != nil {
				return err
			}
		}
	}
	return nil
}

// RouteMoveRefusal reports why an active module forbids p moving a route piece
// of kind k from → to, or nil when none does. See Hooks.RefusesRouteMove.
func (s *State) RouteMoveRefusal(p PlayerID, from, to board.Edge, k RouteKind) error {
	for _, m := range s.Modules() {
		if h := m.Hooks().RefusesRouteMove; h != nil {
			if err := h(s, p, from, to, k); err != nil {
				return err
			}
		}
	}
	return nil
}

// edgeBlockedByModule reports whether any active module holds a piece on edge e.
func (s *State) edgeBlockedByModule(e board.Edge) bool {
	for _, m := range s.Modules() {
		if h := m.Hooks().OccupiesEdge; h != nil && h(s, e) {
			return true
		}
	}
	return false
}

// NewConstructionBlocked reports whether a module refuses every new build at v.
// See Hooks.BlocksNewConstruction. Exported because Knights asks it for its own
// pieces (a knight, a wall).
func (s *State) NewConstructionBlocked(v board.Vertex) bool {
	for _, m := range s.Modules() {
		if h := m.Hooks().BlocksNewConstruction; h != nil && h(s, v) {
			return true
		}
	}
	return false
}

// newRoadBlocked reports whether a module refuses a new road on e. See
// Hooks.BlocksNewRoad.
func (s *State) newRoadBlocked(e board.Edge) bool {
	for _, m := range s.Modules() {
		if h := m.Hooks().BlocksNewRoad; h != nil && h(s, e) {
			return true
		}
	}
	return false
}

// HexIsInert reports whether any module has switched hex h's production off (a
// Raiders hex saturated by raiders). See Hooks.HexInert.
func HexIsInert(s *State, h board.Hex) bool {
	for _, m := range s.Modules() {
		if hk := m.Hooks().HexInert; hk != nil && hk(s, h) {
			return true
		}
	}
	return false
}

// CityYield is how many cards of res one city collects from the resource bank
// on a production roll: 2, unless a module says otherwise. See
// Hooks.CityResourceYield.
func CityYield(s *State, res board.Resource) int {
	for _, m := range s.Modules() {
		if h := m.Hooks().CityResourceYield; h != nil {
			if n, ok := h(s, res); ok {
				return n
			}
		}
	}
	return 2
}

// BuildingIsInert reports whether any module has switched the building at v off
// (a Raiders building with no unconquered neighbour). Exported so other
// modules' production (Fishermen's catch), the bots and the scoreboard agree
// with the engine. See Hooks.BuildingInert.
func BuildingIsInert(s *State, v board.Vertex) bool {
	for _, m := range s.Modules() {
		if h := m.Hooks().BuildingInert; h != nil && h(s, v) {
			return true
		}
	}
	return false
}

// ConfigDefaulter lets a module adjust config defaults (Knights plays to 13 VP).
// Applied at game creation before the base defaults.
type ConfigDefaulter interface {
	DefaultConfig(cfg GameConfig) GameConfig
}

// TargetVPAdjuster lets a module add to the ruleset's default victory target,
// after every ConfigDefaulter has chosen one.
//
// ConfigDefaulter sets the target only if unset (Knights 13, Caravans 12, first
// writer wins in ruleset order), which suits a module that owns a target but
// not one that shifts whatever target the ruleset produced. Harbormaster adds
// one point: 11 on base, 14 on Knights, 13 on Caravans.
//
// Adjustments are summed after the defaulters and GameConfig.withDefaults, so
// the result does not depend on ruleset order ("base+cak+harbormaster" and
// "base+harbormaster+cak" are both 14), like DiscardLimitDelta and
// WinThresholdDelta.
//
// It adjusts only the default. A config with a non-zero TargetVP is a host's
// explicit choice and beats every defaulter; adding to it would change what the
// host typed and double the increment for every lobby game, since format.ts's
// recommendedVP mirrors this resolution and always sends a number. See
// docs/rules/harbormaster.md.
//
// State.New writes the resolved number into the config carried by
// EvGameCreated, so a replay reads it from the log and never re-applies the
// increment.
//
// It receives the config with defaulters applied, so it can scale by player
// count or ruleset; 0 means no change.
type TargetVPAdjuster interface {
	AdjustTargetVP(cfg GameConfig) int
}

// targetVPAdjustment sums every active module's TargetVPAdjuster contribution.
// Order-independent by construction: it is a sum.
func targetVPAdjustment(cfg GameConfig, mods []Module) int {
	delta := 0
	for _, m := range mods {
		if a, ok := m.(TargetVPAdjuster); ok {
			delta += a.AdjustTargetVP(cfg)
		}
	}
	return delta
}

// resolveTargetVP applies the whole target rule: every module's
// ConfigDefaulter, then the base defaults, then, only when the caller named no
// target, every TargetVPAdjuster summed on top.
//
// named is whether TargetVP was set before the defaulters ran; the caller must
// capture it because the defaulters fill the field in.
func resolveTargetVP(cfg GameConfig, mods []Module, named bool) int {
	if named {
		return cfg.TargetVP
	}
	return cfg.TargetVP + targetVPAdjustment(cfg, mods)
}

// ResolveTargetVP is the victory target a game created with this config will be
// played to.
//
// Callers outside the engine need it before a game exists: the lobby checks it
// against MaxVPWithoutCards so a config that resolves above the winnable
// ceiling is refused at creation.
//
// State.New uses the same code path, minus the board work, so the two cannot
// drift.
//
// An unresolvable ruleset returns the config's own target; callers have already
// validated it with CheckRuleset.
func ResolveTargetVP(cfg GameConfig) int {
	mods, err := modulesFor(cfg.Ruleset)
	if err != nil {
		return cfg.TargetVP
	}
	named := cfg.TargetVP != 0
	for _, m := range mods {
		if d, ok := m.(ConfigDefaulter); ok {
			cfg = d.DefaultConfig(cfg)
		}
	}
	cfg = cfg.withDefaults()
	return resolveTargetVP(cfg, mods, named)
}

// BoardRadiuser lets a module enlarge the procedural board beyond what the
// player count implies (a large-map expansion may need a home island plus sea
// and fog). Ignored for preset maps.
type BoardRadiuser interface {
	BoardRadius(players int) int
}

// BoardSeeder lets a module do its board work from the public seed rather than
// from the single stream SetupBoard is handed.
//
// SetupBoard's *rand.Rand comes from the shared board-setup slot
// (rngFor(public, 2)), which suits a module making one bounded set of choices.
// Explorers derives its region split, special hexes, shoal numbering and two
// number-chit stacks from four separate reservations (see engine/seeds.go), so
// each can be audited on its own and changing one does not shift the others.
// That needs the seed itself.
//
// State.New calls SetupBoardSeeded after SetupBoard, for every implementing
// module, in ruleset order. Such a module normally leaves SetupBoard empty.
// Same obligations as SetupBoard: pure, deterministic in (board, config, seed),
// and re-ported to verify/ when changed.
type BoardSeeder interface {
	SetupBoardSeeded(b *board.Board, cfg GameConfig, publicSeed uint64)
}

// Extension is module-owned state stored in State.Ext. Implementations must
// be gob-encodable (register concrete types in the module's init) and
// deep-copyable for Decide's simulation step.
type Extension interface {
	CloneExt() Extension
}

// Viewable extensions contribute a JSON-friendly, per-viewer redacted view to
// full state views.
//
// The returned value must share no map, slice or pointer with the live ext:
// copy every reference field (maps.Clone, slices.Clone, dereference). The view
// is built on the actor goroutine but serialized later on a connection
// goroutine while the actor folds the next command; a shared map then causes
// `fatal error: concurrent map iteration and map write`, which kills the
// process. game/views.go copies the base State's Board, ActiveOffer and
// PendingDiscards for the same reason.
//
// ruletest.TestViewExtSharesNothingWithLiveExt checks this by reflection over
// every registered module.
type Viewable interface {
	ViewExt(viewer PlayerID) any
}

// IdleViewable is an optional companion to Viewable for a module whose view
// carries decision-time information keyed to the viewer rather than a seat (the
// Knights Spy and Master Merchant looks). Seat-keyed data can be filtered by
// seat index; these cannot.
//
// The game layer calls ViewExtIdle instead of ViewExt for a viewer who holds a
// seat a bot is currently playing, so a look the bot opened is not shown to its
// owner. Only the game layer knows a seat is bot-played, so the module says
// what is decision-time private and the caller says whether this viewer is
// deciding.
type IdleViewable interface {
	Viewable
	ViewExtIdle(viewer PlayerID) any
}

// RevealedViewable is the other optional companion to Viewable: a module's view
// once the game is over and nothing needs hiding.
//
// game.NewRevealedReplayView builds a spectator view and patches in every
// seat's hand, dev cards and score, but a module's per-seat private data sits
// inside its ext view behind a `viewer >= 0` gate, so it would stay hidden
// (e.g. Fishermen fish tiles).
//
// A module implements this when its view withholds something per seat.
// ViewExtRevealed takes no viewer: it returns the spectator view with per-seat
// data filled in, keyed by seat. game.NewRevealedReplayView is the only caller
// and runs only for finished games.
type RevealedViewable interface {
	Viewable
	ViewExtRevealed() any
}

// ExtInitializer lets a module put its state in State.Ext at game creation
// rather than on its first event.
//
// Lazily built Ext is invisible to clients until it exists, which is fine only
// when zero is the true starting value. The Knights commodity stacks start at
// twelve with no cak event to fold through setup and the first turn, so without
// this the bank panel's commodity row would appear partway through turn one.
// Computing the size in the client would move a rule (12 + 6 per bracket, see
// ScaleBracket) out of the engine.
//
// Display-motivated only; it changes no rules. ExtRestorer is the restore-time
// counterpart.
//
// Implement it on the Module. Returning nil means nothing to seed.
type ExtInitializer interface {
	InitExt(cfg GameConfig) Extension
}

// ExtBoardInitializer seeds state derived from the board. ExtInitializer
// cannot: it runs on EvGameCreated, before EvBoardGenerated, so s.Board is
// still nil. The Fishermen fishing grounds (deriveGrounds walks the coastline)
// and the Caravans oasis (the desert hex) need the board.
//
// Their accessors (fishExtRO, caravansExtRO) derive without storing, and
// game/views.go publishes only what is in State.Ext, so without this the client
// would draw no weirs, fishing-ground chips, camels or wayposts.
//
// This runs inside the fold, so an implementation must be a pure function of s:
// no clocks, no unseeded randomness, nothing from outside s. Returning nil
// means nothing to seed.
//
// The result is rules-bearing (which vertices catch fish, where the caravans
// start), so it is recorded in the log rather than recomputed; otherwise
// changing a derivation would change how existing games replay. State.New calls
// this once on the Decide side and marshals the result into
// BoardGeneratedData.Ext; Apply calls it again and unmarshals the recorded blob
// over the result, so the log wins on every field it carries. A derivation can
// therefore change for new games without affecting old ones.
//
// Implementations must:
//   - stay pure, because the recording pass and the fold call it separately
//     and must agree;
//   - keep every board-derived field encoding/json-marshallable (a
//     struct-keyed map is not; CaravansExt.Occupied is json:"-" and says why);
//   - not assume a blob is present: logs written before Ext existed carry
//     none and fall back to pure derivation.
//
// TestEveryBoardDerivedModuleRecordsItsLayout and
// TestRecordedLayoutRoundTripsExactly (engine/ruletest) check both ends.
//
// A module may implement both interfaces, but the board pass replaces what
// InitExt seeded (State.Apply assigns Ext[m.Name()] outright). To keep the
// creation-time value, read s.Ext[m.Name()] and return the completed value.
type ExtBoardInitializer interface {
	InitExtBoard(s *State) Extension
}

// ExtRestorer lets an extension repair itself after being decoded from a
// snapshot. State.InitMaps calls it on every value in State.Ext.
//
// gob skips fields that were nil at encode time or did not exist in the binary
// that wrote the blob, so a decoded map can be nil and the next fold writing to
// it panics ("assignment to entry in nil map"). The module knows which of its
// maps the fold writes to, so it repairs them here rather than game/ reaching
// into expansion packages.
//
// Implementations must be idempotent and only fill in what is missing (in
// practice, allocate nil maps), because real events are replayed onto the state
// afterwards.
//
// Only nil is recoverable this way. A field whose zero value is meaningful (a
// NoPlayer(-1) sentinel decoding as seat 0, a count of 12 decoding as 0) needs
// the blob discarded: bump game.snapshotVersion when an Ext gains such a field.
type ExtRestorer interface {
	RestoreExt()
}

var moduleRegistry = map[string]func() Module{}

// routeEventTypes lists module event types that can change longest-route
// standings (ship built/moved). Modules register theirs in init.
var routeEventTypes = map[EventType]bool{}

func RegisterRouteEvent(t EventType) { routeEventTypes[t] = true }

// redactors customize the hidden-payload form of module events: when a
// viewer is not in the Visible list, the registered redactor produces the
// public remainder (default: just the event type).
var redactors = map[EventType]func(e Event) json.RawMessage{}

func RegisterRedactor(t EventType, f func(Event) json.RawMessage) { redactors[t] = f }

// RedactorTypes lists every event type a module has registered a redactor for,
// sorted. Tests such as game.TestRedactionLeavesNoTypedPayload sweep
// this list so a newly registered hidden event is covered automatically.
func RedactorTypes() []EventType {
	out := make([]EventType, 0, len(redactors))
	for t := range redactors {
		out = append(out, t)
	}
	slices.Sort(out)
	return out
}

// RedactorFor returns the module redactor for an event type, if any.
func RedactorFor(t EventType) (func(e Event) json.RawMessage, bool) {
	f, ok := redactors[t]
	return f, ok
}

// terrainOwners maps non-base terrain to the module that gives it meaning;
// maps containing that terrain are only eligible when the module is active.
var terrainOwners = map[board.Resource]string{}

func RegisterTerrain(r board.Resource, moduleName string) { terrainOwners[r] = moduleName }

// FinishedBoardValidator rejects a board whose final geometry cannot support
// the module after every finisher has had a chance to repair it.
type FinishedBoardValidator interface {
	ValidateFinishedBoard(b *board.Board, cfg GameConfig) error
}

// BoardFinisher is implemented by a module whose board work depends on what
// every other module did to the board. State.New runs FinishBoard on all such
// modules after every module's SetupBoard.
//
// SetupBoard hooks run in ruleset-string order, a lexicographic sort with no
// dependency meaning (see CanonicalRuleset): "base+caravans+islands" runs
// Caravans before Islands only because 'c' < 'i'. A module that surveys and
// repairs the board must do it here, where the board is finished.
//
// FinishBoard must be order-independent among its peers: idempotent and correct
// whichever other finishers ran first. Repairing a missing feature qualifies;
// reshaping terrain another module cares about does not. This is not a general
// ordering system.
type BoardFinisher interface {
	FinishBoard(b *board.Board, cfg GameConfig, rng *rand.Rand)
}

// BoardFinisherSlot is an optional companion to BoardFinisher for a module
// whose board derivation needs its own reserved public stream slot instead of
// the shared slot 3.
//
// State.New calls rngFor(publicSeed, 3) once per finisher, and rngFor is pure
// in (seed, seq), so every finisher on slot 3 draws the same numbers. That is
// acceptable for Caravans and Fishermen, which draw only when repairing (rare,
// and at most one per board). A module that draws on every board would share a
// stream with another module, letting one public outcome predict another, which
// seeds.go's registry exists to prevent.
//
// So a finisher that always draws registers a slot in seeds.go and returns it
// here. 3 is the default (the shared slot). The engine still mints the
// generator; the module only names its reservation.
type BoardFinisherSlot interface {
	BoardFinisher
	// FinishBoardSeq is the public stream slot this module's FinishBoard reads
	// from. It must be a value registered in engine/seeds.go and swept by
	// TestPublicSlotsDoNotCollide.
	FinishBoardSeq() int
}

// HexReserver is implemented by a module that will claim hexes off the finished
// board and needs other modules' board derivations to leave them alone.
//
// Wagons reads its trade hexes off the land mask in InitExtBoard, after every
// FinishBoard, while Rivers paints its watercourse in FinishBoard; a river
// estuary wants the coast at far-apart ends, which is where the trade hexes
// come from. Vetoing river hexes from the trade candidates instead would have
// broken the equal-legs property on most boards, so the claim is made first and
// the river routes around it.
//
// ReservedHexes must be a pure function of what no FinishBoard changes (Wagons
// reserves every cape it could pick, a function of the land mask alone),
// because the consumer asks in both FinishBoard and InitExtBoard and the
// answers must match. It takes no seed so the consumer never needs another
// module's stream.
//
// The reservation is a superset of what the module ends up claiming, since
// narrowing it would need the seed. Consumers (currently Rivers) treat reserved
// hexes as ineligible. See docs/rules/wagons.md and docs/rules/rivers.md, "With
// Wagons".
type HexReserver interface {
	ReservedHexes(b *board.Board) []board.Hex
}

// WatercourseSource is implemented by the module that runs a watercourse across
// the finished board (Rivers), so a module placing a whole-hex feature can keep
// it off the channel without importing Rivers.
//
// The Raiders castle is the consumer: castle and river hexes are both drawn as
// tiles, so a castle on a channel hex would break the river. The castle moves
// rather than the river because a HexReserver must depend on the land mask
// alone, and the castle reads terrain.
//
// WatercourseHexes must return the watercourse the game is or will be recorded
// with. It is called from another module's InitExtBoard, where Rivers' ext may
// not be stored yet (ruleset order; nothing is stored on the recording pass),
// so an implementation derives it from the board and public seed when needed.
// The derivation is invariant under its own painting, so the answer matches the
// record.
type WatercourseSource interface {
	WatercourseHexes(s *State) []board.Hex
}

// WatercourseHexes is every hex a watercourse runs through on s's board, for
// every active WatercourseSource. Nil when there is none.
func WatercourseHexes(s *State) map[board.Hex]bool {
	if s == nil || s.Board == nil {
		return nil
	}
	var out map[board.Hex]bool
	for _, m := range s.Modules() {
		w, ok := m.(WatercourseSource)
		if !ok {
			continue
		}
		for _, h := range w.WatercourseHexes(s) {
			if out == nil {
				out = map[board.Hex]bool{}
			}
			out[h] = true
		}
	}
	return out
}

// ReservedHexes is the union of every active module's HexReserver claims on b,
// for the ruleset in cfg. Nil when nothing is reserved, which is every ruleset
// without a reserving module.
func ReservedHexes(cfg GameConfig, b *board.Board) map[board.Hex]bool {
	if b == nil {
		return nil
	}
	var out map[board.Hex]bool
	for _, m := range (&State{Config: cfg}).Modules() {
		r, ok := m.(HexReserver)
		if !ok {
			continue
		}
		for _, h := range r.ReservedHexes(b) {
			if out == nil {
				out = map[board.Hex]bool{}
			}
			out[h] = true
		}
	}
	return out
}

// finishBoardSeq is the public stream slot a finisher reads from: its own
// reservation when it has one, the shared position-3 slot otherwise.
func finishBoardSeq(m Module) int {
	if r, ok := m.(BoardFinisherSlot); ok {
		return r.FinishBoardSeq()
	}
	return boardFinishSeq
}

// AuthoredMapRefuser is implemented by a module whose board is not a terrain
// layout and so cannot be laid over an authored map.
//
// Explorers' board is a partition (home island, home waters, two unexplored
// regions) plus per-region chit stacks and a hidden pool order, none of which
// survives a share code or a preset. Reshaping an authored map would delete it
// (see docs/maps.md).
//
// Checked by MapEligibilityIssues, so the map builder's lint and the lobby's
// validation refuse it with the same message.
type AuthoredMapRefuser interface {
	// RefusesAuthoredMaps returns the reason, for the builder to show.
	RefusesAuthoredMaps() string
}

// RulesetHasRobber reports whether a robber can ever enter play in ruleset:
// false when any of its modules declares Hooks.RobberNeverInPlay. The lobby
// hides the friendly-robber setting where this is false, and the engine
// ignores it there (State.FriendlyRobberActive). An unknown ruleset answers
// true, so nothing is hidden on a string the engine would refuse anyway.
func RulesetHasRobber(ruleset string) bool {
	mods, err := modulesFor(ruleset)
	if err != nil {
		return true
	}
	for _, m := range mods {
		if m.Hooks().RobberNeverInPlay {
			return false
		}
	}
	return true
}

// ValidRulesets is every ruleset string this build accepts, canonically spelled
// and sorted: the powerset of registered modules over "base", plus each
// Standalone alone and with every companion it takes.
//
// Shared by the lobby (every offered ruleset can be created), sim (every one
// can be played to a finish) and engine/ruletest (every victory target is
// priced), so a new module is covered by all three.
func ValidRulesets() []string {
	names := slices.Clone(RegisteredModuleNames())
	slices.Sort(names)
	var out []string
	add := func(rs string) {
		if ValidRuleset(rs) && !slices.Contains(out, rs) {
			out = append(out, rs)
		}
	}
	for mask := range 1 << len(names) {
		var parts []string
		for i, n := range names {
			if mask&(1<<i) != 0 {
				parts = append(parts, n)
			}
		}
		rs := "base"
		if len(parts) > 0 {
			rs = "base+" + strings.Join(parts, "+")
		}
		add(rs)
	}
	// A Standalone's ruleset is its own whole name, so the powerset never reaches
	// it, and it may still take companions (Explorers takes Knights).
	for _, n := range names {
		if !ValidRuleset(n) || ValidRuleset("base+"+n) {
			continue
		}
		others := slices.DeleteFunc(slices.Clone(names), func(m string) bool { return m == n })
		for mask := range 1 << len(others) {
			parts := []string{n}
			for i, m := range others {
				if mask&(1<<i) != 0 {
					parts = append(parts, m)
				}
			}
			slices.Sort(parts)
			add(strings.Join(parts, "+"))
		}
	}
	slices.Sort(out)
	return out
}

// DealsItsOwnMap reports whether any module in this ruleset refuses an authored
// board, and why. A caller holding no board must not invent one for such a
// ruleset, and a caller holding one must drop it before switching.
//
// "No board supplied" and "a board that must not be supplied" need different
// handling: filling a boardless config with a generic hexagon and validating it
// would make an Explorers game impossible to create. See lobby.validateConfig.
func DealsItsOwnMap(ruleset string) (string, bool) {
	mods, err := modulesFor(ruleset)
	if err != nil {
		return "", false
	}
	for _, m := range mods {
		if r, ok := m.(AuthoredMapRefuser); ok {
			return r.RefusesAuthoredMaps(), true
		}
	}
	return "", false
}

// MapChecker is implemented by a module with a non-terrain eligibility rule for
// authored maps (Harbormaster refuses a map with fewer than two of its
// harbours, where the card could never be won). MapIssues sees the framed
// board, as MapEligibilityIssues judges terrain, and returns builder-facing
// Issues (severity "error") or none.
//
// Checked by MapEligibilityIssues, so the map builder's lint, the lobby's
// config validation and engine.New refuse it with the same message.
type MapChecker interface {
	MapIssues(b *board.Board) []board.Issue
}

// MapIssueNeedsHarbours is the Issue code for a module that needs more
// harbours than the map carries (Params: module, min). Named here rather than
// in the module because the transport layer asks MapIssueError about it and
// no layer above the engine imports a module package.
const MapIssueNeedsHarbours = "module_needs_harbours"

// TerrainRequirer is implemented by modules that need certain terrain present
// on curated maps (Islands needs sea). Procedural boards are exempt: the
// module's SetupBoard provides it.
type TerrainRequirer interface {
	RequiredTerrain() []board.Resource
}

// ValidateMap checks map/ruleset eligibility: every special terrain on the map
// has its owning module active, and every active module's required terrain is
// present. See docs/maps.md. It shares its rules with MapEligibilityIssues (the
// builder's lint), so a board the builder accepts is one the lobby accepts.
func ValidateMap(b *board.Board, ruleset string) error {
	if _, err := modulesFor(ruleset); err != nil {
		return err
	}
	if iss := MapEligibilityIssues(b, ruleset); len(iss) > 0 {
		return &MapIssueError{Issue: iss[0]}
	}
	return nil
}

// MapIssueError is ValidateMap's refusal: the first eligibility Issue, kept
// whole so a transport layer can name the reason (its Code and Params) rather
// than collapsing every map/ruleset mismatch into "that setup isn't valid". The
// lobby wraps it in ErrBadConfig, so errors.Is(err, lobby.ErrBadConfig) still
// holds; errors.As recovers the Issue.
type MapIssueError struct {
	Issue board.Issue
}

func (e *MapIssueError) Error() string { return "engine: " + e.Issue.Debug }

// IsIslandsNeedsSea reports whether the issue is Islands asking for open water
// on a map that has none: the one refusal a host reaches by switching Islands
// on over a solid-land map, so it gets its own transport code.
func (e *MapIssueError) IsIslandsNeedsSea() bool {
	return e.Issue.Code == "module_needs_terrain" &&
		e.Issue.Params["module"] == "islands" &&
		e.Issue.Params["terrain"] == board.Sea.String()
}

// IsHarbormasterNeedsHarbours reports whether the issue is Harbormaster asking
// for more harbours than the map carries: a host with one switch on and a map
// to change, so it gets its own transport code as Islands' sea does.
func (e *MapIssueError) IsHarbormasterNeedsHarbours() bool {
	return e.Issue.Code == MapIssueNeedsHarbours && e.Issue.Params["module"] == "harbormaster"
}

// MapEligibilityIssues reports every map/ruleset terrain mismatch as a
// builder-facing Issue (all severity "error"): special terrain whose owning
// module is absent (naming the tiles so the UI can highlight them), and active
// modules whose required terrain is missing. It backs both ValidateMap and the
// map builder's lint. An empty slice means the map is eligible.
//
// Deterministic: issues are sorted by code then by hex, as in board.Lint.
func MapEligibilityIssues(b *board.Board, ruleset string) []board.Issue {
	mods, err := modulesFor(ruleset)
	if err != nil {
		return []board.Issue{{
			Severity: "error",
			Code:     "bad_ruleset",
			Debug:    "This map's expansion set isn't valid.",
			Hexes:    []board.Hex{},
		}}
	}
	active := map[string]bool{}
	for _, m := range mods {
		active[m.Name()] = true
	}
	// Judge eligibility against the board that will be played. The ocean is
	// computed by Frame, not authored (the gallery and map builder paint land
	// only; see docs/maps.md), so Islands' open-water requirement must be
	// checked after framing. Frame is idempotent and skips full-hexagon land
	// boards, so engine.New (which already framed) and standard maps are
	// unaffected. Work on a clone to leave the caller's board intact.
	framed := b.Clone()
	framed.Frame()
	b = framed
	hexesByRes := map[board.Resource][]board.Hex{}
	for h, t := range b.Tiles {
		hexesByRes[t.Res] = append(hexesByRes[t.Res], h)
	}

	var out []board.Issue
	// A module whose board is not a terrain layout refuses an authored map
	// before any terrain check.
	for _, m := range mods {
		r, ok := m.(AuthoredMapRefuser)
		if !ok {
			continue
		}
		out = append(out, board.Issue{
			Severity: "error",
			Code:     "module_refuses_map",
			Params:   map[string]any{"module": m.Name()},
			Debug:    r.RefusesAuthoredMaps(),
			Hexes:    []board.Hex{},
		})
	}
	// Special terrain needs its owning module enabled.
	for res, hexes := range hexesByRes {
		owner, owned := terrainOwners[res]
		if !owned || active[owner] {
			continue
		}
		sortHexes(hexes)
		out = append(out, board.Issue{
			Severity: "error",
			Code:     "terrain_needs_module",
			// Named parameters, not a sentence: the client composes the wording
			// and picks its own terrain and expansion vocabulary.
			Params: map[string]any{"terrain": res.String(), "module": owner},
			Debug:  terrainNeedsModuleMsg(res, owner),
			Hexes:  hexes,
		})
	}
	// Active modules need their required terrain present.
	for _, m := range mods {
		tr, ok := m.(TerrainRequirer)
		if !ok {
			continue
		}
		for _, res := range tr.RequiredTerrain() {
			if len(hexesByRes[res]) > 0 {
				continue
			}
			out = append(out, board.Issue{
				Severity: "error",
				Code:     "module_needs_terrain",
				Params:   map[string]any{"module": m.Name(), "terrain": res.String()},
				Debug:    moduleNeedsTerrainMsg(m.Name(), res),
				Hexes:    []board.Hex{},
			})
		}
	}
	// Module rules about the map that are not terrain (Harbormaster's harbour
	// count). See MapChecker.
	for _, m := range mods {
		if mc, ok := m.(MapChecker); ok {
			out = append(out, mc.MapIssues(b)...)
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Code != out[j].Code {
			return out[i].Code < out[j].Code
		}
		return firstHexLess(out[i].Hexes, out[j].Hexes)
	})
	return out
}

func sortHexes(hs []board.Hex) {
	sort.SliceStable(hs, func(i, j int) bool {
		if hs[i].Q != hs[j].Q {
			return hs[i].Q < hs[j].Q
		}
		return hs[i].R < hs[j].R
	})
}

func firstHexLess(a, c []board.Hex) bool {
	var x, y board.Hex
	if len(a) > 0 {
		x = a[0]
	}
	if len(c) > 0 {
		y = c[0]
	}
	if x.Q != y.Q {
		return x.Q < y.Q
	}
	return x.R < y.R
}

// terrainLabels / moduleLabels give the player-facing names for the otherwise
// internal terrain and module identifiers used in eligibility messages.
var terrainLabels = map[board.Resource]string{board.Gold: "Gold", board.Lake: "Lake", board.Swamp: "Swamp"}
var moduleLabels = map[string]string{"islands": "Islands", "fishermen": "Fishermen", "rivers": "Rivers"}

func terrainLabel(r board.Resource) string {
	if s, ok := terrainLabels[r]; ok {
		return s
	}
	return r.String()
}

func moduleLabel(m string) string {
	if s, ok := moduleLabels[m]; ok {
		return s
	}
	return m
}

func terrainNeedsModuleMsg(res board.Resource, module string) string {
	return fmt.Sprintf("%s tiles need the %s expansion enabled.", terrainLabel(res), moduleLabel(module))
}

func moduleNeedsTerrainMsg(module string, res board.Resource) string {
	if module == "islands" && res == board.Sea {
		return "Islands maps need open water. Paint some sea tiles."
	}
	return fmt.Sprintf("The %s expansion needs %s terrain on the map.", moduleLabel(module), terrainLabel(res))
}

// ValidatePresetRuleset is the lobby-time eligibility check for a curated map
// + ruleset combination.
func ValidatePresetRuleset(preset string, players int, ruleset string) error {
	b, err := board.PresetBoard(preset, players, rand.New(rand.NewPCG(0, 0)))
	if err != nil {
		return err
	}
	return ValidateMap(b, ruleset)
}

// RegisterModule makes a module available to rulesets (call from module init).
func RegisterModule(name string, factory func() Module) {
	moduleRegistry[name] = factory
}

// RegisteredModuleNames returns every module name a ruleset can name, sorted.
//
// verify/verify_test.go uses it to require every registered module in the
// cross-language table, since a module whose board hook was not ported to
// verify/ would fail the fairness audit on honest games.
func RegisteredModuleNames() []string {
	out := make([]string, 0, len(moduleRegistry))
	for name := range moduleRegistry {
		out = append(out, name)
	}
	sort.Strings(out)
	return out
}

// Standalone marks modules that cannot combine with anything else, not even
// the base ruleset name.
type Standalone interface {
	Standalone()
}

// StandaloneWith is a Standalone that names the modules it may still sit
// beside. Anything else is refused, and "base" is always refused: a
// standalone's board and setup replace the base game.
//
// Explorers is the only implementation: its one defined combination is with
// Knights, and the Conflicts table refuses every other partner with its own
// reason. Dropping Standalone instead would change its canonical ruleset string
// from "explorers" to "base+explorers".
type StandaloneWith interface {
	Standalone
	StandaloneCompanions() []string
}

// modulesFor parses a ruleset string ("base", "base+islands", "eap") into its
// module list. "base" contributes no module.
//
// Every part must be a distinct registered name; a repeated or empty part is an
// error. A ruleset can arrive from an uploaded event log (POST
// /api/replay/frames) and Modules caches resolutions by raw string in a
// process-global map, so accepting "base++cak" or "+cak" repeated thousands of
// times would let a caller grow the cache without bound and build huge module
// lists. With both refused the accepted strings are a small finite set, and
// refusal comes early in the walk.
//
// Order among parts is preserved and significant (see CanonicalRuleset): a game
// played under "base+caravans+cak" must keep resolving in that order, so this
// rejects and never rewrites.
func modulesFor(ruleset string) ([]Module, error) {
	// An empty ruleset is the base game with no modules. New resolves modules
	// before withDefaults fills the name in, so "" arrives here routinely; it
	// differs from an empty part of a longer name.
	if ruleset == "" {
		return nil, nil
	}
	var names []string
	seen := map[string]bool{}
	for part := range strings.SplitSeq(ruleset, "+") {
		if part == "" {
			return nil, fmt.Errorf("engine: ruleset %q has an empty part", clipRuleset(ruleset))
		}
		if seen[part] {
			return nil, fmt.Errorf("engine: module %q appears twice in ruleset", clipRuleset(part))
		}
		seen[part] = true
		if part == "base" {
			continue
		}
		names = append(names, part)
	}
	// Check compatibility before the registry lookup: two modules that refuse
	// each other do so whether or not this binary has both, and "explorers and
	// Islands cannot be combined" is more useful than `unknown module
	// "explorers"`. compat.go's tables name every specified expansion,
	// including ones not registered yet.
	if conflicts := RulesetConflicts(ruleset); len(conflicts) > 0 {
		return nil, &ConflictError{Conflict: conflicts[0]}
	}
	var out []Module
	for _, part := range names {
		factory, ok := moduleRegistry[part]
		if !ok {
			return nil, fmt.Errorf("engine: unknown module %q in ruleset", clipRuleset(part))
		}
		out = append(out, factory())
	}
	// A Standalone brings its own board, setup and victory condition, so it is
	// its own ruleset: never with "base", and never with a partner it has not
	// named (StandaloneWith). Explorers takes Knights only; see "Knights in an
	// Explorers game" in docs/rules/explorers.md. Making Explorers an ordinary
	// module would canonicalise it to "base+explorers" and rename every stored
	// game and stat keyed on the string.
	for _, m := range out {
		if _, alone := m.(Standalone); !alone {
			continue
		}
		if seen["base"] {
			return nil, fmt.Errorf("engine: %q is a standalone ruleset and does not take the base game", m.Name())
		}
		companions := map[string]bool{}
		if w, ok := m.(StandaloneWith); ok {
			for _, c := range w.StandaloneCompanions() {
				companions[c] = true
			}
		}
		for _, other := range out {
			if other.Name() == m.Name() || companions[other.Name()] {
				continue
			}
			return nil, fmt.Errorf("engine: %q is a standalone ruleset and cannot be combined with %q", m.Name(), other.Name())
		}
	}
	return out, nil
}

// clipRuleset bounds a caller-supplied ruleset before it lands in an error
// message. The string arrives off the wire on the replay-upload path and the
// error is written straight back to whoever sent it, so a megabyte of "+cak"
// must not come back as a megabyte of response.
func clipRuleset(r string) string {
	const limit = 64
	if len(r) <= limit {
		return r
	}
	return r[:limit] + "..."
}

// CheckRuleset resolves a ruleset and returns why it does not, if it does not.
//
// This is the single admission point for rulesets: game creation
// (lobby.validateConfig) and replay upload (replay.Fold). A refused pairing is
// a *ConflictError, so the lobby can give "these expansions cannot be combined"
// and "not a module" different transport codes.
func CheckRuleset(ruleset string) error {
	_, err := modulesFor(ruleset)
	return err
}

// ValidRuleset reports whether every part of a ruleset resolves and no pair of
// its modules refuses another.
func ValidRuleset(ruleset string) bool {
	return CheckRuleset(ruleset) == nil
}

// moduleCache memoizes resolved module slices by ruleset for the whole process
// rather than per State, so Modules() does not write to its receiver (it is
// called from bot/ and game/views.go, possibly off the actor goroutine).
//
// The key space is finite because modulesFor only succeeds for orderings of
// distinct registered names; otherwise a replay upload could grow this map
// without bound.
//
// Sharing is safe: resolution is a pure function of the string, module
// instances carry no state (that is in State.Ext), moduleRegistry is written
// only at init, and the slice is never mutated after construction.
var moduleCache sync.Map // ruleset string -> []Module

// Modules resolves the state's active modules from its ruleset. Resolution is
// stateless (module instances carry no state; that lives in State.Ext), so
// nothing module-related needs serializing or cloning. It does not write to the
// receiver; see moduleCache.
func (s *State) Modules() []Module {
	if s.Config.Ruleset == "" || s.Config.Ruleset == "base" {
		return nil
	}
	if cached, ok := moduleCache.Load(s.Config.Ruleset); ok {
		if mods, ok := cached.([]Module); ok {
			return mods
		}
	}
	mods, err := modulesFor(s.Config.Ruleset)
	if err != nil {
		// The ruleset was validated at game creation; failure here means a
		// binary running without the module compiled in.
		panic(fmt.Sprintf("engine: ruleset %q: %v", clipRuleset(s.Config.Ruleset), err))
	}
	// LoadOrStore, not Store: concurrent resolutions of one ruleset must return
	// the same slice, since module identity is used for Ext keys and hook
	// ordering.
	actual, _ := moduleCache.LoadOrStore(s.Config.Ruleset, mods)
	if shared, ok := actual.([]Module); ok {
		return shared
	}
	return mods
}

// CanonicalRuleset normalises a ruleset string to its canonical spelling:
// "base" first if present, then each module name once, sorted
// lexicographically.
//
// Order matters at resolution: modulesFor preserves it and State.New applies
// DefaultConfig in that order, so "base+cak+caravans" (13 VP, first writer
// wins) and "base+caravans+cak" (12 VP) are different games. Canonicalising
// removes that ambiguity.
//
// Apply it only where a game is created, never inside modulesFor or Modules.
// Config.Ruleset is in the event log, and a game persisted under a
// non-canonical string must keep resolving in the order it was played, or
// replay would diverge.
//
// Lexicographic order is total, stable across builds (registry order depends on
// map iteration and blank-import order), and needs no upkeep. It has no
// dependency meaning; modules that must run in a particular relation say so at
// their hook.
func CanonicalRuleset(ruleset string) string {
	var base bool
	var mods []string
	seen := make(map[string]bool)
	for part := range strings.SplitSeq(ruleset, "+") {
		switch {
		case part == "":
		case part == "base":
			base = true
		case seen[part]:
		default:
			seen[part] = true
			mods = append(mods, part)
		}
	}
	if len(mods) == 1 && !base {
		// A standalone ruleset ("eap") is its own whole name; leave it alone.
		if f, ok := moduleRegistry[mods[0]]; ok {
			if _, alone := f().(Standalone); alone {
				return mods[0]
			}
		}
	}
	if !base && len(mods) == 0 {
		return ruleset
	}
	slices.Sort(mods)
	if base {
		mods = append([]string{"base"}, mods...)
	}
	return strings.Join(mods, "+")
}

// ModuleExtViews collects every active module's redacted view of its own Ext,
// keyed by module name, in the shape a client receives under `ext`.
//
// Used by `cmd/costan-sim -dump-view` and the board preview endpoint. Several
// modules keep a second board layer in Ext (fishing grounds, Caravans oasis,
// Rivers watercourse, Raiders castle and coast), so drawing a generated board
// needs this alongside the board.
//
// Modules with no Ext yet, or not Viewable, are omitted rather than set to
// null.
//
// Call it on the goroutine that owns the state, as with ViewExt.
func ModuleExtViews(s *State, viewer PlayerID) map[string]any {
	out := map[string]any{}
	for _, m := range s.Modules() {
		x, ok := s.Ext[m.Name()]
		if !ok {
			continue
		}
		if v, ok := x.(Viewable); ok {
			out[m.Name()] = v.ViewExt(viewer)
			if c, ok := x.(ComposedViewable); ok {
				out[m.Name()] = c.ComposeView(s, out[m.Name()])
			}
		}
	}
	return out
}
