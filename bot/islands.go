package bot

import (
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/islands"
)

// islandsActive memoizes whether the Islands module is in the ruleset, the same
// way knightsActive does: the ruleset cannot change mid-game.
func (b *Strong) islandsActive(s *engine.State) bool {
	if b.landOnly {
		return false
	}
	if b.islandsOn == nil {
		on := false
		for _, m := range s.Modules() {
			if m.Name() == islands.Name {
				on = true
				break
			}
		}
		// There must also be somewhere to sail to. Procedural boards are one
		// landmass, where ships cost points; gallery archipelagos have several
		// islands, where sailing pays.
		if on {
			seen := map[int]bool{}
			for _, id := range s.Board.Islands() {
				seen[id] = true
			}
			on = len(seen) > 1
		}
		b.islandsOn = &on
	}
	return *b.islandsOn
}

// ownShipEdges returns the sea edges the player currently holds.
func ownShipEdges(s *engine.State, seat engine.PlayerID) []board.Edge {
	x, ok := islands.StateExt(s)
	if !ok {
		return nil
	}
	var out []board.Edge
	for e, owner := range x.Ships {
		if owner == seat {
			out = append(out, e)
		}
	}
	sortEdges(out)
	return out
}

// shipFrontier lists sea edges where the player could plausibly build a ship:
// touching one of their buildings, or continuing their ship network. Legality is
// left to the engine (checkShipSpot also rejects pirate-blocked edges and
// severed vertices), so this only has to be a superset, as with frontierEdges.
func (b *Strong) shipFrontier(s *engine.State, seat engine.PlayerID) []board.Edge {
	x, ok := islands.StateExt(s)
	if !ok || x.ShipsLeft[seat] <= 0 {
		return nil
	}
	seen := map[board.Edge]bool{}
	var out []board.Edge
	add := func(v board.Vertex) {
		for _, e := range v.Edges() {
			if !e.Valid() || !s.Board.SeaEdge(e) || seen[e] {
				continue
			}
			if _, taken := s.Roads[e]; taken {
				continue
			}
			if _, taken := x.Ships[e]; taken {
				continue
			}
			seen[e] = true
			out = append(out, e)
		}
	}
	// Ships extend from the player's own buildings...
	for v, bld := range s.Buildings {
		if bld.Owner == seat {
			add(v)
		}
	}
	// ...and from the ends of their existing ships. Roads extend a ship network
	// only through a building, covered above.
	for _, e := range ownShipEdges(s, seat) {
		add(e.A)
		add(e.B)
	}
	sortEdges(out)
	return out
}

// islandsCandidates adds Islands builds to the turn's candidate set, scored by
// the same eval as everything else.
func (b *Strong) islandsCandidates(s *engine.State, seat engine.PlayerID, consider func(engine.Command)) {
	// Free Road Building credits may pay for a ship (engine/islands/decide.go).
	if !s.Players[seat].Hand.Has(islands.CostShip) && s.FreeRoads == 0 {
		return
	}
	for _, e := range b.shipFrontier(s, seat) {
		consider(engine.Command{Player: seat, Type: islands.CmdBuildShip, Data: raw2(builtE(e))})
	}
}

// islandRoadCandidates offers the roads that bring an unreached island closer.
//
// bestPlay's road gate rarely opens on a home island with room inland, so the
// road toward the sea would never be scored. Only roads that strictly shorten
// the plan are added, so this cannot cause road sprawl; eval still decides.
func (b *Strong) islandRoadCandidates(s *engine.State, seat engine.PlayerID, openSpots int, consider func(engine.Command)) {
	if b.w.IslandPull == 0 || b.chipVP(s) <= 0 {
		return
	}
	hand := s.Players[seat].Hand
	if s.FreeRoads == 0 {
		if !hand.Has(engine.CostRoad) {
			return
		}
		// While a settlement spot is open, a road would spend the settlement's
		// wood and brick (measured as a heavy loss). Offer it only when there is
		// nothing to settle or the hand pays for both.
		both := engine.CostSettlement
		both.Add(engine.CostRoad)
		if openSpots > 0 && !hand.Has(both) {
			return
		}
	}
	if s.Players[seat].RoadsLeft <= 0 {
		return
	}
	cur, ok := b.islandDistance(s, seat, nil)
	if !ok || cur == 0 {
		return
	}
	for _, e := range b.frontierEdges(s, seat) {
		if x, ok := islands.StateExt(s); ok {
			if _, taken := x.Ships[e]; taken {
				continue
			}
		}
		if d, ok := b.islandDistance(s, seat, &e); ok && d < cur {
			consider(engine.Command{Player: seat, Type: engine.CmdBuildRoad, Data: raw2(builtE(e))})
		}
	}
}

// islandPullHorizon is how many builds out islandPull looks. The pull falls off
// linearly to zero one step past it, giving the constant gradient a one-step
// evaluator needs to walk a chain of builds (a geometric decay made the first
// ship of a long crossing worth almost nothing).
const islandPullHorizon = 8

// islandPullLanding is what a coastal settlement costs in that count, when the
// plan needs one before any ship can leave. Counted as two steps: it is a
// bigger build, and the evaluator already pays for it on its own merits.
const islandPullLanding = 2

// islandOf returns the board's land components, keyed by hex. Land never
// changes during a game, so it is computed once per bot.
func (b *Strong) islandOf(s *engine.State) map[board.Hex]int {
	if b.isleOf == nil {
		b.isleOf = s.Board.Islands()
	}
	return b.isleOf
}

// chipVP memoizes the ruleset's island-chip value (0 when chips are off).
func (b *Strong) chipVP(s *engine.State) int {
	if b.chipVPMemo == nil {
		v := islands.ChipVP(s.Config)
		b.chipVPMemo = &v
	}
	return *b.chipVPMemo
}

// islandPull prices the island chip p would earn by settling an island it has
// not yet built on: the chip's points, times the share of the horizon left, for
// the nearest such island. "Nearest" counts builds: roads to a coastal
// settlement of p's (building one if need be, islandPullLanding steps), then
// ships to a legal spot on the other island. The land leg is what makes the
// coast worth heading for, since ships leave only from coastal buildings.
//
// Landing earns the chip as real VP and removes that island's pull; the banked
// credit below keeps the exchange even. Opponents' pieces block the walk as
// they block real pieces. The pirate is ignored, since it moves.
func (b *Strong) islandPull(s *engine.State, p engine.PlayerID) float64 {
	vp := b.chipVP(s)
	if vp <= 0 {
		return 0
	}
	chip := float64(vp) * b.w.VP
	// Credit for chips already banked, so settling never reads as a loss. With
	// weight w > 1 the pull is worth more than the chip, and the bot would sail
	// to an island and refuse to land. Banking (w-1) chips per chip earned keeps
	// the shaping potential-based.
	banked := 0.0
	if x, ok := islands.StateExt(s); ok && b.w.IslandPull > 1 {
		banked = float64(x.IslandVP[p]) / float64(vp) * chip * (1 - 1/b.w.IslandPull)
	}
	d, ok := b.islandDistance(s, p, nil)
	if !ok {
		return banked
	}
	return banked + chip*float64(islandPullHorizon+1-d)/float64(islandPullHorizon+1)
}

// islandDistance is the build count islandPull prices: a 0-1-2 shortest path
// over (vertex, afloat) states, bucketed by distance, stopping at the horizon.
// extra, when set, is a road p is thinking of building, read as already built.
func (b *Strong) islandDistance(s *engine.State, p engine.PlayerID, extra *board.Edge) (int, bool) {
	x, _ := islands.StateExt(s)
	isle := b.islandOf(s)
	// Islands p already stands on (home, or already settled) earn no chip.
	home := map[int]bool{}
	for v, bld := range s.Buildings {
		if bld.Owner != p {
			continue
		}
		for _, h := range v.Hexes() {
			if id, ok := isle[h]; ok {
				home[id] = true
			}
		}
	}
	if x != nil {
		for id, ok := range x.Reached[p] {
			if ok {
				home[id] = true
			}
		}
	}
	target := func(v board.Vertex) bool {
		for _, h := range v.Hexes() {
			if id, ok := isle[h]; ok && !home[id] {
				return engine.CheckSettlementSpot(s, v) == nil
			}
		}
		return false
	}

	bi := b.cache(s)
	n := len(bi.vertices)
	if cap(b.pullDist) < 2*n {
		b.pullDist = make([]int8, 2*n)
	}
	dist := b.pullDist[:2*n]
	for i := range dist {
		dist[i] = -1
	}
	var buckets [islandPullHorizon + 1][]int32
	push := func(state int32, d int) {
		if d > islandPullHorizon {
			return
		}
		if old := dist[state]; old >= 0 && int(old) <= d {
			return
		}
		dist[state] = int8(d)
		buckets[d] = append(buckets[d], state)
	}
	idx := func(v board.Vertex) (int32, bool) {
		if bld, ok := s.Buildings[v]; ok && bld.Owner != p {
			return 0, false
		}
		vi, ok := bi.vert[v]
		if !ok {
			return 0, false
		}
		return vi.idx, true
	}
	for v, bld := range s.Buildings {
		if bld.Owner != p {
			continue
		}
		if i, ok := idx(v); ok {
			push(2*i, 0)
			push(2*i+1, 0)
		}
	}
	for e, owner := range s.Roads {
		if owner != p {
			continue
		}
		for _, v := range [2]board.Vertex{e.A, e.B} {
			if i, ok := idx(v); ok {
				push(2*i, 0)
			}
		}
	}
	if extra != nil {
		for _, v := range [2]board.Vertex{extra.A, extra.B} {
			if i, ok := idx(v); ok {
				push(2*i, 0)
			}
		}
	}
	for _, e := range ownShipEdges(s, p) {
		for _, v := range [2]board.Vertex{e.A, e.B} {
			if i, ok := idx(v); ok {
				push(2*i+1, 0)
			}
		}
	}
	for d := 0; d <= islandPullHorizon; d++ {
		// Not a range: zero-cost steps append to the bucket being walked.
		for k := 0; k < len(buckets[d]); k++ { //nolint:intrange // the bucket grows while it is walked
			state := buckets[d][k]
			if int(dist[state]) != d {
				continue // superseded by a cheaper route
			}
			vi := bi.vert[bi.vertices[state/2]]
			v := bi.vertices[state/2]
			afloat := state%2 == 1
			if afloat && target(v) {
				return d, true
			}
			if bld, ok := s.Buildings[v]; ok && bld.Owner != p {
				continue
			}
			if !afloat {
				// Put to sea here: free from a building of ours, a settlement's
				// worth of builds from an open coastal spot, impossible otherwise.
				coastal := false
				for i := range vi.edges {
					coastal = coastal || vi.seaE[i]
				}
				if coastal {
					if bld, ok := s.Buildings[v]; ok && bld.Owner == p {
						push(state+1, d)
					} else if engine.CheckSettlementSpot(s, v) == nil {
						push(state+1, d+islandPullLanding)
					}
				}
			}
			for i, e := range vi.edges {
				if !e.Valid() {
					continue
				}
				if afloat && !vi.seaE[i] || !afloat && !vi.landE[i] {
					continue
				}
				step := 1
				if owner, taken := s.Roads[e]; taken {
					if afloat || owner != p {
						continue
					}
					step = 0
				}
				if x != nil {
					if owner, taken := x.Ships[e]; taken {
						if !afloat || owner != p {
							continue
						}
						step = 0
					}
				}
				other := e.A
				if other == v {
					other = e.B
				}
				j, ok := idx(other)
				if !ok {
					continue
				}
				next := 2 * j
				if afloat {
					next++
				}
				push(next, d+step)
			}
		}
	}
	return 0, false
}
