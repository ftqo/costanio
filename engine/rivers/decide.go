package rivers

import (
	"encoding/json"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// Reasons a coin count moved, carried on EvCoinsChanged so the event log can
// say what happened without re-deriving it.
const (
	// ReasonBuild is the coin ledger settling against the board: a road, a
	// ship, a settlement or a bridge placed on the river, or one taken off it.
	ReasonBuild = "build"
	// ReasonBought is a resources-to-supply purchase.
	ReasonBought = "bought"
	// ReasonSpent is two coins turned into one resource.
	ReasonSpent = "spent"
	// ReasonTrade is coins moving between two players in a trade.
	ReasonTrade = "trade"
	// ReasonPillage is the Knights combination rule: 5 coins paid to keep a
	// city the barbarians were about to raze.
	ReasonPillage = "pillage"
)

// CoinsPerPillageBuyout is what saving a city from the barbarians costs: 5
// coins to keep a city that would be pillaged.
//
// The price lives here with the other coin prices; engine/knights does not import
// this package.
const CoinsPerPillageBuyout = 5

// pillageBuyout is engine.Hooks.PillageBuyout: the payment for p keeping a city
// the barbarians were about to take.
//
// It only pays. Whether p owes a pillage, and clearing that debt, belong to the
// barbarians' module. Refused with this module's shortage error when p cannot
// pay; the caller charges nothing on a refusal.
func (Module) pillageBuyout(s *engine.State, p engine.PlayerID) ([]engine.Event, error) {
	if Coins(s, p) < CoinsPerPillageBuyout {
		return nil, ErrNoCoins
	}
	return []engine.Event{engine.NewEvent(EvCoinsChanged, coinsChangedData{
		Player: p, Delta: -CoinsPerPillageBuyout, Reason: ReasonPillage,
	})}, nil
}

// freeBridge is engine.Hooks.FreeBridge: BuildBridgeFree reached through the
// engine, so the Fishermen six-fish spend can buy a bridge without that module
// importing this one.
func (Module) freeBridge(s *engine.State, p engine.PlayerID, e board.Edge) (engine.Event, error) {
	return BuildBridgeFree(s, p, e)
}

type bridgeData struct {
	Player engine.PlayerID `json:"player"`
	E      board.Edge      `json:"e"`
	// Free is set when a module paid for this bridge with something other than
	// resources (Fishermen's six-fish spend). It still pays its 3 coins,
	// because coins are paid for the placement and not for what it cost.
	Free bool `json:"free,omitempty"`
}

// coinsChangedData is one seat's coin movement.
//
// E and V are the position a building payment was made (or reclaimed) for,
// which makes the ledger replayable: a replay never runs AfterEvents, so the
// record of which pieces have paid is kept by Apply from these fields. Absent
// on a purchase, spend or trade.
type coinsChangedData struct {
	Player engine.PlayerID `json:"player"`
	Delta  int             `json:"delta"`
	Reason string          `json:"reason"`
	E      *board.Edge     `json:"e,omitempty"`
	V      *board.Vertex   `json:"v,omitempty"`
}

type coinBoughtData struct {
	Player engine.PlayerID `json:"player"`
	Res    board.Resource  `json:"res"`
	Paid   int             `json:"paid"`
}

type coinsSpentData struct {
	Player engine.PlayerID `json:"player"`
	Res    board.Resource  `json:"res"`
}

type wealthChangedData struct {
	Wealthiest engine.PlayerID   `json:"wealthiest"`
	Poorest    []engine.PlayerID `json:"poorest"`
}

type coinTradeData struct {
	From  engine.PlayerID `json:"from"`
	To    engine.PlayerID `json:"to"`
	Coins int             `json:"coins"`
}

// Decide handles the module's three commands.
func (m Module) Decide(s *engine.State, cmd engine.Command) ([]engine.Event, bool, error) {
	switch cmd.Type {
	case CmdBuildBridge:
		ev, err := m.decideBuildBridge(s, cmd)
		return ev, true, err
	case CmdBuyCoin:
		ev, err := m.decideBuyCoin(s, cmd)
		return ev, true, err
	case CmdSpendCoins:
		ev, err := m.decideSpendCoins(s, cmd)
		return ev, true, err
	default:
	}
	return nil, false, nil
}

// decideBuildBridge places a bridge on an empty bridge site.
//
// The connection rule is the road's: a new bridge must touch one of your roads,
// bridges, settlements or cities at one of its vertices and may not connect
// through an opponent's building. A bridge is part of the road network
// (routeEdges adds it as a road segment), so it uses the base road build's
// RoadConnectsExcluding.
//
// A bridge is never free from a Road Building effect, base card or Knights
// progress card alike, since bridges cost more than the roads the card is
// priced on. So this does not consult s.FreeRoads or take the free-road timing
// exemption.
func (m Module) decideBuildBridge(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	p := cmd.Player
	if s.Phase == engine.PhaseSetup {
		return nil, ErrNoSetupBridge
	}
	if err := engine.RequireActionableTurn(s, p); err != nil {
		return nil, err
	}
	d, err := engine.DecodeCommand[bridgeData](cmd.Data)
	if err != nil {
		return nil, err
	}
	e := board.NewEdge(d.E.A, d.E.B)
	if !e.Valid() {
		return nil, engine.ErrBadPlacement
	}
	x := extRO(s)
	if !x.IsBridgeSite(e) {
		return nil, ErrNotBridgeSite
	}
	if _, taken := x.Bridges[e]; taken {
		return nil, engine.ErrOccupied
	}
	if _, taken := s.Roads[e]; taken {
		return nil, engine.ErrOccupied
	}
	if BridgesLeft(s, p) == 0 {
		return nil, ErrNoBridges
	}
	if !s.RoadConnectsExcluding(e, p, board.Edge{}) {
		return nil, engine.ErrBadPlacement
	}
	if !s.Players[p].Hand.Has(CostBridge) {
		return nil, engine.ErrNoResources
	}
	return []engine.Event{engine.NewEvent(EvBridgeBuilt, bridgeData{Player: p, E: e})}, nil
}

// BuildBridgeFree is the entry point for an effect outside this module that
// pays for a bridge with something other than resources: Fishermen's six-fish
// spend under Rivers.
//
// Every other rule still applies (an empty bridge site, connected to the
// owner's network, within their 3), and the bridge still pays its 3 coins,
// since coins are paid for the placement. No change is given; that is the
// caller's rule to enforce.
func BuildBridgeFree(s *engine.State, p engine.PlayerID, e board.Edge) (engine.Event, error) {
	x := extRO(s)
	if !x.IsBridgeSite(e) {
		return engine.Event{}, ErrNotBridgeSite
	}
	if _, taken := x.Bridges[e]; taken {
		return engine.Event{}, engine.ErrOccupied
	}
	if _, taken := s.Roads[e]; taken {
		return engine.Event{}, engine.ErrOccupied
	}
	if BridgesLeft(s, p) == 0 {
		return engine.Event{}, ErrNoBridges
	}
	if !s.RoadConnectsExcluding(e, p, board.Edge{}) {
		return engine.Event{}, engine.ErrBadPlacement
	}
	return engine.NewEvent(EvBridgeBuilt, bridgeData{Player: p, E: e, Free: true}), nil
}

type buyCoinCmd struct {
	Good string         `json:"good,omitempty"`
	Res  board.Resource `json:"res"`
}

// decideBuyCoin sells resources to the supply for one coin at the player's best
// ratio for that resource: 4:1, 3:1 at a generic harbor, 2:1 at that resource's
// own harbor. As often as you like on your turn.
//
// The rate comes from engine.State.CurrencyRatio, shared with the Raiders and
// Wagons purchases so the three agree, and it honours any module's rate
// override (a Merchant Fleet's 2:1, a worsening blockade) as a resource trade
// does.
func (m Module) decideBuyCoin(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	p := cmd.Player
	if err := engine.RequireActionableTurn(s, p); err != nil {
		return nil, err
	}
	d, err := engine.DecodeCommand[buyCoinCmd](cmd.Data)
	if err != nil {
		return nil, err
	}
	if d.Good != "" {
		if d.Res != 0 {
			return nil, engine.ErrBadCommand
		}
		events, ok, err := s.SellGoodAtMaritimeRate(p, d.Good)
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, engine.ErrBadCommand
		}
		return append(events, engine.NewEvent(EvCoinsChanged, coinsChangedData{Player: p, Delta: 1, Reason: ReasonBought})), nil
	}

	if !d.Res.Producing() {
		return nil, engine.ErrBadCommand
	}
	ratio := s.CurrencyRatio(p, d.Res)
	if s.Players[p].Hand[d.Res] < ratio {
		return nil, engine.ErrNoResources
	}
	return []engine.Event{
		engine.NewEvent(EvCoinBought, coinBoughtData{Player: p, Res: d.Res, Paid: ratio}),
		engine.NewEvent(EvCoinsChanged, coinsChangedData{Player: p, Delta: 1, Reason: ReasonBought}),
	}, nil
}

type spendCoinsCmd struct {
	Res board.Resource `json:"res"`
}

// decideSpendCoins turns two coins into one resource card of the player's
// choice, at most twice per turn. If the bank does not hold the resource, the
// purchase is refused and no coins are spent.
func (m Module) decideSpendCoins(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	p := cmd.Player
	if err := engine.RequireActionableTurn(s, p); err != nil {
		return nil, err
	}
	d, err := engine.DecodeCommand[spendCoinsCmd](cmd.Data)
	if err != nil {
		return nil, err
	}
	if !d.Res.Producing() {
		return nil, engine.ErrBadCommand
	}
	x := extRO(s)
	if x.SpentThisTurn >= SpendsPerTurn {
		return nil, ErrSpendCap
	}
	if Coins(s, p) < CoinsPerResource {
		return nil, ErrNoCoins
	}
	if s.Bank[d.Res] < 1 {
		return nil, ErrBankEmpty
	}
	return []engine.Event{
		engine.NewEvent(EvCoinsSpent, coinsSpentData{Player: p, Res: d.Res}),
		engine.NewEvent(EvCoinsChanged, coinsChangedData{Player: p, Delta: -CoinsPerResource, Reason: ReasonSpent}),
	}, nil
}

// --- coins in player trades ------------------------------------------------
//
// Coins may be given and taken in player trades on the active player's turn,
// like resources. They ride the base engine's opaque module-trade payload, as
// Knights' commodities do.
//
// The payload is an object with a "coins" key. Knights writes an array (its
// CommodityHand), and the engine sums every module's reading of one payload, so
// both shapes must fit in one blob: engine/knights accepts {"commodities": [...]}
// alongside its array form and ignores a payload with neither. A module that
// does not recognise a payload reports (0, true), as Hooks.TradeExtraHeld
// requires.

type coinsPayload struct {
	Coins *int `json:"coins"`
}

// decodeCoinsPayload reads the coin half of a shared trade payload. The second
// return says whether the payload names coins at all; the third whether it is
// readable JSON, because an unparseable blob is refused (engine/knights'
// decodeTradeExtra does the same).
func decodeCoinsPayload(extra json.RawMessage) (n int, mine, readable bool) {
	if len(extra) == 0 {
		return 0, false, true
	}
	var p coinsPayload
	if err := json.Unmarshal(extra, &p); err != nil {
		return 0, false, json.Valid(extra)
	}
	if p.Coins == nil {
		return 0, false, true
	}
	return *p.Coins, true, true
}

// tradeExtraHeld reports how many coins a trade payload names and whether the
// player holds them. An unrecognised payload is another module's: (0, true).
func tradeExtraHeld(s *engine.State, p engine.PlayerID, extra json.RawMessage) (int, bool) {
	n, mine, readable := decodeCoinsForState(s, extra)
	if !readable {
		return 0, false
	}
	if !mine || n == 0 {
		return 0, true
	}
	if n < 0 {
		// The shared trade aggregator checks affordability only for positive counts.
		return 1, false
	}
	return n, Coins(s, p) >= n
}

// tradeExtraEvents moves coins from one player to another as part of a trade.
// Public: every seat sees every seat's count.
func tradeExtraEvents(s *engine.State, from, to engine.PlayerID, extra json.RawMessage) []engine.Event {
	n, mine, _ := decodeCoinsForState(s, extra)
	if !mine || n <= 0 {
		return nil
	}
	return []engine.Event{engine.NewEvent(EvCoinTraded, coinTradeData{From: from, To: to, Coins: n})}
}

// New Rivers/Wagons games accept the historical gold spelling as an alias.
// Raiders owns that spelling in the three-module variant, so its distinct gold
// stays with Raiders while coins name the shared river/wagon purse.
func decodeCoinsForState(s *engine.State, extra json.RawMessage) (int, bool, bool) {
	n, mine, readable := decodeCoinsPayload(extra)
	user, shared := s.Ext["wagons"].(engine.RiverPurseUser)
	if !shared || !user.UsesRiverPurse() || s.Ext["raiders"] != nil || !readable {
		return n, mine, readable
	}
	var alias struct {
		Gold *int `json:"gold"`
	}
	if json.Unmarshal(extra, &alias) != nil || alias.Gold == nil {
		return n, mine, readable
	}
	if n < 0 || *alias.Gold < 0 || *alias.Gold > int(^uint(0)>>1)-n {
		return -1, true, true
	}
	return n + *alias.Gold, true, true
}
