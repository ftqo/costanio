package knights

import (
	"encoding/json"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

const (
	EvEventDie           engine.EventType = "cak_event_die"
	EvCommodityAdjust    engine.EventType = "cak_commodity_adjust"
	EvProgressDrawn      engine.EventType = "cak_progress_drawn"
	EvProgressDiscard    engine.EventType = "cak_progress_discarded"
	EvProgressStolen     engine.EventType = "cak_progress_stolen"
	EvSpyLooking         engine.EventType = "cak_spy_looking"
	EvMasterMerchantLook engine.EventType = "cak_master_merchant_looking"
	EvImproved           engine.EventType = "cak_improved"
	EvMetropolis         engine.EventType = "cak_metropolis"
	// EvMetropolisPending records that a player has earned a metropolis but not yet
	// placed it: they have two or more metropolis-free cities and choose with
	// CmdMetropolisPick. It carries Track/Holder/Prev; V is unset. EvMetropolis
	// keeps its old meaning (place on V), so older logs replay unchanged; a single
	// eligible city still emits EvMetropolis alone.
	EvMetropolisPending engine.EventType = "cak_metropolis_pending"
	EvKnightBuilt       engine.EventType = "cak_knight_built"
	EvKnightActivated   engine.EventType = "cak_knight_activated"
	EvKnightPromoted    engine.EventType = "cak_knight_promoted"
	EvKnightMoved       engine.EventType = "cak_knight_moved"
	EvKnightRemoved     engine.EventType = "cak_knight_removed"
	EvKnightDisplaced   engine.EventType = "cak_knight_displaced"
	EvKnightRelocated   engine.EventType = "cak_knight_relocated"
	EvDefenderAdvance   engine.EventType = "cak_defender_advance" // pop the tied-defender draw queue
	EvKnightsAllActive  engine.EventType = "cak_knights_all_active"
	EvDeserterOpened    engine.EventType = "cak_deserter_opened"  // victim must surrender a knight
	EvDeserterArmed     engine.EventType = "cak_deserter_armed"   // surrendered; taker owes a placement
	EvDeserterCleared   engine.EventType = "cak_deserter_cleared" // replacement placed (or forfeited)
	EvWallBuilt         engine.EventType = "cak_wall_built"
	EvBarbarianAttack   engine.EventType = "cak_barbarian_attack"
	// EvBarbarianDowngraded records one losing player's chosen city sacrifice,
	// resolving a seat in the attack event's Pending set. EvBarbarianAttack keeps
	// its old meaning (every vertex in Downgraded is razed), so older logs replay
	// unchanged; new logs use Downgraded only when there is a single sacrificable
	// city.
	EvBarbarianDowngraded engine.EventType = "cak_barbarian_downgraded"
	// EvPillageBoughtOut resolves a pending sacrifice the other way: the seat paid
	// to keep its city. A separate event rather than a flag, because the fold above
	// reads the vertex (so pre-flag logs replay). The payment comes in the paying
	// module's own events; this only clears the debt. See
	// engine.Hooks.PillageBuyout.
	EvPillageBoughtOut engine.EventType = "cak_pillage_bought_out"
	// EvRobberIdle announces a 7 that moved nothing because the robber is out of
	// play until the first landfall. No payload and no state change (Attacks == 0
	// already decides it); it exists so the log can explain the 7.
	EvRobberIdle         engine.EventType = "cak_robber_idle"
	EvProgressPlayed     engine.EventType = "cak_progress_played"
	EvMerchantPlaced     engine.EventType = "cak_merchant_placed"
	EvCardsTaken         engine.EventType = "cak_cards_taken"
	EvCardsGiven         engine.EventType = "cak_cards_given"
	EvResourceLevy       engine.EventType = "cak_resource_levy"
	EvCommodityLevy      engine.EventType = "cak_commodity_levy"
	EvCommodityDiscarded engine.EventType = "cak_commodity_discarded"
	// EvCommoditySold is one commodity returned to its stack for something another
	// module pays (cak+explorers rule G: Fast Gold buys a commodity for 1 gold).
	// Not EvCommodityDiscarded, which is the 7-roll discard and clears
	// PendingDiscards.
	EvCommoditySold   engine.EventType = "cak_commodity_sold"
	EvCommodityStolen engine.EventType = "cak_commodity_stolen" // random (Bishop/robber)
	EvCommodityTaken  engine.EventType = "cak_commodity_taken"  // chosen (Master Merchant/Wedding)
	EvDiceFixed       engine.EventType = "cak_dice_fixed"
	EvTokensSwapped   engine.EventType = "cak_tokens_swapped" //nolint:gosec // G101: event-type constant, not a credential
	EvHarvest         engine.EventType = "cak_harvest"
	EvCheapCity       engine.EventType = "cak_cheap_city"
	// EvCheapHarbour is the other half of Medicine under cak+explorers rule H: the
	// 1 ore + 1 grain for a harbour settlement. It carries only the payment; the
	// building arrives as the Explorers module's own placement event.
	EvCheapHarbour engine.EventType = "cak_cheap_harbour"
	// EvLaidCityRestored follows the city build (or EvCheapCity) that stands a
	// laid-on-side city back up, and undoes the settlement piece that build
	// credited to supply, since none left supply when the city was laid down. A
	// separate event because the base engine has no laid-city concept. Older logs
	// lack it and replay as before (mustUpgradeFirst resolves from the board).
	EvLaidCityRestored engine.EventType = "cak_laid_city_restored"
	EvFreeRoads        engine.EventType = "cak_free_roads"
	EvRoadRelocated    engine.EventType = "cak_road_relocated"
	EvHarborSetup      engine.EventType = "cak_harbor_setup"
	EvHarborGiven      engine.EventType = "cak_harbor_given"
	EvMerchantFleet    engine.EventType = "cak_merchant_fleet"
	EvTradingHouse     engine.EventType = "cak_trading_house"
	EvCommodityTraded  engine.EventType = "cak_commodity_traded"
	EvCommodityBasket  engine.EventType = "cak_commodity_basket_traded"
	EvAqueductOwed     engine.EventType = "cak_aqueduct_owed"
	EvAqueductTaken    engine.EventType = "cak_aqueduct_taken"
)

type aqueductOwedData struct {
	Players []engine.PlayerID `json:"players"`
}

type aqueductTakenData struct {
	Player engine.PlayerID `json:"player"`
	Res    board.Resource  `json:"res"` // ResNone when the bank was empty (no take)
}

// commodityTradeData records a maritime trade involving a commodity. The
// give side (GiveIsCom selects which of GiveRes/GiveCom is meaningful) is spent
// GiveN cards; the get side (GetIsCom) yields Count cards.
type commodityTradeData struct {
	Player    engine.PlayerID `json:"player"`
	GiveRes   board.Resource  `json:"give_res"`
	GiveCom   Commodity       `json:"give_com"`
	GiveIsCom bool            `json:"give_is_com"`
	GiveN     int             `json:"give_n"`
	GetRes    board.Resource  `json:"get_res"`
	GetCom    Commodity       `json:"get_com"`
	GetIsCom  bool            `json:"get_is_com"`
	Count     int             `json:"count"`
}

// commodityBasketData records a whole maritime basket settled at once: any mix
// of give kinds, each at its own rate, funding any mix of taken kinds, across
// resources and commodities. Separate from commodityTradeData, whose fold
// assumes one give and one get kind, so EvCommodityTraded logs still replay.
// The fold is additive, so the basket is validated and applied as a unit.
type commodityBasketData struct {
	Player   engine.PlayerID `json:"player"`
	SpendRes engine.Hand     `json:"spend_res"`
	SpendCom CommodityHand   `json:"spend_com"`
	GetRes   engine.Hand     `json:"get_res"`
	GetCom   CommodityHand   `json:"get_com"`
}

// tradingHouseData records a Trade-L3 swap: 2 of commodity Give for a single
// output. ComOut selects whether the output is the commodity GetCom or the
// resource GetRes.
type tradingHouseData struct {
	Player engine.PlayerID `json:"player"`
	Give   Commodity       `json:"give"`
	GetRes board.Resource  `json:"get_res"`
	GetCom Commodity       `json:"get_com"`
	ComOut bool            `json:"com_out"`
}

type merchantFleetData struct {
	Player engine.PlayerID `json:"player"`
	Res    board.Resource  `json:"res"`
	Com    Commodity       `json:"com"`
	IsCom  bool            `json:"is_com"`
}

type eventDieData struct {
	Face string `json:"face"` // ship | trade | politics | science
	Red  int    `json:"red"`
}

// commodityAdjustData converts city production into commodities: Count copies
// of Res go back to the bank and Count-Short commodities come off the supply
// stack in their place.
//
// Short records how many of the returned resources bought nothing because the
// commodity stack ran out; the resource still goes back so the city is not
// overpaid. Absent in older logs, it decodes as 0, the old unconditional grant.
//
// Minted is the current form. The core now pays a Knights city one resource on
// commodity terrain (Hooks.CityResourceYield), so nothing is taken back: Count
// is the number of cities owed a commodity and Count-Short come off the stack.
// Each half then follows its own shortage rule independently. Older events
// decode false and fold as written.
type commodityAdjustData struct {
	Player    engine.PlayerID `json:"player"`
	Res       board.Resource  `json:"res"`
	Commodity Commodity       `json:"commodity"`
	Count     int             `json:"count"`
	Short     int             `json:"short,omitempty"`
	Minted    bool            `json:"minted,omitempty"`
}

type progressCardData struct {
	Player engine.PlayerID `json:"player"`
	Card   ProgressCard    `json:"card"`
	Track  Track           `json:"track"`
	// Under places the card at, or takes it from, the bottom of its deck
	// (Ext.Under) rather than the shuffled stack (Ext.Decks). Always set on a
	// played or discarded card; on a draw, set when the shuffled stack was empty.
	// Older logs omit it and the card goes back into the shuffled stack.
	Under bool `json:"under,omitempty"`
}

type progressStolenData struct {
	Thief  engine.PlayerID `json:"thief"`
	Victim engine.PlayerID `json:"victim"`
	Card   ProgressCard    `json:"card"`
}

// spyLookData opens the Spy look-and-choose: the public part is who is spying
// whom; the victim's revealed hand reaches only the thief via the view layer.
type spyLookData struct {
	Thief  engine.PlayerID `json:"thief"`
	Victim engine.PlayerID `json:"victim"`
}

type improvedData struct {
	Player engine.PlayerID `json:"player"`
	Track  Track           `json:"track"`
	Cost   int             `json:"cost"` // commodities paid (Crane discounts)
}

// metropolisData is the payload of both EvMetropolisPending (Track/Holder/Prev;
// V unset) and EvMetropolis (all four; V is the city). On EvMetropolis a Holder
// of NoPlayer means the pick was abandoned for lack of an eligible city: it
// clears the pending and nothing else.
type metropolisData struct {
	Track  Track           `json:"track"`
	Holder engine.PlayerID `json:"holder"`
	Prev   engine.PlayerID `json:"prev"` // NoPlayer if unclaimed before
	V      board.Vertex    `json:"v"`    // the city designated as the metropolis
}

type knightData struct {
	Player engine.PlayerID `json:"player"`
	V      board.Vertex    `json:"v"`
	Free   bool            `json:"free,omitempty"`
	// Level is the strength to build at; 0 means level 1. Deserter sets it.
	Level int `json:"level,omitempty"`
	// Active places the knight already active. Deserter sets it to mirror the
	// removed knight's status.
	Active bool `json:"active,omitempty"`
	// Count is how many knights the event affected, set only by
	// EvKnightsAllActive (Warlord) so the log can show the number. Apply ignores
	// it and re-derives the set from state.
	Count int `json:"count,omitempty"`
	// Fresh places an active knight that may not act until the placer's next turn
	// (the Deserter replacement arrives mid-Action-phase). Older logs read false.
	Fresh bool `json:"fresh,omitempty"`
}

type knightMoveData struct {
	Player engine.PlayerID `json:"player"`
	From   board.Vertex    `json:"from"`
	To     board.Vertex    `json:"to"`
}

type knightRemovedData struct {
	Owner engine.PlayerID `json:"owner"`
	V     board.Vertex    `json:"v"`
}

// deserterData drives the two-step Deserter interaction. Opened carries Taker +
// Victim; Armed carries Taker, Level (the strength owed; 0 means forfeited) and
// Active (the surrendered knight's status, inherited by the replacement).
type deserterData struct {
	Taker  engine.PlayerID `json:"taker"`
	Victim engine.PlayerID `json:"victim,omitempty"`
	Level  int             `json:"level,omitempty"`
	Active bool            `json:"active,omitempty"`
}

// knightDisplacedData drives both move-based displacement and Intrigue: the
// knight at At is pushed off; it relocates to Dest (preserving level/active) or
// is removed when Dest is nil. When From is set, the displacing knight also
// moves From→At (deactivating); for Intrigue From is nil (no piece advances).
type knightDisplacedData struct {
	Mover engine.PlayerID `json:"mover"`
	From  *board.Vertex   `json:"from,omitempty"`
	At    board.Vertex    `json:"at"`
	Dest  *board.Vertex   `json:"dest,omitempty"`
}

type wallData struct {
	Player engine.PlayerID `json:"player"`
	Free   bool            `json:"free,omitempty"`
	// V is the city the player chose to wall. Zero on old logs and for callers
	// that do not choose one (the Engineer card); Apply then falls back to
	// firstUnwalledCity. The tag stays omitempty: omitzero would change the
	// persisted event JSON.
	//nolint:modernize // omitzero would change the persisted event JSON; the log is append-only
	V board.Vertex `json:"v,omitempty"`
}

// downgrade is one razed city: whose, and which. It doubles as the payload of
// EvBarbarianDowngraded.
type downgrade struct {
	Player engine.PlayerID `json:"player"`
	V      board.Vertex    `json:"v"`
	// Forfeit marks the debt-clearing case: the player owed a sacrifice and had no
	// city left, so nothing was razed. A zero V already meant that and still does
	// for older logs, but it is indistinguishable from a city at the origin, so the
	// client reads this flag instead.
	Forfeit bool `json:"forfeit,omitempty"`
}

type barbarianAttackData struct {
	Skipped  bool            `json:"skipped,omitempty"`
	Strength int             `json:"strength"`
	Cities   int             `json:"cities"`
	Win      bool            `json:"win"`
	Defender engine.PlayerID `json:"defender"` // sole top defender, else NoPlayer
	// Downgraded are the sacrifices with nothing to decide: a player whose only
	// sacrificable city is the one named. Applied immediately, as in older logs.
	Downgraded []downgrade `json:"downgraded,omitempty"`
	// Pending are the losing players who hold two or more sacrificable cities and
	// so must choose; each resolves with its own EvBarbarianDowngraded.
	Pending []engine.PlayerID `json:"pending_downgrade,omitempty"`
	// TiedDefenders (turn order from the current player) each owe a progress-card
	// draw of their choice when the defense ties for strongest.
	TiedDefenders []engine.PlayerID `json:"tied_defenders,omitempty"`
}

type merchantData struct {
	Player engine.PlayerID `json:"player"`
	Hex    board.Hex       `json:"hex"`
}

type cardsMovedData struct {
	From  engine.PlayerID `json:"from"`
	To    engine.PlayerID `json:"to"`
	Cards engine.Hand     `json:"cards"`
}

type resourceLevyData struct {
	Player engine.PlayerID       `json:"player"`
	Res    board.Resource        `json:"res"`
	Takes  []engine.MonopolyTake `json:"takes"`
}

type commodityLevyData struct {
	Player    engine.PlayerID       `json:"player"`
	Commodity Commodity             `json:"commodity"`
	Takes     []engine.MonopolyTake `json:"takes"`
}

// commodityDiscardData is one player's 7-roll commodity discard (to the bank).
type commodityDiscardData struct {
	Player engine.PlayerID `json:"player"`
	Cards  CommodityHand   `json:"cards"`
}

// commoditySoldData is one commodity going back on its stack. See EvCommoditySold.
type commoditySoldData struct {
	Player    engine.PlayerID `json:"player"`
	Commodity Commodity       `json:"commodity"`
}

// commodityStolenData is a single random commodity moving Victim→Thief; the
// identity is hidden from non-parties (redacted to a count).
type commodityStolenData struct {
	Thief  engine.PlayerID `json:"thief"`
	Victim engine.PlayerID `json:"victim"`
	Com    Commodity       `json:"com"`
}

// commodityMovedData is a chosen bundle of commodities moving From→To, redacted
// to a count for non-parties.
type commodityMovedData struct {
	From  engine.PlayerID `json:"from"`
	To    engine.PlayerID `json:"to"`
	Cards CommodityHand   `json:"cards"`
}

type diceFixedData struct {
	Player engine.PlayerID `json:"player"`
	D1     int             `json:"d1"`
	D2     int             `json:"d2"`
}

// tokensSwappedData is the Inventor's swap. A and B are the two hexes, all the
// fold needs: Apply derives the new numbers from s.Board.Tiles. AN and BN are
// for the event log only, the numbers before the swap (AN leaves hex A); the
// formatter has no board to look them up. Old logs decode them as zero and
// fold the same.
type tokensSwappedData struct {
	A  board.Hex `json:"a"`
	B  board.Hex `json:"b"`
	AN int       `json:"an,omitempty"`
	BN int       `json:"bn,omitempty"`
}

type harvestData struct {
	Player engine.PlayerID `json:"player"`
	Res    board.Resource  `json:"res"`
	Count  int             `json:"count"`
}

type cheapCityData struct {
	Player engine.PlayerID `json:"player"`
	V      board.Vertex    `json:"v"`
}

// cheapHarbourData is Medicine's harbour price. See EvCheapHarbour.
type cheapHarbourData struct {
	Player engine.PlayerID `json:"player"`
	V      board.Vertex    `json:"v"`
}

// laidCityRestoredData names the vertex whose laid-on-side city was just stood
// back up, so the fold can drop it from the owner's laid list and cancel the
// settlement piece the upgrade credited.
type laidCityRestoredData struct {
	Player engine.PlayerID `json:"player"`
	V      board.Vertex    `json:"v"`
}

type freeRoadsData struct {
	Player engine.PlayerID `json:"player"`
	Count  int             `json:"count"`
}

type roadRelocatedData struct {
	Player engine.PlayerID `json:"player"`
	Owner  engine.PlayerID `json:"owner"` // whose road was removed
	From   board.Edge      `json:"from"`
	To     *board.Edge     `json:"to,omitempty"` // set when the owner re-places their own removed road
}

// harborGive is the resource the Commercial Harbor taker offers one opponent;
// that opponent must return a commodity of their own choice.
type harborGive struct {
	Player engine.PlayerID `json:"player"`
	Res    board.Resource  `json:"res"`
}

type harborSetupData struct {
	Taker engine.PlayerID `json:"taker"`
	Gives []harborGive    `json:"gives"`
}

type harborGivenData struct {
	Taker engine.PlayerID `json:"taker"`
	Giver engine.PlayerID `json:"giver"`
	Res   board.Resource  `json:"res"`
	Com   Commodity       `json:"com"`
}

func init() {
	// Hidden-payload events keep their public parts when redacted for
	// non-parties (see game.RedactEvent → engine.RedactorFor).
	engine.RegisterRedactor(EvProgressDrawn, func(e engine.Event) json.RawMessage {
		d := engine.DecodeEvent[progressCardData](e)
		public := map[string]any{"player": d.Player, "track": d.Track}
		// Constitution and Printer are pure-VP cards that resolve on draw and are
		// revealed face-up, so opponents see which one was drawn.
		if vpCard(d.Card) {
			public["card"] = d.Card
		}
		raw, _ := json.Marshal(public)
		return raw
	})
	engine.RegisterRedactor(EvProgressDiscard, func(e engine.Event) json.RawMessage {
		// The over-limit progress card is discarded face-down: opponents see the
		// discipline (track) but never which card.
		d := engine.DecodeEvent[progressCardData](e)
		raw, _ := json.Marshal(map[string]any{"player": d.Player, "track": d.Track})
		return raw
	})
	engine.RegisterRedactor(EvProgressStolen, func(e engine.Event) json.RawMessage {
		d := engine.DecodeEvent[progressStolenData](e)
		raw, _ := json.Marshal(map[string]any{"thief": d.Thief, "victim": d.Victim})
		return raw
	})
	engine.RegisterRedactor(EvCardsTaken, func(e engine.Event) json.RawMessage {
		d := engine.DecodeEvent[cardsMovedData](e)
		raw, _ := json.Marshal(map[string]any{"from": d.From, "to": d.To, "count": d.Cards.Count()})
		return raw
	})
	engine.RegisterRedactor(EvCardsGiven, func(e engine.Event) json.RawMessage {
		d := engine.DecodeEvent[cardsMovedData](e)
		raw, _ := json.Marshal(map[string]any{"from": d.From, "to": d.To, "count": d.Cards.Count()})
		return raw
	})
	engine.RegisterRedactor(EvCommodityStolen, func(e engine.Event) json.RawMessage {
		d := engine.DecodeEvent[commodityStolenData](e)
		raw, _ := json.Marshal(map[string]any{"thief": d.Thief, "victim": d.Victim})
		return raw
	})
	engine.RegisterRedactor(EvCommodityTaken, func(e engine.Event) json.RawMessage {
		d := engine.DecodeEvent[commodityMovedData](e)
		raw, _ := json.Marshal(map[string]any{"from": d.From, "to": d.To, "count": d.Cards.Count()})
		return raw
	})
	engine.RegisterRedactor(EvHarborGiven, func(e engine.Event) json.RawMessage {
		// Commodities are hidden: non-parties learn only that an exchange happened and
		// which resource the taker offered, not the commodity (Com). Taker and giver
		// get the full payload via the visibility list.
		d := engine.DecodeEvent[harborGivenData](e)
		raw, _ := json.Marshal(map[string]any{"taker": d.Taker, "giver": d.Giver, "res": d.Res})
		return raw
	})
}
