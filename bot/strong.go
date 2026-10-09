package bot

import (
	"encoding/json"
	"sort"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/wagons"
)

// Strong is a heuristic bot. Instead of fixed action priorities it scores
// candidate moves by simulating each through the engine and evaluating the
// resulting position (see eval.go), then takes the best. It has dedicated
// policies for initial placement, the robber, discarding, and trading. For
// commands it doesn't model it falls back to bot.Simple.
type Strong struct {
	noExplorersCityChoice bool
	naive                 string // sub-policy replaced with a naive version (see WithNaivePolicy)
	noSimpleDefend        bool
	lookahead             int // within-turn lookahead plies (see WithLookahead)
	lookaheadWidth        int
	w                     Weights
	simple                Simple
	bi                    *boardInfo // board cache; built once when the bot is primed (see Prime)
	knightsOn             *bool      // memoized "is the Knights module active" (see knightsActive)
	islandsOn             *bool      // memoized "is the Islands module active" (see islandsActive)
	fishOn                *bool      // memoized "is the Fishermen module active" (see fishActive)
	caravansOn            *bool      // memoized "is the Caravans module active" (see caravansActive)
	harbourOn             *bool      // memoized "is the Harbormaster module active" (see harbourActive)
	raidersOn             *bool      // memoized "is the Raiders module active" (see raidersActive)
	wagonsOn              *bool      // memoized "is the Wagons module active" (see wagonsActive)
	noWagons              bool       // drops the whole Wagons lane (see WithoutWagonPlay)
	noSwift               bool       // never plays a Swift Journey or buys the boost (see WithoutSwiftJourney)

	// islandPull's per-game caches (bot/islands.go): the land components, the
	// ruleset's chip value, and the walk's scratch. All static or reset per call.
	isleOf     map[board.Hex]int
	chipVPMemo *int
	pullDist   []int8
	// playerTrades gates responding to standing player offers (see WithPlayerTrades).
	// Off by default; bank trades are always available regardless.
	playerTrades bool
	// lrChase builds toward Longest Road (see WithLongestRoad). Off by default;
	// the title's victory points are counted regardless.
	lrChase bool
	// hiddenInfo restores reads of opponents' hidden state (see WithHiddenInfo).
	// Off by default; used only to price the information rules.
	hiddenInfo bool
	// flatRes prices all resources equally (see WithFlatResourceWeights).
	flatRes bool
	// landOnly disables Islands play entirely (see WithLandOnly).
	landOnly bool
	// vlBlocks is scratch for the learned value term, reused across calls.
	vlBlocks [][perPlayerFeatures]float64
	// acceptProbe counts consultations (see WithAcceptProbe).
	acceptProbe func()
	// acceptThreshold enables the cloned acceptance policy (see WithLearnedAccept).
	acceptThreshold float64
	// learnedSetupRoad picks opening roads with the cloned net (see WithLearnedSetupRoad).
	learnedSetupRoad bool
	// roadOpens scores opening roads by what they open (see WithRoadOpens).
	roadOpens bool
	// ungatedRoads drops the road-candidate gate (see WithUngatedRoads).
	ungatedRoads bool
	// learnedBuild picks builds with the cloned net (see WithLearnedBuild).
	learnedBuild bool
	// learnedPlacement scores openings with the cloned net (see WithLearnedPlacement).
	learnedPlacement bool
	// ungatedOffers restores the unconditional overpay (see WithUngatedOffers).
	ungatedOffers bool
	// noFish disables fish spending (see WithoutFishSpending).
	noFish bool
	// noCamels disables the camel auction lane (see WithoutCamelPlay).
	noCamels bool
	// camelCap bounds the cards one bid may name (see WithCamelBidCap).
	camelCap int
	// unpricedCamelBids restores the unpriced bid (see WithUnpricedCamelBids).
	unpricedCamelBids bool
	// camelNoBid keeps placement and drops bidding. True by default; see
	// WithCamelBids.
	camelNoBid bool
	// camelUniformRivals restores the bare uniform rival model (see WithUniformCamelRivals).
	camelUniformRivals bool
	// fishHold / fishHoldSet scale the held-fish term (see WithFishHoldWeight).
	fishHold    float64
	fishHoldSet bool
	// noFishGate drops the top-rung gate (see WithoutFishRungGate).
	noFishGate bool
	// keepBoot disables passing the old boot (see WithKeepBoot).
	keepBoot bool
	// noFishChance drops the chance-resolving fish spends (see WithoutFishChanceSpends).
	noFishChance bool
	// noFreeProg disables the rule-played progress cards (see WithoutFreeProgressPlays).
	noFreeProg bool
	// noProgBatch2 drops the second progress-card batch (see WithoutProgressBatch2).
	noProgBatch2 bool
	// noProgBatch3 drops the final progress-card batch (see WithoutProgressBatch3).
	noProgBatch3 bool
	// noPendingMetro / noAqueduct are measurement knobs (see options.go).
	noPendingMetro bool
	noAqueduct     bool
}

func NewStrong(opts ...Option) *Strong {
	c := resolve(opts)
	depth, width := defaultLookaheadDepth, defaultLookaheadWidth
	if c.lookaheadSet {
		depth, width = c.lookahead, c.lookaheadWidth
	}
	w := DefaultWeights()
	if c.weights != nil {
		w = *c.weights
	}
	return &Strong{noExplorersCityChoice: c.noExplorersCityChoice, w: w, playerTrades: !c.noPlayerTrades, ungatedOffers: c.ungatedOffers, learnedPlacement: !c.handPlacement, learnedBuild: c.learnedBuild, ungatedRoads: c.ungatedRoads, roadOpens: c.roadOpens, learnedSetupRoad: c.learnedSetupRoad, acceptThreshold: c.acceptThreshold, acceptProbe: c.acceptProbe, lrChase: c.lrChase, hiddenInfo: c.hiddenInfo, flatRes: c.flatRes, landOnly: c.landOnly, noFish: c.noFish, noCamels: c.noCamels, noWagons: c.noWagons, noSwift: c.noSwift, camelCap: c.camelBidCap, unpricedCamelBids: c.unpricedCamelBids, camelNoBid: !c.camelBids, camelUniformRivals: c.camelUniformRivals, fishHold: c.fishHold, fishHoldSet: c.fishHoldSet, noFishGate: c.noFishGate, keepBoot: c.keepBoot, noFishChance: c.noFishChance, noFreeProg: c.noFreeProg, noProgBatch2: c.noProgBatch2, noProgBatch3: c.noProgBatch3, noPendingMetro: c.noPendingMetro, noAqueduct: c.noAqueduct,
		simple: Simple{playerTrades: !c.noPlayerTrades, noDefend: c.noSimpleDefend, noSwift: c.noSwift}, naive: c.naive, noSimpleDefend: c.noSimpleDefend, lookahead: depth, lookaheadWidth: max(1, width)}
}

// Prime builds the static board cache once, when the bot is installed on a seat
// (game start, or a forfeit takeover). The board never changes during a game.
// The actor calls this via the boardPrimer interface in SetSeatBot.
func (b *Strong) Prime(brd *board.Board) { b.bi = newBoardInfo(brd) }

// cache returns the board cache, building it lazily if the bot was never primed
// (tests that call Act directly).
func (b *Strong) cache(s *engine.State) *boardInfo {
	if b.bi == nil {
		b.bi = newBoardInfo(s.Board)
	}
	return b.bi
}

func raw2(v any) json.RawMessage {
	b, _ := json.Marshal(v)
	return b
}

func (b *Strong) Act(s *engine.State, seat engine.PlayerID) (engine.Command, bool) {
	// Discards may be owed by a seat that isn't the current player.
	if n := s.PendingDiscards[seat]; n > 0 {
		// Under Knights the discard counts commodities too and must shed exactly n
		// cards across resources+commodities, so it needs its own chooser.
		if b.knightsActive(s) {
			cards, coms := b.knightsChooseDiscard(s, seat, n)
			return engine.Command{Player: seat, Type: engine.CmdDiscardCards,
				Data: raw2(map[string]any{"cards": cards, "commodities": coms})}, true
		}
		return engine.Command{Player: seat, Type: engine.CmdDiscardCards,
			Data: raw2(map[string]any{"cards": b.chooseDiscard(s, seat, n)})}, true
	}
	// A lost barbarian defense makes us choose which of our own cities burns.
	// It can be owed off-turn and blocks everything else, so it goes before the
	// turn gate.
	if b.knightsActive(s) {
		if cmd, ok := b.knightsBarbarianSacrifice(s, seat); ok {
			return cmd, true
		}
		// An earned metropolis needs a city named and blocks everything else
		// until answered.
		if cmd, ok := b.knightsMetropolisPick(s, seat); ok {
			return cmd, true
		}
		// The Aqueduct's free resource can be owed off-turn; auto would pick by
		// bank abundance.
		if cmd, ok := b.knightsAqueductPick(s, seat); ok {
			return cmd, true
		}
	}
	// The camel auction. A round opens as a turn ends, so bids and placements
	// are usually owed off-turn; and BlocksTurnActions freezes the seat until it
	// answers. Hence before the turn gate and before bestPlay.
	if b.caravansActive(s) {
		if cmd, ok := b.camelAction(s, seat); ok {
			return cmd, true
		}
	}
	// Raiders pendings (landing tie, Muster placement, the 7's victim), for the
	// same reason. The landing tie is owed by the seat that built, not whoever is
	// up when the batch settles.
	if b.raidersActive(s) {
		if cmd, ok := b.raidersPending(s, seat); ok {
			return cmd, true
		}
	}
	// The Wagons barbarian, for the same reason (it can be owed after a pre-roll
	// Knight). Wagon movement comes later; see wagonAction below.
	if b.wagonsActive(s) {
		if idx, owed := wagons.OwesBarbarian(s, seat); owed {
			if cmd, ok := barbarianMove(s, seat, idx); ok {
				return cmd, true
			}
		}
	}
	// Respond to a standing table offer before our own turn logic. Gated by
	// playerTrades (on by default for Strong). A seat that won't take the offer
	// declines explicitly, so a human offerer isn't left waiting out the timer.
	if b.playerTrades && s.ActiveOffer != nil && s.ActiveOffer.By != seat && !s.ActiveOffer.Responded(seat) {
		if cmd, ok := b.respond(s, seat); ok {
			return cmd, true
		}
		return declineOffer(seat), true
	}
	if s.Cur != seat {
		return engine.Command{}, false
	}

	switch {
	case s.Phase == engine.PhaseSetup:
		return b.setup(s, seat)
	case s.Phase != engine.PhasePlay:
		return engine.Command{}, false
	case s.RobberPending:
		return b.moveRobber(s, seat)
	case !s.Rolled && b.knightsActive(s):
		// Alchemist sets the dice, so it has to come before the roll.
		if cmd, ok := b.alchemistPlay(s, seat); ok {
			return cmd, true
		}
		return engine.Command{Player: seat, Type: engine.CmdRollDice}, true
	case !s.Rolled:
		// A Knights pre-roll knight or other module nuance: let the baseline
		// handle anything that isn't a plain roll.
		return engine.Command{Player: seat, Type: engine.CmdRollDice}, true
	}

	// Shed the old boot before anything else this turn: it costs a victory point
	// until it is gone, and passing it is never worse (see passBoot).
	if b.fishActive(s) {
		if cmd, ok := b.passBoot(s, seat); ok {
			return cmd, true
		}
	}
	// Settle our own standing offer before anything else: it is holding up the
	// turn, and the cards it brings change what else is affordable.
	if cmd, ok := b.executeTrade(s, seat); ok {
		return cmd, true
	}
	// Take an immediate win if one is available this turn.
	if cmd, ok := b.winningMove(s, seat); ok {
		return cmd, true
	}

	// Explorers, before the evaluator: ships, crews, settlers and the whole
	// Movement phase are invisible to a position score. See StrongExplorersPlay.
	if !b.noExplorersCityChoice {
		if cmd, ok := b.explorersCityChoice(s, seat); ok {
			return cmd, true
		}
	}
	if cmd, ok := StrongExplorersPlay(s, seat); ok {
		return cmd, true
	}

	// Progress cards whose effect lands through a pending are invisible to the
	// evaluator, so they are played by rule (see knightsFreeProgressPlay).
	if b.knightsActive(s) {
		if cmd, ok := b.knightsFreeProgressPlay(s, seat); ok {
			return cmd, true
		}
	}
	// Raiders: hire a rider and spend the gold, by rule, because a card resolves
	// the moment it is bought and the evaluator cannot see it (bot/raiders.go).
	if b.raidersActive(s) {
		if cmd, ok := b.raidersBuild(s, seat); ok {
			return cmd, true
		}
	}
	if cmd, ok := b.bestPlay(s, seat); ok {
		return cmd, true
	}
	// Ask the table before paying the bank: a 1:1 beats any bank ratio when
	// someone takes it.
	if cmd, ok := b.offerTrade(s, seat); ok {
		return cmd, true
	}
	// The march comes after trading and building.
	if b.raidersActive(s) {
		if cmd, ok := b.raidersMarch(s, seat); ok {
			return cmd, true
		}
	}
	// The wagon moves after trading and building, and before the baseline,
	// whose AutoCommand would return the module's decline.
	if b.wagonsActive(s) {
		if cmd, ok := b.wagonAction(s, seat); ok {
			return cmd, true
		}
	}
	// Defer to the baseline for anything not modelled. Strong builds roads only
	// via bestPlay, so a baseline road is vetoed rather than chasing Longest Road.
	cmd, ok := b.simple.Act(s, seat)
	if ok && cmd.Type == engine.CmdBuildRoad && !b.lrChase {
		// Vetoing the road must not skip a later turn stage: Explorers' Movement
		// phase still has to run, or ships never sail.
		if c, ok := explorersEnterMovement(s, seat); ok {
			return c, true
		}
		return engine.Command{Player: seat, Type: engine.CmdEndTurn}, true
	}
	return cmd, ok
}

// score simulates a command on a clone and returns the resulting eval, or
// (0,false) if the command is illegal.
func (b *Strong) score(s *engine.State, seat engine.PlayerID, cmd engine.Command) (float64, bool) {
	c := s.Clone()
	// DecideForEval applies events in place, saving a Clone; the result matches
	// Decide + Apply (module reactions, route titles, victory check included).
	if err := engine.DecideForEval(c, cmd); err != nil {
		return 0, false
	}
	return b.eval(c, seat), true
}

// bestPlay picks the highest-eval legal action of the turn, or trades toward
// the best build it can't yet afford. Returns false when ending the turn is
// best (or only module actions remain).
func (b *Strong) bestPlay(s *engine.State, seat engine.PlayerID) (engine.Command, bool) {
	base := b.eval(s, seat)
	bestCmd := engine.Command{}
	bestScore := base
	found := false

	// The cloned build chooser, when enabled, decides among roads, settlements,
	// cities, a development card and stopping. Its "stop" is honoured: builds are
	// skipped, but trades, dev plays and module actions below still run.
	skipBuilds := false
	if b.learnedBuild {
		if cmd, ok := b.buildNetPick(s, seat); ok {
			return cmd, true
		}
		skipBuilds = true
	}

	var cands []scoredCand
	consider := func(cmd engine.Command) {
		sc, ok := b.score(s, seat, cmd)
		if !ok {
			return
		}
		if b.lookahead > 0 {
			cands = append(cands, scoredCand{cmd, sc})
		}
		if sc > bestScore+1e-9 {
			bestScore, bestCmd, found = sc, cmd, true
		}
	}

	// Skip builds we can't afford; Decide would reject them anyway. (Only roads
	// have a free path.)
	hand := s.Players[seat].Hand

	// Cities: upgrade each own settlement (deterministic order).
	if !skipBuilds && hand.Has(engine.CostCity) {
		for _, v := range ownSettlements(s, seat) {
			consider(engine.Command{Player: seat, Type: engine.CmdBuildCity, Data: raw2(builtV(v))})
		}
	}
	// Settlements at the frontier.
	frontier := b.frontierVertices(s, seat)
	if !skipBuilds && hand.Has(engine.CostSettlement) {
		for _, v := range frontier {
			consider(engine.Command{Player: seat, Type: engine.CmdBuildSettlement, Data: raw2(builtV(v))})
		}
	}
	// Roads extend the network toward a new settlement spot, only when no open
	// spot is already reachable and the network is under ~2 roads per building.
	// The cap stops a card-flooded bot laying roads that never convert to points;
	// past it the bot bank-trades toward a city or settlement instead.
	//
	// A free-road credit opens the gate: it costs nothing and expires with the
	// turn.
	if !skipBuilds && (s.FreeRoads > 0 || b.ungatedRoads || b.lrChase || (len(frontier) == 0 && roadCount(s, seat) < buildingCount(s, seat)*2+2)) {
		for _, e := range b.frontierEdges(s, seat) {
			consider(engine.Command{Player: seat, Type: engine.CmdBuildRoad, Data: raw2(builtE(e))})
		}
	}
	// Development card (only if buyable: affordable, deck non-empty, enabled).
	// Scored by expectation over the deck, never by simulating the purchase:
	// the engine resolves the draw deterministically, so simulating would peek
	// at the top card.
	if !skipBuilds && !devCardsDisabled(s) && s.DevDeck.Count() > 0 && hand.Has(engine.CostDevCard) {
		if sc, ok := b.expectedDevBuyValue(s, seat); ok && sc > bestScore+1e-9 {
			bestScore, bestCmd, found = sc, engine.Command{Player: seat, Type: engine.CmdBuyDevCard}, true
		}
	}
	// Play a held knight (largest army / robber pressure).
	if s.Players[seat].DevCards[engine.DevKnight] > 0 && !s.PlayedDevThisTurn {
		consider(engine.Command{Player: seat, Type: engine.CmdPlayDevCard, Data: raw2(map[string]any{"card": engine.DevKnight})})
	}
	// Play the best choice dev card (monopoly / year-of-plenty / road-building).
	if cmd, sc, ok := b.bestDevPlay(s, seat); ok && sc > bestScore+1e-9 {
		bestScore, bestCmd, found = sc, cmd, true
	}
	// Fishermen: spend fish, scored the same way as any other action.
	if b.fishActive(s) {
		b.fishCandidates(s, seat, consider, func(cmd engine.Command, sc float64) {
			if sc > bestScore+1e-9 {
				bestScore, bestCmd, found = sc, cmd, true
			}
		})
	}
	// Islands: ships, scored the same way as any other build.
	if b.islandsActive(s) {
		b.islandsCandidates(s, seat, consider)
		if !skipBuilds {
			b.islandRoadCandidates(s, seat, len(frontier), consider)
		}
	}
	// Rivers: bridges and the two coin conversions, same again.
	if b.riversActive(s) {
		b.riversCandidates(s, seat, consider)
	}
	// Wagons: the track and the two gold lanes. Movement is planned by rule in
	// wagonAction, since a route spans several turns.
	if b.wagonsActive(s) {
		b.wagonsCandidates(s, seat, consider)
	}
	// Knights build actions (improvements, knights, walls), scored the same way.
	if b.knightsActive(s) {
		propose := func(cmd engine.Command, sc float64) {
			if sc > bestScore+1e-9 {
				bestScore, bestCmd, found = sc, cmd, true
			}
		}
		b.knightsCandidates(s, seat, consider, propose)
		b.knightsProgressCandidates2(s, seat, propose)
	}

	// One-step scoring makes a move that pays on the next action (a road that
	// opens a spot, a trade that completes a city) look like a cost. Lookahead
	// re-scores the top few candidates by the best position one action later;
	// each probe costs a full candidate sweep, hence the width bound.
	if found && b.lookahead > 0 {
		bestCmd, bestScore = b.deepen(s, seat, cands, bestCmd, bestScore)
	}
	if found {
		return bestCmd, true
	}
	// No build improves the position right now: trade toward the most
	// valuable build we cannot yet afford.
	if cmd, ok := b.tradeTowardBuild(s, seat); ok {
		return cmd, true
	}
	return engine.Command{}, false
}

// frontierVertices are open settlement spots adjacent to the player's roads,
// returned in a deterministic (sorted) order.
func (b *Strong) frontierVertices(s *engine.State, seat engine.PlayerID) []board.Vertex {
	seen := map[board.Vertex]bool{}
	var out []board.Vertex
	consider := func(v board.Vertex) {
		if !seen[v] && engine.CheckSettlementSpot(s, v) == nil {
			seen[v] = true
			out = append(out, v)
		}
	}
	for e, owner := range s.Roads {
		if owner != seat {
			continue
		}
		consider(e.A)
		consider(e.B)
	}
	// A spot reached by ship is as settleable as one reached by road.
	if b.islandsActive(s) {
		for _, e := range ownShipEdges(s, seat) {
			consider(e.A)
			consider(e.B)
		}
	}
	sortVertices(out)
	return out
}

// frontierEdges are free land edges that extend the player's network, returned
// in a deterministic (sorted) order.
func (b *Strong) frontierEdges(s *engine.State, seat engine.PlayerID) []board.Edge {
	seen := map[board.Edge]bool{}
	var out []board.Edge
	add := func(v board.Vertex) {
		for _, e := range v.Edges() {
			if !e.Valid() || !s.Board.LandEdge(e) {
				continue
			}
			if _, taken := s.Roads[e]; taken {
				continue
			}
			if seen[e] {
				continue
			}
			seen[e] = true
			out = append(out, e)
		}
	}
	for v, bld := range s.Buildings {
		if bld.Owner == seat {
			add(v)
		}
	}
	for e, owner := range s.Roads {
		if owner == seat {
			add(e.A)
			add(e.B)
		}
	}
	sortEdges(out)
	return out
}

// ---- Discard ----

// chooseDiscard drops the least useful n cards: surplus first, keeping a
// balance weighted toward late-game ore/wheat.
func (b *Strong) chooseDiscard(s *engine.State, seat engine.PlayerID, n int) engine.Hand {
	if b.naive == "discard" {
		// Naive version for ablation: shed in resource order.
		var out engine.Hand
		hand := s.Players[seat].Hand
		for range n {
			for _, r := range board.Resources {
				if hand[r]-out[r] > 0 {
					out[r]++
					break
				}
			}
		}
		return out
	}
	phase := gamePhase(s, seat)
	hand := s.Players[seat].Hand
	var out engine.Hand
	for range n {
		// Pick the resource with the highest (remaining count / weight): the
		// most expendable card.
		bestR := board.Wood
		bestScore := -1e18
		for _, r := range board.Resources {
			remaining := hand[r] - out[r]
			if remaining <= 0 {
				continue
			}
			// Higher remaining and lower weight => more expendable.
			expend := float64(remaining) / (b.resourceWeight(r, phase) + 0.1)
			if expend > bestScore {
				bestScore, bestR = expend, r
			}
		}
		out[bestR]++
	}
	return out
}

// winningMove returns a legal action this turn that reaches this seat's win
// threshold, if any (city upgrades and frontier settlements; VP cards auto-count
// so only build actions need enumerating). Buying a VP dev card is left to
// bestPlay/eval.
//
// The threshold is engine.WinThreshold, not s.Config.TargetVP: a seat holding
// the Fishermen boot needs one point more.
func (b *Strong) winningMove(s *engine.State, seat engine.PlayerID) (engine.Command, bool) {
	target := engine.WinThreshold(s, seat)
	wins := func(cmd engine.Command) bool {
		c := s.Clone()
		events, err := engine.Decide(c, cmd)
		if err != nil {
			return false
		}
		for _, e := range events {
			if err := engine.Apply(c, e); err != nil {
				return false
			}
		}
		return c.VPWithModules(seat) >= target
	}
	hand := s.Players[seat].Hand
	if hand.Has(engine.CostCity) {
		for _, v := range ownSettlements(s, seat) {
			cmd := engine.Command{Player: seat, Type: engine.CmdBuildCity, Data: raw2(builtV(v))}
			if wins(cmd) {
				return cmd, true
			}
		}
	}
	if hand.Has(engine.CostSettlement) {
		for _, v := range b.frontierVertices(s, seat) {
			cmd := engine.Command{Player: seat, Type: engine.CmdBuildSettlement, Data: raw2(builtV(v))}
			if wins(cmd) {
				return cmd, true
			}
		}
	}
	return engine.Command{}, false
}

func builtV(v board.Vertex) map[string]any { return map[string]any{"v": v} }
func builtE(e board.Edge) map[string]any   { return map[string]any{"e": e} }

// expectedDevBuyValue scores buying a development card as the average over every
// card the deck could still yield, weighted by how many of each remain.
//
// The deck's composition is public (card counting); its order is not, so this
// must never simulate the purchase, which would reveal the exact next card.
func (b *Strong) expectedDevBuyValue(s *engine.State, seat engine.PlayerID) (float64, bool) {
	total := s.DevDeck.Count()
	if total == 0 {
		return 0, false
	}
	// Legality check only (e.g. a pending module choice makes the buy illegal).
	// The drawn card is discarded; the score below uses only the composition.
	if _, err := engine.Decide(s.Clone(), engine.Command{Player: seat, Type: engine.CmdBuyDevCard}); err != nil {
		return 0, false
	}
	kinds := []engine.DevCard{engine.DevKnight, engine.DevVictoryPoint,
		engine.DevRoadBuilding, engine.DevYearOfPlenty, engine.DevMonopoly}
	exp := 0.0
	for _, card := range kinds {
		n := s.DevDeck[card]
		if n <= 0 {
			continue
		}
		c := s.Clone()
		c.Players[seat].Hand.Sub(engine.CostDevCard)
		c.Players[seat].NewDevCards[card]++
		c.DevDeck[card]--
		exp += float64(n) / float64(total) * b.eval(c, seat)
	}
	return exp, true
}

// scoredCand is a candidate and the one-step score it earned.
type scoredCand struct {
	cmd engine.Command
	sc  float64
}

// deepen re-scores the strongest candidates by what the turn can reach one
// action later, and returns whichever first move leads to the best two-move
// position.
//
// The follow-up is a recursive bestPlay on the successor with one less ply.
func (b *Strong) deepen(s *engine.State, seat engine.PlayerID, cands []scoredCand, bestCmd engine.Command, bestScore float64) (engine.Command, float64) {
	sort.Slice(cands, func(i, j int) bool { return cands[i].sc > cands[j].sc })
	if len(cands) > b.lookaheadWidth {
		cands = cands[:b.lookaheadWidth]
	}
	deeper := *b
	deeper.lookahead = b.lookahead - 1
	best, bestVal := bestCmd, bestScore
	for _, c := range cands {
		next := s.Clone()
		if err := engine.DecideForEval(next, c.cmd); err != nil {
			continue
		}
		val := b.eval(next, seat)
		// The best single follow-up, scored on the successor position.
		if cmd2, ok := deeper.bestPlay(next, seat); ok {
			after := next.Clone()
			if err := engine.DecideForEval(after, cmd2); err == nil {
				if v := b.eval(after, seat); v > val {
					val = v
				}
			}
		}
		if val > bestVal+1e-9 {
			best, bestVal = c.cmd, val
		}
	}
	return best, bestVal
}
