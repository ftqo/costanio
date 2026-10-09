package raiders

import (
	"errors"

	"github.com/ftqo/costan.io/engine"
)

// This module's own rules errors. Each replaces a core sentinel that would
// mislead the player:
//
//   - moving a rider that has already moved would say ErrBadPlacement ("You
//     can't build there"), though nothing is being built;
//   - placing a rider with none left would say ErrNoResources, though riders
//     cost no resources;
//   - a third gold purchase, or one with too little gold, would also say
//     ErrNoResources, which names a shortage of cards;
//   - an impossible Treason plan would say ErrBadPlacement, which does not say
//     which part of the plan was wrong.
var (
	ErrNoRefuge = errors.New("this map cannot provide a productive mainland refuge for Raiders")
	// ErrRiderMoved: you may move each of your own riders once per turn.
	ErrRiderMoved = errors.New("that rider has already moved this turn")
	// ErrNoRiders: six per seat, enforced like roads and settlements.
	ErrNoRiders = errors.New("no riders left")
	// ErrNoGold: a resource costs 2 gold.
	ErrNoGold = errors.New("not enough gold")
	// ErrGoldBuysUsed: at most two gold purchases per turn.
	ErrGoldBuysUsed = errors.New("both gold purchases used this turn")
	// ErrTreasonPlan: Treason moves raiders from different hexes onto other
	// unconquered coastal hexes, and takes from the supply only for a shortfall.
	ErrTreasonPlan = errors.New("that treason plan is not one the card can make")
)

// Codes and reference wording. Clients render their own copy from the code; the
// message is the English reference wording. Every sentinel must appear in both
// lists, one for one, or engine/ruletest fails.
func init() {
	engine.RegisterErrorMessage(ErrNoRefuge, "This map needs a larger mainland with productive interior terrain for Raiders")
	engine.RegisterErrorCode(ErrNoRefuge, "RAIDERS_NO_REFUGE")
	engine.RegisterErrorMessage(ErrRiderMoved, "That rider has already moved this turn")
	engine.RegisterErrorMessage(ErrNoRiders, "You have no riders left to place")
	engine.RegisterErrorMessage(ErrNoGold, "You don't have enough gold for that")
	engine.RegisterErrorMessage(ErrGoldBuysUsed, "You have already bought twice with gold this turn")
	engine.RegisterErrorMessage(ErrTreasonPlan, "Treason can't move the raiders that way")

	engine.RegisterErrorCode(ErrRiderMoved, "RIDER_MOVED")
	engine.RegisterErrorCode(ErrNoRiders, "NO_RIDERS")
	engine.RegisterErrorCode(ErrNoGold, "NO_GOLD")
	engine.RegisterErrorCode(ErrGoldBuysUsed, "GOLD_BUYS_USED")
	engine.RegisterErrorCode(ErrTreasonPlan, "BAD_TREASON_PLAN")
}
