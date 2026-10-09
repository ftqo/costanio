package explorers

import (
	"encoding/json"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// Commands. Every one is prefixed `explorers_` because wire names are global:
// the transport does not namespace them.
const (
	// The three setup rounds this module owns (see Hooks.OwnsSetup).
	CmdPlaceHarbour    engine.CommandType = "explorers_place_harbour"
	CmdPlaceSettlement engine.CommandType = "explorers_place_settlement"
	CmdPlaceStart      engine.CommandType = "explorers_place_start"

	// Action phase.
	CmdBuildHarbour engine.CommandType = "explorers_build_harbour"
	CmdBuildShip    engine.CommandType = "explorers_build_ship"
	CmdBuyCargo     engine.CommandType = "explorers_buy_cargo"
	CmdJettison     engine.CommandType = "explorers_jettison"
	CmdGoldBuy      engine.CommandType = "explorers_gold_buy"
	CmdGoldSell     engine.CommandType = "explorers_gold_sell"
	CmdBankGold     engine.CommandType = "explorers_bank_gold"

	// Movement phase.
	CmdEnterMovement engine.CommandType = "explorers_enter_movement"
	CmdMoveShip      engine.CommandType = "explorers_move_ship"
	CmdSpeedShip     engine.CommandType = "explorers_speed_ship"
	CmdLoad          engine.CommandType = "explorers_load"
	CmdUnload        engine.CommandType = "explorers_unload"
	CmdLandCrew      engine.CommandType = "explorers_land_crew"
	CmdTakeCrew      engine.CommandType = "explorers_take_crew"
	CmdLoadHaul      engine.CommandType = "explorers_load_haul"
	CmdDeliver       engine.CommandType = "explorers_deliver"
	CmdFound         engine.CommandType = "explorers_found"
	CmdFishRoll      engine.CommandType = "explorers_fish_roll"
	CmdChasePirate   engine.CommandType = "explorers_chase_pirate"
	CmdMovePirate    engine.CommandType = "explorers_move_pirate"
)

// Events.
const (
	EvHarbourPlaced   engine.EventType = "explorers_harbour_placed"
	EvSettlementPlace engine.EventType = "explorers_settlement_placed"
	EvStartPlaced     engine.EventType = "explorers_start_placed"
	EvHarbourBuilt    engine.EventType = "explorers_harbour_built"
	EvShipBuilt       engine.EventType = "explorers_ship_built"
	EvShipMoved       engine.EventType = "explorers_ship_moved"
	EvShipSped        engine.EventType = "explorers_ship_sped"
	EvHexRevealed     engine.EventType = "explorers_hex_revealed"
	EvCargoBought     engine.EventType = "explorers_cargo_bought"
	EvJettisoned      engine.EventType = "explorers_jettisoned"
	EvCargoMoved      engine.EventType = "explorers_cargo_moved"
	EvCrewLanded      engine.EventType = "explorers_crew_landed"
	EvCrewTaken       engine.EventType = "explorers_crew_taken"
	EvHaulPlaced      engine.EventType = "explorers_haul_placed"
	EvHaulMissed      engine.EventType = "explorers_haul_missed"
	EvHaulLoaded      engine.EventType = "explorers_haul_loaded"
	EvDelivered       engine.EventType = "explorers_delivered"
	EvFounded         engine.EventType = "explorers_founded"
	EvLairResolved    engine.EventType = "explorers_lair_resolved"
	EvPirateOwed      engine.EventType = "explorers_pirate_owed"
	EvPirateMoved     engine.EventType = "explorers_pirate_moved"
	EvPirateChased    engine.EventType = "explorers_pirate_chased"
	EvGoldChanged     engine.EventType = "explorers_gold_changed"
	EvGoldTraded      engine.EventType = "explorers_gold_traded"
	EvMovementBegan   engine.EventType = "explorers_movement_began"
	EvTurnReset       engine.EventType = "explorers_turn_reset"
)

// Gold reasons, for the event log line.
const (
	GoldSetup       = "setup"
	GoldConsolation = "consolation"
	GoldField       = "gold_field"
	GoldReveal      = "reveal"
	GoldLair        = "lair"
	GoldTribute     = "tribute"
	GoldSteal       = "steal"
	GoldBuy         = "buy"
	GoldSell        = "sell"
	GoldBank        = "bank"
)

// ---- payloads ---------------------------------------------------------------

type placeData struct {
	Player engine.PlayerID `json:"player"`
	V      board.Vertex    `json:"v"`
	// Gain is the starting resources the non-harbour setup building collects. Empty
	// for a harbour settlement, which pays nothing at setup.
	Gain engine.Hand `json:"gain,omitempty"`
	// City marks that setup placement as a city (cak+explorers rule C: each
	// player builds a city instead of a settlement). Only EvSettlementPlace
	// carries it. Logs from before the pairing omit it and decode as false.
	City bool `json:"city,omitempty"`
	// Free marks a harbour-settlement upgrade whose price was paid by something
	// other than this module's own cost: the Knights Medicine card under
	// cak+explorers rule H. Only EvHarbourBuilt ever carries it.
	Free bool `json:"free,omitempty"`
}

type startData struct {
	Player engine.PlayerID `json:"player"`
	Road   board.Edge      `json:"road"`
	Ship   board.Edge      `json:"ship"`
	ShipID int             `json:"ship_id"`
}

type shipData struct {
	Player engine.PlayerID `json:"player"`
	ShipID int             `json:"ship_id"`
	E      board.Edge      `json:"e"`
	// Recycled is the ship returned to the supply to make room, or 0.
	Recycled int `json:"recycled,omitempty"`
}

type shipMoveData struct {
	Player engine.PlayerID `json:"player"`
	ShipID int             `json:"ship_id"`
	From   board.Edge      `json:"from"`
	To     board.Edge      `json:"to"`
	// Path is every edge the ship crossed, one per movement point. The fold
	// needs only To; the path is recorded so a client can animate the move and
	// an auditor can check the route, and because tribute is charged on the
	// edges used.
	Path  []board.Edge `json:"path"`
	Steps int          `json:"steps"`
	// Tribute is the gold paid to an opponent's pirate for the use of its hex's
	// edges, once per ship per turn.
	Tribute int `json:"tribute,omitempty"`
	// Stopped marks a move that ended in a reveal, which forfeits the ship's
	// remaining movement points including any bought with wool.
	Stopped bool `json:"stopped,omitempty"`
}

type shipRefData struct {
	Player engine.PlayerID `json:"player"`
	ShipID int             `json:"ship_id"`
}

// revealData is public and carries the terrain: a revealed hex is public from
// that moment, and the client cannot draw it otherwise (its board copy still
// says `fog`). The chit is the one drawn from the region's stack, 0 for a hex
// that takes none.
type revealData struct {
	Player  engine.PlayerID `json:"player"`
	H       board.Hex       `json:"h"`
	Res     board.Resource  `json:"res"`
	Number  int             `json:"number,omitempty"`
	Kind    Special         `json:"kind,omitempty"`
	Shoal   int             `json:"shoal,omitempty"`
	Village Village         `json:"village,omitempty"`
	Region  int             `json:"region"`
	// Gain is the reward: one resource of the terrain for producing land, and
	// nothing for anything else (which pays gold instead, on its own event).
	Gain engine.Hand `json:"gain,omitempty"`
}

type cargoData struct {
	Player engine.PlayerID `json:"player"`
	// Exactly one of ShipID and V names where the cargo is. A harbour settlement
	// is addressed by its vertex.
	ShipID int          `json:"ship_id,omitempty"`
	V      board.Vertex `json:"v"`
	AtShip bool         `json:"at_ship"`
	Cargo  Cargo        `json:"cargo"`
	Cost   engine.Hand  `json:"cost,omitempty"`
}

type cargoMoveData struct {
	Player engine.PlayerID `json:"player"`
	ShipID int             `json:"ship_id"`
	V      board.Vertex    `json:"v"`
	Cargo  Cargo           `json:"cargo"`
	// ToShip is true for a load (basin to hold) and false for an unload.
	ToShip bool `json:"to_ship"`
	// Back is what travels the other way in the same transfer, making it a
	// swap: a load that hands Back to the basin, or an unload that takes Back
	// aboard. Empty for a plain load or unload (and absent in logs from before
	// swaps existed).
	Back Cargo `json:"back,omitzero"`
}

type crewData struct {
	Player engine.PlayerID `json:"player"`
	ShipID int             `json:"ship_id"`
	H      board.Hex       `json:"h"`
	// Sack is set when the crew was landed on a spice farm and took its sack.
	Sack bool `json:"sack,omitempty"`
	// Village and Region name the advantage a farm crew just granted, so the
	// fold and the log do not have to search the pool for it.
	Village Village `json:"village,omitempty"`
	Region  int     `json:"region,omitempty"`
}

type haulData struct {
	Player engine.PlayerID `json:"player"`
	ShipID int             `json:"ship_id,omitempty"`
	H      board.Hex       `json:"h"`
	// Die is the fishing roll that placed the haul. Zero on a load.
	Die int `json:"die,omitempty"`
}

type deliverData struct {
	Player engine.PlayerID `json:"player"`
	ShipID int             `json:"ship_id"`
	Hauls  int             `json:"hauls,omitempty"`
	Sacks  int             `json:"sacks,omitempty"`
}

type foundData struct {
	Player engine.PlayerID `json:"player"`
	ShipID int             `json:"ship_id"`
	V      board.Vertex    `json:"v"`
}

// lairData is the whole battle, resolved in one event so a replay reproduces it
// without re-rolling anything.
type lairData struct {
	H board.Hex `json:"h"`
	// Involved is the seats with at least one crew on the hex, in clockwise order
	// from the active player: the order they take their gold and their space in.
	Involved []engine.PlayerID `json:"involved"`
	// Rolls is each involved seat's die, parallel to Involved, and Crews the
	// crews it had on the hex. Hero is the highest sum.
	Rolls []int           `json:"rolls"`
	Crews []int           `json:"crews"`
	Hero  engine.PlayerID `json:"hero"`
	// Number is the chit the flipped lair token revealed.
	Number int `json:"number"`
}

type pirateData struct {
	Player engine.PlayerID `json:"player"`
	H      board.Hex       `json:"h"`
	// From is where an opponent's pirate ship was returned from, or the mover's
	// own previous hex. Absent when no pirate was on the board.
	From      *board.Hex       `json:"from,omitempty"`
	Displaced *engine.PlayerID `json:"displaced,omitempty"`
	// Victim and Res record the steal. Res is hidden information and travels on
	// a Visible list; the redactor keeps the fact and drops the card.
	Victim *engine.PlayerID `json:"victim,omitempty"`
	Res    board.Resource   `json:"res,omitempty"`
	// Gold is set when the victim held no resource cards and one gold was taken
	// instead; this is the only way gold is stolen.
	Gold int `json:"gold,omitempty"`
	// Haul is set when the pirate landed on a shoal carrying a fish haul, which
	// it removes to the supply.
	Haul bool `json:"haul,omitempty"`
}

type chaseData struct {
	Player engine.PlayerID `json:"player"`
	// Ships is the battle-ready ships in the nominated order, and Rolls the
	// dice they threw. Rolling stops at the first success, so Rolls is never
	// longer than Ships and its last entry is the success when Won.
	Ships []int `json:"ships"`
	Rolls []int `json:"rolls"`
	// Hits is every die face that succeeds for this player: 6, plus the number
	// on each Pirate Bonus village they hold (5 north, 4 south). Need is the
	// lowest of them; older logs carry only Need (then meaning "Need or
	// higher"), so a reader of an old event derives Hits as Need..6.
	Need int   `json:"need"`
	Hits []int `json:"hits,omitempty"`
	Won  bool  `json:"won"`
}

// goldData is a batch of gold movements. A production roll pays consolation
// gold to every seat that got no resources plus gold-field yields, so it is
// batched like resources_distributed rather than one event per seat.
type goldData struct {
	Gains  []goldGain `json:"gains"`
	Reason string     `json:"reason,omitempty"`
}

type goldGain struct {
	Player engine.PlayerID `json:"player"`
	Amount int             `json:"amount"`
	// Reason names this entry's source when the batch mixes them (a roll pays
	// gold-field yields and consolation gold at once). Empty means the batch's
	// own Reason.
	Reason string `json:"reason,omitempty"`
}

type goldTradeData struct {
	Player engine.PlayerID `json:"player"`
	// Give and Get are the two sides. Exactly one of Gold and the hands is the
	// payment, which Reason names.
	Give   engine.Hand `json:"give,omitempty"`
	Get    engine.Hand `json:"get,omitempty"`
	Gold   int         `json:"gold"`
	Reason string      `json:"reason"`
}

type pirateOwedData struct {
	Player engine.PlayerID `json:"player"`
	// Bishop marks the activation the Knights Bishop buys under cak+explorers
	// rule H. It does not change where the ship may go (the activation obeys "a
	// different sea hex" like a 7); it records the source, and keeps older
	// logs' shape.
	Bishop bool `json:"bishop,omitempty"`
}

type movementData struct {
	Player engine.PlayerID `json:"player"`
}

func raw(v any) json.RawMessage {
	b, _ := json.Marshal(v)
	return b
}
