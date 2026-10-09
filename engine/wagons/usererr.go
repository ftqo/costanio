package wagons

import (
	"errors"

	"github.com/ftqo/costan.io/engine"
)

// This module's own rules errors, used where the nearest core sentinel would
// tell the player the wrong thing (movement points are not a resource, for
// example).
var (
	// ErrNoWagon: the seat's wagon is not on an intersection (setup placed no
	// city for it).
	ErrNoWagon = errors.New("your wagon is not on the board")
	// ErrMovementOver: the movement action has ended for this turn. Entering a
	// plaza ends it, and so does halting.
	ErrMovementOver = errors.New("your wagon has finished moving this turn")
	// ErrNoMovement: the path costs more movement points than are left, and a
	// path must be paid in full.
	ErrNoMovement = errors.New("not enough movement points for that path")
	// ErrNoGold: the toll on an opponent's road cannot be paid, which makes the
	// path illegal rather than free.
	ErrNoGold = errors.New("not enough gold")
	// ErrWagonLevel: level 1 cannot attempt a drive-off at all.
	ErrWagonLevel = errors.New("your wagon is not upgraded enough for that")
	// ErrAlreadyCharged: each barbarian may be attempted once per turn.
	ErrAlreadyCharged = errors.New("you have already tried that barbarian this turn")
	// ErrMaxLevel: there is no level above 5.
	ErrMaxLevel = errors.New("your wagon is already at the top of the track")
	// ErrGoldLimit: two resources per turn, bought at 2 gold each.
	ErrGoldLimit = errors.New("you have already bought from the bank with gold twice this turn")
	// ErrNoSwift: you do not hold a playable Swift Journey.
	ErrNoSwift = errors.New("you do not hold a Swift Journey")
	// ErrNoJourney: a Swift Journey is a second movement action, so the first
	// must have finished.
	ErrNoJourney = errors.New("you have not finished a movement action this turn")
	// ErrBarbarianSpot: a barbarian's home must be a path a road could occupy,
	// with no barbarian already on it, and not the one it is standing on.
	ErrBarbarianSpot = errors.New("a barbarian cannot go there")
	// ErrNoBarbarian: nothing is owed, so there is no barbarian to move.
	ErrNoBarbarian = errors.New("you have no barbarian to move")
)

// Codes and reference wording. Clients render their own copy from the code; the
// message is the English reference wording. See engine/errcode.go and
// docs/user-facing-text.md. Every sentinel must appear in both lists, one for
// one, or engine/ruletest fails.
func init() {
	engine.RegisterErrorMessage(ErrNoWagon, "Your wagon isn't on the board")
	engine.RegisterErrorMessage(ErrMovementOver, "Your wagon has finished moving for this turn")
	engine.RegisterErrorMessage(ErrNoMovement, "That path costs more movement than your wagon has left")
	engine.RegisterErrorMessage(ErrNoGold, "You don't have the gold for that")
	engine.RegisterErrorMessage(ErrWagonLevel, "Your wagon isn't upgraded enough to do that")
	engine.RegisterErrorMessage(ErrAlreadyCharged, "You have already tried to drive that barbarian off this turn")
	engine.RegisterErrorMessage(ErrMaxLevel, "Your wagon is already at the top of its track")
	engine.RegisterErrorMessage(ErrGoldLimit, "You have already bought from the bank with gold twice this turn")
	engine.RegisterErrorMessage(ErrNoSwift, "You don't hold a Swift Journey you can play")
	engine.RegisterErrorMessage(ErrNoJourney, "A Swift Journey is a second trip, so finish the first one")
	engine.RegisterErrorMessage(ErrBarbarianSpot, "A barbarian can't stand there")
	engine.RegisterErrorMessage(ErrNoBarbarian, "You have no barbarian to move right now")

	engine.RegisterErrorCode(ErrNoWagon, "NO_WAGON")
	engine.RegisterErrorCode(ErrMovementOver, "MOVEMENT_OVER")
	engine.RegisterErrorCode(ErrNoMovement, "NO_MOVEMENT")
	// WAGON_NO_GOLD, not NO_GOLD: engine/raiders registers NO_GOLD, the two
	// modules compose, and codes are global, so each must be unique
	// (TestErrorCodesAreUniqueAndWellFormed).
	engine.RegisterErrorCode(ErrNoGold, "WAGON_NO_GOLD")
	engine.RegisterErrorCode(ErrWagonLevel, "WAGON_LEVEL")
	engine.RegisterErrorCode(ErrAlreadyCharged, "ALREADY_CHARGED")
	engine.RegisterErrorCode(ErrMaxLevel, "MAX_LEVEL")
	engine.RegisterErrorCode(ErrGoldLimit, "GOLD_LIMIT")
	engine.RegisterErrorCode(ErrNoSwift, "NO_SWIFT")
	engine.RegisterErrorCode(ErrNoJourney, "NO_JOURNEY")
	engine.RegisterErrorCode(ErrBarbarianSpot, "BARBARIAN_SPOT")
	engine.RegisterErrorCode(ErrNoBarbarian, "NO_BARBARIAN")
}
