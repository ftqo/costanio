package explorers

import (
	"errors"

	"github.com/ftqo/costan.io/engine"
)

// This module's own rules errors. Each exists because the core sentinel it
// would otherwise fall back on would mislead the player: "You can't build
// there" is wrong for a ship out of movement points, a full hold, or a crew
// landed on an unexplored hex.
var (
	// ErrNotSeaEdge: ships go on water. A coastal edge counts; two land hexes
	// do not. Its code is SHIP_NEEDS_WATER because Islands already owns
	// NOT_SEA_EDGE, and codes are global.
	ErrNotSeaEdge = errors.New("explorers: ships go on sea edges")
	// ErrIntoTheFog: a ship may not be built with an end at a corner of an
	// unexplored hex, because standing there would reveal it for free.
	ErrIntoTheFog = errors.New("explorers: that spot looks into the fog")
	// ErrNoShipyard: ships are built beside a harbour settlement. A plain
	// coastal settlement is not a shipyard.
	ErrNoShipyard = errors.New("explorers: ships are built beside a harbour settlement")
	// ErrNotCoastal: a harbour settlement needs open water beside it.
	ErrNotCoastal = errors.New("explorers: that intersection has no water beside it")
	// ErrUpgradeIsFinal: cak+explorers rule A. A coastal settlement may become
	// a city or a harbour settlement, and converting one into the other
	// afterwards is prohibited. Both directions refuse here.
	ErrUpgradeIsFinal = errors.New("explorers: a city and a harbour settlement cannot be swapped")
	// ErrHoldFull: a hold and a basin each take one large piece or two small
	// ones, and no more.
	ErrHoldFull = errors.New("explorers: there is no room for that")
	// ErrRoomRemains: a piece is discarded to make room only when there is none
	// left anywhere.
	ErrRoomRemains = errors.New("explorers: you still have somewhere to put it")
	// ErrNotAtHarbour: loading, unloading and buying all happen at one of your
	// own harbour settlements.
	ErrNotAtHarbour = errors.New("explorers: that ship is not at one of your harbour settlements")
	// ErrNotMovement: the Movement phase has not begun.
	ErrNotMovement = errors.New("explorers: you are not in the Movement phase yet")
	// ErrNoMovement: this ship has no movement points left, or its movement
	// ended when it revealed a hex.
	ErrNoMovement = errors.New("explorers: that ship has finished moving")
	// ErrStopsAtTheFog: a discovery ends movement, so a path may not continue
	// past the point where a hex is revealed.
	ErrStopsAtTheFog = errors.New("explorers: the ship stops when it finds something")
	// ErrAlreadySped: one wool per ship per turn.
	ErrAlreadySped = errors.New("explorers: that ship has already bought extra movement")
	// ErrNoTribute: the pirate's toll is not a debt and there is no forced sale.
	ErrNoTribute = errors.New("explorers: you cannot pay the pirate's tribute")
	// ErrPiratePending: a rolled 7 owes a pirate activation before anything else.
	ErrPiratePending = errors.New("explorers: move the pirate ship first")
	// ErrPirateMustMove: your own pirate ship may not stay where it is.
	ErrPirateMustMove = errors.New("explorers: your pirate ship must move somewhere new")
	// ErrNoChase: a chase is made by battle-ready ships, which have not moved
	// this turn and stand at a corner of the pirate's hex.
	ErrNoChase = errors.New("explorers: you have no ship ready to chase the pirate")
	// ErrOutOfReach: a ship works a hex from a corner it is standing on.
	ErrOutOfReach = errors.New("explorers: that ship is not next to it")
	// ErrNoCrew: no crew aboard, or none of yours left on that hex.
	ErrNoCrew = errors.New("explorers: you have no crew there")
	// ErrNoSettler: founding a settlement overseas takes a settler.
	ErrNoSettler = errors.New("explorers: that ship is not carrying a settler")
	// ErrLairCaptured: the lair has already fallen.
	ErrLairCaptured = errors.New("explorers: that lair has already been stormed")
	// ErrFarmBefriended: one crew and one sack per player per farm, for the whole
	// game. You cannot return for a second sack from the same village.
	ErrFarmBefriended = errors.New("explorers: you have already befriended that village")
	// ErrNoHaul: no fish haul sits on that shoal.
	ErrNoHaul = errors.New("explorers: there is no catch there")
	// ErrAlreadyFished: one fishing roll per Movement phase.
	ErrAlreadyFished = errors.New("explorers: you have already fished this turn")
	// ErrNotAtCouncil: deliveries are made at either anchor of the Council hex.
	ErrNotAtCouncil = errors.New("explorers: that ship is not docked at the Council")
	// ErrNothingToDeliver: the hold carries nothing the Council takes.
	ErrNothingToDeliver = errors.New("explorers: that ship has nothing for the Council")
	// ErrNoGold: gold is a second currency and this player has too little of it.
	ErrNoGold = errors.New("explorers: you do not have enough gold")
	// ErrGoldSpent: the per-turn cap on gold purchases, or on Fast Gold sales.
	ErrGoldSpent = errors.New("explorers: you have used that up for this turn")
	// ErrNoFastGold: selling a resource for gold needs a Fast Gold village.
	ErrNoFastGold = errors.New("explorers: you have not befriended a Fast Gold village")
)

// Codes and reference wording for this module's rules errors. Clients render
// their own copy from the code; the message is the English reference wording.
// See engine/errcode.go and docs/user-facing-text.md. Every sentinel must appear
// in both lists, one for one, or engine/ruletest fails.
func init() {
	engine.RegisterErrorMessage(ErrNotSeaEdge, "Ships go on water, not between two land hexes")
	engine.RegisterErrorMessage(ErrIntoTheFog, "You can't build a ship where it would be looking into the fog")
	engine.RegisterErrorMessage(ErrNoShipyard, "Ships are built beside one of your harbour settlements")
	engine.RegisterErrorMessage(ErrNotCoastal, "A harbour settlement needs open water beside it")
	engine.RegisterErrorMessage(ErrUpgradeIsFinal, "That building has already been upgraded, and a city and a harbour settlement can't be swapped")
	engine.RegisterErrorMessage(ErrHoldFull, "There's no room for that: a hold takes one large piece or two small ones")
	engine.RegisterErrorMessage(ErrRoomRemains, "You can only throw something overboard when you have nowhere left to put it")
	engine.RegisterErrorMessage(ErrNotAtHarbour, "That ship isn't at one of your harbour settlements")
	engine.RegisterErrorMessage(ErrNotMovement, "You haven't started your Movement phase yet")
	engine.RegisterErrorMessage(ErrNoMovement, "That ship has finished moving for this turn")
	engine.RegisterErrorMessage(ErrStopsAtTheFog, "A ship stops as soon as it finds something, so the route can't carry on past it")
	engine.RegisterErrorMessage(ErrAlreadySped, "That ship has already bought extra movement this turn")
	engine.RegisterErrorMessage(ErrNoTribute, "You don't have the gold to pass the pirate ship")
	engine.RegisterErrorMessage(ErrPiratePending, "You must place your pirate ship first")
	engine.RegisterErrorMessage(ErrPirateMustMove, "Your pirate ship has to move somewhere new")
	engine.RegisterErrorMessage(ErrNoChase, "None of your ships is ready to chase the pirate")
	engine.RegisterErrorMessage(ErrOutOfReach, "That ship isn't next to it")
	engine.RegisterErrorMessage(ErrNoCrew, "You have no crew there")
	engine.RegisterErrorMessage(ErrNoSettler, "That ship isn't carrying a settler")
	engine.RegisterErrorMessage(ErrLairCaptured, "That pirate lair has already been stormed")
	engine.RegisterErrorMessage(ErrFarmBefriended, "You've already befriended that spice village")
	engine.RegisterErrorMessage(ErrNoHaul, "There's no catch on that shoal")
	engine.RegisterErrorMessage(ErrAlreadyFished, "You've already fished this turn")
	engine.RegisterErrorMessage(ErrNotAtCouncil, "That ship isn't docked at the Council")
	engine.RegisterErrorMessage(ErrNothingToDeliver, "That ship has nothing the Council wants")
	engine.RegisterErrorMessage(ErrNoGold, "You don't have enough gold for that")
	engine.RegisterErrorMessage(ErrGoldSpent, "You've used that up for this turn")
	engine.RegisterErrorMessage(ErrNoFastGold, "You need a Fast Gold village to sell a resource for gold")

	engine.RegisterErrorCode(ErrNotSeaEdge, "SHIP_NEEDS_WATER")
	engine.RegisterErrorCode(ErrIntoTheFog, "INTO_THE_FOG")
	engine.RegisterErrorCode(ErrNoShipyard, "NO_SHIPYARD")
	engine.RegisterErrorCode(ErrNotCoastal, "NOT_COASTAL")
	engine.RegisterErrorCode(ErrUpgradeIsFinal, "UPGRADE_IS_FINAL")
	engine.RegisterErrorCode(ErrHoldFull, "HOLD_FULL")
	engine.RegisterErrorCode(ErrRoomRemains, "ROOM_REMAINS")
	engine.RegisterErrorCode(ErrNotAtHarbour, "NOT_AT_HARBOUR")
	engine.RegisterErrorCode(ErrNotMovement, "NOT_MOVEMENT")
	// SHIP_NO_MOVEMENT and SHIP_NO_GOLD rather than NO_MOVEMENT and NO_GOLD:
	// the code table is global and built at init from every linked module
	// (cmd/costan links all of them), and engine/wagons and engine/raiders
	// already register those codes. TestErrorCodesAreUniqueAndWellFormed checks
	// uniqueness. The SHIP_ prefix matches SHIP_NEEDS_WATER and NO_SHIPYARD.
	engine.RegisterErrorCode(ErrNoMovement, "SHIP_NO_MOVEMENT")
	engine.RegisterErrorCode(ErrStopsAtTheFog, "STOPS_AT_THE_FOG")
	engine.RegisterErrorCode(ErrAlreadySped, "ALREADY_SPED")
	engine.RegisterErrorCode(ErrNoTribute, "NO_TRIBUTE")
	engine.RegisterErrorCode(ErrPiratePending, "PIRATE_PENDING")
	engine.RegisterErrorCode(ErrPirateMustMove, "PIRATE_MUST_MOVE")
	engine.RegisterErrorCode(ErrNoChase, "NO_CHASE")
	engine.RegisterErrorCode(ErrOutOfReach, "OUT_OF_REACH")
	engine.RegisterErrorCode(ErrNoCrew, "NO_CREW")
	engine.RegisterErrorCode(ErrNoSettler, "NO_SETTLER")
	engine.RegisterErrorCode(ErrLairCaptured, "LAIR_CAPTURED")
	engine.RegisterErrorCode(ErrFarmBefriended, "FARM_BEFRIENDED")
	engine.RegisterErrorCode(ErrNoHaul, "NO_HAUL")
	engine.RegisterErrorCode(ErrAlreadyFished, "ALREADY_FISHED")
	engine.RegisterErrorCode(ErrNotAtCouncil, "NOT_AT_COUNCIL")
	engine.RegisterErrorCode(ErrNothingToDeliver, "NOTHING_TO_DELIVER")
	engine.RegisterErrorCode(ErrNoGold, "SHIP_NO_GOLD")
	engine.RegisterErrorCode(ErrGoldSpent, "GOLD_SPENT")
	engine.RegisterErrorCode(ErrNoFastGold, "NO_FAST_GOLD")
}
