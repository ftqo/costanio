package engine

import (
	"errors"

	"github.com/ftqo/costan.io/engine/board"
)

// Machine-readable error codes.
//
// The backend never sends prose that a client renders: a rejected command
// reaches the client as a stable code plus named, typed parameters, and the
// client renders the sentence in the player's language. See
// docs/user-facing-text.md.
//
// Every registered player-facing refusal has exactly one code, and every code
// exactly one registered message. The message is English reference wording for
// developers, never rendered by a client. TestErrorRegistryIsOneToOne in
// engine/ruletest asserts the 1:1 mapping. Each module registers its own codes
// in init, so the core and the transport never import a module to name its
// errors.
//
// Naming: SCREAMING_SNAKE_CASE, globally unique, derived from the sentinel name
// without the Err prefix (ErrTooClose becomes TOO_CLOSE). No module prefix;
// uniqueness is enforced by test. Codes are stable identifiers used as
// translation keys, so rename one only with a migration plan.

type userCode struct {
	err  error
	code string
}

// userCodes is an ordered list so lookup is deterministic even when an error
// would match more than one registered sentinel.
var userCodes []userCode

// RegisterErrorCode associates a machine-readable code with a rules error
// sentinel. Call it from a module's init. The code is a short SCREAMING_SNAKE
// token sent verbatim to clients.
func RegisterErrorCode(err error, code string) {
	userCodes = append(userCodes, userCode{err, code})
}

// ErrorCode returns the registered code for a rules error, matched with
// errors.Is so wrapped errors still resolve. It returns "" when no code is
// registered, leaving the caller to apply its own fallback.
func ErrorCode(err error) string {
	for _, c := range userCodes {
		if errors.Is(err, c.err) {
			return c.code
		}
	}
	return ""
}

// ErrorCodeEntry is one row of the registered code table.
type ErrorCodeEntry struct {
	Err  error
	Code string
}

// RegisteredErrorCodes returns a copy of the code table in registration order,
// for tests and tooling.
func RegisteredErrorCodes() []ErrorCodeEntry {
	out := make([]ErrorCodeEntry, 0, len(userCodes))
	for _, c := range userCodes {
		out = append(out, ErrorCodeEntry{c.err, c.code})
	}
	return out
}

// Params carries the variable content of a refusal as named values, never
// positional ones, so a client can place "2" and "brick" wherever its grammar
// needs them. Values must be JSON-encodable scalars or flat containers of
// them: string, int, bool, []string, []int, map[string]int. No pre-formatted
// sentences or display words; identifiers ("brick", "road") are fine because
// the client maps them to its own vocabulary.
type Params map[string]any

// ValidParams reports whether every value in p is one of the permitted wire
// shapes.
func ValidParams(p Params) bool {
	for _, v := range p {
		switch v.(type) {
		case string, int, bool, []string, []int, map[string]int:
		default:
			return false
		}
	}
	return true
}

// paramError decorates a refusal sentinel with named parameters. It unwraps to
// the sentinel, so errors.Is checks keep working.
type paramError struct {
	err    error
	params Params
}

func (e *paramError) Error() string { return e.err.Error() }
func (e *paramError) Unwrap() error { return e.err }

// WithParams attaches named parameters to a refusal. The result still satisfies
// errors.Is against the original sentinel.
func WithParams(err error, params Params) error {
	if err == nil || len(params) == 0 {
		return err
	}
	return &paramError{err: err, params: params}
}

// ErrorParams returns the named parameters attached to a refusal, or nil. The
// transport layer sends these alongside the code.
func ErrorParams(err error) Params {
	var pe *paramError
	if errors.As(err, &pe) {
		return pe.params
	}
	return nil
}

// missingParams describes the shortfall between a cost and a hand as
// {resource: count}: what the player still needs, not the full cost.
func missingParams(cost, held Hand) Params {
	missing := map[string]int{}
	for i := range cost {
		if short := cost[i] - held[i]; short > 0 {
			missing[board.Resource(i).String()] = short
		}
	}
	if len(missing) == 0 {
		return nil
	}
	return Params{"missing": missing}
}

// noResources builds the NO_RESOURCES refusal with the shortfall attached.
func noResources(cost, held Hand) error {
	return WithParams(ErrNoResources, missingParams(cost, held))
}

// Piece identifiers carried by NO_PIECES. They are stable tokens the client maps
// to its own vocabulary, not words to display.
const (
	PieceRoad       = "road"
	PieceSettlement = "settlement"
	PieceCity       = "city"
)

// noPieces builds the NO_PIECES refusal naming which piece ran out.
func noPieces(piece string) error {
	return WithParams(ErrNoPieces, Params{"piece": piece})
}

func init() {
	// Codes the transport layer historically distinguished. Keep these stable;
	// clients may branch on them.
	RegisterErrorCode(ErrNotYourTurn, "NOT_YOUR_TURN")
	RegisterErrorCode(ErrNoResources, "NO_RESOURCES")
	RegisterErrorCode(ErrBadCommand, "BAD_COMMAND")
	// Concede/draw refusals: the client hides these controls when unavailable, but
	// a stale UI can still send one, and the toast should say why.
	RegisterErrorCode(ErrNotDuel, "NOT_A_DUEL")
	RegisterErrorCode(ErrDrawTooEarly, "DRAW_TOO_EARLY")
	RegisterErrorCode(ErrDrawPending, "DRAW_PENDING")
	RegisterErrorCode(ErrNoDrawOffer, "NO_DRAW_OFFER")
	RegisterErrorCode(ErrSurrenderTooEarly, "SURRENDER_TOO_EARLY")
	RegisterErrorCode(ErrDrawOfferUsed, "DRAW_OFFER_USED")
	// Refusals that would otherwise surface as a generic STORAGE_ERROR.
	RegisterErrorCode(ErrGameFinished, "GAME_FINISHED")
	RegisterErrorCode(ErrWrongPhase, "WRONG_PHASE")
	RegisterErrorCode(ErrAlreadyResponded, "ALREADY_RESPONDED")
	RegisterErrorCode(ErrNoResponse, "NO_RESPONSE")
	RegisterErrorCode(ErrModulePending, "MODULE_PENDING")
	RegisterErrorCode(ErrBuildingOver, "BUILDING_OVER")
	// The rest of the base game's refusals.
	RegisterErrorCode(ErrBadPlacement, "BAD_PLACEMENT")
	RegisterErrorCode(ErrTooClose, "TOO_CLOSE")
	RegisterErrorCode(ErrOccupied, "OCCUPIED")
	RegisterErrorCode(ErrNoPieces, "NO_PIECES")
	RegisterErrorCode(ErrMustRoll, "MUST_ROLL")
	RegisterErrorCode(ErrAlreadyRolled, "ALREADY_ROLLED")
	RegisterErrorCode(ErrRobberPending, "ROBBER_PENDING")
	RegisterErrorCode(ErrDiscardPending, "DISCARD_PENDING")
	RegisterErrorCode(ErrNoDiscardNeeded, "NO_DISCARD_NEEDED")
	RegisterErrorCode(ErrBadDiscard, "BAD_DISCARD")
	RegisterErrorCode(ErrBadVictim, "BAD_VICTIM")
	RegisterErrorCode(ErrUnknownCommand, "UNKNOWN_COMMAND")
	RegisterErrorCode(ErrNoOffer, "NO_OFFER")
	RegisterErrorCode(ErrSameResource, "SAME_RESOURCE")
	RegisterErrorCode(ErrBadTrade, "BAD_TRADE")
	RegisterErrorCode(ErrDeckEmpty, "DECK_EMPTY")
	RegisterErrorCode(ErrDevAlreadyPlayed, "DEV_ALREADY_PLAYED")
	RegisterErrorCode(ErrNoSuchCard, "NO_SUCH_CARD")
}
