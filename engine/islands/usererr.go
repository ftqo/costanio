package islands

import "github.com/ftqo/costan.io/engine"

// Codes and reference wording for this module's rules errors. Clients render
// their own copy from the code; the message is the English reference wording.
// See engine/errcode.go and docs/user-facing-text.md. Every sentinel must appear
// in both lists, one for one, or engine/ruletest fails.
func init() {
	engine.RegisterErrorMessage(ErrNotSeaEdge, "Ships can only go on sea edges")
	engine.RegisterErrorMessage(ErrPirateBlocks, "The pirate blocks that water")
	engine.RegisterErrorMessage(ErrShipNotOpen, "Only an open-ended ship can move")
	engine.RegisterErrorMessage(ErrShipJustBuilt, "A ship can't move the turn it was built")
	engine.RegisterErrorMessage(ErrShipAlreadyMoved, "You can only move one ship per turn")
	engine.RegisterErrorMessage(ErrNoGoldOwed, "You have no gold to collect")
	engine.RegisterErrorMessage(ErrBadGoldPick, "That doesn't match the gold you're owed")

	engine.RegisterErrorCode(ErrNotSeaEdge, "NOT_SEA_EDGE")
	engine.RegisterErrorCode(ErrPirateBlocks, "PIRATE_BLOCKS")
	engine.RegisterErrorCode(ErrShipNotOpen, "SHIP_NOT_OPEN")
	engine.RegisterErrorCode(ErrShipJustBuilt, "SHIP_JUST_BUILT")
	engine.RegisterErrorCode(ErrShipAlreadyMoved, "SHIP_ALREADY_MOVED")
	engine.RegisterErrorCode(ErrNoGoldOwed, "NO_GOLD_OWED")
	engine.RegisterErrorCode(ErrBadGoldPick, "BAD_GOLD_PICK")
}
