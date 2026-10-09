// Package rivers implements the Rivers scenario on a procedural board: a
// watercourse derived across the finished board, bridges (the only thing that may
// cross it), and coins, a side currency earned by building along it and spent on
// resources. The spec is docs/rules/rivers.md; conformance tests name the bullet
// they cover.
//
// The module owns board.Swamp (the non-producing hex a river ends on), Ext in
// State.Ext["rivers"] (chains, coins, bridge supply, wealth tiles) and three
// commands: build a bridge, buy a coin, spend two coins on a resource. Nothing
// is hidden, so there is no redactor.
package rivers

import (
	"encoding/gob"
	"encoding/json"
	"maps"
	"slices"
	"strings"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// Name is the ruleset part that turns this module on.
const Name = "rivers"

const (
	// CmdBuildBridge places a bridge on an empty bridge site.
	CmdBuildBridge engine.CommandType = "build_bridge"
	// CmdBuyCoin sells resources to the supply for one coin, at the player's
	// best ratio for that resource (see docs/rules/rivers.md, "Earning").
	CmdBuyCoin engine.CommandType = "buy_coin"
	// CmdSpendCoins buys one resource of the player's choice for two coins,
	// at most twice per turn.
	CmdSpendCoins engine.CommandType = "spend_coins"
)

const (
	// EvBridgeBuilt is a bridge placed on a bridge site.
	EvBridgeBuilt engine.EventType = "rivers_bridge_built"
	// EvCoinsChanged carries one seat's coin movement and why. Emitted by the
	// module's AfterEvents pass for building coins, and by the two trade
	// commands for the rest.
	EvCoinsChanged engine.EventType = "rivers_coins_changed"
	// EvCoinBought is the resources-to-supply half of a coin purchase: the
	// cards leave the hand and go back to the bank. The coin itself arrives on
	// the EvCoinsChanged that follows it.
	EvCoinBought engine.EventType = "rivers_coin_bought"
	// EvCoinsSpent is the supply-to-hand half of a coin spend: the bank pays
	// one chosen resource. The coins leave on the EvCoinsChanged that follows.
	EvCoinsSpent engine.EventType = "rivers_coins_spent"
	// EvCoinTraded moves coins between two players as part of a player trade.
	EvCoinTraded engine.EventType = "rivers_coin_traded"
	// EvTurnReset clears the per-turn coin-spend counter. Emitted by the
	// module's AfterEvents pass when it sees a turn start; see the Apply case.
	EvTurnReset engine.EventType = "rivers_turn_reset"
	// EvWealthChanged announces the two wealth tiles' new holders. It carries the
	// full assignment rather than a delta, since both tiles are re-derived together.
	EvWealthChanged engine.EventType = "rivers_wealth_changed"
)

// Piece and payout constants, from the spec's tables.
const (
	// BridgeSupply is how many bridges a player may ever build.
	BridgeSupply = 3
	// CoinsPerRoad, CoinsPerBuilding and CoinsPerShip are the 1-coin
	// placements: a road on a river edge, a settlement (or a setup city) on a
	// river vertex, a ship on a river edge.
	CoinsPerRoad     = 1
	CoinsPerBuilding = 1
	CoinsPerShip     = 1
	// CoinsPerBridge is 3: a bridge does not also collect the road payment, so a
	// settlement, a road and a bridge total 5 coins.
	CoinsPerBridge = 3
	// CoinsPerBridgeWagons is the Wagons adjustment: coins pay for movement there,
	// so the bridge payout is cut.
	CoinsPerBridgeWagons = 2
	// CoinsPerResource is what two coins buy: one resource card of the
	// player's choice from the supply.
	CoinsPerResource = 2
	// SpendsPerTurn caps that purchase at twice a turn, so a turn converts at
	// most 4 coins into at most 2 resources.
	SpendsPerTurn = 2
	// WealthiestVP and PoorestVP are the two tiles' victory contributions.
	// A total may go negative; -2 is a penalty, not a floor.
	WealthiestVP = 1
	PoorestVP    = -2
)

// CostBridge is 2 brick + 1 lumber.
var CostBridge = engine.Hand{board.Brick: 2, board.Wood: 1}

func init() {
	engine.RegisterModule(Name, func() engine.Module { return Module{} })
	engine.RegisterTerrain(board.Swamp, Name)
	engine.RegisterRouteEvent(EvBridgeBuilt)
	gob.Register(&Ext{})
}

func raw(v any) json.RawMessage {
	b, _ := json.Marshal(v)
	return b
}

// rulesetHas reports whether a module name is part of the ruleset string. Rivers
// adjusts two rules for partners that may not be compiled into this binary
// (Wagons, Raiders), so it tests by name. Mirrors engine/scenarios' rulesetHas.
func rulesetHas(ruleset, name string) bool {
	for part := range strings.SplitSeq(ruleset, "+") {
		if part == name {
			return true
		}
	}
	return false
}

// River is one derived watercourse: a chain of land hexes, the channel through
// each, and the edges that channel crosses.
//
// Every field is board-derived and marshallable, because the value is recorded in
// EvBoardGenerated's ext blob for replay (see engine.ExtBoardInitializer). A
// struct-keyed map here would be dropped from the record.
type River struct {
	// Hexes is the chain h1..hn, downstream: h1 is the headwater in the mountains
	// and hn is the swamp at the sea.
	Hexes []board.Hex `json:"hexes"`
	// Mouth is the index in Hexes of the swamp end, always len(Hexes)-1. Kept as a
	// field because the wire carries it and clients should not need to know which end
	// is the mouth.
	Mouth int `json:"mouth"`
	// In and Out are, per hex, the two edges its channel meets: In is the seam with
	// the previous hex, Out the seam with the next (the coastal outlet at hn). Two
	// named slices rather than [2]Edge pairs, which read badly in the log.
	//
	// At the source In[0] == Out[0]: a headwater reaches no edge but the seam with
	// h2, and ChannelShape reads that as a `src_*` shape.
	In  []board.Edge `json:"in"`
	Out []board.Edge `json:"out"`
	// Sites is every bridge site of this river: the n-1 seams plus the estuary's
	// coastal outlet, in chain order.
	Sites []board.Edge `json:"sites"`
	// Variants is, per hex, which authored meander of its shape it draws. Only the
	// east-west straight has more than one (see EWVariants); every other hex is 0.
	// It is player-visible, so it is drawn from a reserved public slot and recorded
	// in the board, where the fairness port can reproduce it.
	Variants []int `json:"variants"`
}

// MouthHex is the swamp at this river's mouth.
func (r River) MouthHex() board.Hex { return r.Hexes[r.Mouth] }

// SourceHex is the headwater in the mountains, at the other end from the mouth.
func (r River) SourceHex() board.Hex { return r.Hexes[0] }

// Ext is the module's state.
type Ext struct {
	// Rivers is the derived layout, in the order the derivation chose them.
	Rivers []River `json:"rivers"`
	// Coins is every seat's coin count. Public: every seat sees every seat's.
	Coins []int `json:"coins"`
	// BridgesLeft is every seat's remaining bridge supply.
	BridgesLeft []int `json:"bridges_left"`
	// Wealthiest holds the Wealthiest Settler tile, or NoPlayer when a tie
	// means nobody does.
	Wealthiest engine.PlayerID `json:"wealthiest"`
	// Poorest is per seat: every player tied for the fewest coins holds a
	// Poorest Settler tile, so all seats can hold one at once and they do at
	// the start of setup. Suppressed entirely under Wagons and under Raiders.
	Poorest []bool `json:"poorest"`
	// SpentThisTurn counts the current player's coin-to-resource purchases, so
	// the two-per-turn cap can be enforced. Reset on every EvTurnStarted.
	SpentThisTurn int `json:"spent_this_turn"`

	// Bridges maps an occupied bridge site to its owner. Not in the board record,
	// like CaravansExt.Occupied: it is not board-derived (only EvBridgeBuilt writes
	// it), and encoding/json cannot marshal a struct-keyed map.
	Bridges map[board.Edge]engine.PlayerID `json:"-"`
	// PaidEdge and PaidVertex are the coin ledger: which river edges and vertices
	// have already paid their owner. AfterEvents compares who holds each one now
	// against these sets and pays or reclaims the difference, which is what makes it
	// work for pieces from modules this package cannot import (Islands ships, the
	// Knights Diplomat). json:"-" as for Bridges; replaying the placements rebuilds
	// them.
	PaidEdge   map[board.Edge]paid   `json:"-"`
	PaidVertex map[board.Vertex]paid `json:"-"`

	// Positional caches over Rivers, built lazily by cache() and never mutated after.
	// Unexported, so gob and JSON skip them. Lazy because State.Apply unmarshals the
	// logged layout over a derived Ext; a cache built at construction would describe
	// the derived layout instead.
	hexSet   map[board.Hex]bool
	siteSet  map[board.Edge]bool
	edgeList []board.Edge
	vertList []board.Vertex
}

// CloneExt deep-copies the ext for Decide's simulation step.
func (x *Ext) CloneExt() engine.Extension {
	c := *x
	c.Rivers = make([]River, len(x.Rivers))
	for i, r := range x.Rivers {
		c.Rivers[i] = River{
			Hexes:    append([]board.Hex(nil), r.Hexes...),
			Mouth:    r.Mouth,
			In:       append([]board.Edge(nil), r.In...),
			Out:      append([]board.Edge(nil), r.Out...),
			Sites:    append([]board.Edge(nil), r.Sites...),
			Variants: append([]int(nil), r.Variants...),
		}
	}
	c.Coins = slices.Clone(x.Coins)
	c.BridgesLeft = slices.Clone(x.BridgesLeft)
	c.Poorest = slices.Clone(x.Poorest)
	c.Bridges = maps.Clone(x.Bridges)
	c.PaidEdge = maps.Clone(x.PaidEdge)
	c.PaidVertex = maps.Clone(x.PaidVertex)
	// maps.Clone returns nil for a nil map and the fold writes to all three
	// unchecked; RestoreExt fills them in.
	c.RestoreExt()
	// The positional caches are shared by reference: they depend only on
	// Rivers, which never changes after board time, and nothing writes into
	// a built cache. Copying them would cost the bot per candidate move.
	return &c
}

// RestoreExt fills in the maps gob dropped because they were nil when the
// snapshot was written (see engine.ExtRestorer).
func (x *Ext) RestoreExt() {
	if x.Bridges == nil {
		x.Bridges = map[board.Edge]engine.PlayerID{}
	}
	if x.PaidEdge == nil {
		x.PaidEdge = map[board.Edge]paid{}
	}
	if x.PaidVertex == nil {
		x.PaidVertex = map[board.Vertex]paid{}
	}
}

// StateExt returns the live rivers ext, if this game has one.
func StateExt(s *engine.State) (*Ext, bool) {
	if s == nil || s.Ext == nil {
		return nil, false
	}
	x, ok := s.Ext[Name].(*Ext)
	return x, ok
}

// extRO returns the ext for a read, deriving an empty one rather than panicking
// on a state whose board event has not folded yet.
func extRO(s *engine.State) *Ext {
	if x, ok := StateExt(s); ok {
		return x
	}
	return emptyExt(s.Config.Players)
}

// ext returns the live ext for a write, creating it if the fold has not.
func ext(s *engine.State) *Ext {
	if x, ok := StateExt(s); ok {
		x.RestoreExt()
		return x
	}
	x := emptyExt(s.Config.Players)
	if s.Ext == nil {
		s.Ext = map[string]engine.Extension{}
	}
	s.Ext[Name] = x
	return x
}

// emptyExt is the opening state for n seats: no coins, a full bridge supply,
// nobody wealthiest, and every seat poorest, since everyone is tied at 0 coins.
func emptyExt(players int) *Ext {
	if players < 0 {
		players = 0
	}
	x := &Ext{
		Coins:       make([]int, players),
		BridgesLeft: make([]int, players),
		Wealthiest:  engine.NoPlayer,
		Poorest:     make([]bool, players),
		Bridges:     map[board.Edge]engine.PlayerID{},
		PaidEdge:    map[board.Edge]paid{},
		PaidVertex:  map[board.Vertex]paid{},
	}
	for i := range x.BridgesLeft {
		x.BridgesLeft[i] = BridgeSupply
	}
	for i := range x.Poorest {
		x.Poorest[i] = true
	}
	return x
}

// Coins is seat p's coin count, 0 for a seat off the end of the table.
func Coins(s *engine.State, p engine.PlayerID) int {
	x := extRO(s)
	if p < 0 || int(p) >= len(x.Coins) {
		return 0
	}
	return x.Coins[p]
}

// BridgesLeft is seat p's remaining bridge supply.
func BridgesLeft(s *engine.State, p engine.PlayerID) int {
	x := extRO(s)
	if p < 0 || int(p) >= len(x.BridgesLeft) {
		return 0
	}
	return x.BridgesLeft[p]
}

// usesPoorestTile reports whether this ruleset plays with the Poorest Settler
// tile. Wagons and Raiders switch it off because coins stop measuring good play:
// Wagons spends coins to move, and Raiders pays coins out when knights are lost.
// The Wealthiest Settler tile stays in both.
func usesPoorestTile(ruleset string) bool {
	return !rulesetHas(ruleset, "wagons") && !rulesetHas(ruleset, "raiders")
}

// bridgePayout is what building a bridge earns: 3, or 2 alongside Wagons.
func bridgePayout(ruleset string) int {
	if rulesetHas(ruleset, "wagons") {
		return CoinsPerBridgeWagons
	}
	return CoinsPerBridge
}

func (x *Ext) RiverGold(p engine.PlayerID) int {
	if p < 0 || int(p) >= len(x.Coins) {
		return 0
	}
	return x.Coins[p]
}
func (x *Ext) ChangeRiverGold(p engine.PlayerID, delta int) {
	if p >= 0 && int(p) < len(x.Coins) {
		x.Coins[p] += delta
	}
}
func (x *Ext) RiverPurchases() int { return x.SpentThisTurn }
func (x *Ext) CountRiverPurchase() { x.SpentThisTurn++ }
func (x *Ext) RiverCrossing(e board.Edge) (engine.PlayerID, bool, bool) {
	if !x.IsBridgeSite(e) {
		return engine.NoPlayer, false, false
	}
	owner, built := x.Bridges[e]
	return owner, true, built
}
