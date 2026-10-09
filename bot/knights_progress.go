package bot

import (
	"maps"
	"sort"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/knights"
)

// knightsProgressCandidates feeds progress-card plays into bestPlay's scorer. Only
// cards that resolve immediately (no follow-on pending the bot can't yet drive)
// and have a constructible target are offered; each is scored through the
// simulator, so a card is played only when that beats holding it (the eval
// prices held cards). Interactive cards (Wedding, Commercial Harbor, Spy, …)
// are held for now.
func (b *Strong) knightsProgressCandidates(s *engine.State, seat engine.PlayerID, consider func(engine.Command)) {
	x := knights.Read(s)
	if int(seat) >= len(x.Players) {
		return
	}
	hand := x.Players[seat].Progress
	if len(hand) == 0 {
		return
	}
	held := map[knights.ProgressCard]bool{}
	for _, c := range hand {
		held[c] = true
	}
	play := func(card knights.ProgressCard, extra map[string]any) {
		data := map[string]any{"card": card}
		maps.Copy(data, extra)
		consider(engine.Command{Player: seat, Type: knights.CmdPlayProgress, Data: raw2(data)})
	}

	// No-target cards that are pure or near-pure gains.
	if held[knights.CardWarlord] {
		play(knights.CardWarlord, nil) // activate all our knights for free
	}
	if held[knights.CardSmith] {
		play(knights.CardSmith, nil) // promote up to two of our knights for free
	}
	if held[knights.CardEngineer] {
		play(knights.CardEngineer, nil) // a free city wall
	}
	if held[knights.CardIrrigation] {
		play(knights.CardIrrigation, nil) // free wheat from our grain hexes
	}
	if held[knights.CardMining] {
		play(knights.CardMining, nil) // free ore from our mountain hexes
	}

	// Intrigue: displace an enemy knight standing on our road network. The board
	// changes immediately, so ordinary scoring prices it.
	if held[knights.CardIntrigue] && !b.noProgBatch2 {
		// Sorted for determinism: map order is random and ties keep the first
		// candidate seen.
		var targets []board.Vertex
		for v, k := range x.Knights {
			if k.Owner != seat {
				targets = append(targets, v)
			}
		}
		sortVertices(targets)
		for _, v := range targets {
			for _, e := range v.Edges() {
				if owner, ok := s.Roads[e]; ok && owner == seat {
					play(knights.CardIntrigue, map[string]any{"v": v})
					break
				}
			}
		}
	}
	// Diplomat: remove an opponent's open road (or relocate one of ours). Removal
	// shows up directly in their reachability, which the evaluator reads.
	if held[knights.CardDiplomat] && !b.noProgBatch2 {
		// Sorted before capping, so both the order and the subset kept are stable.
		var roads []board.Edge
		for e, owner := range s.Roads {
			if owner != seat {
				roads = append(roads, e)
			}
		}
		sortEdges(roads)
		if len(roads) > 24 { // bounded: this runs inside candidate scoring
			roads = roads[:24]
		}
		for _, e := range roads {
			play(knights.CardDiplomat, map[string]any{"e": e})
		}
	}
	// Inventor: swap two number tokens. Offer swaps that move a better number
	// onto a hex we produce from, bounded to the most promising pairs (the full
	// cross product is hundreds of candidates, each an evaluation).
	if held[knights.CardInventor] && !b.noProgBatch2 {
		b.inventorCandidates(s, seat, play)
	}

	// Merchant: places the merchant token on one of our hexes, worth a victory
	// point while held (plus a 2:1). Put it on our best producing hex.
	if held[knights.CardMerchant] {
		if h, ok := b.bestOwnedHex(s, seat); ok {
			play(knights.CardMerchant, map[string]any{"hex": h})
		}
	}

	// Monopolies: name the resource/commodity that yields the most.
	if held[knights.CardResourceMonopoly] {
		if r, ok := b.bestMonopolyResource(s, seat); ok {
			play(knights.CardResourceMonopoly, map[string]any{"res": r})
		}
	}
	if held[knights.CardTradeMonopoly] {
		if c, ok := b.bestMonopolyCommodity(s, x, seat); ok {
			play(knights.CardTradeMonopoly, map[string]any{"com": c})
		}
	}

	// Crane: a discounted improvement; offer one per track (Decide enforces cost).
	if held[knights.CardCrane] {
		for t := range knights.Track(3) {
			if x.Players[seat].Improve[t] < knights.MaxImprovement {
				play(knights.CardCrane, map[string]any{"track": t})
			}
		}
	}

	// Medicine: cheap settlement→city upgrade. Offer our best settlement.
	if held[knights.CardMedicine] {
		if v, ok := b.bestUpgradeSettlement(s, seat); ok {
			play(knights.CardMedicine, map[string]any{"v": v})
		}
	}
}

// bestOwnedHex returns the seat's highest-pip owned land hex (for the merchant
// token), in deterministic board order.
func (b *Strong) bestOwnedHex(s *engine.State, seat engine.PlayerID) (board.Hex, bool) {
	best, bestPips, found := board.Hex{}, -1, false
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		if !s.Board.Land(h) {
			continue
		}
		owned := false
		for _, v := range h.Vertices() {
			if bld, ok := s.Buildings[v]; ok && bld.Owner == seat {
				owned = true
				break
			}
		}
		if !owned {
			continue
		}
		p := 0
		if t, ok := s.Board.Tiles[h]; ok && t.Res.Producing() {
			p = pips(t.Number)
		}
		if p > bestPips {
			best, bestPips, found = h, p, true
		}
	}
	return best, found
}

// bestUpgradeSettlement returns the seat's highest-pip plain settlement, the best
// target for a Medicine cheap-city upgrade.
func (b *Strong) bestUpgradeSettlement(s *engine.State, seat engine.PlayerID) (board.Vertex, bool) {
	best, bestPips, found := board.Vertex{}, -1.0, false
	for _, v := range ownSettlements(s, seat) {
		if p := vertexPips(s, v); p > bestPips {
			best, bestPips, found = v, p, true
		}
	}
	return best, found
}

// bestMonopolyResource picks the resource whose Resource-Monopoly levy (up to 2
// from each opponent) takes the most cards, breaking ties toward what we value.
func (b *Strong) bestMonopolyResource(s *engine.State, seat engine.PlayerID) (board.Resource, bool) {
	phase := gamePhase(s, seat)
	best, bestScore, found := board.Wood, 0.0, false
	for _, r := range board.Resources {
		take := 0.0
		for q := range s.Players {
			if engine.PlayerID(q) == seat {
				continue
			}
			// Public estimate: an opponent's hand contents are hidden (see
			// publicHandEstimate and the information rules in docs/bots.md).
			take += min(publicHandEstimate(s, engine.PlayerID(q))[r], 2)
		}
		if take == 0 {
			continue
		}
		score := take * (b.resourceWeight(r, phase) + 0.1)
		if score > bestScore {
			best, bestScore, found = r, score, true
		}
	}
	return best, found
}

// bestMonopolyCommodity picks the commodity held by the most opponents (each
// yields one), breaking ties toward a commodity we still need to improve.
func (b *Strong) bestMonopolyCommodity(s *engine.State, x *knights.Ext, seat engine.PlayerID) (knights.Commodity, bool) {
	keep := commodityKeep(x, seat)
	best, bestScore, found := knights.Commodity(0), 0.0, false
	for c := range knights.Commodity(3) {
		holders := 0
		for q := range s.Players {
			if engine.PlayerID(q) == seat {
				continue
			}
			// Held commodities are hidden; whether a player has cities that
			// produce this commodity is public and serves as the proxy.
			if producesCommodity(s, engine.PlayerID(q), c) {
				holders++
			}
		}
		if holders == 0 {
			continue
		}
		score := float64(holders)
		if keep[c] > 0 {
			score += 0.5 // mild preference for a commodity we can use
		}
		if score > bestScore {
			best, bestScore, found = c, score, true
		}
	}
	return best, found
}

// knightsFreeProgressPlay returns a progress card that is strictly worth playing
// whenever its precondition holds, as a rule rather than a scored candidate.
//
// These resolve after the decision (Wedding emits an owed-cards pending, Road
// Building a road credit), so a one-step evaluator scores them at zero. There is
// nothing to weigh anyway: Wedding only takes from players ahead of us, and
// Road Building is two roads for a card the bot would otherwise discard at the
// hand limit.
func (b *Strong) knightsFreeProgressPlay(s *engine.State, seat engine.PlayerID) (engine.Command, bool) {
	if b.noFreeProg {
		return engine.Command{}, false
	}
	x := knights.Read(s)
	if int(seat) >= len(x.Players) {
		return engine.Command{}, false
	}
	held := map[knights.ProgressCard]bool{}
	for _, c := range x.Players[seat].Progress {
		held[c] = true
	}
	// Rule-played cards skip the scorer, which is where Decide checks legality,
	// so each must ask the engine itself (e.g. no play while a forced give or
	// pick is outstanding).
	propose := func(data map[string]any) (engine.Command, bool) {
		cmd := engine.Command{Player: seat, Type: knights.CmdPlayProgress, Data: raw2(data)}
		if _, err := engine.Decide(s.Clone(), cmd); err != nil {
			return engine.Command{}, false
		}
		return cmd, true
	}
	play := func(card knights.ProgressCard) (engine.Command, bool) {
		return propose(map[string]any{"card": card})
	}
	// Saboteur: every player at or above our victory points discards half their
	// hand. Like Wedding it lands as a pending and only targets players doing at
	// least as well, so it is always worth playing.
	if held[knights.CardSaboteur] && !b.noProgBatch2 {
		mine := s.PublicVPWithModules(seat)
		for q := range s.Players {
			p := engine.PlayerID(q)
			if p == seat || s.PublicVPWithModules(p) < mine {
				continue
			}
			if s.DiscardableCount(p) > 1 {
				if cmd, ok := play(knights.CardSaboteur); ok {
					return cmd, true
				}
				break
			}
		}
	}
	// Deserter: take a knight from whoever has the most of them. The card opens a
	// forced exchange (the victim surrenders, we place the replacement), so the
	// gain arrives through pendings and is invisible at decision time.
	if held[knights.CardDeserter] && !b.noProgBatch2 {
		best, bestN := engine.NoPlayer, 0
		for q := range s.Players {
			p := engine.PlayerID(q)
			if p == seat {
				continue
			}
			n := 0
			for _, k := range x.Knights {
				if k.Owner == p {
					n++
				}
			}
			if n > bestN {
				best, bestN = p, n
			}
		}
		if best != engine.NoPlayer {
			if cmd, ok := propose(map[string]any{"card": knights.CardDeserter, "victim": best}); ok {
				return cmd, true
			}
		}
	}
	if held[knights.CardWedding] {
		mine := s.PublicVPWithModules(seat)
		for q := range s.Players {
			if engine.PlayerID(q) != seat && s.PublicVPWithModules(engine.PlayerID(q)) > mine {
				if cmd, ok := play(knights.CardWedding); ok {
					return cmd, true
				}
				break
			}
		}
	}
	if held[knights.CardRoadBuilding] && s.Players[seat].RoadsLeft > 0 && len(b.frontierEdges(s, seat)) > 0 {
		if cmd, ok := play(knights.CardRoadBuilding); ok {
			return cmd, true
		}
	}
	return engine.Command{}, false
}

// swappableNumber reports whether a chip may be moved by Inventor: 2, 6, 8 and
// 12 stay put by rule.
func swappableNumber(n int) bool {
	return n != 0 && n != 2 && n != 6 && n != 8 && n != 12
}

// inventorCandidates offers number-token swaps that raise our own production,
// pairing the weakest chip on a hex we touch with the strongest chip on one we
// do not. Bounded to a handful of pairs because every candidate costs a full
// evaluation and the raw cross product runs to hundreds.
func (b *Strong) inventorCandidates(s *engine.State, seat engine.PlayerID, play func(knights.ProgressCard, map[string]any)) {
	mine := map[board.Hex]bool{}
	for v, bld := range s.Buildings {
		if bld.Owner != seat {
			continue
		}
		for _, h := range v.Hexes() {
			mine[h] = true
		}
	}
	var ours, theirs []board.Hex
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		t, ok := s.Board.Tiles[h]
		if !ok || !t.Res.Producing() || !swappableNumber(t.Number) {
			continue
		}
		if mine[h] {
			ours = append(ours, h)
		} else {
			theirs = append(theirs, h)
		}
	}
	// Weakest of ours against strongest of theirs: the swap that gains the most.
	sortHexesByPips(s, ours, true)
	sortHexesByPips(s, theirs, false)
	n := 0
	for _, a := range ours {
		for _, c := range theirs {
			if pips(s.Board.Tiles[c].Number) <= pips(s.Board.Tiles[a].Number) {
				continue // not an upgrade for us
			}
			play(knights.CardInventor, map[string]any{"a": a, "b": c})
			n++
			if n >= 12 {
				return
			}
		}
	}
}

func sortHexesByPips(s *engine.State, hs []board.Hex, ascending bool) {
	sort.Slice(hs, func(i, j int) bool {
		pi, pj := pips(s.Board.Tiles[hs[i]].Number), pips(s.Board.Tiles[hs[j]].Number)
		if pi != pj {
			if ascending {
				return pi < pj
			}
			return pi > pj
		}
		return hexLess(hs[i], hs[j])
	})
}

func hexLess(a, c board.Hex) bool {
	if a.Q != c.Q {
		return a.Q < c.Q
	}
	return a.R < c.R
}
