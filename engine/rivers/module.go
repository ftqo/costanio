package rivers

import (
	"math/rand/v2"
	"sort"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// Module is the Rivers scenario.
type Module struct{}

func (Module) Name() string { return Name }

// SetupBoard does nothing; the derivation is all in FinishBoard (see board.go).
func (Module) SetupBoard(b *board.Board, cfg engine.GameConfig, rng *rand.Rand) {}

// InitExtBoard derives the module's state from the finished board, which is what
// EvBoardGenerated records and what a replay runs on (see
// engine.ExtBoardInitializer and the two-pass note in board.go).
//
// This pass has no generator, so it re-derives from the same reserved public slot
// the paint pass drew from, and both passes see the same numbers.
func (Module) InitExtBoard(s *engine.State) engine.Extension {
	x := emptyExt(s.Config.Players)
	// Route around the same reservation FinishBoard used (the Wagons trade-hex
	// candidates) so the two passes agree.
	x.Rivers = DeriveRiversAround(s.Board, engine.ReservedHexes(s.Config, s.Board),
		engine.PublicRngForSeed(s.PublicSeed, engine.RiversBoardSeq))
	// Tile variants (which meander each east-west hex draws) come from their own slot:
	// drawing them from the watercourse's generator would shift the chain choice.
	// FinishBoard does not assign them, so this pass does.
	assignVariants(x.Rivers, engine.PublicRngForSeed(s.PublicSeed, engine.RiversVariantSeq))
	if !usesPoorestTile(s.Config.Ruleset) {
		for i := range x.Poorest {
			x.Poorest[i] = false
		}
	}
	return x
}

func (m Module) Hooks() engine.Hooks {
	return engine.Hooks{
		// AfterEvents rather than OnEvents, for two reasons:
		//   - it also runs during setup, where the first coins are earned (a starting
		//     settlement on a river vertex or road on a river edge pays one), and
		//   - it runs after every module's OnEvents, so the wealth tiles, re-derived
		//     from coin counts, never read standings that another module's reaction
		//     has not yet updated. Hook order is a name sort, not a dependency order.
		AfterEvents:      m.afterEvents,
		VictoryCheck:     m.victory,
		RouteEdges:       m.routeEdges,
		RouteEdge:        m.routeEdge,
		RouteEdgeKind:    m.routeEdgeKind,
		OccupiesEdge:     m.occupiesEdge,
		RefusesEdge:      m.refusesEdge,
		RefusesRouteMove: m.refusesRouteMove,
		LegalExtras:      m.legalExtras,
		TradeExtraHeld:   tradeExtraHeld,
		TradeExtraEvents: tradeExtraEvents,
		// Combination rules this module half-owns. Neither module may import the other,
		// so the coin price and payment live here and the effect is theirs: 5 coins to
		// keep a city the barbarians would pillage (Knights), and a bridge bought for 6
		// fish (Fishermen).
		PillageBuyout: m.pillageBuyout,
		FreeBridge:    m.freeBridge,
	}
}

// --- the coin ledger -------------------------------------------------------
//
// Coins are paid by diffing the board, not by reacting to event types. A coin is
// paid for the placement, not the cost: Road Building roads, a road the Knights
// Diplomat rebuilds, a bridge bought with fish and setup placements all pay, and a
// Diplomat removing a road from a river edge takes the coin back. Matching event
// types would mean naming engine/islands' and engine/knights' events, which this
// package may not import.
//
// So afterEvents compares who holds each river edge and vertex now with who was
// paid for it. A ship leaving a river edge refunds, arriving earns, moving between
// two is neutral; a settlement upgraded to a city pays nothing (its vertex is
// already paid), and a Knights setup city on a fresh river vertex pays.

// paid records who was paid for a piece and how much, so the payment can be
// taken back from the right seat when the piece leaves.
type paid struct {
	P engine.PlayerID
	N int
}

// cache builds the positional sets the ledger walks, lazily: State.Apply
// unmarshals the logged layout over a freshly derived Ext (see
// engine.ExtBoardInitializer), and an eagerly built cache would describe the
// derived layout rather than the logged one.
func (x *Ext) cache() {
	if x.edgeList != nil || len(x.Rivers) == 0 {
		return
	}
	hexes := x.riverHexSet()
	sites := x.BridgeSites()
	seenE := map[board.Edge]bool{}
	seenV := map[board.Vertex]bool{}
	// Board order within each river, in river order, so the lists are stable without
	// a sort.
	for _, r := range x.Rivers {
		for _, h := range r.Hexes {
			for _, e := range h.Edges() {
				if !seenE[e] {
					seenE[e] = true
					x.edgeList = append(x.edgeList, e)
				}
			}
			for _, v := range h.Vertices() {
				if !seenV[v] {
					seenV[v] = true
					x.vertList = append(x.vertList, v)
				}
			}
		}
	}
	x.hexSet = hexes
	x.siteSet = sites
	if x.edgeList == nil {
		x.edgeList = []board.Edge{}
	}
}

// edgeHolder reports who holds river edge e and what that placement is worth.
// A bridge is checked first: it pays 3, not 3 plus the road's 1.
func (x *Ext) edgeHolder(s *engine.State, e board.Edge, ruleset string) (engine.PlayerID, int, bool) {
	if owner, ok := x.Bridges[e]; ok {
		return owner, bridgePayout(ruleset), true
	}
	if owner, ok := s.Roads[e]; ok {
		return owner, CoinsPerRoad, true
	}
	// An Islands ship, asked through the engine's accessor so this package need not
	// know what a ship is.
	if owner, ok := s.ModuleRouteEdge(e); ok {
		return owner, CoinsPerShip, true
	}
	return engine.NoPlayer, 0, false
}

// afterEvents settles the coin ledger against the board, then re-derives both
// wealth tiles once per batch, so a Road Building that places two river roads
// never shows an intermediate tile state.
//
// It returns events and mutates nothing. The ledger (PaidEdge, PaidVertex) is
// written by Apply folding these events: replay never runs this hook, so an
// in-place update would be lost on restore and every piece would be paid again.
// Each payment therefore carries the position it was made for.
func (m Module) afterEvents(after *engine.State, events []engine.Event) []engine.Event {
	x, ok := StateExt(after)
	if !ok || len(x.Rivers) == 0 {
		return nil
	}
	x.RestoreExt()
	x.cache()
	ruleset := after.Config.Ruleset
	seat := func(p engine.PlayerID) bool { return p >= 0 && int(p) < len(after.Players) }
	// Running projection of each seat's coins, so a batch that both pays and reclaims
	// never emits an event the fold would have to clamp.
	proj := append([]int(nil), x.Coins...)

	var out []engine.Event
	for _, e := range events {
		if e.Type == engine.EvTurnStarted {
			out = append(out, engine.NewEvent(EvTurnReset, struct{}{}))
			break
		}
	}
	pay := func(p engine.PlayerID, n int, e *board.Edge, v *board.Vertex) {
		if !seat(p) || n == 0 {
			return
		}
		if n < 0 && proj[p]+n < 0 {
			// Backstop clamp, unreachable by a legal command: every way a piece
			// leaves a river edge is refused up front when its payer cannot cover it
			// (refusesRouteMove, asked by the Islands ship move and the Knights
			// Diplomat), and the fold must never take a count below zero.
			n = -proj[p]
		}
		proj[p] += n
		out = append(out, engine.NewEvent(EvCoinsChanged, coinsChangedData{
			Player: p, Delta: n, Reason: ReasonBuild, E: e, V: v,
		}))
	}

	for _, e := range x.edgeList {
		owner, amount, held := x.edgeHolder(after, e, ruleset)
		was, wasPaid := x.PaidEdge[e]
		if held && wasPaid && was.P == owner && was.N == amount {
			continue
		}
		edge := e
		if wasPaid {
			// The piece left or changed hands, so its coin goes back. The event
			// names the edge so the fold clears the right entry even when the
			// clamp zeroed the amount.
			//
			// The payer is the seat that removed the piece. That is normally the
			// owner (a ship moved away), except for the Knights Diplomat, which may
			// remove an opponent's open road: whoever removes a road from a river
			// edge pays 1 gold, and the road's owner keeps the coin it earned.
			// Read off the board, since no module may import another.
			payer := was.P
			if !held && after.Phase == engine.PhasePlay && seat(after.Cur) {
				payer = after.Cur
			}
			pay(payer, -was.N, &edge, nil)
		}
		if held {
			pay(owner, amount, &edge, nil)
		}
	}
	for _, v := range x.vertList {
		b, held := after.Buildings[v]
		was, wasPaid := x.PaidVertex[v]
		if held && wasPaid && was.P == b.Owner {
			continue
		}
		vert := v
		if wasPaid {
			pay(was.P, -was.N, nil, &vert)
		}
		if held {
			// A city pays nothing outside setup and never reaches here, since its
			// vertex was paid as a settlement. The exception is the Knights
			// round-2 setup city on an unpaid river vertex, which pays as a
			// settlement does.
			pay(b.Owner, CoinsPerBuilding, nil, &vert)
		}
	}

	if ev, ok := m.wealthEvent(after, x, out); ok {
		out = append(out, ev)
	}
	return out
}

// wealthEvent re-derives both tiles over the coin counts the batch is about to
// produce, and returns the announcement when either has moved.
func (m Module) wealthEvent(s *engine.State, x *Ext, pending []engine.Event) (engine.Event, bool) {
	coins := append([]int(nil), x.Coins...)
	for _, e := range pending {
		if e.Type != EvCoinsChanged {
			continue
		}
		d := engine.DecodeEvent[coinsChangedData](e)
		if d.Player >= 0 && int(d.Player) < len(coins) {
			coins[d.Player] += d.Delta
		}
	}
	wealthiest, poorest := deriveWealth(coins, usesPoorestTile(s.Config.Ruleset))
	if wealthiest == x.Wealthiest && sameBools(poorest, x.Poorest) {
		return engine.Event{}, false
	}
	return engine.NewEvent(EvWealthChanged, wealthChangedData{
		Wealthiest: wealthiest, Poorest: seatsOf(poorest),
	}), true
}

// deriveWealth is the wealth rule, a pure function of the coin counts:
//   - Wealthiest Settler goes to the player with strictly the most coins. On a
//     tie nobody holds it until a single player leads again.
//   - A Poorest Settler tile goes to every player tied for the fewest (one per
//     seat, so all can hold one, as at the start of setup).
//
// No player can hold both: with two or more seats, a strict maximum is never
// among the minima. See TestNoPlayerEverHoldsBothTiles.
func deriveWealth(coins []int, poorestInPlay bool) (engine.PlayerID, []bool) {
	poorest := make([]bool, len(coins))
	if len(coins) == 0 {
		return engine.NoPlayer, poorest
	}
	hi, lo := coins[0], coins[0]
	for _, c := range coins {
		hi = max(hi, c)
		lo = min(lo, c)
	}
	leaders := 0
	leader := engine.NoPlayer
	for p, c := range coins {
		if c == hi {
			leaders++
			leader = engine.PlayerID(p)
		}
	}
	wealthiest := engine.NoPlayer
	if leaders == 1 {
		wealthiest = leader
	}
	if poorestInPlay {
		for p, c := range coins {
			if c == lo {
				poorest[p] = true
			}
		}
	}
	return wealthiest, poorest
}

func sameBools(a, b []bool) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func seatsOf(flags []bool) []engine.PlayerID {
	out := []engine.PlayerID{}
	for p, f := range flags {
		if f {
			out = append(out, engine.PlayerID(p))
		}
	}
	return out
}

// victory is the module's VP contribution: +1 for the Wealthiest Settler tile
// and -2 for a Poorest Settler tile. A total may go negative.
func (Module) victory(s *engine.State, p engine.PlayerID) int {
	x := extRO(s)
	vp := 0
	if x.Wealthiest == p {
		vp += WealthiestVP
	}
	if p >= 0 && int(p) < len(x.Poorest) && x.Poorest[p] {
		vp += PoorestVP
	}
	return vp
}

// --- edges -----------------------------------------------------------------

// routeEdges adds p's bridges to the longest-route walk as road segments (0 VP),
// so they join roads freely and join ships only through p's own building.
func (Module) routeEdges(s *engine.State, p engine.PlayerID, net *engine.RouteNet) {
	for e, owner := range extRO(s).Bridges {
		if owner == p {
			net.Add(e, engine.RouteRoad)
		}
	}
}

// routeEdge reports a bridge's owner, so a module that walks routes can cross one
// without importing this package. Knights move across bridges as though they were
// roads, and bridges count for knight displacement.
func (Module) routeEdge(s *engine.State, e board.Edge) (engine.PlayerID, bool) {
	owner, ok := extRO(s).Bridges[e]
	return owner, ok
}

// routeEdgeKind reports a bridge as a road, which matters when deciding whether a
// road is open at a vertex: a bridge of yours attached to a road makes that road
// not open for the Diplomat.
func (Module) routeEdgeKind(s *engine.State, e board.Edge) (engine.PlayerID, engine.RouteKind, bool) {
	owner, ok := extRO(s).Bridges[e]
	return owner, engine.RouteRoad, ok
}

// occupiesEdge reports a bridge standing on an edge, so the base road build
// treats it as taken. refusesEdge already closes the site to roads; this keeps two
// pieces off one edge if a future rule opens it.
func (Module) occupiesEdge(s *engine.State, e board.Edge) bool {
	_, ok := extRO(s).Bridges[e]
	return ok
}

// refusesEdge closes a bridge site to everything but a bridge: it is an edge like
// any other for adjacency and blocking, but may hold no road and (under Islands)
// no ship, including the coastal river outlets a ship would otherwise use.
func (Module) refusesEdge(s *engine.State, e board.Edge, k engine.RouteKind) error {
	if extRO(s).IsBridgeSite(e) {
		return ErrBridgeSiteOnly
	}
	return nil
}

// refusesRouteMove prices a ship move over the river and refuses one the owner
// cannot pay for. Leaving a river edge costs a coin and arriving earns one, so a
// move between two river edges is neutral (the symmetric reading the Diplomat rule
// spells out for roads).
//
// The same price applies to a road the Knights Diplomat takes off a river edge;
// there p is the card's player, who pays whether or not the road was theirs.
// engine/knights calls this with an empty `to` for a plain removal.
//
// Refused up front, like an unaffordable build; the engine has no notion of debt.
func (Module) refusesRouteMove(s *engine.State, p engine.PlayerID, from, to board.Edge, k engine.RouteKind) error {
	x := extRO(s)
	if len(x.Rivers) == 0 {
		return nil
	}
	net := 0
	if x.IsRiverEdge(from) {
		net -= CoinsPerShip
	}
	if x.IsRiverEdge(to) {
		net += CoinsPerShip
	}
	if net < 0 && Coins(s, p) < -net {
		return ErrNoCoins
	}
	return nil
}

// legalExtras offers the bridge sites the active seat could build on, so the
// client draws only placeable spots. Positional only: resource and supply checks
// stay on the build command, as for a road.
func (m Module) legalExtras(s *engine.State, seat engine.PlayerID) engine.LegalExtra {
	x := extRO(s)
	if len(x.Rivers) == 0 || BridgesLeft(s, seat) == 0 {
		return engine.LegalExtra{}
	}
	var out []board.Edge
	for _, r := range x.Rivers {
		for _, e := range r.Sites {
			if _, taken := x.Bridges[e]; taken {
				continue
			}
			if !s.RoadConnectsExcluding(e, seat, board.Edge{}) {
				continue
			}
			out = append(out, e)
		}
	}
	sortEdges(out)
	return engine.LegalExtra{Bridges: out}
}

func sortEdges(es []board.Edge) {
	sort.Slice(es, func(i, j int) bool {
		a, b := es[i], es[j]
		if a.A != b.A {
			return vertexLess(a.A, b.A)
		}
		return vertexLess(a.B, b.B)
	})
}

func vertexLess(a, b board.Vertex) bool {
	if a.Q != b.Q {
		return a.Q < b.Q
	}
	if a.R != b.R {
		return a.R < b.R
	}
	return a.Side < b.Side
}
