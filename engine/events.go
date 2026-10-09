package engine

import (
	"encoding/json"
	"fmt"

	"github.com/ftqo/costan.io/engine/board"
)

// GameCreatedData carries both seeds (hidden until game end) and their public
// commitments for the provable-fairness audit (docs/dice.md).
//
// PublicSeed and PublicSeedCommit are omitempty so a log from before the seed
// split decodes to zero values; an empty PublicSeedCommit tells Apply one seed
// drove everything.
type GameCreatedData struct {
	Config     GameConfig `json:"config"`
	Seed       uint64     `json:"seed"`
	SeedCommit string     `json:"seed_commit"`
	// PublicSeed drives every outcome a player can see: dice, the fair-dice
	// deck, the event die, board generation, seat order. Its commitment is
	// published when the lobby opens, not at start, so it is fixed before
	// anyone knows who will be at the table.
	PublicSeed       uint64 `json:"public_seed,omitempty"`
	PublicSeedCommit string `json:"public_seed_commit,omitempty"`
	// DerivationVersion records which set of published derivations built this
	// game, so a later audit can tell "cannot reproduce" from "rigged". Stamped at
	// creation and never rewritten; games from before versioning lack it and are
	// reported unauditable. See engine.DerivationVersion.
	DerivationVersion int `json:"derivation_version,omitempty"`
}

type BoardGeneratedData struct {
	Board *board.Board `json:"board"`

	// Ext is the board-derived module state, recorded rather than recomputed: one
	// JSON blob per module implementing ExtBoardInitializer, keyed by
	// Module.Name(). These values are rules-bearing (which vertices catch fish,
	// which edges a caravan starts on), so re-deriving them on every fold would let
	// a derivation change in a newer binary alter old games.
	//
	// Recorded on the Decide side (engine.New) and restored in Apply by
	// unmarshalling over a freshly derived value, so a field the log carries always
	// wins and a missing field keeps the derived default. When a module's key is
	// absent (logs from before this field) Apply falls back to pure derivation.
	Ext map[string]json.RawMessage `json:"ext,omitempty"`
}

type SettlementPlacedData struct {
	Player PlayerID     `json:"player"`
	V      board.Vertex `json:"v"`
}

type RoadPlacedData struct {
	Player PlayerID   `json:"player"`
	E      board.Edge `json:"e"`
}

type StartingResData struct {
	Player PlayerID `json:"player"`
	Gain   Hand     `json:"gain"`
}

type TurnStartedData struct {
	Player PlayerID `json:"player"`
}

type DiceRolledData struct {
	Player PlayerID `json:"player"`
	D1     int      `json:"d1"`
	D2     int      `json:"d2"`
	// Fixed marks a roll a module declared rather than the seed produced: today
	// only the Knights Alchemist, whose holder names both dice. Such a roll is not
	// derivable from the public seed, so this tells the fairness audit which rolls
	// to exempt (verify/, docs/dice.md). The Alchemist play is a public event, so a
	// flagged roll without one in the log is visible. omitempty leaves ordinary
	// rolls unchanged on the wire.
	Fixed bool `json:"fixed,omitempty"`
}

type PlayerGain struct {
	Player PlayerID `json:"player"`
	Gain   Hand     `json:"gain"`
}

type ResDistributedData struct {
	Gains []PlayerGain `json:"gains"`
}

type PlayerDiscard struct {
	Player PlayerID `json:"player"`
	Count  int      `json:"count"`
}

type DiscardsReqData struct {
	Required []PlayerDiscard `json:"required"`
}

type CardsDiscardedData struct {
	Player PlayerID `json:"player"`
	Cards  Hand     `json:"cards"`
}

type RobberMovedData struct {
	Player PlayerID  `json:"player"`
	Hex    board.Hex `json:"hex"`
}

// CardStolenData's Res is the hidden part; redaction blanks it for everyone
// but thief and victim.
type CardStolenData struct {
	Thief  PlayerID       `json:"thief"`
	Victim PlayerID       `json:"victim"`
	Res    board.Resource `json:"res"`
}

type BuiltData struct {
	Player PlayerID      `json:"player"`
	V      *board.Vertex `json:"v,omitempty"`
	E      *board.Edge   `json:"e,omitempty"`
	Free   bool          `json:"free,omitempty"` // road-building roads
}

type BankTradedData struct {
	Player PlayerID `json:"player"`
	Give   Hand     `json:"give"`
	Get    Hand     `json:"get"`
}

type TradeOfferedData struct {
	Player PlayerID `json:"player"`
	Give   Hand     `json:"give"`
	Want   Hand     `json:"want"`
	// GiveCom/WantCom carry an opaque module payload (Knights commodities) the base
	// engine never inspects; modules validate and move it via trade hooks.
	GiveCom json.RawMessage `json:"give_com,omitempty"`
	WantCom json.RawMessage `json:"want_com,omitempty"`
}

type TradeCounteredData struct {
	Player  PlayerID        `json:"player"`
	Give    Hand            `json:"give"`
	Want    Hand            `json:"want"`
	GiveCom json.RawMessage `json:"give_com,omitempty"`
	WantCom json.RawMessage `json:"want_com,omitempty"`
}

// TradeRespondedData is one seat's current answer to the standing offer. The
// latest answer wins, so accept→decline→accept is legal. Retract withdraws the
// answer entirely (Accept is then meaningless); it defaults to false, so older
// responses decode unchanged.
type TradeRespondedData struct {
	Player  PlayerID `json:"player"`
	Accept  bool     `json:"accept"`
	Retract bool     `json:"retract,omitempty"`
}

type TradeExecutedData struct {
	By   PlayerID `json:"by"`
	With PlayerID `json:"with"`
	Give Hand     `json:"give"`
	Want Hand     `json:"want"`
}

// DevCardBoughtData's Card is hidden from everyone but the buyer. Free draws
// (fish markets and the like) skip the cost.
type DevCardBoughtData struct {
	Player PlayerID `json:"player"`
	Card   DevCard  `json:"card"`
	Free   bool     `json:"free,omitempty"`
}

type DevPlayedData struct {
	Player PlayerID `json:"player"`
}

type YearOfPlentyData struct {
	Player PlayerID `json:"player"`
	Gain   Hand     `json:"gain"`
}

type MonopolyTake struct {
	Player PlayerID `json:"player"`
	Count  int      `json:"count"`
}

type MonopolyData struct {
	Player PlayerID       `json:"player"`
	Res    board.Resource `json:"res"`
	Takes  []MonopolyTake `json:"takes"`
}

type TitleData struct {
	Holder PlayerID `json:"holder"` // NoPlayer when the title is lost
}

type TurnEndedData struct {
	Player PlayerID `json:"player"`
}

// GameFinishedData ends the game. Winner is NoPlayer for a drawn game (an
// accepted draw offer, or a claim by a player who was not ahead), in which case
// VP is 0: there is no winner to score.
type GameFinishedData struct {
	Winner PlayerID `json:"winner"`
	VP     int      `json:"vp"`
	// Scores is every seat's final total, hidden victory-point cards included,
	// indexed by seat. Public, since the game is over; a spectator's redacted log
	// has the VP cards stripped from its draws, so it needs these to fold the same
	// final seat cards (game/views.go reads State.FinalVP). Older logs omit it and
	// fold with FinalVP empty.
	Scores []int `json:"scores,omitempty"`
}

// SurrenderedData records the seat that conceded a duel. The EvGameFinished
// that follows names the opponent as winner.
type SurrenderedData struct {
	Player PlayerID `json:"player"`
}

type DrawOfferedData struct {
	Player PlayerID `json:"player"`
}

// DrawCancelledData records an offer withdrawn by its owner, or by the game
// layer when its expiry elapsed.
type DrawCancelledData struct {
	Player PlayerID `json:"player"`
}

type DrawRespondedData struct {
	Player PlayerID `json:"player"`
	Accept bool     `json:"accept"`
}

// GameClaimedData records a claim against an all-bot table. Winner is the
// claimer when they were strictly ahead, and NoPlayer when they were not (the
// claim then resolves as a draw).
type GameClaimedData struct {
	Player PlayerID `json:"player"`
	Winner PlayerID `json:"winner"`
}

func mustEvent(typ EventType, data any, visible ...PlayerID) Event {
	raw, err := json.Marshal(data)
	if err != nil {
		panic(fmt.Sprintf("engine: marshal %s: %v", typ, err)) // structs above always marshal
	}
	e := Event{Type: typ, Data: raw, Visible: visible}
	// Cache the typed payload beside the authoritative JSON so the in-process path
	// (Apply, bot simulation) can skip json.Unmarshal. Data remains the source of
	// truth. Events carrying *board.Board are not cached: their Apply keeps the
	// pointer, so a shared payload would alias one mutable board across states.
	// They fire once per game, so the JSON round-trip (a deep copy) is cheap. Hot
	// per-turn events copy scalars out and keep no reference, so caching is safe.
	if !payloadAliasesState[typ] {
		e.Payload = data
	}
	return e
}

// payloadAliasesState lists event types whose Apply keeps a reference into the
// decoded payload (the board pointer), so their typed payload is not cached;
// see mustEvent.
var payloadAliasesState = map[EventType]bool{
	EvGameCreated:    true,
	EvBoardGenerated: true,
}

// decode returns the event's typed Data, from the cached Payload when present
// (events just built by mustEvent) or by unmarshalling Data (events loaded from
// the store). mustEvent sets both from one value and nothing mutates Payload,
// so they cannot diverge.
func decode[T any](e Event) T {
	if e.Payload != nil {
		if v, ok := e.Payload.(T); ok {
			return v
		}
		// A Payload of the wrong type means mismatched build/decode types, an engine
		// bug. Fall through to the authoritative Data.
	}
	var v T
	if err := json.Unmarshal(e.Data, &v); err != nil {
		panic(fmt.Sprintf("engine: corrupt %s event at seq %d: %v", e.Type, e.Seq, err))
	}
	return v
}
