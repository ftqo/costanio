package bot

import (
	"math"
	"slices"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/knights"
)

// knightSpotCap bounds how many knight-recruit spots we score per turn.
// Barbarian defense depends on total active strength, not knight position, so a
// few deterministic spots suffice and branching stays small on 7 to 10 player
// boards.
const knightSpotCap = 8

// knightsCandidates feeds the Knights-specific build actions into bestPlay's scorer.
// Each is scored like a base build (cloned, applied, evaluated), so the
// Knights-aware eval decides among them. Timing-sensitive choices (pre-attack
// defense, knight movement) belong to the sub-policies.
// propose takes a precomputed score for the one candidate that must not be
// priced by simulating it (the robber chase).
func (b *Strong) knightsCandidates(s *engine.State, seat engine.PlayerID, consider func(engine.Command), propose func(engine.Command, float64)) {
	x := knights.Read(s)
	if int(seat) >= len(x.Players) {
		return
	}
	lt := s.LegalTargetsFor(seat)

	// City improvements: advance any track not yet maxed. Decide enforces the
	// commodity cost; eval prices the infrastructure and the metropolis VP.
	for t := range knights.Track(3) {
		if x.Players[seat].Improve[t] >= knights.MaxImprovement {
			continue
		}
		consider(engine.Command{Player: seat, Type: knights.CmdImproveCity,
			Data: raw2(map[string]any{"track": t})})
	}

	// Recruit a knight on each legal spot (board-ordered, capped).
	for i, v := range lt.Knights {
		if i >= knightSpotCap {
			break
		}
		consider(knightCmd(seat, knights.CmdBuildKnight, v))
	}

	// Activate or promote our existing knights (deterministic order).
	for _, v := range ownKnightVertices(x, seat) {
		k := x.Knights[v]
		if !k.Active {
			consider(knightCmd(seat, knights.CmdActivateKnight, v))
		}
		if k.Level < knights.MaxKnightLevel {
			consider(knightCmd(seat, knights.CmdPromoteKnight, v))
		}
	}

	// Add a wall to a still-wallable city (binds to the first unwalled city).
	if len(lt.Walls) > 0 {
		consider(engine.Command{Player: seat, Type: knights.CmdBuildWall})
	}

	// Chase the robber with an adjacent active knight: drive it to the hex that
	// most hurts opponents (the robber sub-policy's targeting) and steal. The
	// eval weighs the steal against the knight standing down.
	//
	// The steal itself is resolved by Decide from the victim's real hand, so a
	// chase with a victim is priced by expectedStealScore over the public hand
	// estimate instead (as in moveRobber).
	for _, kv := range ownKnightVertices(x, seat) {
		k := x.Knights[kv]
		if !k.Active || k.FreshlyActivated || !knightAdjacentToRobber(s, kv) {
			continue
		}
		for _, h := range board.HexesInRadius(s.Board.Radius) {
			if !engine.RobberMayEnter(s, h) || h == s.Board.Robber || blocksOwn(s, h, seat) {
				continue
			}
			payload := map[string]any{"v": kv, "hex": h}
			victim, hasVictim := b.robberVictim(s, seat, h)
			if hasVictim {
				payload["victim"] = victim
			}
			cmd := engine.Command{Player: seat, Type: knights.CmdChaseRobber, Data: raw2(payload)}
			if !hasVictim || b.hiddenInfo {
				consider(cmd)
				continue
			}
			if sc, ok := b.expectedStealScore(s, seat, victim, cmd); ok {
				propose(cmd, sc)
			}
		}
	}

	// Progress-card plays, scored the same way.
	b.knightsProgressCandidates(s, seat, consider)
}

// knightsBarbarianSacrifice answers the barbarian city sacrifice when this seat owes
// one: of the cities the engine offers, give up the least valuable. Value is the
// city's production weight (commodity terrain counts double, since commodities
// are what a Knights city is for) plus a bonus for a wall. Ties break on board order, so the choice is deterministic.
//
// Owed by a seat that may not be the current player, so Act consults this before
// its own-turn gate. Returns false when nothing is owed.
func (b *Strong) knightsBarbarianSacrifice(s *engine.State, seat engine.PlayerID) (engine.Command, bool) {
	cities := knights.SacrificeCities(s, seat)
	if len(cities) == 0 {
		return engine.Command{}, false
	}
	// Rivers alongside Knights sells this debt off for 5 coins. Always buy when
	// offered and affordable: a city is worth far more. PillageBuyoutFor answers
	// both questions without this package importing the coin module.
	if _, sold, err := engine.PillageBuyoutFor(s, seat); sold && err == nil {
		return engine.Command{Player: seat, Type: knights.CmdPillageBuyout}, true
	}
	x := knights.Read(s)
	best, bestVal := cities[0], math.Inf(1)
	for _, v := range cities {
		val := 0.0
		for _, h := range v.Hexes() {
			t, ok := s.Board.Tiles[h]
			if !ok || !t.Res.Producing() {
				continue
			}
			w := float64(pips(t.Number))
			if _, isCommodity := knights.CommodityFor(t.Res); isCommodity {
				w *= 2
			}
			val += w
		}
		if x.Walled[v] {
			val += b.w.KnightsWall
		}
		if val < bestVal {
			best, bestVal = v, val
		}
	}
	return engine.Command{Player: seat, Type: knights.CmdBarbarianDowngrade,
		Data: raw2(map[string]any{"v": best})}, true
}

// knightsMetropolisPick answers a pending metropolis placement: take the most
// valuable offered city, by knightsBarbarianSacrifice's valuation, since a
// metropolis can never be pillaged. Among equals prefer an unwalled city (a
// wall already insures the other). Ties break on board order.
//
// Returns false when nothing is owed.
func (b *Strong) knightsMetropolisPick(s *engine.State, seat engine.PlayerID) (engine.Command, bool) {
	_, cities, ok := knights.MetropolisChoice(s, seat)
	if !ok || len(cities) == 0 {
		return engine.Command{}, false
	}
	x := knights.Read(s)
	best, bestVal := cities[0], math.Inf(-1)
	for _, v := range cities {
		val := 0.0
		for _, h := range v.Hexes() {
			t, okT := s.Board.Tiles[h]
			if !okT || !t.Res.Producing() {
				continue
			}
			w := float64(pips(t.Number))
			if _, isCommodity := knights.CommodityFor(t.Res); isCommodity {
				w *= 2
			}
			val += w
		}
		if x.Walled[v] {
			val -= b.w.KnightsWall
		}
		if val > bestVal {
			best, bestVal = v, val
		}
	}
	return engine.Command{Player: seat, Type: knights.CmdMetropolisPick,
		Data: raw2(map[string]any{"v": best})}, true
}

// knightAdjacentToRobber reports whether the knight at v sits on a hex currently
// occupied by the robber (a precondition for chasing it).
func knightAdjacentToRobber(s *engine.State, v board.Vertex) bool {
	for _, h := range v.Hexes() {
		if h == s.Board.Robber {
			return true
		}
	}
	return false
}

// knightsChooseDiscard sheds exactly need cards on a 7, drawing from resources and
// commodities together. Resources go first (commodities drive the VP engine);
// among commodities, surplus held beyond the next improvement's cost is shed
// before commodities we still need. The returned counts always sum to need and
// never exceed what the seat holds, so the engine accepts them.
func (b *Strong) knightsChooseDiscard(s *engine.State, seat engine.PlayerID, need int) (engine.Hand, knights.CommodityHand) {
	phase := gamePhase(s, seat)
	hand := s.Players[seat].Hand
	x := knights.Read(s)
	coms := x.Players[seat].Commodities
	keep := commodityKeep(x, seat)

	var outH engine.Hand
	var outC knights.CommodityHand
	for range need {
		bestExpend := -1.0
		bestRes, bestCom := board.Resource(0), knights.Commodity(-1)
		isCom := false

		for _, r := range board.Resources {
			if rem := hand[r] - outH[r]; rem > 0 {
				// Higher remaining and lower keep-weight ⇒ more expendable.
				if e := float64(rem) / (b.resourceWeight(r, phase) + 0.1); e > bestExpend {
					bestExpend, bestRes, isCom = e, r, false
				}
			}
		}
		for c := range knights.Commodity(3) {
			rem := coms[c] - outC[c]
			if rem <= 0 {
				continue
			}
			// A commodity we still need for the next improvement is precious;
			// once we hold more than that, the surplus is cheap to shed.
			keepW := 1.8
			if rem > keep[c] {
				keepW = 0.8
			}
			if e := float64(rem) / (keepW + 0.1); e > bestExpend {
				bestExpend, bestCom, isCom = e, c, true
			}
		}

		switch {
		case isCom && bestCom >= 0:
			outC[bestCom]++ //nolint:gosec // G602: bestCom ranges over knights.Commodity(3), always within CommodityHand bounds
		default:
			outH[bestRes]++
		}
	}
	return outH, outC
}

// commodityKeep is the amount of each commodity the seat wants to retain: the
// cost of the next improvement on the track that commodity feeds (0 for maxed
// tracks).
func commodityKeep(x *knights.Ext, seat engine.PlayerID) [3]int {
	var keep [3]int
	for t := range knights.Track(3) {
		if lvl := x.Players[seat].Improve[t]; lvl < knights.MaxImprovement {
			keep[t.Commodity()] = knights.ImproveCost(lvl)
		}
	}
	return keep
}

// knightCmd builds a single-vertex knight command (build/activate/promote).
func knightCmd(seat engine.PlayerID, typ engine.CommandType, v board.Vertex) engine.Command {
	return engine.Command{Player: seat, Type: typ, Data: raw2(map[string]any{"v": v})}
}

// ownKnightVertices lists the seat's knight vertices in deterministic order so
// candidate generation never depends on Go map iteration order.
func ownKnightVertices(x *knights.Ext, seat engine.PlayerID) []board.Vertex {
	var out []board.Vertex
	for v, k := range x.Knights {
		if k.Owner == seat {
			out = append(out, v)
		}
	}
	sortVertices(out)
	return out
}

// knightsAqueductPick answers a pending Aqueduct grant: the Science-3 ability that
// hands a free resource to a player who produced nothing on a roll.
//
// Picks by the usual resource weighting. The engine's auto-pass takes what the
// bank holds most of, which is what nobody is spending and the opposite of
// what a city-building bot wants.
func (b *Strong) knightsAqueductPick(s *engine.State, seat engine.PlayerID) (engine.Command, bool) {
	if b.noAqueduct {
		return engine.Command{}, false
	}
	x := knights.Read(s)
	if !slices.Contains(x.Aqueduct, seat) {
		return engine.Command{}, false
	}
	phase := gamePhase(s, seat)
	best, bestVal := board.Resource(0), -1.0
	for _, r := range board.Resources {
		if s.Bank[r] < 1 {
			continue // the bank cannot cover it
		}
		// Weight by usefulness, then break toward what we are shortest of for the
		// build we are closest to affording.
		v := b.resourceWeight(r, phase)
		if s.Players[seat].Hand[r] == 0 {
			v *= 1.3
		}
		if v > bestVal {
			best, bestVal = r, v
		}
	}
	if bestVal < 0 {
		return engine.Command{}, false
	}
	return engine.Command{Player: seat, Type: knights.CmdAqueductPick,
		Data: raw2(map[string]any{"res": best})}, true
}
