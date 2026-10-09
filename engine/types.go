// Package engine implements the rules of the base game and its expansions. It is pure: no I/O, no clocks,
// no unseeded randomness. The contract with the rest of the system is
// Decide(state, command) → events, and Apply(state, event) folding events into
// state. Replaying a game's event log always reproduces its state exactly.
package engine

import (
	"encoding/json"

	"github.com/ftqo/costan.io/engine/board"
)

// PlayerID is a seat index (0..N-1). User identity lives outside the engine.
type PlayerID int

const NoPlayer PlayerID = -1

type CommandType string

const (
	CmdPlaceSettlement CommandType = "place_settlement"
	CmdPlaceRoad       CommandType = "place_road"
	CmdRollDice        CommandType = "roll_dice"
	CmdDiscardCards    CommandType = "discard_cards"
	CmdMoveRobber      CommandType = "move_robber"
	CmdBuildRoad       CommandType = "build_road"
	CmdBuildSettlement CommandType = "build_settlement"
	CmdBuildCity       CommandType = "build_city"
	CmdEndTurn         CommandType = "end_turn"
	CmdBankTrade       CommandType = "bank_trade"
	CmdOfferTrade      CommandType = "offer_trade"
	CmdRespondTrade    CommandType = "respond_trade"
	CmdExecuteTrade    CommandType = "execute_trade"
	CmdCancelTrade     CommandType = "cancel_trade"
	CmdCounterTrade    CommandType = "counter_trade"
	CmdBuyDevCard      CommandType = "buy_dev_card"
	CmdPlayDevCard     CommandType = "play_dev_card"

	// Ending a game the players cannot finish (see engine/concede.go).
	CmdSurrender   CommandType = "surrender"
	CmdOfferDraw   CommandType = "offer_draw"
	CmdRespondDraw CommandType = "respond_draw"
	// CmdCancelDraw withdraws an open offer. Owner-only; the game layer also
	// issues it on the owner's behalf when the offer's expiry elapses.
	CmdCancelDraw CommandType = "cancel_draw"
	// CmdClaimGame ends a game in which every other seat is played by a bot. The
	// engine enforces only the turn threshold and the "actually ahead" test; the
	// game layer, which knows seat status, refuses it otherwise (see
	// game.Actor.execute).
	CmdClaimGame CommandType = "claim_game"
)

type Command struct {
	Player PlayerID        `json:"player"`
	Type   CommandType     `json:"type"`
	Data   json.RawMessage `json:"data,omitempty"`
}

type EventType string

const (
	EvGameCreated     EventType = "game_created"
	EvBoardGenerated  EventType = "board_generated"
	EvSettlementPlace EventType = "settlement_placed"
	EvSetupCityPlace  EventType = "setup_city_placed" // round-2 setup city (Knights)
	EvRoadPlaced      EventType = "road_placed"
	EvSetupAdvanced   EventType = "setup_advanced" // a module setup-ship stands in for the road

	EvStartingRes     EventType = "starting_resources"
	EvTurnStarted     EventType = "turn_started"
	EvDiceRolled      EventType = "dice_rolled"
	EvResDistributed  EventType = "resources_distributed"
	EvDiscardsReq     EventType = "discards_required"
	EvCardsDiscarded  EventType = "cards_discarded"
	EvRobberMoved     EventType = "robber_moved"
	EvCardStolen      EventType = "card_stolen"
	EvRoadBuilt       EventType = "road_built"
	EvSettlementBuilt EventType = "settlement_built"
	EvCityBuilt       EventType = "city_built"
	EvTurnEnded       EventType = "turn_ended"
	EvGameFinished    EventType = "game_finished"
	EvBankTraded      EventType = "bank_traded"
	EvTradeOffered    EventType = "trade_offered"
	EvTradeResponded  EventType = "trade_responded"
	EvTradeExecuted   EventType = "trade_executed"
	EvTradeCancelled  EventType = "trade_cancelled"
	// evTradeCanceledLegacy is the US spelling ("canceled") that was briefly
	// written by a misspell autofix before being reverted. Event types are persisted
	// schema, so logs from that window still carry it; Apply must keep decoding it as
	// EvTradeCancelled (see the alias case in engine/state.go).
	evTradeCanceledLegacy EventType = "trade_canceled"
	EvTradeCountered      EventType = "trade_countered"
	EvDevCardBought       EventType = "dev_card_bought"
	EvKnightPlayed        EventType = "knight_played"
	EvRoadBuilding        EventType = "road_building_played"
	EvYearOfPlenty        EventType = "year_of_plenty"
	EvMonopoly            EventType = "monopoly_resolved"
	EvLongestRoad         EventType = "longest_road"
	EvLargestArmy         EventType = "largest_army"

	// Conceding and drawing (see engine/concede.go). Each is followed by
	// EvGameFinished when it ends the game, so every finish flows through one
	// event.
	EvSurrendered   EventType = "player_surrendered"
	EvDrawOffered   EventType = "draw_offered"
	EvDrawResponded EventType = "draw_responded"
	EvDrawCancelled EventType = "draw_cancelled"
	EvGameClaimed   EventType = "game_claimed"
)

// DevCard indexes the development card arrays.
type DevCard int8

const (
	DevKnight DevCard = iota
	DevVictoryPoint
	DevRoadBuilding
	DevYearOfPlenty
	DevMonopoly
	devCardKinds
)

// MinPlayers and MaxPlayers bound a game's seat count. New refuses a config
// outside the range and Apply refuses such an EvGameCreated, so every state this
// package returns has a valid Players. (lobby.validateConfig checks the same range
// earlier, with a message a player can act on.)
//
// Players sizes the seat slice, the bank, the dev deck and per-seat module
// allocations, and POST /api/replay/frames folds caller-supplied logs, so an
// unbounded count would be a 16 GB make() from a tiny request.
const (
	MinPlayers = 2
	MaxPlayers = 10
)

// ScaleBracket is 0 for 3-4 players, 1 for 5-6, 2 for 7-8, 3 for 9-10. Each
// bracket adds one 5-6 player extension's worth of components (extrapolated
// beyond 6).
//
// Exported because modules size their own supplies off the same brackets (the
// Knights commodity stacks scale +6 per bracket as the bank scales +5), and both
// must agree on where a bracket begins.
func ScaleBracket(players int) int {
	if players <= 4 {
		return 0
	}
	return (players - 3) / 2
}

// BankPerResource follows the 5-6 player bracket (+5 per bracket).
func BankPerResource(players int) int {
	return 19 + 5*ScaleBracket(players)
}

// DevDeckFor scales the base deck (14 knights, 5 VP, 2 of each progress card) by
// player bracket. The 5-6 player bracket adds +6 knights and +3 VP and no
// progress cards, so knights and VP scale per bracket while the three progress
// cards stay at 2. Brackets beyond 6 players extrapolate that same pattern.
func DevDeckFor(players int) DevHand {
	b := ScaleBracket(players)
	return DevHand{14 + 6*b, 5 + 3*b, 2, 2, 2}
}

type DevHand [devCardKinds]int

func (d DevHand) Count() int {
	n := 0
	for _, c := range d {
		n += c
	}
	return n
}

// Event is one entry in a game's append-only log.
type Event struct {
	Seq  int             `json:"seq"`
	Type EventType       `json:"type"`
	Data json.RawMessage `json:"data"`
	// Visible lists the seats that may see the full payload; nil = public.
	// Redaction itself happens outside the engine.
	Visible []PlayerID `json:"visible,omitempty"`

	// Src is provenance: whether a seated human caused this event or the server
	// did in their place (timeout, auto-pass, bot). Stamped by the game layer
	// between Decide and the store write; the engine neither sets nor reads it.
	// Omitted from JSON when zero, so old events look unchanged on the wire. See
	// source.go.
	Src Source `json:"src,omitempty"`

	// Payload is an in-memory cache of the decoded Data, set by mustEvent so
	// Apply/decode can skip a JSON unmarshal on the bot simulation hot path. Data
	// stays authoritative (it is what the store, wire and replay use); events loaded
	// from the store have Payload == nil and decode falls back to Data. Never
	// persisted (json:"-") and must never diverge from Data.
	Payload any `json:"-"`
}

// GameConfig is fixed at game creation.
type GameConfig struct {
	Players      int    `json:"players"`
	TargetVP     int    `json:"target_vp"`        // default 10
	DiscardLimit int    `json:"discard_limit"`    // hand size above which a 7 forces discards; default 7
	TurnTimerSec int    `json:"turn_timer_sec"`   // per-decision budget; config requires > 0, engine stays defensive on 0
	Ruleset      string `json:"ruleset"`          // "base", "base+islands", ...
	Preset       string `json:"preset,omitempty"` // named map preset; empty = procedural
	// Board, when set, is a custom map inlined into the config (resolved and
	// validated by the lobby). It takes precedence over Preset/procedural, so
	// the engine stays pure and replays stay deterministic from the event log.
	Board *board.Board `json:"board,omitempty"`
	// DiceMode: "random" (default) rolls true seeded dice; "fair" draws from a
	// shuffled deck of all 36 outcomes (smooth distribution). Both derive
	// from the committed seed, so both are provably fair. See docs/dice.md.
	DiceMode string `json:"dice_mode,omitempty"`
	// BoardMode: "fair" (default) balances number spacing and resource pips on
	// top of the no-adjacent-6/8 rule; "random" shuffles with only that rule.
	// See docs/maps.md.
	BoardMode string `json:"board_mode,omitempty"`
	// TurnOrder controls how seats map to turn order at game start: "random"
	// (default) shuffles; "lobby" keeps seat/join order. The lobby applies it
	// by permuting seats; the engine never reads it.
	TurnOrder string `json:"turn_order,omitempty"`
	// FriendlyRobber, when set, shields players still at their starting score
	// (public VP <= State.FriendlyRobberMaxVP: 2, or 3 where setup deals a city)
	// from the robber: they cannot be stolen from, and the robber may not be
	// parked on a hex reaching only protected players while an unprotected target
	// is reachable elsewhere. It keys off public VP only, so it leaks nothing
	// hidden. Ignored, and cleared by the lobby, in a ruleset with no robber
	// (RulesetHasRobber).
	FriendlyRobber bool `json:"friendly_robber,omitempty"`
	// ShowBank controls only the client UI: whether the remaining bank supply is
	// displayed. nil/absent = shown (default); false = hidden. The engine never
	// reads it, and the bank stays in the redacted view regardless (clients need it
	// for trade validation and gold/Year of Plenty picks).
	ShowBank *bool `json:"show_bank,omitempty"`
	// ShowImprovements controls only the client UI: whether every seat's
	// city-improvement levels (Trade/Politics/Science) are drawn in the player
	// rail. nil/absent = shown (default); false = hidden. Display-only like
	// ShowBank; the levels stay in the redacted view (a client needs them to
	// price its own upgrades). Meaningful only with the Knights module.
	ShowImprovements *bool `json:"show_improvements,omitempty"`
	// MemoryMode bundles the display cuts for a table that wants no bookkeeping
	// done for it: the bank's remaining supply is hidden (the player's own stock
	// to place stays), every seat's VP total leaves the player rail (award chips
	// for sources the board cannot show, such as Longest Road, Largest Army,
	// barbarian defence and kept VP cards, stay), and event log lines fade a few
	// seconds after they arrive.
	//
	// Off by default. Ranked games lock it on (see ranked.ConfigFor), so the
	// rating measures play rather than the readouts.
	//
	// Display-only like ShowBank: the engine never reads it and no view is
	// redacted differently for it.
	MemoryMode bool `json:"memory_mode,omitempty"`
	// Modules holds per-module options, keyed by module name; each module
	// parses (and defaults) its own blob.
	Modules map[string]json.RawMessage `json:"modules,omitempty"`
}

func (c GameConfig) withDefaults() GameConfig {
	if c.TargetVP == 0 {
		c.TargetVP = 10
	}
	if c.DiscardLimit == 0 {
		c.DiscardLimit = 7
	}
	if c.Ruleset == "" {
		c.Ruleset = "base"
	}
	if c.DiceMode == "" {
		c.DiceMode = DiceRandom
	}
	if c.BoardMode == "" {
		c.BoardMode = board.BoardFair
	}
	return c
}

const (
	DiceRandom = "random"
	DiceFair   = "fair"
)

const (
	TurnOrderLobby  = "lobby"
	TurnOrderRandom = "random"
)

// Hand is a resource multiset, indexed by board.Resource (index 0 unused).
type Hand [6]int

func (h Hand) Count() int {
	n := 0
	for _, c := range h {
		n += c
	}
	return n
}

func (h Hand) Has(o Hand) bool {
	for i := range h {
		if h[i] < o[i] {
			return false
		}
	}
	return true
}

func (h *Hand) Add(o Hand) {
	for i := range h {
		h[i] += o[i]
	}
}

func (h *Hand) Sub(o Hand) {
	for i := range h {
		h[i] -= o[i]
	}
}

func (h Hand) NonNegative() bool {
	for _, c := range h {
		if c < 0 {
			return false
		}
	}
	return true
}

var (
	CostRoad       = Hand{board.Wood: 1, board.Brick: 1}
	CostSettlement = Hand{board.Wood: 1, board.Brick: 1, board.Sheep: 1, board.Wheat: 1}
	CostCity       = Hand{board.Ore: 3, board.Wheat: 2}
	CostDevCard    = Hand{board.Ore: 1, board.Sheep: 1, board.Wheat: 1}
)

// Piece limits per player (base game).
const (
	MaxRoads       = 15
	MaxSettlements = 5
	MaxCities      = 4
)
