package engine

import "errors"

// English reference wording for player-facing errors.
//
// Clients do not render these; they render their own copy keyed off the stable
// code in errcode.go. The strings say what a code means, travel on the wire only
// as a marked developer aid, and are what headless tools (the simulator, tests,
// an operator on a socket) print. See docs/user-facing-text.md.
//
// Rules errors are Go errors (lowercase, sometimes with module prefixes like
// "cak:" or wrapping), none of which should reach a client. UserError maps a rules
// error to a complete, capitalized sentence. The base game registers its errors
// below; each module registers its own in init via RegisterErrorMessage, so the
// core imports no module.

type userMessage struct {
	err error
	msg string
}

// userMessages is an ordered list so lookup is deterministic even when an error
// would match more than one registered sentinel.
var userMessages []userMessage

// RegisterErrorMessage associates the English reference wording with a rules
// error sentinel. Call it from a module's init, paired one-for-one with a
// RegisterErrorCode call for the same sentinel. The message must be a complete,
// capitalized sentence with no internal jargon.
func RegisterErrorMessage(err error, msg string) {
	userMessages = append(userMessages, userMessage{err, msg})
}

// UserError returns the English reference wording for a rules error, matched
// with errors.Is so wrapped errors still resolve. An unrecognized error falls
// back to a generic message, so a raw Go error is never surfaced.
func UserError(err error) string {
	for _, m := range userMessages {
		if errors.Is(err, m.err) {
			return m.msg
		}
	}
	return "That move isn't allowed"
}

// ErrorMessageEntry is one row of the registered message table.
type ErrorMessageEntry struct {
	Err     error
	Message string
}

// RegisteredErrorMessages returns a copy of the message table in registration
// order, for tests and tooling.
func RegisteredErrorMessages() []ErrorMessageEntry {
	out := make([]ErrorMessageEntry, 0, len(userMessages))
	for _, m := range userMessages {
		out = append(out, ErrorMessageEntry{m.err, m.msg})
	}
	return out
}

func init() {
	RegisterErrorMessage(ErrNotYourTurn, "It's not your turn")
	RegisterErrorMessage(ErrWrongPhase, "You can't do that right now")
	RegisterErrorMessage(ErrBadPlacement, "You can't build there")
	RegisterErrorMessage(ErrTooClose, "Too close to another settlement")
	RegisterErrorMessage(ErrOccupied, "That spot is already taken")
	RegisterErrorMessage(ErrNoResources, "You don't have the resources for that")
	RegisterErrorMessage(ErrNoPieces, "You have no pieces left to build")
	RegisterErrorMessage(ErrMustRoll, "You must roll the dice first")
	RegisterErrorMessage(ErrAlreadyRolled, "You've already rolled this turn")
	RegisterErrorMessage(ErrRobberPending, "You must move the robber first")
	RegisterErrorMessage(ErrDiscardPending, "Waiting for players to discard")
	RegisterErrorMessage(ErrNoDiscardNeeded, "You don't need to discard")
	RegisterErrorMessage(ErrBadDiscard, "That discard doesn't match what's required")
	RegisterErrorMessage(ErrBadVictim, "You can't steal from that player")
	RegisterErrorMessage(ErrGameFinished, "The game is already over")
	RegisterErrorMessage(ErrUnknownCommand, "That action isn't allowed")
	RegisterErrorMessage(ErrBadCommand, "That action isn't allowed")
	RegisterErrorMessage(ErrNoOffer, "There's no open trade offer")
	RegisterErrorMessage(ErrSameResource, "You can't trade a resource for the same resource")
	RegisterErrorMessage(ErrBadTrade, "Those cards don't pay for what you asked for")
	RegisterErrorMessage(ErrAlreadyResponded, "You've already responded to this offer")
	RegisterErrorMessage(ErrNoResponse, "You haven't answered this offer yet")
	RegisterErrorMessage(ErrDeckEmpty, "The development card deck is empty")
	RegisterErrorMessage(ErrDevAlreadyPlayed, "You've already played a development card this turn")
	RegisterErrorMessage(ErrNoSuchCard, "You don't hold that card")
	RegisterErrorMessage(ErrModulePending, "You must resolve a pending choice first")
	RegisterErrorMessage(ErrNotDuel, "You can only surrender in a two-player game")
	RegisterErrorMessage(ErrDrawTooEarly, "The game isn't long enough for that yet")
	RegisterErrorMessage(ErrDrawPending, "There's already an open draw offer")
	RegisterErrorMessage(ErrNoDrawOffer, "There's no draw offer for you to answer")
	RegisterErrorMessage(ErrSurrenderTooEarly, "It's too early to surrender. The host can reset the game to the lobby instead")
	RegisterErrorMessage(ErrDrawOfferUsed, "You've already offered a draw this turn")
	RegisterErrorMessage(ErrBuildingOver, "You can't build or trade any more this turn")
}
