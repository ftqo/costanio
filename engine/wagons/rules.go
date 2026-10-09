package wagons

import (
	"encoding/json"
	"slices"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// --- event payloads --------------------------------------------------------

// startData opens the scenario: every seat's wagon on its round-2 city, and the
// starting gold. It is emitted on the first play-phase batch because OnEvents
// does not run outside PhasePlay; nothing beyond the first roll happens before
// it.
type startData struct {
	SharedCurrency bool           `json:"shared_currency,omitempty"`
	At             []board.Vertex `json:"at"`
	Gold           int            `json:"gold"`
	// Seated says which entries of At are real. A seat with no round-2 city has
	// no wagon, and the zero vertex {0,0,N} is an ordinary buildable corner.
	Seated []bool `json:"seated"`
}

// OnBoard reports whether seat i's entry names a real intersection.
func (d startData) OnBoard(i int) bool {
	return i < len(d.Seated) && d.Seated[i]
}

// turnData resets the per-turn bookkeeping. A module cannot fold a base event,
// so the reset cannot hang off EvTurnStarted; this is emitted alongside it by
// OnEvents and folds immediately after.
type turnData struct {
	Player engine.PlayerID `json:"player"`
}

// movedData is one path travelled: what it cost in movement points, and the
// toll it paid, to whom. Public in full.
type movedData struct {
	Player engine.PlayerID `json:"player"`
	From   board.Vertex    `json:"from"`
	To     board.Vertex    `json:"to"`
	MP     int             `json:"mp"`
	Toll   int             `json:"toll,omitempty"`
	Paid   engine.PlayerID `json:"paid,omitempty"`
}

type playerData struct {
	Player engine.PlayerID `json:"player"`
}

// boostedData records the once-per-turn +2 MP purchase and what paid for it.
type boostedData struct {
	Free   bool            `json:"free,omitempty"`
	Player engine.PlayerID `json:"player"`
	MP     int             `json:"mp"`
}

// chargedData is one drive-off attempt: the die, and whether it carried. The
// die is on the public stream (engine.WagonsDieSeq), so players can audit it.
type chargedData struct {
	Player engine.PlayerID `json:"player"`
	Barb   int             `json:"barb"`
	Die    int             `json:"die"`
	Drove  bool            `json:"drove"`
}

// barbPendingData opens the one interrupt this module has: a seat owes a
// barbarian move. Idx is -1 when the seat may choose which of the three (a 7, a
// Knight) and a real index when the barbarian is already named (a drive-off).
type barbPendingData struct {
	Player engine.PlayerID `json:"player"`
	Idx    int             `json:"idx"`
	Steal  bool            `json:"steal"`
}

type barbMovedData struct {
	Player engine.PlayerID `json:"player"`
	Barb   int             `json:"barb"`
	E      board.Edge      `json:"e"`
}

type loadedData struct {
	Player engine.PlayerID `json:"player"`
	Hex    int             `json:"hex"`
	Cargo  uint8           `json:"cargo"`
}

type deliveredData struct {
	Player engine.PlayerID `json:"player"`
	Hex    int             `json:"hex"`
	Cargo  uint8           `json:"cargo"`
	Gold   int             `json:"gold"`
}

type upgradedData struct {
	Player engine.PlayerID `json:"player"`
	Level  int             `json:"level"`
	Cost   engine.Hand     `json:"cost"`
}

type boughtData struct {
	Player engine.PlayerID `json:"player"`
	Res    board.Resource  `json:"res"`
	Gold   int             `json:"gold"`
}

type soldData struct {
	Player engine.PlayerID `json:"player"`
	Res    board.Resource  `json:"res"`
	Count  int             `json:"count"`
	Gold   int             `json:"gold"`
}

// goldMovedData is gold changing hands inside a player trade. Gold is a count
// rather than a card, so it cannot ride the base trade payload; it travels as
// the module's opaque `extra` instead (see Hooks.TradeExtraEvents).
type goldMovedData struct {
	From engine.PlayerID `json:"from"`
	To   engine.PlayerID `json:"to"`
	Gold int             `json:"gold"`
}

type swiftBoughtData struct {
	Player engine.PlayerID `json:"player"`
}

// --- the movement graph ----------------------------------------------------

// step is one path a wagon may take out of an intersection.
type step struct {
	To board.Vertex
	E  board.Edge
	// Spoke is a path between a plaza and one of its trade hex's land corners.
	// It carries no road (see board.go), so it costs the bare-path rate and no
	// toll.
	Spoke bool
	// Hex is the trade hex the spoke belongs to, or -1.
	Hex int
}

// steps lists every path out of v, in a deterministic order.
//
// Wagons never block and are never blocked, so this is the board's adjacency,
// minus the trade hexes' blocked coastal edges, plus the spokes.
func steps(s *engine.State, x *WagonsExt, v board.Vertex) []step {
	var out []step
	if isPlaza(v) {
		i := x.tradeIndexAt(board.Hex{Q: v.Q, R: v.R})
		if i < 0 {
			return nil
		}
		for _, c := range landCorners(s.Board, x.Trade[i]) {
			out = append(out, step{To: c, E: board.NewEdge(v, c), Spoke: true, Hex: i})
		}
		return out
	}
	for _, e := range v.Edges() {
		if !e.Valid() || !s.Board.LandEdge(e) {
			continue
		}
		if blockedEdgeOn(s.Board, x.Trade, e) {
			continue
		}
		out = append(out, step{To: e.Other(v), E: e, Hex: -1})
	}
	// A land corner of a trade hex also has its spoke into the plaza.
	for i, h := range x.Trade {
		if !x.HasTrade {
			break
		}
		if slices.Contains(landCorners(s.Board, h), v) {
			out = append(out, step{To: plazaOf(h), E: board.NewEdge(v, plazaOf(h)), Spoke: true, Hex: i})
		}
	}
	return out
}

// tradeIndexAt is the index of the trade hex at h, or -1.
func (e *WagonsExt) tradeIndexAt(h board.Hex) int {
	if !e.HasTrade {
		return -1
	}
	for i, t := range e.Trade {
		if t == h {
			return i
		}
	}
	return -1
}

// plazaIndex is the trade hex a plaza vertex belongs to, or -1.
func (e *WagonsExt) plazaIndex(v board.Vertex) int {
	if !isPlaza(v) {
		return -1
	}
	return e.tradeIndexAt(board.Hex{Q: v.Q, R: v.R})
}

// barbarianOn is the index of the barbarian standing on e, or -1.
func (e *WagonsExt) barbarianOn(edge board.Edge) int {
	for i, b := range e.Barb {
		if b == edge && edge != (board.Edge{}) {
			return i
		}
	}
	return -1
}

// price is what a step costs the mover: movement points, and the toll in gold
// with the seat it is paid to.
//
//	no road on it            2 MP
//	one of your roads        1 MP
//	another player's road    1 MP and 1 gold, to that player
//	any of the above, with a barbarian on it   +2 MP, toll unchanged
func price(s *engine.State, x *WagonsExt, p engine.PlayerID, st step) (mp, toll int, to engine.PlayerID) {
	to = engine.NoPlayer
	if st.Spoke {
		mp = bareMP
		if barbarianAt(s, x, st.E) >= 0 {
			mp += barbarianMP
		}
		return mp, 0, to
	}
	owner, roaded := s.Roads[st.E]
	switch {
	case !roaded:
		mp = bareMP
	case owner == p:
		mp = roadMP
	default:
		mp, toll, to = roadMP, tollPerRoad, owner
	}
	if river, ok := sharedPurse(s, x); ok {
		if owner, crossing, bridged := river.RiverCrossing(st.E); crossing {
			mp, toll, to = 3, 0, engine.NoPlayer
			if bridged {
				mp = 1
				if owner != p {
					toll, to = 2, owner
				}
			}
		}
	}

	if barbarianAt(s, x, st.E) >= 0 {
		mp += barbarianMP
	}
	return mp, toll, to
}

// allowance is the wagon's movement points for one action: the level's entry on
// the track, plus 2 for every ring the board runs beyond radius 2.
func allowance(s *engine.State, level int) int {
	if level < 1 {
		level = 1
	}
	if level > maxLevel {
		level = maxLevel
	}
	mp := mpTrack[level-1]
	if s.Board != nil && s.Board.Radius > 2 {
		mp += 2 * (s.Board.Radius - 2)
	}
	return mp
}

// stackOrder is trade hex i's cargo stack for its current refill: 6 of each of
// the two cargoes it ships, shuffled.
//
// Derived rather than stored, from a reserved slot on the private stream. The
// stack order is the scenario's one hidden thing, so it is never written into
// an event and cannot leak through one. It is a pure function of the private
// seed, the hex and the refill count.
func stackOrder(s *engine.State, x *WagonsExt, i int) []uint8 {
	sh := shipsOf(x.Roles[i])
	out := make([]uint8, 0, stackDepth)
	for range perCargo {
		out = append(out, sh[0])
	}
	for range perCargo {
		out = append(out, sh[1])
	}
	rng := engine.RngForReserved(s, engine.PrivateWagonsStackSeq(i, x.Refill[i]))
	rng.Shuffle(len(out), func(a, b int) { out[a], out[b] = out[b], out[a] })
	return out
}

// topOfStack is the token trade hex i would deal next.
func topOfStack(s *engine.State, x *WagonsExt, i int) uint8 {
	order := stackOrder(s, x, i)
	n := x.Drawn[i]
	if n < 0 || n >= len(order) {
		n = 0
	}
	return order[n]
}

// hexAccepts reports whether trade hex i takes this cargo in.
func hexAccepts(x *WagonsExt, i int, c uint8) bool {
	if c == CargoNone || i < 0 {
		return false
	}
	if i >= tradeHexCount {
		return false
	}
	return slices.Contains(acceptsOf(x.Roles[i]), c)
}

// --- hooks -----------------------------------------------------------------

// onEvents opens the scenario on the first play batch, resets the per-turn
// bookkeeping when a turn starts, and turns a played Knight into a barbarian
// move.
func (m Wagons) onEvents(after *engine.State, events []engine.Event) []engine.Event {
	x := extRO(after)
	if !x.HasTrade || after.Phase != engine.PhasePlay {
		return nil
	}
	var out []engine.Event
	if !x.Started {
		at, seated := setupCities(after)
		out = append(out, engine.NewEvent(EvStart, startData{
			At: at, Gold: startingGold(after.Config.Ruleset), Seated: seated,
			SharedCurrency: hasRiverEconomy(after),
		}))
	}
	for _, e := range events {
		switch e.Type {
		case engine.EvTurnStarted:
			d := engine.DecodeEvent[engine.TurnStartedData](e)
			out = append(out, engine.NewEvent(EvTurn, turnData{Player: d.Player}))
		case engine.EvKnightPlayed:
			// "Knight: move one barbarian to a path with no barbarian on it. If
			// it lands on a road, steal 1 random resource from that road's
			// owner." The base fold set RobberPending on this event; the Apply
			// for EvBarbPending clears it, since there is no robber here.
			d := engine.DecodeEvent[engine.DevPlayedData](e)
			out = append(out, engine.NewEvent(EvBarbPending,
				barbPendingData{Player: d.Player, Idx: -1, Steal: true}))
		default:
		}
	}
	return out
}

// onSeven: no production, discards as usual (gold is not in the hand), and the
// active player moves one of the three barbarians. A barbarian landing on a
// road steals from its owner.
func (m Wagons) onSeven(s *engine.State) []engine.Event {
	if _, shared := engine.SharedRaiders(s); shared {
		return nil
	}
	x := extRO(s)
	if !x.HasTrade || !x.Started {
		return nil
	}
	return []engine.Event{engine.NewEvent(EvBarbPending,
		barbPendingData{Player: s.Cur, Idx: -1, Steal: true})}
}

// startingGold is 5, or 3 alongside Rivers, where gold has become the wagon's
// fuel and both scenarios spend it.
func startingGold(ruleset string) int {
	if rulesetHas(ruleset, riversName) {
		return startGoldRivers
	}
	return startGold
}

// setupCities finds each seat's round-2 setup city, which is where its wagon
// starts. SetupRound2City makes each seat own exactly one city after setup.
// The scan follows the board's order because the Buildings map has none.
func setupCities(s *engine.State) ([]board.Vertex, []bool) {
	out := make([]board.Vertex, len(s.Players))
	found := make([]bool, len(s.Players))
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, v := range h.Vertices() {
			b, ok := s.Buildings[v]
			if !ok || !b.City || int(b.Owner) >= len(out) || found[b.Owner] {
				continue
			}
			out[b.Owner] = v
			found[b.Owner] = true
		}
	}
	// A seat with no city has no wagon; `found` says so, since the zero vertex
	// is an ordinary buildable corner.
	return out, found
}

// blocks pauses the turn while the module is owed something: a barbarian move,
// or the movement phase the active player has not yet taken or declined.
//
// The movement phase blocks only ending the turn ("after the active player has
// finished trading and building, and before they end their turn, they may move
// their wagon"), which is why blocksTurnActions is narrower.
func (Wagons) blocks(s *engine.State) bool {
	x := extRO(s)
	if !x.HasTrade {
		return false
	}
	// Discards come first. A 7 emits the discards and the barbarian move in one
	// batch, and decideBarbarian refuses while a discard is owed, so blocking
	// here would make AutoCommand issue a command that is always refused.
	if len(s.PendingDiscards) > 0 {
		return false
	}
	if x.BarbSeat != engine.NoPlayer {
		return true
	}
	if !x.Started || s.Phase != engine.PhasePlay || !s.Rolled {
		return false
	}
	return !x.MoveDone && x.TurnSeat == s.Cur
}

// blocksTurnActions gates the active player's voluntary actions only while the
// barbarian interrupt is open. The movement phase does not: it sits at the end
// of the turn, and a player may build, trade and play cards before it.
func (Wagons) blocksTurnActions(s *engine.State) bool {
	if len(s.PendingDiscards) > 0 {
		return false // see blocks: the discards are owed first
	}
	return extRO(s).BarbSeat != engine.NoPlayer
}

// blocksBuildTrade closes building and trading while the active seat's wagon
// is on the move, and reopens them when the movement action ends.
//
// The movement phase comes after trading and building, so without this gate a
// seat could lay a road mid-move and carry on at 1 MP instead of 2. It is
// BlocksBuildTrade rather than BlocksTurnActions because the wagon's own
// commands (move, boost, drive-off, halt, gold purchase) and ending the turn
// must stay open.
//
// Decision: open action only. Once the wagon has stopped (a halt, or a plaza)
// the seat may build and trade again; a road built then is only worth what it
// would be next turn anyway. See docs/rules/wagons.md.
func (Wagons) blocksBuildTrade(s *engine.State) bool {
	x := extRO(s)
	return x.HasTrade && x.Started && x.MoveOpen && x.TurnSeat == s.Cur
}

// pendingDeciders reports the barbarian interrupt and nothing else.
//
// The movement phase is absent: it is part of the turn, and reporting it would
// replace the turn budget with a module cap. It still blocks the pass (see
// blocks); a seat whose turn timer runs out gets the halt from Auto, then the
// end-turn on the next tick.
func (Wagons) pendingDeciders(s *engine.State) []engine.ModuleDecider {
	x := extRO(s)
	// Same discard guard as blocks(). engine.PendingDeciders returns only the
	// module seats when any module names one, so naming the barbarian seat here
	// would hide the seat that owes the discard and stall the game.
	if x.BarbSeat == engine.NoPlayer || len(s.PendingDiscards) > 0 {
		return nil
	}
	return []engine.ModuleDecider{{Seat: x.BarbSeat, Decision: DecisionBarbarian}}
}

// pendingTargets offers the barbarian's legal homes to the seat that owes the
// move. It is a PendingTargets hook rather than a LegalExtras one because the
// move can be owed outside an actionable turn: a Knight played before the roll
// opens it, and LegalTargetsFor returns early for a seat that is not actionable.
func (Wagons) pendingTargets(s *engine.State, seat engine.PlayerID) engine.LegalExtra {
	x := extRO(s)
	if x.BarbSeat == engine.NoPlayer || seat != x.BarbSeat {
		return engine.LegalExtra{}
	}
	return engine.LegalExtra{BarbarianEdges: barbarianHomes(s, x)}
}

// legalExtras offers the active wagon's next steps, so the client lights up
// only the intersections it can actually reach and pay for.
func (Wagons) legalExtras(s *engine.State, seat engine.PlayerID) engine.LegalExtra {
	x := extRO(s)
	if !x.HasTrade || !x.Started || x.MoveDone || seat != s.Cur {
		return engine.LegalExtra{}
	}
	var out []board.Vertex
	for _, st := range reachable(s, x, seat) {
		out = append(out, st.To)
	}
	return engine.LegalExtra{WagonSteps: out}
}

// reachable lists the steps the seat's wagon may take right now: it can pay the
// path in full out of the movement points it has (or would be given, when no
// action is open yet) and it can pay the toll.
func reachable(s *engine.State, x *WagonsExt, p engine.PlayerID) []step {
	if int(p) >= len(x.Wagon) {
		return nil
	}
	if !x.OnBoard[p] {
		return nil
	}
	v := x.Wagon[p]
	mp := x.MP
	if !x.MoveOpen {
		mp = allowance(s, x.Level[p])
	}
	var out []step
	for _, st := range steps(s, x, v) {
		cost, toll, _ := price(s, x, p, st)
		if cost > mp || toll > goldAt(s, x, p) {
			continue
		}
		out = append(out, st)
	}
	return out
}

// barbarianHomes lists every path a barbarian may be moved to: a path a road
// could legally occupy, spokes excluded (they are not board edges here), that
// no barbarian already stands on. A barbarian may stand on a built road, which
// is what makes the steal possible.
func barbarianHomes(s *engine.State, x *WagonsExt) []board.Edge {
	if _, shared := engine.SharedRaiders(s); shared {
		return sharedHomes(s)
	}
	var out []board.Edge
	for _, e := range boardEdges(s.Board) {
		if !e.Valid() || !s.Board.LandEdge(e) {
			continue
		}
		if blockedEdgeOn(s.Board, x.Trade, e) {
			continue
		}
		if x.barbarianOn(e) >= 0 {
			continue
		}
		out = append(out, e)
	}
	return out
}

// auto is the module's minimal legal command: place the owed barbarian, or
// decline the movement.
func (m Wagons) auto(s *engine.State, target engine.PlayerID) (engine.Command, bool) {
	x := extRO(s)
	if !x.HasTrade || len(s.PendingDiscards) > 0 {
		return engine.Command{}, false
	}
	if x.BarbSeat != engine.NoPlayer {
		if target != engine.NoPlayer && target != x.BarbSeat {
			return engine.Command{}, false
		}
		homes := barbarianHomes(s, x)
		if len(homes) == 0 {
			return engine.Command{}, false
		}
		idx := max(x.BarbIdx, 0)
		return engine.Command{Player: x.BarbSeat, Type: CmdBarbarian,
			Data: raw(map[string]any{"barb": idx, "e": homes[0]})}, true
	}
	if !m.blocks(s) {
		return engine.Command{}, false
	}
	if target != engine.NoPlayer && target != s.Cur {
		return engine.Command{}, false
	}
	return engine.Command{Player: s.Cur, Type: CmdHalt}, true
}

// occupiesEdge marks a trade hex's three seaward edges as taken.
//
// It uses the OccupiesEdge hook because the build command, the setup connector
// and the legal-road set all consult that one predicate, so one check blocks
// the edge everywhere.
func occupiesEdge(s *engine.State, e board.Edge) bool {
	x := extRO(s)
	if !x.HasTrade || s.Board == nil {
		return false
	}
	return blockedEdgeOn(s.Board, x.Trade, e)
}

// blocksVertex marks a trade hex's two blocked corners: the ones touching
// nothing but water and the trade hex itself. No settlement or city goes there,
// and no route runs through one.
//
// The plaza needs no entry: checkSettlementSpot already refuses any vertex
// whose Side is past board.S. See board.go.
func blocksVertex(s *engine.State, v board.Vertex, _ engine.PlayerID) bool {
	x := extRO(s)
	if !x.HasTrade || s.Board == nil {
		return false
	}
	for _, h := range x.Trade {
		for _, c := range h.Vertices() {
			if c == v && !cornerIsLand(s.Board, h, v) {
				return true
			}
		}
	}
	return false
}

// --- dev deck --------------------------------------------------------------

// extraDevCards is how many Swift Journeys are still shuffled into the deck.
func (Wagons) extraDevCards(s *engine.State) int {
	x := extRO(s)
	if !x.HasTrade {
		return 0
	}
	return x.SwiftLeft
}

// drawSwift hands p a Swift Journey.
//
// The event is public. Its payload is only the buyer, and its type already
// tells every viewer a Swift Journey was drawn (redaction cannot strip a type),
// so there is nothing to hide; the view publishes `swift_held` for the same
// reason. See docs/rules/wagons.md. Hiding it would need decideBuyDevCard to
// emit one event shape for both halves of the deck.
func (Wagons) drawSwift(s *engine.State, p engine.PlayerID, idx, offset int) (engine.Event, bool) {
	x := extRO(s)
	if x.SwiftLeft <= 0 {
		return engine.Event{}, false
	}
	return engine.NewEvent(EvSwiftBought, swiftBoughtData{Player: p}), true
}

// --- gold in a player trade -------------------------------------------------

// goldPayload is the module's half of a player trade: gold is a count rather
// than a card, so it cannot ride the base Give/Want hands.
type goldPayload struct {
	Gold int `json:"gold,omitempty"`
}

func decodeWagonGold(s *engine.State, extra json.RawMessage) int {
	var d struct {
		Gold      int `json:"gold"`
		WagonGold int `json:"wagon_gold"`
	}
	if len(extra) == 0 {
		return 0
	}
	if json.Unmarshal(extra, &d) != nil {
		return decodeGold(extra)
	}
	if d.Gold < 0 || d.WagonGold < 0 {
		return -1
	}
	if s.Ext["raiders"] != nil {
		return d.WagonGold
	}
	if d.WagonGold > int(^uint(0)>>1)-d.Gold {
		return -1
	}
	return d.Gold + d.WagonGold
}

func decodeGold(extra json.RawMessage) int {
	if len(extra) == 0 {
		return 0
	}
	var d goldPayload
	if err := json.Unmarshal(extra, &d); err != nil {
		return 0
	}
	if d.Gold < 0 {
		return 0
	}
	return d.Gold
}

// tradeExtraHeld reports how much gold the payload offers and whether p holds
// it. The count must be positive for any non-empty offer, because
// engine.tradeExtraHeld skips the held check on zero counts. Gold is not in
// Hand, so no hand-limit or discard rule sees it.
func (Wagons) tradeExtraHeld(s *engine.State, p engine.PlayerID, extra json.RawMessage) (int, bool) {
	if extRO(s).SharedCurrency {
		return 0, true
	}
	n := decodeWagonGold(s, extra)
	if n < 0 {
		// The shared trade aggregator checks affordability only for positive counts.
		return 1, false
	}
	if n == 0 {
		return 0, true
	}
	x := extRO(s)
	if int(p) >= len(x.Gold) {
		return n, false
	}
	return n, goldAt(s, x, p) >= n
}

func (Wagons) tradeExtraEvents(s *engine.State, from, to engine.PlayerID, extra json.RawMessage) []engine.Event {
	if extRO(s).SharedCurrency {
		return nil
	}
	n := decodeWagonGold(s, extra)
	if n <= 0 {
		return nil
	}
	return []engine.Event{engine.NewEvent(EvGoldMoved, goldMovedData{From: from, To: to, Gold: n})}
}
