package scenarios

import (
	"errors"

	"github.com/ftqo/costan.io/engine"
)

// This module's own rules errors. Each replaces a core sentinel whose message
// would mislead the player:
//   - handing on the boot would get ErrBadVictim ("You can't steal from that
//     player"), but nothing is stolen.
//   - a robber spend would get ErrBadPlacement ("You can't build there").
//   - too few fish would get ErrNoResources, but fish are not resources (outside
//     the hand limit; no robber, pirate, knight or Monopoly takes them).
//   - bidding twice would get ErrNotYourTurn, when the seat has simply already
//     answered.
//   - a spend the ruleset removed would get ErrUnknownCommand, which names
//     neither what was refused nor why.
var (
	// ErrBootRecipient: the boot only moves to a seat doing at least as well.
	ErrBootRecipient = errors.New("that player is behind you")
	// ErrNoFish: whole tiles, and you cannot make change.
	ErrNoFish = errors.New("not enough fish")
	// ErrAlreadyBid: a round takes one answer per seat, and a bid that is
	// already face up on the table cannot be revised.
	ErrAlreadyBid = errors.New("you have already answered this vote")
	// ErrSpendUnavailable: this ruleset has removed what the spend buys.
	ErrSpendUnavailable = errors.New("that fish spend is not available in this game")
)

// Codes and English reference wording for this module's rules errors; clients
// render their own copy from the code (engine/errcode.go,
// docs/user-facing-text.md). Every sentinel must appear in both lists or
// engine/ruletest fails.
func init() {
	engine.RegisterErrorMessage(ErrBootRecipient, "The boot only goes to a player doing at least as well as you")
	engine.RegisterErrorMessage(ErrNoFish, "You don't hold enough fish for that spend")
	engine.RegisterErrorMessage(ErrAlreadyBid, "You have already answered this vote, and a bid can't be changed")
	engine.RegisterErrorMessage(ErrSpendUnavailable, "This game's rules have taken that fish spend off the table")

	engine.RegisterErrorCode(ErrBootRecipient, "BOOT_RECIPIENT")
	engine.RegisterErrorCode(ErrNoFish, "NO_FISH")
	engine.RegisterErrorCode(ErrAlreadyBid, "ALREADY_BID")
	engine.RegisterErrorCode(ErrSpendUnavailable, "SPEND_UNAVAILABLE")
}
