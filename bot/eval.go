package bot

import (
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// pips is the probability weight of a number token (dots on the chit):
// 6 and 8 are worth 5, 2 and 12 worth 1, 7 (robber) and 0 worth nothing.
func pips(n int) int {
	if n <= 0 || n == 7 {
		return 0
	}
	return 6 - abs(7-n)
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

// Weights tune the evaluation. Defaults were set by hand and validated by
// self-play; the struct is JSON-serializable and settable via WithWeights, so a
// weight vector is data.
//
// A version of Strong is this binary plus a weight vector, so versions can play
// each other in one process. That only works if new features are added
// additively, with a zero weight reproducing the previous behavior exactly
// (as Reach and Blocked do).
type Weights struct {
	VP        float64 `json:"vp"`        // linear value per victory point
	VPRush    float64 `json:"vp_rush"`   // convex VP term: VPRush * vp² makes the last points urgent
	Prod      float64 `json:"prod"`      // expected production (pip × resource weight)
	Diversity float64 `json:"diversity"` // bonus per distinct resource produced
	Hand      float64 `json:"hand"`      // value of cards in hand
	Dev       float64 `json:"dev"`       // value per development card held
	Expansion float64 `json:"expansion"` // spots reachable with no new roads
	Reach     float64 `json:"reach"`     // spots 1-2 new roads away (decayed by distance)
	FreeRoad  float64 `json:"free_road"` // value per unspent free-road credit (State.FreeRoads)
	Blocked   float64 `json:"blocked"`   // penalty per resource-weighted pip denied by the robber
	Port      float64 `json:"port"`      // value of owned harbors
	Army      float64 `json:"army"`      // proximity to largest army
	Opp       float64 `json:"opp"`       // discount applied to the best opponent's selfScore
	Threat    float64 `json:"threat"`    // penalty per VP the leader has above the threat threshold

	// Knights terms, in the vector so ablation and sweeps reach them. Not yet
	// measured.
	KnightsImprove    float64 `json:"cak_improve"`     // scales knightsImproveValue, the per-track improvement ladder
	KnightsLevel      float64 `json:"cak_knight"`      // per weighted knight level, scaled by barbarian proximity
	KnightsInactive   float64 `json:"cak_inactive"`    // an inactive knight's level, as a fraction of an active one
	KnightsCommodCap  float64 `json:"cak_commod_cap"`  // per pip of commodity-producing city capacity
	KnightsCommodHold float64 `json:"cak_commod_hold"` // per held commodity feeding the next improvement
	KnightsProgress   float64 `json:"cak_progress"`    // per progress card held (optionality)
	KnightsWall       float64 `json:"cak_wall"`        // per city wall
	KnightsCityLoss   float64 `json:"cak_city_loss"`   // penalty for being the expected city-loser at landfall
	KnightsDefender   float64 `json:"cak_defender"`    // bonus for being the likely sole defender

	// Opening placement, the most valuable policy in the bot: replacing it with
	// "first legal spot" drops the win rate to 7.2% (about 42.8 points).
	SetupBreadth1 float64 `json:"setup_breadth1"` // weight on a resource we lack, first settlement
	SetupBreadth2 float64 `json:"setup_breadth2"` // ...and on the second, where the pair must be buildable
	SetupPort2    float64 `json:"setup_port2"`    // a 2:1 harbor on a resource this spot floods
	SetupPort3    float64 `json:"setup_port3"`    // a generic 3:1
	SetupNeighbor float64 `json:"setup_neighbor"` // discounted pips of the best open neighbor

	// Harbour scales harbourProximity, the Harbormaster card's approach term
	// (bot/harbormaster.go). The card's 2 VP are already in the VP term. Zero
	// reproduces the earlier evaluator. Hand-set and unmeasured (no ladder plays
	// the module); see docs/bots.md.
	Harbour float64 `json:"harbour"`

	// Learned scales a win-probability term fitted to 40329 strong human games
	// (bot/value_linear.go). Zero, the default, reproduces the earlier evaluator.
	Learned float64 `json:"learned"`

	// Route prices the acting seat's own longest route, in edges, as progress
	// toward the Longest Road title. Zero (the default) skips the term entirely.
	// selfScore only counts the title once awarded; this sees the distance to
	// it. Chasing the title measured as a loss, so this is a personality knob
	// (Winston), not a default.
	//
	// Acting seat only, in eval rather than selfScore, as with Reach: an
	// opponent's route does not change across our candidates, and through the
	// Opp discount it would become "deny theirs".
	Route float64 `json:"route"`

	// IslandPull prices the next island chip before it is earned (islandPull,
	// bot/islands.go): the chip's points times the share of an 8-build horizon
	// left on the plan to the nearest unreached island (roads to the coast, a
	// coastal settlement, ships across). Acting seat only, like Reach; zero
	// reproduces the earlier evaluator. Without it the bot rarely sails when
	// its home island has room inland.
	//
	// The value is a plateau: against the same bot at zero, 56.2 / 55.1 / 56.8%
	// at 5 / 8 / 12 on Shores (Small) at four players, and 55.2 / 61.8 / 63.4% on
	// Shores (Large). Above 1 it over-prices the landing, which islandPull's
	// banked credit corrects.
	IslandPull float64 `json:"island_pull"`
}

// DefaultWeights is the current vector: hand-tuned, then corrected where
// measurement disagreed with the hand-tuning.
func DefaultWeights() Weights {
	return Weights{
		VP:        10,
		VPRush:    3.0,
		Prod:      2.0,
		Diversity: 4.0,
		Hand:      0.6,
		// Dev is 0 on measurement. A per-card bonus double-counts (hidden VP
		// cards are scored by eval, knights by armyProximity) and pushed the bot
		// to buy cards instead of building. The sweep is monotone toward zero
		// (x4 48.0%, x2 48.9%, x1 50%, x0.5 54.5%, x0.25 55.1%, x0 56.6%). The
		// field stays so past vectors remain comparable.
		Dev: 0,
		// Expansion is 2x its hand-set value. Against clones the term is flat
		// (identical evaluators only change which of them takes a spot); against
		// diversePool it is worth +1.9 points on Knights (29.6% -> 31.5%, two
		// seeds, 8000 games each, ~2.6 SE), a plateau over x1.5/x2/x3. Base
		// measures +0.4, inside noise. Strong human winners finish with 2.55
		// settlements to this bot's 1.95.
		Expansion: 2.4,
		// Reach and Opp are 2x and 16x their hand-set values: over 12000 games on
		// held-out seeds, reach x2 52.0% [51.1, 52.9], opp x16 51.6% [50.7, 52.5],
		// both 53.7% [52.8, 54.6]. Opp plateaus from x8 to x32; x16 was validated.
		Reach: 1.6,
		// A free-road credit is priced at 1.0x the cards it saves (a floor; see
		// freeRoadCredit). Untuned (see docs/bots.md).
		FreeRoad: 1.0,
		Blocked:  1.0,
		Port:     3.0,
		Army:     4.0,
		// Hand-set: half of Army, since a harbour building already pays through
		// Prod and Port. No ladder plays Harbormaster.
		Harbour: 2.0,
		Opp:     9.6,
		Threat:  12.0,

		// 1.0 reproduces knightsImproveValue read raw. Untuned.
		KnightsImprove:    1.0,
		KnightsLevel:      1.6,
		KnightsInactive:   0.4,
		KnightsCommodCap:  0.5,
		KnightsCommodHold: 0.6,
		KnightsProgress:   1.5,
		KnightsWall:       0.8,
		KnightsCityLoss:   14.0,
		KnightsDefender:   3.0,

		SetupBreadth1: 0.8,
		SetupBreadth2: 1.4,
		SetupPort2:    1.5,
		SetupPort3:    0.7,
		SetupNeighbor: 0.3,

		// See islandPull. Measured: docs/bots.md, "Islands: the bot sails".
		IslandPull: 8,
	}
}

// BaselineWeights reproduces the evaluator as it stood before robber denial and
// road reachability were added, so the ladder can A/B a feature against the
// version that lacked it without checking out an old revision.
//
// It is a frozen literal, not DefaultWeights with overrides, so later changes to
// a default cannot move the baseline.
func BaselineWeights() Weights {
	return Weights{
		VP:        10,
		VPRush:    3.0,
		Prod:      2.0,
		Diversity: 4.0,
		Hand:      0.6,
		Dev:       2.5,
		Expansion: 1.2,
		Reach:     0,
		Blocked:   0,
		Port:      3.0,
		Army:      4.0,
		Opp:       9.6,
		Threat:    12.0,

		// 1.0, not zero: knightsImproveValue was applied raw in the legacy
		// evaluator, so 1.0 reproduces it.
		KnightsImprove:    1.0,
		KnightsLevel:      1.6,
		KnightsInactive:   0.4,
		KnightsCommodCap:  0.5,
		KnightsCommodHold: 0.6,
		KnightsProgress:   1.5,
		KnightsWall:       0.8,
		KnightsCityLoss:   14.0,
		KnightsDefender:   3.0,

		SetupBreadth1: 0.8,
		SetupBreadth2: 1.4,
		SetupPort2:    1.5,
		SetupPort3:    0.7,
		SetupNeighbor: 0.3,
	}
}

// earlyResW / lateResW weight resources by usefulness; brick+wood drive early
// expansion, ore+wheat drive late-game cities and points. Indexed by resource.
var earlyResW = [6]float64{0, 1.0, 1.1, 0.9, 1.0, 0.85} // _, wood, brick, sheep, wheat, ore
var lateResW = [6]float64{0, 0.8, 0.7, 0.9, 1.2, 1.35}

// resourceWeight prices a resource by usefulness at the current game phase.
//
// A method so WithFlatResourceWeights can switch the schedule off, to test
// whether the ten unmeasured hand-set constants matter.
func (b *Strong) resourceWeight(r board.Resource, phase float64) float64 {
	if b.flatRes {
		return 1.0
	}
	return earlyResW[r]*(1-phase) + lateResW[r]*phase
}

// gamePhase is 0 early, 1 at the seat's own win threshold. Counts module VP
// (metropolis, defender, …), and divides by engine.WinThreshold rather than
// s.Config.TargetVP so the Fishermen boot's extra point is respected.
func gamePhase(s *engine.State, me engine.PlayerID) float64 {
	target := engine.WinThreshold(s, me)
	p := float64(s.PublicVPWithModules(me)) / float64(target)
	if p > 1 {
		p = 1
	}
	return p
}

// perResourcePips totals a player's expected production per resource
// (settlement = ×1, city = ×2).
func perResourcePips(s *engine.State, me engine.PlayerID) [6]float64 {
	var out [6]float64
	for v, b := range s.Buildings {
		if b.Owner != me {
			continue
		}
		mult := 1.0
		if b.City {
			mult = 2
		}
		for _, h := range v.Hexes() {
			if t, ok := s.Board.Tiles[h]; ok && t.Res.Producing() {
				out[t.Res] += mult * float64(pips(t.Number))
			}
		}
	}
	return out
}

// selfScore rates one player's standalone position. VP is public VP, including
// module VP (metropolis, defender, merchant); hidden VP cards are excluded (eval
// adds back our own). viewer is the seat reasoning: for anyone else, terms that
// need hidden state use public estimates (docs/bots.md).
func (b *Strong) selfScore(s *engine.State, p, viewer engine.PlayerID) float64 {
	w := b.w
	phase := gamePhase(s, p)
	rp := perResourcePips(s, p)

	prod, distinct := 0.0, 0
	for _, r := range board.Resources {
		prod += rp[r] * b.resourceWeight(r, phase)
		if rp[r] > 0 {
			distinct++
		}
	}

	// Longest-road VP counts, for everyone, so an opponent taking the title is
	// visible (55.6% [54.1, 57.2]). The bot does not build toward it: chasing
	// measured 48.1% [46.6, 49.6] over 4000 games.
	vp := float64(s.PublicVPWithModules(p))
	score := w.VP*vp + w.VPRush*vp*vp
	score += w.Prod * prod
	score += w.Diversity * float64(distinct)
	score += w.Hand * b.handValue(s, p, viewer, phase)
	score += w.Dev * float64(s.Players[p].DevCards.Count()+s.Players[p].NewDevCards.Count())
	score += w.Expansion * b.expansionPotential(s, p)
	score += w.FreeRoad * b.freeRoadCredit(s, p, phase)
	score -= w.Blocked * b.robberDenial(s, p, phase)
	score += w.Port * portValue(s, rp, p)
	score += w.Army * armyProximity(s, p)
	score += b.evalModule(s, p, viewer) // module hook (Islands/Knights); 0 in base
	if b.w.Learned != 0 {
		score += b.w.Learned * b.valueLinearScore(s, p)
	}
	return score
}

// eval scores seat me's position relative to the field, with an endgame threat
// penalty. Every Strong decision maximizes this.
func (b *Strong) eval(s *engine.State, me engine.PlayerID) float64 {
	score := b.selfScore(s, me, me)
	// Reachability is scored only for us: an opponent's reach does not change
	// across our candidates, and scoring it cost (players-1) BFS runs per
	// candidate. (robberDenial stays in selfScore: denial is its purpose, and it
	// is cheap.)
	score += b.w.Reach * b.reachableProduction(s, me)
	// Progress toward Longest Road, for the acting seat only. Gated on the
	// weight because LongestRouteLength is a DFS run for every candidate.
	if b.w.Route != 0 {
		score += b.w.Route * float64(engine.LongestRouteLength(s, me))
	}
	// The island chip before it is earned, for the acting seat only (the same
	// reasoning as Reach: our moves do not move an opponent's distance to sea).
	if b.w.IslandPull != 0 && b.islandsActive(s) {
		score += b.w.IslandPull * b.islandPull(s, me)
	}
	// Value our own hidden VP cards (selfScore used public VP for fairness).
	// VP-PublicVP is exactly the hidden dev VP, independent of module VP, so this
	// stays correct with the module-aware selfScore above (no double count).
	score += b.w.VP * float64(s.VP(me)-s.PublicVP(me))

	best := 0.0
	for p := range s.Players {
		if engine.PlayerID(p) == me {
			continue
		}
		if sc := b.selfScore(s, engine.PlayerID(p), me); sc > best {
			best = sc
		}
	}
	score -= b.w.Opp * best
	score -= b.w.Threat * b.threatExcess(s, me)
	return score
}

// oppNeutralWeight is the opponent discount to use wherever a gain on the
// shared board is compared against a cost paid from our own side.
//
// Weights.Opp (9.6) is a ranking discount over our own moves, across which the
// opponent term barely changes. When the opponent term itself varies across the
// candidates (the camel bid, see neutralPricer; alchemistPlay), 9.6x dominates
// the comparison.
//
// 1.0, not 0: denial is real, and a point is worth the same on either side of
// the table.
const oppNeutralWeight = 1.0

// evalModule is the per-module evaluation hook. Base game adds nothing; the
// Knights terms live in knights_eval.go, the Fishermen hold term in fishermen.go and
// the Rivers coin term in rivers.go. Additive, because rulesets compose.
func (b *Strong) evalModule(s *engine.State, p, viewer engine.PlayerID) float64 {
	score := 0.0
	if b.knightsActive(s) {
		score += b.knightsEval(s, p, viewer)
	}
	if b.fishActive(s) {
		score += b.fishHoldValue(s, p, viewer)
	}
	if b.harbourActive(s) {
		score += b.w.Harbour * harbourProximity(s, p)
	}
	if b.riversActive(s) {
		score += b.riversHoldValue(s, p, viewer)
	}
	if b.raidersActive(s) {
		score += b.raidersEval(s, p, viewer)
	}
	return score
}

// threatExcess estimates how close the most dangerous opponent is to winning,
// using only public information (fair). For each opponent it sums public VP plus
// a small allowance for a likely hidden VP card when they're close, and returns
// the excess over (that opponent's threshold - 2) for the most threatening
// opponent, so the penalty applies only in the endgame. 0 when no one is close.
//
// The threshold is per opponent (engine.WinThreshold): the Fishermen boot
// holder needs one more point. The boot holder is public (ViewExt publishes
// boot_holder).
func (b *Strong) threatExcess(s *engine.State, me engine.PlayerID) float64 {
	worst := 0.0
	for p := range s.Players {
		if engine.PlayerID(p) == me {
			continue
		}
		target := engine.WinThreshold(s, engine.PlayerID(p))
		reach := float64(s.PublicVPWithModules(engine.PlayerID(p)))
		if int(reach) >= target-3 {
			reach += 0.5 // allowance for a possible hidden VP card
		}
		excess := reach - float64(target-2)
		if excess > worst {
			worst = excess
		}
	}
	return worst
}

// handValue rewards holding useful cards with diminishing returns, and
// penalizes hoarding past the 7-card discard threshold.
func (b *Strong) handValue(s *engine.State, p, viewer engine.PlayerID, phase float64) float64 {
	val := 0.0
	if p == viewer {
		h := s.Players[p].Hand
		for _, r := range board.Resources {
			n := min(h[r], 3) // cards beyond three of a kind add little
			val += float64(n) * b.resourceWeight(r, phase)
		}
	} else {
		// An opponent's hand contents are hidden; only its size is public. Use
		// publicHandEstimate (count spread by production).
		est := publicHandEstimate(s, p)
		if b.hiddenInfo {
			h := s.Players[p].Hand
			for _, r := range board.Resources {
				est[r] = float64(h[r])
			}
		}
		for _, r := range board.Resources {
			val += min(est[r], 3) * b.resourceWeight(r, phase)
		}
	}
	// Robber/discard risk, measured against the real module-aware threshold:
	// Knights commodities count toward the hand, and city walls raise the limit.
	if total, limit := s.DiscardableCount(p), s.DiscardThreshold(p); total > limit {
		val -= float64(total-limit) * 1.5
	}
	return val
}

// expansionPotential rewards legal, network-reachable empty vertices, weighted
// by their production: a network with room to grow into good spots.
//
// Ships count as network: reachableProduction skips d = 0 (reachDecay[0] is
// zero) because this function owns that distance, so a spot at the end of a ship
// would otherwise be priced by neither. Expansion is the largest weight by
// ablation (-39.9).
func (b *Strong) expansionPotential(s *engine.State, me engine.PlayerID) float64 {
	seen := map[board.Vertex]bool{}
	total := 0.0
	consider := func(v board.Vertex) {
		if seen[v] || engine.CheckSettlementSpot(s, v) != nil {
			return
		}
		seen[v] = true
		total += vertexPips(s, v)
	}
	for e, owner := range s.Roads {
		if owner != me {
			continue
		}
		consider(e.A)
		consider(e.B)
	}
	if b.islandsActive(s) {
		for _, e := range ownShipEdges(s, me) {
			consider(e.A)
			consider(e.B)
		}
	}
	return total
}

// freeRoadCredit values road builds already granted and not yet spent. The base
// Road Building card, the Knights progress card of the same name and the
// Fishermen five-fish spend all emit a credit (State.FreeRoads) rather than a
// road on the board.
//
// Without this, playing Road Building scores zero (no piece moves) and
// bestPlay's strict `sc > bestScore+1e-9` gate never plays it, and unspent
// credits are carried into EndTurn and lost.
//
// A credit is priced at the cards it saves (one wood and one brick at the
// current phase's weights), a floor rather than a valuation: the road is scored
// by expansion and reach once it lands, so a richer price would double-count
// and make spending the credit look like a loss. Credits past RoadsLeft buy
// nothing, and the field belongs to the seat on turn.
func (b *Strong) freeRoadCredit(s *engine.State, p engine.PlayerID, phase float64) float64 {
	if s.FreeRoads <= 0 || s.Cur != p {
		return 0
	}
	n := min(s.FreeRoads, s.Players[p].RoadsLeft)
	if n <= 0 {
		return 0
	}
	return float64(n) * (b.resourceWeight(board.Wood, phase) + b.resourceWeight(board.Brick, phase))
}

// robberDenial totals the resource-weighted production p is currently losing to
// the robber.
//
// perResourcePips counts tiles under the robber at full value, so this term is
// what lets the evaluator (and moveRobber) tell blocking a 6 from blocking a 2.
//
// The robber is temporary, so the default weight is below prod.
func (b *Strong) robberDenial(s *engine.State, p engine.PlayerID, phase float64) float64 {
	h := s.Board.Robber
	t, ok := s.Board.Tiles[h]
	if !ok || !t.Res.Producing() {
		return 0
	}
	blocked := 0.0
	for _, v := range h.Vertices() {
		bld, ok := s.Buildings[v]
		if !ok || bld.Owner != p {
			continue
		}
		mult := 1.0
		if bld.City {
			mult = 2
		}
		blocked += mult * float64(pips(t.Number))
	}
	return blocked * b.resourceWeight(t.Res, phase)
}

// reachMaxDist caps the reachability BFS at two new roads. Beyond that the land
// board is mostly reachable by everyone and the term stops discriminating.
const reachMaxDist = 2

// seaMaxDist is the horizon with Islands active: an island is several ship
// moves away, beyond a two-step horizon.
const seaMaxDist = 5

// reachDecay[d] weights a spot d builds away. Distance 0 is excluded here
// because expansionPotential already scores it under its own weight.
var reachDecay = [seaMaxDist + 1]float64{0, 0.5, 0.25, 0.15, 0.1, 0.07}

// reachableProduction values the settlement spots p could reach by building one
// or two more roads, decayed by distance. Where expansionPotential asks "where
// can I build right now", this asks "where is my network pointed": a player
// boxed in with no route to open land is in trouble no other term registers.
func (b *Strong) reachableProduction(s *engine.State, p engine.PlayerID) float64 {
	bi := b.cache(s)

	// Every vertex already on p's network seeds the frontier at distance 0, so
	// p's own roads never need traversing and a plain BFS (uniform cost of one
	// new road per hop) is correct.
	bi.bfsReset()
	seed := func(v board.Vertex) {
		if vi, ok := bi.vert[v]; ok && bi.mark(vi.idx) {
			bi.cur = append(bi.cur, vi.idx)
		}
	}
	for v, bld := range s.Buildings {
		if bld.Owner == p {
			seed(v)
		}
	}
	for e, owner := range s.Roads {
		if owner == p {
			seed(e.A)
			seed(e.B)
		}
	}
	sea := b.islandsActive(s)
	if sea {
		for _, e := range ownShipEdges(s, p) {
			seed(e.A)
			seed(e.B)
		}
	}

	maxD := reachMaxDist
	if sea {
		maxD = seaMaxDist
	}
	total := 0.0
	for d := 1; d <= maxD && len(bi.cur) > 0; d++ {
		bi.next = bi.next[:0]
		for _, idx := range bi.cur {
			v := bi.vertices[idx]
			// An opponent's building severs the network: you may not run a road
			// through it, so nothing beyond it is reachable this way.
			if bld, ok := s.Buildings[v]; ok && bld.Owner != p {
				continue
			}
			for _, e := range bi.vert[v].edges {
				// With Islands on, a sea edge is traversable too: a ship instead
				// of a road, the same one-build step.
				if !e.Valid() || !(s.Board.LandEdge(e) || (sea && s.Board.SeaEdge(e))) {
					continue
				}
				// Traversing costs a road, so the edge must be free to build on.
				// p's own roads were already folded into the distance-0 seed.
				if _, taken := s.Roads[e]; taken {
					continue
				}
				n := e.A
				if n == v {
					n = e.B
				}
				vi, ok := bi.vert[n]
				if !ok || !bi.mark(vi.idx) {
					continue
				}
				bi.next = append(bi.next, vi.idx)
				// vi.pips is the cached static pip sum. Checking it before
				// legality skips the pricier spot check on dead vertices.
				if vi.pips > 0 && engine.CheckSettlementSpot(s, n) == nil {
					total += float64(vi.pips) * reachDecay[d]
				}
			}
		}
		bi.cur, bi.next = bi.next, bi.cur
	}
	return total
}

// vertexPips is the raw pip sum a settlement at v would collect.
func vertexPips(s *engine.State, v board.Vertex) float64 {
	total := 0.0
	for _, h := range v.Hexes() {
		if t, ok := s.Board.Tiles[h]; ok && t.Res.Producing() {
			total += float64(pips(t.Number))
		}
	}
	return total
}

// portValue rewards owned harbors: a 2:1 on a resource you produce, or any 3:1.
func portValue(s *engine.State, rp [6]float64, me engine.PlayerID) float64 {
	val := 0.0
	for v, b := range s.Buildings {
		if b.Owner != me {
			continue
		}
		h, ok := s.Board.HarborAt(v)
		if !ok {
			continue
		}
		if h.Ratio == 2 {
			val += 1 + rp[h.Res]*0.1 // worth more on a resource you flood
		} else {
			val += 0.6
		}
	}
	return val
}

// armyProximity rewards being close to (but not yet holding) the largest army.
func armyProximity(s *engine.State, me engine.PlayerID) float64 {
	if s.LargestArmyHolder == me {
		return 0 // already counted as +2 VP
	}
	k := s.Players[me].KnightsPlayed
	switch {
	case k >= 2:
		return 1.5
	case k == 1:
		return 0.5
	}
	return 0
}

// publicHandEstimate approximates a player's hand from public information only:
// how many cards they hold (hand size is public) spread over resources in
// proportion to their pip-weighted production (the board and their buildings are
// public). A player with no production gets a flat spread.
//
// This approximates what a strong human tracks; it is not meant to be exact.
func publicHandEstimate(s *engine.State, p engine.PlayerID) [6]float64 {
	var out [6]float64
	n := float64(s.DiscardableCount(p))
	if n <= 0 {
		return out
	}
	rp := perResourcePips(s, p)
	total := 0.0
	for _, r := range board.Resources {
		total += rp[r]
	}
	if total <= 0 {
		for _, r := range board.Resources {
			out[r] = n / float64(len(board.Resources))
		}
		return out
	}
	for _, r := range board.Resources {
		out[r] = n * rp[r] / total
	}
	return out
}
