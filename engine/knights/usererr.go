package knights

import "github.com/ftqo/costan.io/engine"

// Codes and reference wording for this module's rules errors. Clients render
// their own copy from the code; the message is the English reference wording.
// See engine/errcode.go and docs/user-facing-text.md. Every sentinel must appear
// in both lists, one for one, or engine/ruletest fails.
func init() {
	engine.RegisterErrorMessage(ErrAlchemistDice, "Each alchemist die must be 1-6")
	engine.RegisterErrorMessage(ErrNotBeforeRoll, "That card must be played before rolling")
	engine.RegisterErrorMessage(ErrMerchantTerrain, "The merchant needs a hex that produces a resource")
	engine.RegisterErrorMessage(ErrNoOpenRoad, "That road isn't an open end")
	engine.RegisterErrorMessage(ErrCardNoEffect, "That card would do nothing right now, so it stays in your hand")
	engine.RegisterErrorMessage(ErrNeedCity, "That requires a city")
	engine.RegisterErrorMessage(ErrAlreadyPromoted, "That knight has already been promoted this turn")
	engine.RegisterErrorMessage(ErrMaxImprovement, "That improvement is already at its maximum")
	engine.RegisterErrorMessage(ErrNoFreeCity, "You need a city without a metropolis for that")
	engine.RegisterErrorMessage(ErrNoCommodities, "You don't have enough commodities for that")
	engine.RegisterErrorMessage(ErrComSupplyEmpty, "The supply has run out of that commodity")
	engine.RegisterErrorMessage(ErrVertexTaken, "That spot is already taken")
	engine.RegisterErrorMessage(ErrNoKnight, "You don't have a knight there")
	engine.RegisterErrorMessage(ErrKnightState, "That knight can't do that right now")
	engine.RegisterErrorMessage(ErrMaxWalls, "You've reached the city wall limit")
	engine.RegisterErrorMessage(ErrNoProgressCard, "You don't hold that progress card")
	engine.RegisterErrorMessage(ErrNotOwed, "You don't owe anything")
	engine.RegisterErrorMessage(ErrBadGive, "That doesn't match what you owe")
	engine.RegisterErrorMessage(ErrHandNotOver, "Your progress hand isn't over the limit")
	engine.RegisterErrorMessage(ErrMightyNeedsFort, "Level-3 knights need politics level 3")
	engine.RegisterErrorMessage(ErrNotSacrificable, "The barbarians can only raze a city of yours")
	engine.RegisterErrorMessage(ErrKnightInTheFog, "A knight won't stand next to an unexplored hex")

	engine.RegisterErrorCode(ErrAlchemistDice, "ALCHEMIST_DICE")
	engine.RegisterErrorCode(ErrNotBeforeRoll, "NOT_BEFORE_ROLL")
	engine.RegisterErrorCode(ErrMerchantTerrain, "MERCHANT_TERRAIN")
	engine.RegisterErrorCode(ErrNoOpenRoad, "NO_OPEN_ROAD")
	engine.RegisterErrorCode(ErrCardNoEffect, "CARD_NO_EFFECT")
	engine.RegisterErrorCode(ErrNeedCity, "NEED_CITY")
	engine.RegisterErrorCode(ErrAlreadyPromoted, "ALREADY_PROMOTED")
	engine.RegisterErrorCode(ErrMaxImprovement, "MAX_IMPROVEMENT")
	engine.RegisterErrorCode(ErrNoFreeCity, "NO_FREE_CITY")
	engine.RegisterErrorCode(ErrNoCommodities, "NO_COMMODITIES")
	engine.RegisterErrorCode(ErrComSupplyEmpty, "COMMODITY_SUPPLY_EMPTY")
	engine.RegisterErrorCode(ErrVertexTaken, "VERTEX_TAKEN")
	engine.RegisterErrorCode(ErrNoKnight, "NO_KNIGHT")
	engine.RegisterErrorCode(ErrKnightState, "KNIGHT_STATE")
	engine.RegisterErrorCode(ErrMaxWalls, "MAX_WALLS")
	engine.RegisterErrorCode(ErrNoProgressCard, "NO_PROGRESS_CARD")
	engine.RegisterErrorCode(ErrNotOwed, "NOT_OWED")
	engine.RegisterErrorCode(ErrBadGive, "BAD_GIVE")
	engine.RegisterErrorCode(ErrHandNotOver, "HAND_NOT_OVER")
	engine.RegisterErrorCode(ErrMightyNeedsFort, "MIGHTY_NEEDS_FORT")
	engine.RegisterErrorCode(ErrNotSacrificable, "NOT_SACRIFICABLE")
	engine.RegisterErrorCode(ErrKnightInTheFog, "KNIGHT_IN_THE_FOG")
}
