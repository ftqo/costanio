package scenarios

import (
	"encoding/json"
	"fmt"
	"maps"
	"math/rand/v2"
	"slices"
	"strings"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// Caravans scenario on a standard board: the oasis is the desert hex. Three
// neutral caravans grow outward from spokes at alternating oasis corners. One
// camel is placed after any turn in which the active player built or upgraded a
// building, its position settled by a wool/grain vote. A settlement or city
// between two camels of a caravan is worth +1 VP, and a road sharing a path with
// a camel counts double for Longest Road. Game to 12 VP.
const CaravansName = "caravans"

const (
	CmdBidCamel   engine.CommandType = "bid_camel"
	CmdPlaceCamel engine.CommandType = "place_camel"

	EvCamelBuilt    engine.EventType = "tab_camel_built"    // marker: builder acted this turn
	EvCamelVote     engine.EventType = "tab_camel_vote"     // a qualifying turn ended; voting opens
	EvCamelBid      engine.EventType = "tab_camel_bid"      // a player's bid, face up like the cards it names
	EvCamelResolved engine.EventType = "tab_camel_resolved" // bidding closed; every bid revealed and paid, winner chosen
	EvCamelPlaced   engine.EventType = "tab_camel_placed"
)

const (
	// caravansPerOasis is how many caravans each oasis starts, one per
	// alternating corner. A table has 1, 2 or 3 oases (oasisCountFor), so 3, 6
	// or 9 caravans.
	caravansPerOasis = 3
	// camelSupply is the 3-4-player camel count.
	camelSupply = 22
	// caravanVP is the scenario's addition to the target: 12 is the base 10 plus
	// 2, and alongside Knights 15 is Knights' 13 plus the same 2. Alongside Islands
	// the target rises by a further caravanIslandsVP.
	caravanVP        = 2
	caravanIslandsVP = 2

	// CamelSupply is the 3-4-player camel count. A game's own supply is
	// CaravansExt.Supply(): it grows with the table (camelSupplyFor).
	CamelSupply = camelSupply
)

// oasisCountFor is how many oases a table plays with (derivation 13): one at 2
// to 4 seats, two at 5 and 6 (the 5-6 player bracket, six caravans), and three at
// 7 to 10 (our extension: one per desert on the 61-hex board).
func oasisCountFor(players int) int {
	switch {
	case players <= 4:
		return 1
	case players <= 6:
		return 2
	default:
		return 3
	}
}

// OasisCount is oasisCountFor, exported for the sim invariants.
func OasisCount(players int) int { return oasisCountFor(players) }

// camelSupplyFor is the camel supply at a table size: 22, plus 11 at 5 and 6
// (33), plus 11 more at 7 to 10 (44; ours, eleven per extra oasis).
func camelSupplyFor(players int) int {
	return camelSupplyForOases(oasisCountFor(players))
}

// camelSupplyForOases is the supply for the oases a board actually has: eleven
// more camels per oasis past the first. It follows the board rather than the
// table because an Islands carve can drown a desert.
func camelSupplyForOases(oases int) int {
	return camelSupply + 11*(max(oases, 1)-1)
}

type CaravansExt struct {
	// Oasis is the first oasis, Oases[0]. Kept under this name because logs from
	// before derivation 13 record only it.
	Oasis    board.Hex
	HasOasis bool
	// Oases is every oasis, in the order pickOases chose them (derivation 13:
	// two at 5 and 6 seats, three at 7 to 10). Caravan i starts from oasis i/3.
	// A legacy blob has no key and folds to the one oasis it recorded.
	Oases []board.Hex
	// Arrows, ArrowCorner and Chains hold three entries per oasis: the spoke
	// edge that starts each caravan, the oasis corner it leaves from, and the
	// ordered camel path. Slices, so a legacy blob's three entries decode to
	// three caravans.
	Arrows      []board.Edge
	ArrowCorner []board.Vertex
	Chains      [][]board.Edge
	// CamelSupply is the game's camel count (camelSupplyFor). Zero on a legacy
	// blob, which means the base 22; read it through Supply().
	CamelSupply int
	// Occupied is excluded from the EvBoardGenerated ext record: it is not
	// board-derived (only EvCamelPlaced writes it), and encoding/json cannot
	// marshal a struct-keyed map. TestRecordedLayoutRoundTripsExactly catches a
	// board-derived field wrongly excluded here.
	Occupied   map[board.Edge]bool `json:"-"`
	CamelsLeft int

	// BuiltThisTurn arms a camel vote at the next turn end. It is set on
	// EvCamelBuilt and cleared on EvCamelVote, not at turn start.
	//
	// A turn that ends with a build but a suppressed vote (CamelsLeft == 0, or no
	// legal paths) leaves it set. That is harmless today because Occupied only
	// grows and LandEdge is static, so once no path is legal none ever is again; a
	// rule that reopens paths would need to handle it.
	//
	// Clearing it on EvTurnStarted does not work: EvTurnEnded and the next
	// EvTurnStarted fold in the same batch and onEvents sees the state after the
	// whole batch, so the deferred vote would never open (game.TestCamelBidsAreSealed
	// fails). A module's Apply never sees base events either. A real fix needs a
	// point after onEvents consumes the flag (the next EvDiceRolled) or an explicit
	// clearing event.
	BuiltThisTurn bool

	// Voting state for one pending camel placement.
	Voting   bool
	Finisher engine.PlayerID
	// Bids is what each seat named. Bids are open: bidding starts with the player
	// who just finished their turn and goes clockwise, cards face up, so later
	// bidders see earlier ones. That is what makes a coalition possible (see
	// pickPlacer).
	Bids map[engine.PlayerID]CamelBid
	// Bidded is who has answered. Needed beside Bids because a seat may answer
	// with nothing, and a zero bid cannot otherwise be told from no answer.
	Bidded map[engine.PlayerID]bool
	Placer engine.PlayerID // NoPlayer until bidding closes
	// BidRes is the pair of resources this game bids camels in, resolved once
	// from the ruleset at board time. Stored here because ViewExt gets no State.
	// See BidResources.
	BidRes [2]board.Resource
	// Reason is which of pickPlacer's outcomes settled the round, stamped at
	// resolution. It cannot be re-derived from Bids, since a coalition outcome
	// depends on the placements named and Bids is replaced by what was paid.
	Reason string
}

// CamelBid is one seat's vote in a camel round: the cards it put up, and the
// placement it wants.
type CamelBid struct {
	// Cards is how many of each of the round's two bid resources this seat
	// named, in BidResources order. Two piles because payment is settled later
	// and clamped pile by pile against what the seat still holds (see settle).
	// Not named wool and grain because under Knights they are brick and lumber.
	Cards [2]int `json:"cards"`
	// Path is the placement this seat wants, if it named one. A coalition is
	// two or more players who together hold a majority of the votes and agree on
	// the placement. Nil means no preference, which is legal and joins no
	// coalition.
	Path *engine.CamelPath `json:"path,omitempty"`
}

// Total is the number of votes a bid is worth: one per card, whichever pile it
// came from.
func (b CamelBid) Total() int { return b.Cards[0] + b.Cards[1] }

// BidResources are the two resources a camel vote is bid in, for this ruleset:
// wool and grain, or brick and lumber alongside Knights (a combination rule, since
// Knights uses wool and grain for commodities).
//
// Published so the client can label the piles without hardcoding a rules
// constant, like LakeNumbers.
func BidResources(s *engine.State) [2]board.Resource {
	if rulesetHas(s.Config.Ruleset, knightsModuleName) {
		return [2]board.Resource{board.Brick, board.Wood}
	}
	return [2]board.Resource{board.Sheep, board.Wheat}
}

// bidCost is a bid as a hand: the two piles against the resources this ruleset
// bids in.
func bidCost(s *engine.State, cards [2]int) engine.Hand {
	var cost engine.Hand
	res := BidResources(s)
	cost[res[0]] = cards[0]
	cost[res[1]] = cards[1]
	return cost
}

// rulesetHas reports whether the ruleset string names a module.
//
// Names are string constants rather than imports of engine/knights and
// engine/islands, so peer modules stay independent. TestModuleNamesMatch pins
// them against those packages' constants.
const (
	knightsModuleName = "cak"
	islandsModuleName = "islands"
)

func rulesetHas(ruleset, name string) bool {
	return slices.Contains(strings.Split(ruleset, "+"), name)
}

// CloneExt deep-copies the module state for Decide, which runs the rules against
// a copy rather than the live game.
//
// It starts from a shallow struct copy so every value field is carried. Reference
// fields are replaced explicitly, since sharing them would let a speculative write
// from a rejected command reach the live game. TestCloneExtCarriesEveryField in
// engine/ruletest checks them by reflection.
func (e *CaravansExt) CloneExt() engine.Extension {
	c := *e
	c.Oases = slices.Clone(e.Oases)
	c.Arrows = slices.Clone(e.Arrows)
	c.ArrowCorner = slices.Clone(e.ArrowCorner)
	if e.Chains != nil {
		c.Chains = make([][]board.Edge, len(e.Chains))
		for i := range e.Chains {
			c.Chains[i] = append([]board.Edge(nil), e.Chains[i]...)
		}
	}
	c.Occupied = maps.Clone(e.Occupied)
	c.Bids = maps.Clone(e.Bids)
	c.Bidded = maps.Clone(e.Bidded)
	return &c
}

// Supply is the game's camel count: CamelSupply, or the base 22 on a legacy
// ext that never recorded one.
func (e *CaravansExt) Supply() int {
	if e.CamelSupply > 0 {
		return e.CamelSupply
	}
	return camelSupply
}

// UnmarshalJSON adds legacy rules for a blob recorded before derivation 13,
// which engine.Apply folds over the fresh derivation: no "Oases" key means the
// one oasis the blob names (the derived second and third are dropped), and no
// "CamelSupply" key means 22. The recorded three-entry Arrows, ArrowCorner and
// Chains replace the derived slices, so such a game keeps its three caravans.
func (e *CaravansExt) UnmarshalJSON(raw []byte) error {
	var probe map[string]json.RawMessage
	if err := json.Unmarshal(raw, &probe); err != nil {
		return err
	}
	type plain CaravansExt
	if err := json.Unmarshal(raw, (*plain)(e)); err != nil {
		return err
	}
	if _, ok := probe["Oases"]; !ok {
		e.Oases = nil
		if e.HasOasis {
			e.Oases = []board.Hex{e.Oasis}
		}
	}
	if _, ok := probe["CamelSupply"]; !ok {
		e.CamelSupply = 0
	}
	return nil
}

// isOasis reports whether h is one of the game's oases.
func (e *CaravansExt) isOasis(h board.Hex) bool {
	if !e.HasOasis {
		return false
	}
	if e.Oases == nil {
		return h == e.Oasis
	}
	return slices.Contains(e.Oases, h)
}

// RestoreExt reallocates the maps the fold writes to after a snapshot decode
// left them nil (see engine.ExtRestorer). Bids and Bidded are replaced at each
// vote's start and end, but a snapshot mid-vote still needs them.
//
// Fill in only what is missing: post-snapshot events are replayed onto this
// state next.
func (e *CaravansExt) RestoreExt() {
	if e.Occupied == nil {
		e.Occupied = map[board.Edge]bool{}
	}
	if e.Bids == nil {
		e.Bids = map[engine.PlayerID]CamelBid{}
	}
	if e.Bidded == nil {
		e.Bidded = map[engine.PlayerID]bool{}
	}
}

// CaravansStateExt returns the caravans module's ext state for s and whether
// the module is active. Read-only: callers outside the fold must not mutate
// it.
func CaravansStateExt(s *engine.State) (*CaravansExt, bool) {
	e, ok := s.Ext[CaravansName].(*CaravansExt)
	return e, ok
}

// InitCaravansExt installs the module's derived state on s if nothing has
// written it yet, and returns it with whether Caravans is active.
//
// For callers that need the state before any camel event (a test arranging a
// vote on a fresh board, a tool). CaravansStateExt does not do this because it
// is the read path, and a read that writes live state lets the fold and a viewer
// disagree.
func InitCaravansExt(s *engine.State) (*CaravansExt, bool) {
	if e, ok := s.Ext[CaravansName].(*CaravansExt); ok {
		return e, true
	}
	if !hasCaravans(s) {
		return nil, false
	}
	return caravansExt(s), true
}

func caravansExt(s *engine.State) *CaravansExt {
	if e, ok := s.Ext[CaravansName].(*CaravansExt); ok {
		return e
	}
	e := freshCaravans(s)
	s.Ext[CaravansName] = e
	return e
}

// OasisOf reports the scenario's oasis hex for s and whether it has one,
// deriving it from the board if the ext does not exist yet. Returns (zero,
// false) when Caravans is not active.
func OasisOf(s *engine.State) (board.Hex, bool) {
	if _, ok := s.Ext[CaravansName]; !ok && !hasCaravans(s) {
		return board.Hex{}, false
	}
	e := caravansExtRO(s)
	return e.Oasis, e.HasOasis
}

func hasCaravans(s *engine.State) bool {
	for _, m := range s.Modules() {
		if m.Name() == CaravansName {
			return true
		}
	}
	return false
}

func caravansExtRO(s *engine.State) *CaravansExt {
	if e, ok := s.Ext[CaravansName].(*CaravansExt); ok {
		return e
	}
	// No board yet: the state between game_created and board_generated.
	// A live game never renders it, but replay.Fold snapshots a view after
	// every event, including frame zero, and freshCaravans would dereference
	// a nil board. Before the board exists there is no oasis, caravan or
	// camel, so the empty ext is correct.
	if s.Board == nil {
		return emptyCaravans(s)
	}
	return freshCaravans(s)
}

// emptyCaravans is the zero ext for a game whose board has not been dealt. It
// still knows the bid resources, which depend only on the ruleset.
func emptyCaravans(s *engine.State) *CaravansExt {
	n := camelSupplyFor(len(s.Players))
	return &CaravansExt{
		Occupied: map[board.Edge]bool{}, CamelsLeft: n, CamelSupply: n,
		Finisher: engine.NoPlayer, Placer: engine.NoPlayer,
		Bids: map[engine.PlayerID]CamelBid{}, Bidded: map[engine.PlayerID]bool{},
		BidRes:      BidResources(s),
		Arrows:      make([]board.Edge, caravansPerOasis),
		ArrowCorner: make([]board.Vertex, caravansPerOasis),
		Chains:      make([][]board.Edge, caravansPerOasis),
	}
}

// freshCaravans derives the oases (the deserts) and their caravan spokes.
func freshCaravans(s *engine.State) *CaravansExt {
	e := emptyCaravans(s)
	// The oasis is the desert hex. Under Fishermen every desert is already a
	// lake, so fall back to the first lake hex (on a procedural board, the
	// former desert). HexesInRadius order is deterministic, so live and replay
	// agree.
	e.Oases = oasesOf(s.Board, len(s.Players))
	if len(e.Oases) > 0 {
		e.Oasis, e.HasOasis = e.Oases[0], true
		e.Arrows = make([]board.Edge, 0, caravansPerOasis*len(e.Oases))
		e.ArrowCorner = make([]board.Vertex, 0, caravansPerOasis*len(e.Oases))
		for _, o := range e.Oases {
			a, c := oasisSpokes(s.Board, o)
			e.Arrows = append(e.Arrows, a[:]...)
			e.ArrowCorner = append(e.ArrowCorner, c[:]...)
		}
		e.Chains = make([][]board.Edge, len(e.Arrows))
		e.CamelSupply = camelSupplyForOases(len(e.Oases))
		e.CamelsLeft = e.CamelSupply
	}
	return e
}

// oasesOf is the hexes freshCaravans makes the oases at a table of `players`:
// pickOases, else the first producing hex as the one oasis. A pure function of
// the finished board, so TradeHexAllowed can call it from another module's
// derivation regardless of which ext was stored first.
func oasesOf(b *board.Board, players int) []board.Hex {
	if b == nil {
		return nil
	}
	if os := pickOases(b, oasisCountFor(players)); len(os) > 0 {
		return os
	}
	if h, ok := oasisHex(b); ok {
		return []board.Hex{h}
	}
	return nil
}

// oasisHex is the first oasis: pickOasis, else the last-resort first producing
// hex.
func oasisHex(b *board.Board) (board.Hex, bool) {
	if b == nil {
		return board.Hex{}, false
	}
	if h, ok := pickOasis(b); ok {
		return h, true
	}
	// Last resort: any land hex. SetupBoard guarantees a desert on procedural
	// boards, so this fires only for an authored map with no desert or lake.
	// An oasis that also produces is a small deviation; without it HasOasis is
	// false and the scenario is absent while the target is still 12. See
	// sim.TestCaravansAlwaysHasOasis.
	for _, h := range board.HexesInRadius(b.Radius) {
		if t, ok := b.Tiles[h]; ok && t.Res.Producing() {
			return h, true
		}
	}
	return board.Hex{}, false
}

// pickOasis is the oasis rule: the first desert in board order, else the first
// lake (Fishermen has drowned every desert by then). Shared by freshCaravans and
// FinishBoard, which must know which hex will be picked before judging it.
func pickOasis(b *board.Board) (board.Hex, bool) {
	if hs := neutralHexes(b); len(hs) > 0 {
		return hs[0], true
	}
	return board.Hex{}, false
}

// neutralHexes is every hex an oasis may be, in the order the oasis rule reads
// them: the deserts in board order, then the lakes in board order.
func neutralHexes(b *board.Board) []board.Hex {
	var out []board.Hex
	for _, want := range []board.Resource{board.ResNone, board.Lake} {
		for _, h := range board.HexesInRadius(b.Radius) {
			if t, ok := b.Tiles[h]; ok && t.Res == want {
				out = append(out, h)
			}
		}
	}
	return out
}

// pickOases is the oasis rule for n oases (derivation 13): neutral hexes in
// neutralHexes order, each taken unless it clashes with one already taken
// (oasesClash), until there are n. The first is always pickOasis. A neutral hex
// not taken stays a plain desert (or lake) the robber may use.
func pickOases(b *board.Board, n int) []board.Hex {
	var out []board.Hex
	for _, h := range neutralHexes(b) {
		if len(out) == n {
			break
		}
		clash := false
		for _, o := range out {
			if oasesClash(b, h, o) {
				clash = true
				break
			}
		}
		if !clash {
			out = append(out, h)
		}
	}
	return out
}

// oasesClash reports whether two oases would get in each other's way: they
// touch, or a spoke of one shares an intersection with a spoke of the other.
// The second stays a desert unless the finisher can move it (finishOasis).
func oasesClash(b *board.Board, a, c board.Hex) bool {
	if hexDistance(a, c) < 2 {
		return true
	}
	ends := map[board.Vertex]bool{}
	aa, _ := oasisSpokes(b, a)
	for _, e := range aa {
		if e != (board.Edge{}) {
			ends[e.A], ends[e.B] = true, true
		}
	}
	ca, _ := oasisSpokes(b, c)
	for _, e := range ca {
		if e != (board.Edge{}) && (ends[e.A] || ends[e.B]) {
			return true
		}
	}
	return false
}

// oasisSpokes derives the three caravan spokes for an oasis: alternating corners
// 0, 2 and 4 each contribute one outward (non-perimeter) land edge. A corner
// with none leaves a zero Edge, a caravan that never grows (see spokeCount and
// FinishBoard).
func oasisSpokes(b *board.Board, oasis board.Hex) (arrows [caravansPerOasis]board.Edge, corners [caravansPerOasis]board.Vertex) {
	perim := map[board.Edge]bool{}
	for _, pe := range oasis.Edges() {
		perim[pe] = true
	}
	verts := oasis.Vertices()
	for i, ci := range []int{0, 2, 4} {
		v := verts[ci]
		for _, ve := range v.Edges() {
			// LandEdge, so a caravan starts on land, not on a strait between two
			// sea hexes under Islands. Derivation 12.
			if !perim[ve] && b.LandEdge(ve) {
				arrows[i] = ve
				corners[i] = v
				break
			}
		}
	}
	return arrows, corners
}

// spokeCount is how many of the three caravans an oasis at h can actually start.
func spokeCount(b *board.Board, h board.Hex) int {
	arrows, _ := oasisSpokes(b, h)
	n := 0
	for _, a := range arrows {
		if a != (board.Edge{}) {
			n++
		}
	}
	return n
}

// oasisSites are the hexes the oasis may be moved to: interior (never the outer
// ring, which Islands may drown), with enough land to start all three caravans,
// and producing (a hex with a feature is not a candidate for replacement).
//
// Returned in board order; callers draw from it with the seeded rng, so the
// repaired oasis is not on the same tile of every board.
func oasisSites(b *board.Board) []board.Hex {
	var all, spoked []board.Hex
	for _, h := range board.HexesInRadius(b.Radius) {
		if hexRing(h) >= b.Radius {
			continue
		}
		if t, ok := b.Tiles[h]; !ok || !t.Res.Producing() {
			continue
		}
		all = append(all, h)
		if spokeCount(b, h) == caravansPerOasis {
			spoked = append(spoked, h)
		}
	}
	if len(spoked) > 0 {
		return spoked
	}
	return all
}

type Caravans struct{}

// TradeHexAllowed keeps the oasis from becoming a Wagons trade hex
// (engine.TradeHexEligibility); the two cannot share a hex.
//
// On engine-dealt boards this never binds, since finishOasis keeps the oasis off
// the hexes Wagons reserves (engine.HexReserver). It binds only on an authored map
// with a desert pinned on a cape, where the author's map decides the triple. See
// docs/rules/wagons.md, "Caravans".
func (Caravans) TradeHexAllowed(s *engine.State, h board.Hex) bool {
	return !slices.Contains(oasesOf(s.Board, len(s.Players)), h)
}

func (Caravans) Name() string { return CaravansName }

// InitExtBoard seeds the module state as soon as the board exists, so the oasis
// and camel supply are in every client view from the first frame. Not InitExt,
// since s.Board is nil then.
//
// Pure: freshCaravans depends only on s.Board, scanning HexesInRadius in fixed
// order with no RNG. See engine.ExtBoardInitializer.
func (Caravans) InitExtBoard(s *engine.State) engine.Extension { return freshCaravans(s) }

// SetupBoard does nothing; the oasis guarantee is in FinishBoard, since it
// depends on what every other module did.
func (Caravans) SetupBoard(b *board.Board, cfg engine.GameConfig, rng *rand.Rand) {}

// FinishBoard guarantees the board actually has a usable oasis. It runs after
// every module's SetupBoard.
//
// The oasis is the desert (or the lake Fishermen made of it). Islands carves the
// outer ring into sea, and on small boards that can take the only desert. This
// must be a FinishBoard, not a SetupBoard: SetupBoard runs in lexicographic
// ruleset order, so in "base+caravans+islands" Caravans would see the uncarved
// desert and Islands would drown it afterwards.
//
// Repairs, in order:
//   - No oasis at all: promote an interior producing hex to desert. This deletes
//     a resource hex and its token after generation balanced the board, so it is
//     the last resort; interior-only keeps it safe from any module that carves
//     the ring.
//   - An oasis on the outer ring lacks spokes and starts fewer than three
//     caravans: swap it with an interior producing hex (see below).
//   - Tables of five or more seats still short of oases: fillOases.
//
// Only engine-dealt tiles move (see dealtTerrain). Every lobby game inlines a
// board, but a gallery map is a silhouette whose terrain the engine deals, so
// those tiles are as movable as procedural ones; a tile the author pinned is not.
// Presets pin every tile and come out unchanged.
//
// The robber starts beside the board ("on the first 7, any hex with a number
// token, not the oasis"). The base game parks it on the desert, which here is the
// oasis, so it is moved last and unconditionally, including on authored maps.
// robberForbidden keeps it off the oasis afterwards.
func (Caravans) FinishBoard(b *board.Board, cfg engine.GameConfig, rng *rand.Rand) {
	finishOasis(b, cfg, rng)
	b.Robber = board.OffBoard
}

// finishOasis is FinishBoard's repair half: the oasis and its three spokes.
func finishOasis(b *board.Board, cfg engine.GameConfig, rng *rand.Rand) {
	dealt := dealtTerrain(cfg)
	// Hexes another module will claim off the finished board (the Wagons
	// trade-hex candidates). The oasis may not sit on or be moved onto one.
	// On a generated board they are outer corners, which the interior rule
	// already avoids, so this binds only on an authored silhouette.
	reserved := engine.ReservedHexes(cfg, b)
	free := func(hs []board.Hex) []board.Hex {
		return slices.DeleteFunc(hs, func(h board.Hex) bool { return reserved[h] })
	}
	n := oasisCountFor(cfg.Players)
	if _, ok := pickOasis(b); !ok && n == 1 {
		// No oasis at all: promote a producing hex. Tables of five or more
		// skip this and are filled by fillOases below.
		sites := free(dealtOnly(oasisSites(b), dealt))
		if len(sites) == 0 {
			return
		}
		h := sites[rng.IntN(len(sites))]
		b.Tiles[h] = board.Tile{Res: board.ResNone}
		// The robber goes beside the board after this returns, not onto the
		// new desert (which is the oasis).
		//
		// The promotion took a token off a balanced board, so a fair-mode
		// board has its engine-dealt tokens rebalanced, as fillOases does
		// (derivation 13). rng-free. No board engine.New deals reaches this
		// branch today (the Islands carve keeps a desert and board.Resolve
		// deals one); it stays for a future module that removes a desert.
		if cfg.BoardMode == board.BoardFair {
			b.Rebalance(dealt)
		}
		return
	}
	// An oasis survives, but where it sits decides how many caravans start.
	// Each spoke needs an outward land edge at its corner, which an oasis on
	// the outer ring lacks. A missing spoke loses a third of the scenario's
	// camel space and +1 VP spots. See sim.TestCaravansHasThreeSpokes.
	//
	// The repair swaps tile and token with an interior producing hex, so the
	// board keeps every resource and number it was dealt. It is cheaper than
	// the promotion above, so it is not a last resort.
	//
	// The partner is drawn from the seed (oasisSites) and its number is never
	// 6 or 8: a red moving outward is the only way the swap could create
	// adjacent reds, since the vacated hex loses its token. If no partner is
	// free the oasis stays.
	//
	// Looped because a board can carry several neutral hexes and swapping one
	// can hand pickOasis the next. Each pass moves a distinct neutral hex
	// inward, so the loop cannot revisit one; the bound is a safety net.
	//
	// With several oases (derivation 13) each must have three spokes, avoid
	// reserved hexes and not clash with the others (oasesClash). A pass
	// repairs the first bad oasis, else the first neutral hex pickOases had
	// to skip while the table is short; the partner must clash with no other
	// oasis. A hex no partner can fix is marked stuck. With one oasis this
	// reduces to the single-oasis loop.
	stuck := map[board.Hex]bool{}
	for range len(b.Tiles) {
		oases := pickOases(b, n)
		target, found := board.Hex{}, false
		for _, o := range oases {
			// Only engine-dealt tiles move, in either direction: an oasis or
			// partner the author pinned stays put.
			if stuck[o] || !dealt(o) {
				continue
			}
			if spokeCount(b, o) != caravansPerOasis || reserved[o] {
				target, found = o, true
				break
			}
		}
		if !found && len(oases) < n {
			for _, h := range neutralHexes(b) {
				if !slices.Contains(oases, h) && !stuck[h] && dealt(h) {
					target, found = h, true
					break
				}
			}
		}
		if !found {
			break
		}
		others := slices.DeleteFunc(slices.Clone(oases), func(o board.Hex) bool { return o == target })
		var sites []board.Hex
		for _, h := range oasisSites(b) {
			// Every candidate must start three caravans. oasisSites falls back
			// to every interior hex when none does, which on a thin authored
			// coastline can happen; without this check the loop would move the
			// oasis around for nothing.
			if !dealt(h) || reserved[h] || spokeCount(b, h) != caravansPerOasis {
				continue
			}
			if n := b.Tiles[h].Number; n == 6 || n == 8 {
				continue
			}
			if slices.ContainsFunc(others, func(o board.Hex) bool { return oasesClash(b, h, o) }) {
				continue
			}
			sites = append(sites, h)
		}
		if len(sites) == 0 {
			stuck[target] = true
			continue
		}
		h := sites[rng.IntN(len(sites))]
		// The robber goes beside the board once the repairs are done.
		b.Tiles[target], b.Tiles[h] = b.Tiles[h], b.Tiles[target]
	}
	if fillOases(b, n, dealt, reserved, rng) && cfg.BoardMode == board.BoardFair {
		// A promotion took a token off a balanced board, so a fair-mode board
		// has its engine-dealt tokens rebalanced, as Rivers does (derivation 11).
		b.Rebalance(dealt)
	}
}

// fillOases promotes a producing hex into a desert for each oasis the table is
// still short after the swaps, and reports whether it promoted any. The shortfall
// comes from the Islands carve drowning a desert on a table of five or more.
//
// Each promoted hex meets every oasis rule: interior (oasisSites), three spokes
// on real LandEdges, engine-dealt, off every reserved hex (Wagons trade-hex
// candidates), clear of every other oasis (oasesClash), and never a 6 or 8. It
// becomes a plain desert with no token. It cannot be a lake, river or castle
// (those derive after this finisher and avoid deserts), and since it clashes with
// no existing oasis pickOases keeps them all and adds it.
//
// A desert is land, so promotions change no LandEdge: the candidates are fixed up
// front and each promotion strikes out those that clash with it. Each draw is
// among candidates that still leave room for the rest (fillable), so an early pick
// cannot crowd out a later oasis. If the board has room for fewer, it fills what
// fits.
//
// Drawn from the finisher's stream after the swaps, so the promoted oasis is not
// on the same tile of every board. At one oasis it never promotes; that case is
// handled at the top of finishOasis.
func fillOases(b *board.Board, n int, dealt func(board.Hex) bool, reserved map[board.Hex]bool, rng *rand.Rand) bool {
	oases := pickOases(b, n)
	need := n - len(oases)
	if need <= 0 {
		return false
	}
	var cands []board.Hex
	for _, h := range oasisSites(b) {
		if !dealt(h) || reserved[h] || spokeCount(b, h) != caravansPerOasis {
			continue
		}
		if num := b.Tiles[h].Number; num == 6 || num == 8 {
			continue
		}
		if slices.ContainsFunc(oases, func(o board.Hex) bool { return oasesClash(b, h, o) }) {
			continue
		}
		cands = append(cands, h)
	}
	for need > 0 && !fillable(b, cands, need) {
		need--
	}
	for k := need; k > 0; k-- {
		var sites []board.Hex
		for _, h := range cands {
			if fillable(b, compatible(b, cands, h), k-1) {
				sites = append(sites, h)
			}
		}
		h := sites[rng.IntN(len(sites))]
		b.Tiles[h] = board.Tile{Res: board.ResNone}
		cands = compatible(b, cands, h)
	}
	return need > 0
}

// compatible is the candidates, in order, that may still be an oasis beside a
// new one at h: every one that does not clash with it (h itself included, as a
// hex always clashes with itself).
func compatible(b *board.Board, cands []board.Hex, h board.Hex) []board.Hex {
	var out []board.Hex
	for _, c := range cands {
		if !oasesClash(b, c, h) {
			out = append(out, c)
		}
	}
	return out
}

// fillable reports whether k pairwise-compatible oases can be taken from
// cands. k is at most two past the first pick, so the search is a few
// thousand clash tests on the largest board, and it runs only on a board that
// is short.
func fillable(b *board.Board, cands []board.Hex, k int) bool {
	if k <= 0 {
		return true
	}
	for i, h := range cands {
		if fillable(b, compatible(b, cands[i+1:], h), k-1) {
			return true
		}
	}
	return false
}

// dealtTerrain reports, per hex, whether the tile is the engine's to move or the
// map author's to keep:
//   - Inlined board: a hex the author left as generic land with a blank number
//     (board.ResLand, Number 0) was filled by board.Resolve and is the engine's.
//     Anything else the author chose. A hex absent from the source is ocean
//     added by Board.Frame and is nobody's to promote.
//   - Named preset: presets pin every tile, so nothing is dealt.
//   - Neither: a procedural board is entirely the engine's.
//
// Board before Preset mirrors engine.State.New, where an inlined board wins.
func dealtTerrain(cfg engine.GameConfig) func(board.Hex) bool {
	switch {
	case cfg.Board != nil:
		src := cfg.Board.Tiles
		return func(h board.Hex) bool {
			t, ok := src[h]
			return ok && t.Res == board.ResLand && t.Number == 0
		}
	case cfg.Preset != "":
		return func(board.Hex) bool { return false }
	default:
		return func(board.Hex) bool { return true }
	}
}

// dealtOnly keeps the hexes this hook may reshape, in oasisSites order, so the
// seeded draw is unchanged on a procedural board (where it is the identity).
func dealtOnly(hexes []board.Hex, dealt func(board.Hex) bool) []board.Hex {
	var out []board.Hex
	for _, h := range hexes {
		if dealt(h) {
			out = append(out, h)
		}
	}
	return out
}

// hexRing is a hex's distance from the board's centre in rings.
func hexRing(h board.Hex) int {
	x, y, z := h.Q, -h.Q-h.R, h.R
	m := 0
	for _, n := range []int{x, y, z} {
		if n < 0 {
			n = -n
		}
		if n > m {
			m = n
		}
	}
	return m
}

// MaxVPWithoutCards is this scenario's contribution to the winnable ceiling: the
// 2 (or 4 with Islands) it adds to the target. The lobby refuses a target above
// the ceiling, so a module that raises the target must cover it or its own
// combinations cannot be created. The premium is used rather than a component
// count because the scenario's VP source (buildings between camels) is
// board-dependent, and such sources are excluded from the ceiling; nine buildings
// a seat could flank is far more than the premium.
func (Caravans) MaxVPWithoutCards(cfg engine.GameConfig) int {
	return (Caravans{}).AdjustTargetVP(cfg)
}

func (Caravans) AdjustTargetVP(cfg engine.GameConfig) int {
	vp := caravanVP
	if rulesetHas(cfg.Ruleset, islandsModuleName) {
		vp += caravanIslandsVP
	}
	return vp
}

type camelBuiltData struct {
	Player engine.PlayerID `json:"player"`
}

type camelVoteData struct {
	Finisher engine.PlayerID `json:"finisher"`
}

// camelBidData is one seat's bid. It is public: bidding is open and
// sequential, so the next bidder can read it.
type camelBidData struct {
	Player engine.PlayerID   `json:"player"`
	Cards  [2]int            `json:"cards"`
	Path   *engine.CamelPath `json:"path,omitempty"`
	// LegacyWool/LegacyGrain are the wire names from before the bid resources
	// became ruleset-dependent. Read on decode, never written, so old logs fold
	// to the same votes and payments.
	LegacyWool  int `json:"wool,omitempty"`
	LegacyGrain int `json:"grain,omitempty"`
}

// cards folds the legacy pair into the current one. A pre-change log carries
// wool/grain and no cards; every log written since carries cards and neither.
func (d camelBidData) cards() [2]int {
	if d.Cards == ([2]int{}) {
		return [2]int{d.LegacyWool, d.LegacyGrain}
	}
	return d.Cards
}

// camelPayment is one seat's settled vote: its bid clamped to what it still
// held when the round closed. Carried on the public EvCamelResolved.
type camelPayment struct {
	Player engine.PlayerID `json:"player"`
	Cards  [2]int          `json:"cards"`
	// Legacy wire names; see camelBidData.
	LegacyWool  int `json:"wool,omitempty"`
	LegacyGrain int `json:"grain,omitempty"`
}

func (p camelPayment) cards() [2]int {
	if p.Cards == ([2]int{}) {
		return [2]int{p.LegacyWool, p.LegacyGrain}
	}
	return p.Cards
}

// Votes is how many votes a settled payment was worth: one per card. Exported
// for the scoreboard, so it does not repeat the rule.
func (p camelPayment) Votes() int { c := p.cards(); return c[0] + c[1] }

type camelResolvedData struct {
	Placer engine.PlayerID `json:"placer"`
	// Paid is every seat that paid something, in seat order. Seats that bid
	// nothing (or could no longer back what they bid) are omitted.
	Paid []camelPayment `json:"paid,omitempty"`
	// Reason is which of pickPlacer's outcomes chose Placer, so the client can
	// say "wins the vote", "the vote is tied" or "nobody bid" without
	// re-deriving the voting rule from Paid.
	Reason string `json:"reason,omitempty"`
}

// Values of camelResolvedData.Reason, in the voting rule's order. They are
// wire strings read by frontend/src/lib/eventlog.ts.
const (
	// camelReasonMajority is the unique top bidder, whether by absolute
	// majority (more votes than all others combined) or bare plurality (the
	// rule's third step). The client renders both as "wins the vote".
	camelReasonMajority = "majority"
	// camelReasonCoalition: two or more players who together hold a majority
	// of the votes and agree on the placement place the camel there. It
	// outranks the plurality holder, so at 4/3/3 two agreeing threes beat the
	// four. The agreed path is the placement; the camel goes down in the same
	// batch.
	camelReasonCoalition = "coalition"
	camelReasonTie       = "tie"    // votes were cast but nobody carried it; the finisher places
	camelReasonNobody    = "nobody" // no votes at all; the finisher places
)

func init() {
	// A camel changes route lengths without a road being built (routeLength
	// counts a road sharing a path with a camel as two), so placing one can
	// change who holds Longest Road. Mark it as a route event so the title is
	// recomputed now; a delayed recompute could see a tie and set the title
	// aside instead of awarding it.
	//
	// EvCamelPlaced is the only event here that can move a route length,
	// since it is the only writer of Occupied. (Fishermen's 5-fish road is a
	// credit; the road arrives as an ordinary EvRoadBuilt.)
	engine.RegisterRouteEvent(EvCamelPlaced)

	// No redactor for EvCamelBid: bidding is open and sequential, cards face
	// up, so the event is public. Hiding the amounts would turn it into a
	// sealed auction in which no coalition could form.
}

type camelPlacedData struct {
	Caravan int        `json:"caravan"`
	E       board.Edge `json:"e"`
}

func (m Caravans) Hooks() engine.Hooks {
	return engine.Hooks{
		OnEvents:          m.onEvents,
		Blocks:            m.blocks,
		BlocksTurnActions: m.blocksTurnActions,
		Auto:              m.auto,
		PendingDeciders:   m.pendingDeciders,
		PendingTargets:    m.pendingTargets,
		VictoryCheck:      m.victory,
		RouteWeights:      m.routeWeights,
		RobberForbidden:   robberForbidden,
	}
}

// robberForbidden keeps the robber off the oasis: on the first 7 it goes to any
// hex with a number token, never the oasis, which would otherwise be a neutral
// parking spot. It applies under every composition, including Fishermen's,
// where the oasis is the lake (docs/rules/scenarios.md, "The Caravans").
func robberForbidden(s *engine.State, h board.Hex) bool {
	return caravansExtRO(s).isOasis(h)
}

// nextBidder is the seat on the clock in an open round, or NoPlayer when the
// round is closed or every seat has answered.
//
// Bidding starts with the player who just finished their turn and goes
// clockwise, once each. Derived from Bidded rather than counted, so the clock
// cannot advance twice if a fold replays a bid.
func nextBidder(s *engine.State, x *CaravansExt) engine.PlayerID {
	if !x.Voting || x.Placer != engine.NoPlayer {
		return engine.NoPlayer
	}
	n := len(s.Players)
	start := int(x.Finisher)
	if x.Finisher == engine.NoPlayer || start >= n {
		start = 0
	}
	for i := range n {
		p := engine.PlayerID((start + i) % n)
		if !x.Bidded[p] {
			return p
		}
	}
	return engine.NoPlayer
}

// NextBidder is the seat a camel round is waiting on, or NoPlayer when no round
// is open or every seat has answered.
//
// Exported for the bots, which act for a seat rather than being asked by the
// pending-decision layer; a bot bidding out of turn would be refused and the
// round would fall through to the timer's pass. Clients can use
// `legal.camel_paths`, which reaches exactly the seat on the clock (see
// pendingTargets).
func NextBidder(s *engine.State) engine.PlayerID {
	if _, ok := s.Ext[CaravansName]; !ok && !hasCaravans(s) {
		return engine.NoPlayer
	}
	return nextBidder(s, caravansExtRO(s))
}

// pendingDeciders reports who owes a camel-vote action: during bidding, the one
// seat on the clock; during placement, the winning placer. Mirrors the seats auto
// would drive, so the timer layer can surface non-current bidders. Seats behind
// the clock are not yet being waited on and must not have a timer running.
func (Caravans) pendingDeciders(s *engine.State) []engine.ModuleDecider {
	x := caravansExtRO(s)
	if !x.Voting {
		return nil
	}
	if x.Placer == engine.NoPlayer {
		if p := nextBidder(s, x); p != engine.NoPlayer {
			return []engine.ModuleDecider{{Seat: p, Decision: DecisionCaravanBid}}
		}
		return nil
	}
	return []engine.ModuleDecider{{Seat: x.Placer, Decision: DecisionCaravanPlace}}
}

// pendingTargets offers the camel placements to the seat that won the vote.
//
// A PendingTargets hook rather than LegalExtras: LegalTargets returns early for
// any seat that is not s.Cur (engine/legal.go), and the placer is usually not the
// current player. Even when it is, blocksTurnActions holds them and the
// requireActionableTurn gate fails. PendingTargets is drained ahead of both
// gates, for placements a module owes a seat on anyone's turn.
func (m Caravans) pendingTargets(s *engine.State, seat engine.PlayerID) engine.LegalExtra {
	x := caravansExtRO(s)
	if !x.Voting {
		return engine.LegalExtra{}
	}
	// Two seats are owed this list: the placer once the round has closed,
	// and the seat on the clock while it is open, since a bid may name its
	// placement to join a coalition. Neither is s.Cur in general.
	if x.Placer == engine.NoPlayer {
		if seat != nextBidder(s, x) {
			return engine.LegalExtra{}
		}
	} else if seat != x.Placer {
		return engine.LegalExtra{}
	}
	return engine.LegalExtra{CamelPaths: CamelPaths(s)}
}

// CamelPaths lists every path the next camel may legally be placed on, across
// all caravans, in the module's deterministic order.
//
// Exported because a bot must price the placement before it knows whether it
// will win the vote, and pendingTargets answers only the winner. Read-only.
// Returns nil when Caravans is not active or no path is open.
func CamelPaths(s *engine.State) []engine.CamelPath {
	if _, ok := s.Ext[CaravansName]; !ok && !hasCaravans(s) {
		return nil
	}
	x := caravansExtRO(s)
	var out []engine.CamelPath
	for _, lp := range (Caravans{}).legalPaths(x, s) {
		out = append(out, engine.CamelPath{Caravan: lp.caravan, E: lp.edge})
	}
	return out
}

// onEvents watches the base event stream: it marks a build during the turn and,
// when a qualifying turn ends, opens a camel-placement vote (if a legal path
// exists and camels remain).
func (m Caravans) onEvents(after *engine.State, events []engine.Event) []engine.Event {
	x := caravansExtRO(after)
	if !x.HasOasis {
		return nil
	}
	// A camel vote follows a turn in which somebody built, so setup must
	// not arm one: setup settlements emit EvSettlementBuilt but no
	// EvTurnEnded, so a flag set there would open a vote on the first turn
	// of play. finalizeWith already skips OnEvents outside PhasePlay; the
	// gate is repeated here where the intent lives.
	if after.Phase != engine.PhasePlay {
		return nil
	}
	var out []engine.Event
	built := false
	ended := engine.NoPlayer
	for _, e := range events {
		switch e.Type {
		case engine.EvSettlementBuilt, engine.EvCityBuilt:
			built = true
		case engine.EvTurnEnded:
			ended = engine.DecodeEvent[engine.TurnEndedData](e).Player
		default:
		}
	}
	if built {
		out = append(out, engine.NewEvent(EvCamelBuilt, camelBuiltData{Player: after.Cur}))
	}
	// !x.Voting is a safeguard: a second EvCamelVote would reset Voting,
	// Finisher, Bids and Bidded and destroy the bids cast. Commands cannot
	// reach it because decideEndTurn still requires the strict Blocks
	// (engine/turn.go), but BlocksTurnActions lets play continue around a
	// vote.
	if ended != engine.NoPlayer && !x.Voting && (x.BuiltThisTurn || built) && x.CamelsLeft > 0 {
		if len(m.legalPaths(x, after)) > 0 {
			out = append(out, engine.NewEvent(EvCamelVote, camelVoteData{Finisher: ended}))
		}
	}
	return out
}

func (Caravans) blocks(s *engine.State) bool {
	x := caravansExtRO(s)
	return x.Voting
}

// blocksTurnActions gates only the active player's voluntary actions, and only
// while the open vote owes that player something (a bid or the placement they
// won). A seat the vote owes nothing keeps playing its turn instead of waiting
// out an auction it has no part in.
//
// Ending the turn is not freed: decideEndTurn also checks the strict blocks(),
// so the vote resolves before the turn passes and no second EvCamelVote can open.
func (Caravans) blocksTurnActions(s *engine.State) bool {
	x := caravansExtRO(s)
	if !x.Voting {
		return false
	}
	if x.Placer == engine.NoPlayer {
		// Only while the round is waiting on this seat, i.e. it is on the clock;
		// a seat further down the order keeps playing until the bid reaches it.
		return nextBidder(s, x) == s.Cur
	}
	return s.Cur == x.Placer
}

func (m Caravans) auto(s *engine.State, target engine.PlayerID) (engine.Command, bool) {
	x := caravansExtRO(s)
	if !x.Voting {
		return engine.Command{}, false
	}
	if x.Placer == engine.NoPlayer {
		// Bidding phase: only the seat on the clock can act. A timeout bids
		// nothing, a legal and usually correct answer.
		p := nextBidder(s, x)
		if p == engine.NoPlayer || (target != engine.NoPlayer && target != p) {
			return engine.Command{}, false
		}
		return engine.Command{Player: p, Type: CmdBidCamel,
			Data: raw(map[string]any{"cards": [2]int{0, 0}})}, true
	}
	// Placement phase: only the winner places; nobody else owes anything.
	if target != engine.NoPlayer && target != x.Placer {
		return engine.Command{}, false
	}
	for _, lp := range m.legalPaths(x, s) {
		return engine.Command{Player: x.Placer, Type: CmdPlaceCamel,
			Data: raw(map[string]any{"caravan": lp.caravan, "e": lp.edge})}, true
	}
	return engine.Command{}, false
}

func (m Caravans) Decide(s *engine.State, cmd engine.Command) ([]engine.Event, bool, error) {
	switch cmd.Type {
	case CmdBidCamel:
		ev, err := m.decideBid(s, cmd)
		return ev, true, err
	case CmdPlaceCamel:
		ev, err := m.decidePlace(s, cmd)
		return ev, true, err
	default:
	}
	return notHandled()
}

func (m Caravans) decideBid(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	x := caravansExtRO(s)
	if !x.Voting || x.Placer != engine.NoPlayer {
		return nil, engine.ErrWrongPhase
	}
	if int(cmd.Player) >= len(s.Players) {
		return nil, engine.ErrNotYourTurn
	}
	// A repeat answer is ErrAlreadyBid; answering out of order is
	// ErrNotYourTurn. Each seat votes once, in order from the finisher
	// clockwise, so answering early would commit before seeing the bids it
	// is entitled to see.
	if x.Bidded[cmd.Player] {
		return nil, ErrAlreadyBid
	}
	if nextBidder(s, x) != cmd.Player {
		return nil, engine.ErrNotYourTurn
	}
	d, err := engine.DecodeCommand[struct {
		Cards [2]int            `json:"cards"`
		Path  *engine.CamelPath `json:"path,omitempty"`
	}](cmd.Data)
	if err != nil {
		return nil, err
	}
	if d.Cards[0] < 0 || d.Cards[1] < 0 {
		return nil, engine.ErrBadCommand
	}
	if !s.Players[cmd.Player].Hand.Has(bidCost(s, d.Cards)) {
		return nil, engine.ErrNoResources
	}
	// A named placement must be one this round could make, or the coalition
	// it joins agrees on nothing. A bid of no cards may still name one; it
	// joins no coalition, but refusing it would make the panel's shape
	// depend on the tally.
	bid := CamelBid{Cards: d.Cards}
	if d.Path != nil {
		if !m.isLegalPath(x, s, d.Path.Caravan, board.NewEdge(d.Path.E.A, d.Path.E.B)) {
			return nil, engine.ErrBadPlacement
		}
		path := engine.CamelPath{Caravan: d.Path.Caravan, E: board.NewEdge(d.Path.E.A, d.Path.E.B)}
		bid.Path = &path
	}
	// Public: the cards go face up in front of the bidder, and the next seat
	// answers having seen them.
	events := []engine.Event{engine.NewEvent(EvCamelBid,
		camelBidData{Player: cmd.Player, Cards: bid.Cards, Path: bid.Path})}

	// If this bid completes the round, resolve it now.
	if m.lastBidder(s, x, cmd.Player) {
		paid, votes, prefs := settle(s, x, cmd.Player, bid)
		placer, agreed, reason := pickPlacer(votes, prefs, x.Finisher, len(s.Players))
		events = append(events, engine.NewEvent(EvCamelResolved,
			camelResolvedData{Placer: placer, Paid: paid, Reason: reason}))
		// A coalition has already agreed where the camel goes, so it goes
		// there in this batch, with no placement step.
		//
		// Re-checked here even though nothing between bid and resolution can
		// move a camel today; if a future rule does, this degrades to the
		// coalition's largest bidder picking rather than logging an illegal
		// placement.
		if agreed != nil && m.isLegalPath(x, s, agreed.Caravan, agreed.E) {
			events = append(events, engine.NewEvent(EvCamelPlaced,
				camelPlacedData{Caravan: agreed.Caravan, E: agreed.E}))
		}
	}
	return events, nil
}

// settle prices the closed round: what each seat pays, the votes that buys, and
// the placement each voter named.
//
// Payment happens at resolution, not as each bid lands, so a bid is not paid
// before the seats after it have answered. A seat can lose cards it bid before
// the round closes (it may keep playing, and a 7 can force a discard), so each
// bid is clamped pile by pile to what the seat still holds; a seat only loses
// votes it can no longer back.
//
// Iterates seats 0..n-1, never the Bids map, so Paid and the event bytes are
// identical on replay.
func settle(s *engine.State, x *CaravansExt, last engine.PlayerID, lastBid CamelBid) (
	[]camelPayment, map[engine.PlayerID]int, map[engine.PlayerID]engine.CamelPath) {
	var paid []camelPayment
	votes := map[engine.PlayerID]int{}
	prefs := map[engine.PlayerID]engine.CamelPath{}
	for i := range len(s.Players) {
		p := engine.PlayerID(i)
		b := x.Bids[p]
		if p == last {
			b = lastBid
		}
		var cards [2]int
		res := BidResources(s)
		cards[0] = min(b.Cards[0], s.Players[p].Hand[res[0]])
		cards[1] = min(b.Cards[1], s.Players[p].Hand[res[1]])
		if cards[0] == 0 && cards[1] == 0 {
			continue
		}
		paid = append(paid, camelPayment{Player: p, Cards: cards})
		votes[p] = cards[0] + cards[1]
		// Only a seat that paid at least one card joins a coalition; a bid
		// clamped to nothing bid nothing.
		if b.Path != nil {
			prefs[p] = *b.Path
		}
	}
	return paid, votes, prefs
}

func (Caravans) lastBidder(s *engine.State, x *CaravansExt, p engine.PlayerID) bool {
	for q := range len(s.Players) {
		if engine.PlayerID(q) == p {
			continue
		}
		if !x.Bidded[engine.PlayerID(q)] {
			return false
		}
	}
	return true
}

// pickPlacer applies the voting rule's four steps in order. It returns who
// places, the placement a coalition already agreed on (nil when the winner still
// chooses), and which step decided it.
//
//  1. A player with more votes than all the other players combined chooses
//     where to place the camel.
//  2. Otherwise, two or more players who together hold the majority of the
//     votes and agree on the placement place the camel there.
//  3. Otherwise (no agreement), the player with the most votes chooses, even
//     with a minority of the total.
//  4. Otherwise (no single "most votes" player), the player who just finished
//     their turn chooses.
//
// Step 2 outranks the plurality holder: at 4/3/3 two agreeing threes beat the
// four.
//
// Online, "they agree" is expressed in the bid: the round is open and sequential,
// so a later bidder can see and match an earlier one's placement, the same
// information in the same order as at a table. A seat naming no placement joins
// no coalition. Recorded as a decision in docs/rules/scenarios.md.
//
// The reason is returned here because this is the only place the rule lives.
func pickPlacer(votes map[engine.PlayerID]int, prefs map[engine.PlayerID]engine.CamelPath,
	finisher engine.PlayerID, players int) (engine.PlayerID, *engine.CamelPath, string) {
	total, best, bestP, tie := 0, 0, engine.NoPlayer, false
	for p := range players {
		v := votes[engine.PlayerID(p)]
		total += v
		if v > best {
			best, bestP, tie = v, engine.PlayerID(p), false
		} else if v == best && v > 0 {
			tie = true
		}
	}
	if best == 0 {
		return finisher, nil, camelReasonNobody
	}
	if best*2 > total { // strictly more than all others combined
		return bestP, nil, camelReasonMajority
	}
	// Step 2. Seats naming the same placement pool their votes; a pool of two
	// or more holding strictly more than half decides. Two disjoint pools
	// cannot both hold a majority, so the winner is unique, and seats are read
	// in seat order so the pool's leader is deterministic.
	type bloc struct {
		votes  int
		seats  int
		leader engine.PlayerID
		lead   int
	}
	blocs := map[engine.CamelPath]*bloc{}
	for p := range players {
		seat := engine.PlayerID(p)
		path, named := prefs[seat]
		if !named || votes[seat] == 0 {
			continue
		}
		b := blocs[path]
		if b == nil {
			b = &bloc{leader: engine.NoPlayer}
			blocs[path] = b
		}
		b.votes += votes[seat]
		b.seats++
		if votes[seat] > b.lead {
			b.leader, b.lead = seat, votes[seat]
		}
	}
	for path, b := range blocs {
		if b.seats >= 2 && b.votes*2 > total {
			agreed := path
			// The bloc's largest bidder is named as placer so the log can attribute
			// the camel; the placement is already decided.
			return b.leader, &agreed, camelReasonCoalition
		}
	}
	if tie {
		return finisher, nil, camelReasonTie
	}
	return bestP, nil, camelReasonMajority
}

func (m Caravans) decidePlace(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	x := caravansExtRO(s)
	if !x.Voting || x.Placer == engine.NoPlayer {
		return nil, engine.ErrWrongPhase
	}
	if cmd.Player != x.Placer {
		return nil, engine.ErrNotYourTurn
	}
	d, err := engine.DecodeCommand[camelPlacedData](cmd.Data)
	if err != nil {
		return nil, err
	}
	e := board.NewEdge(d.E.A, d.E.B)
	if !m.isLegalPath(x, s, d.Caravan, e) {
		return nil, engine.ErrBadPlacement
	}
	return []engine.Event{engine.NewEvent(EvCamelPlaced, camelPlacedData{Caravan: d.Caravan, E: e})}, nil
}

func (Caravans) Apply(s *engine.State, e engine.Event) (bool, error) {
	x := caravansExt(s)
	switch e.Type {
	case EvCamelBuilt:
		x.BuiltThisTurn = true
	case EvCamelVote:
		d := engine.DecodeEvent[camelVoteData](e)
		x.Voting = true
		x.Finisher = d.Finisher
		x.Placer = engine.NoPlayer
		x.Reason = ""
		x.Bids = map[engine.PlayerID]CamelBid{}
		x.Bidded = map[engine.PlayerID]bool{}
		x.BuiltThisTurn = false
	case EvCamelBid:
		// Moves no cards and hides nothing: the bid is public, so every viewer
		// folds the same amount and placement, and the next seat answers
		// knowing the tally.
		d := engine.DecodeEvent[camelBidData](e)
		x.Bids[d.Player] = CamelBid{Cards: d.cards(), Path: d.Path}
		x.Bidded[d.Player] = true
	case EvCamelResolved:
		// The round is paid here, in one public event, so every viewer's fold
		// moves the same cards at the same log position.
		d := engine.DecodeEvent[camelResolvedData](e)
		// Bids is replaced, not patched. Paid omits seats whose bid was clamped
		// to zero (cards discarded on a 7 before the close), so afterwards Bids
		// says exactly what was spent.
		bids := make(map[engine.PlayerID]CamelBid, len(d.Paid))
		for _, pay := range d.Paid {
			cards := pay.cards()
			cost := bidCost(s, cards)
			s.Players[pay.Player].Hand.Sub(cost)
			s.Bank.Add(cost)
			// The named placement survives the settle for the log's coalition line
			// and the view's reveal.
			bids[pay.Player] = CamelBid{Cards: cards, Path: x.Bids[pay.Player].Path}
		}
		x.Bids = bids
		x.Placer = d.Placer
		x.Reason = d.Reason
	case EvCamelPlaced:
		d := engine.DecodeEvent[camelPlacedData](e)
		if d.Caravan < 0 || d.Caravan >= len(x.Chains) {
			return true, fmt.Errorf("tab: camel placed on caravan %d of %d", d.Caravan, len(x.Chains))
		}
		x.Chains[d.Caravan] = append(x.Chains[d.Caravan], d.E)
		x.Occupied[d.E] = true
		x.CamelsLeft--
		x.Voting = false
		x.Finisher = engine.NoPlayer
		x.Placer = engine.NoPlayer
		x.Reason = ""
		x.Bids = map[engine.PlayerID]CamelBid{}
		x.Bidded = map[engine.PlayerID]bool{}
	default:
		return false, nil
	}
	return true, nil
}

type legalPath struct {
	caravan int
	edge    board.Edge
}

// legalPaths lists every path on which the next camel may be placed, across all
// three caravans.
func (m Caravans) legalPaths(x *CaravansExt, s *engine.State) []legalPath {
	var out []legalPath
	if !x.HasOasis || x.CamelsLeft == 0 {
		return out
	}
	for i := range x.Chains {
		for _, e := range m.caravanFrontEdges(x, s, i) {
			out = append(out, legalPath{caravan: i, edge: e})
		}
	}
	return out
}

func (m Caravans) isLegalPath(x *CaravansExt, s *engine.State, caravan int, e board.Edge) bool {
	if caravan < 0 || caravan >= len(x.Chains) || caravan >= len(x.Arrows) {
		return false
	}
	return slices.Contains(m.caravanFrontEdges(x, s, caravan), e)
}

// camelDegree counts the camels meeting at each vertex of the whole network,
// across all caravans. It is what makes merging work ("two caravans meeting at an
// intersection merge as soon as the next camel is placed and continue as a single
// caravan"):
//   - a vertex of degree 2 is between two camels, whichever caravans they came
//     from, and scores (see VictoryVP);
//   - a camel may never arrive at a vertex already joining two, since caravans do
//     not branch. The one vertex that reaches three is a merge: two heads meeting
//     there, continuing as one caravan along the third path (see
//     caravanFrontEdges). Any other front at degree 2 has ended.
func camelDegree(x *CaravansExt) map[board.Vertex]int {
	deg := make(map[board.Vertex]int, 2*len(x.Occupied))
	for i := range x.Chains {
		for _, e := range x.Chains[i] {
			deg[e.A]++
			deg[e.B]++
		}
	}
	return deg
}

// caravanFrontEdges returns the paths that extend caravan i from its current
// front (or its starting spoke when empty).
//
// The oasis perimeter bars only a caravan's first camel; a caravan that curls
// back to the oasis may place there. That needs no code here, since oasisSpokes
// only picks non-perimeter edges as arrows.
//
// A rival caravan does not block, it merges. An edge is closed only if it already
// carries a camel or is not a camel path; a placement whose far vertex already
// has a camel is the merge itself. The degree test forbids arriving at an
// intersection that already joins two. Two heads that have met continue along
// the third path, below.
func (Caravans) caravanFrontEdges(x *CaravansExt, s *engine.State, i int) []board.Edge {
	if x.CamelsLeft == 0 || i < 0 || i >= len(x.Chains) || i >= len(x.Arrows) || i >= len(x.ArrowCorner) {
		return nil
	}
	deg := camelDegree(x)
	// canTake reports whether a camel may be laid on e growing away from vertex
	// `from`: the path must be free land, and the vertex it reaches must not
	// already join two camels (which would branch).
	canTake := func(e board.Edge, from board.Vertex) bool {
		if x.Occupied[e] || !camelPathOK(s, e) {
			return false
		}
		return deg[e.Other(from)] < 2
	}
	chain := x.Chains[i]
	if len(chain) == 0 {
		arr := x.Arrows[i]
		// A caravan starts on its own arrow or not at all. Its corner may already
		// carry another caravan's camel (a merge, which is legal); the only bars
		// are the arrow being taken or the corner already joining two.
		if arr == (board.Edge{}) || deg[x.ArrowCorner[i]] >= 2 || !canTake(arr, x.ArrowCorner[i]) {
			return nil
		}
		return []board.Edge{arr}
	}
	front := caravanFront(x, i)
	last := chain[len(chain)-1]
	other := last
	if deg[front] >= 2 {
		// Two camels already meet at the front. Either this caravan ran into a
		// camel that is not a front (its own chain, or another's side or tail)
		// and has ended, or two caravans met head to head and merge on the next
		// camel. That camel can only go on the intersection's third path, since
		// both other ends of the merged caravan are anchored at the oasis. It
		// makes a junction of three, a merge rather than a branch. See
		// TestCaravansMergeAndContinue.
		j, ok := headToHead(x, i, front, deg)
		if !ok || j < i {
			// Offered once, by the lower-numbered caravan, so a merge edge is one
			// placement in the list (a coalition pools bids by placement, so a
			// duplicate would split one agreement into two).
			return nil
		}
		other = x.Chains[j][len(x.Chains[j])-1]
	}
	var out []board.Edge
	for _, e := range front.Edges() {
		if e == last || e == other || !canTake(e, front) {
			continue
		}
		out = append(out, e)
	}
	return out
}

// headToHead reports the other caravan whose front is also at v, when exactly
// two camels meet there and both are caravan heads: the merge case. Any other
// degree-two front is a caravan that has run into a camel it cannot join.
func headToHead(x *CaravansExt, i int, v board.Vertex, deg map[board.Vertex]int) (int, bool) {
	if deg[v] != 2 {
		return 0, false
	}
	for j := range x.Chains {
		if j == i || len(x.Chains[j]) == 0 {
			continue
		}
		if caravanFront(x, j) == v {
			return j, true
		}
	}
	return 0, false
}

// camelPathOK reports whether a camel may ever stand on e: a land path
// (including a coastal one), and alongside Islands a sea path as well.
//
// The sea half is the combination rule: on its own a caravan does not cross
// water, but combined the camels may go anywhere beside overland routes and
// waterways, roads and ships. A sea path is exactly what a ship may stand on
// (board.SeaEdge), so a camel can walk beside any ship route.
func camelPathOK(s *engine.State, e board.Edge) bool {
	if s.Board.LandEdge(e) {
		return true
	}
	return rulesetHas(s.Config.Ruleset, islandsModuleName) && e.Valid() && s.Board.SeaEdge(e)
}

// caravanFront returns the open vertex at the head of caravan i's chain.
func caravanFront(x *CaravansExt, i int) board.Vertex {
	chain := x.Chains[i]
	last := chain[len(chain)-1]
	if len(chain) == 1 {
		return last.Other(x.ArrowCorner[i])
	}
	prev := chain[len(chain)-2]
	shared := sharedVertex(last, prev)
	return last.Other(shared)
}

func sharedVertex(a, b board.Edge) board.Vertex {
	if a.A == b.A || a.A == b.B {
		return a.A
	}
	return a.B
}

// VictoryVP returns the caravan VP for player p: +1 for each of their buildings
// between two camels. The single implementation shared by the VictoryCheck hook
// and the scoreboard.
//
// Any two camels count, not only two of the same caravan: once caravans merge
// that distinction is meaningless, so a vertex of degree 2 in the camel network
// scores. A city scores one point, like a settlement.
func VictoryVP(s *engine.State, p engine.PlayerID) int {
	x := caravansExtRO(s)
	vp := 0
	for v, n := range camelDegree(x) {
		if n < 2 {
			continue
		}
		if b, ok := s.Buildings[v]; ok && b.Owner == p && !s.BuildingVPSuppressed(v) {
			vp++
		}
	}
	return vp
}

// victory: +1 VP for each of the player's buildings sitting between two camels.
func (Caravans) victory(s *engine.State, p engine.PlayerID) int {
	return VictoryVP(s, p)
}

// routeWeights makes a road (or, under Islands, a ship) sharing a path with a
// camel count as 2 segments in the route network. Ships double by the Caravans
// sea-combination rule.
//
// A RouteWeights hook rather than RouteEdges: "caravans" sorts before "islands",
// so reweighting in the first phase would run before any ship was added.
func (Caravans) routeWeights(s *engine.State, _ engine.PlayerID, net *engine.RouteNet) {
	x := caravansExtRO(s)
	for e := range net.Edges {
		if x.Occupied[e] {
			net.SetWeight(e, 2)
		}
	}
}

// sortedSeats returns a map's seats in ascending order, so a view field built
// from a per-seat map has stable bytes.
//
// Kept outside ViewExt because TestCaravansViewRejectsSort scans ViewExt's source
// for any sort call (sorting the camel list would destroy chain order); this sort
// over seat numbers is safe.
func sortedSeats[T any](m map[engine.PlayerID]T) []engine.PlayerID {
	return slices.Sorted(maps.Keys(m))
}

func (e *CaravansExt) ViewExt(viewer engine.PlayerID) any {
	type camelView struct {
		Caravan int        `json:"caravan"`
		E       board.Edge `json:"e"`
	}
	// Do not sort: the loop walks caravans 0..n and each chain from the oasis
	// outward, so the output is grouped by caravan and in chain order. That
	// order is the camel path, and each scoring vertex is the one shared by a
	// consecutive pair. sort.Slice is not stable and would permute entries
	// within a caravan. Pinned by TestCaravansViewRejectsSort.
	var camels []camelView
	for i := range e.Chains {
		for _, edge := range e.Chains[i] {
			camels = append(camels, camelView{Caravan: i, E: edge})
		}
	}
	// The spokes. An unstarted caravan has no camels, so without these the
	// client cannot tell which corner and edge it leaves from. A list rather
	// than a fixed triple so a missing arrow is absent rather than serialised
	// as the zero edge, which would draw a spoke at the origin.
	type spokeView struct {
		Caravan int          `json:"caravan"`
		Arrow   board.Edge   `json:"arrow"`
		Corner  board.Vertex `json:"corner"`
	}
	var spokes []spokeView
	if e.HasOasis {
		for i := range e.Arrows {
			if e.Arrows[i] == (board.Edge{}) || i >= len(e.ArrowCorner) {
				continue
			}
			spokes = append(spokes, spokeView{Caravan: i, Arrow: e.Arrows[i], Corner: e.ArrowCorner[i]})
		}
	}
	// Every edge carrying a camel, flat: redundant with `camels`, but it is
	// the set a road renderer tests against for the doubled-route rule. Built
	// from Chains rather than ranging e.Occupied so the order is stable.
	occupied := make([]board.Edge, 0, len(camels))
	for _, c := range camels {
		occupied = append(occupied, c.E)
	}
	v := map[string]any{
		"camels": camels, "camels_left": e.CamelsLeft,
		// The supply size, so a client can draw "9 of 22 placed" without a
		// hardcoded constant. It grows with the table (33 at 5-6, 44 at 7-10).
		"camel_supply": e.Supply(),
		"caravans":     spokes,
		"occupied":     occupied,
		// The two bid resources (brick and lumber alongside Knights, else wool
		// and grain), so the client labels the piles from the engine. See
		// BidResources.
		"bid_resources": e.BidRes,
	}
	// Nullable, like islands.ExtView.Pirate: a bare board.Hex cannot say "no
	// oasis", and an inert module would serialise {q:0,r:0}, identical to a
	// real oasis at the centre. Omitting the key says it outright.
	if e.HasOasis {
		h := e.Oasis
		v["oasis"] = &h
		// Every oasis, the first included; caravan i leaves from oases[i/3].
		// "oasis" above stays the first, for clients that read only it.
		os := slices.Clone(e.Oases)
		if len(os) == 0 {
			os = []board.Hex{h}
		}
		v["oases"] = os
	}
	if e.Voting {
		v["voting"] = true
		v["finisher"] = e.Finisher
		v["placer"] = e.Placer
		// Who has answered, in seat order, as a list so the bytes do not depend
		// on map ordering.
		bidded := make([]engine.PlayerID, 0, len(e.Bidded))
		for _, p := range sortedSeats(e.Bidded) {
			if e.Bidded[p] {
				bidded = append(bidded, p)
			}
		}
		v["bidded"] = bidded
		// Every bid, open round or closed, because bidding is open: cards go
		// face up and the next seat answers having seen them.
		type bidView struct {
			Player engine.PlayerID   `json:"player"`
			Cards  [2]int            `json:"cards"`
			Path   *engine.CamelPath `json:"path,omitempty"`
		}
		bids := make([]bidView, 0, len(e.Bids))
		for _, p := range sortedSeats(e.Bids) {
			b := e.Bids[p]
			bids = append(bids, bidView{Player: p, Cards: b.Cards, Path: b.Path})
		}
		v["bids"] = bids
		if e.Placer != engine.NoPlayer {
			// Why this seat is placing: the panel must say "you won the vote", "the
			// vote was tied" or "nobody bid", which `placer` alone cannot
			// distinguish. Read from the ext, where EvCamelResolved stamped it; it
			// cannot be re-derived from a settled Bids map once a coalition can
			// decide the round.
			v["reason"] = e.Reason
		}
	}
	return v
}
