package bot

import (
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/knights"
)

// moveRobber places the robber on the legal hex that most raises our
// opponent-relative eval (which tends to deny the leader's production), never
// on a hex with one of our own buildings. The victim is the adjacent opponent
// with the most cards, then the most VP.
func (b *Strong) moveRobber(s *engine.State, seat engine.PlayerID) (engine.Command, bool) {
	var best board.Hex
	var bestVictim = engine.NoPlayer
	bestScore := -1e18
	found := false

	for _, h := range board.HexesInRadius(s.Board.Radius) {
		if !engine.RobberMayEnter(s, h) || h == s.Board.Robber {
			continue
		}
		if blocksOwn(s, h, seat) {
			continue // never rob your own production
		}
		if b.naive == "robber" {
			payload := map[string]any{"hex": h}
			if v, ok := b.robberVictim(s, seat, h); ok {
				payload["victim"] = v
			}
			return engine.Command{Player: seat, Type: engine.CmdMoveRobber, Data: raw2(payload)}, true
		}
		victim, hasVictim := b.robberVictim(s, seat, h)
		payload := map[string]any{"hex": h}
		if hasVictim {
			payload["victim"] = victim
		}
		cmd := engine.Command{Player: seat, Type: engine.CmdMoveRobber, Data: raw2(payload)}
		sc, ok := b.robberHexScore(s, seat, cmd, victim, hasVictim)
		if !ok {
			continue
		}
		if sc > bestScore {
			bestScore, best, found = sc, h, true
			if hasVictim {
				bestVictim = victim
			} else {
				bestVictim = engine.NoPlayer
			}
		}
	}
	if !found {
		return b.simple.Act(s, seat)
	}
	payload := map[string]any{"hex": best}
	if bestVictim != engine.NoPlayer {
		payload["victim"] = bestVictim
	}
	return engine.Command{Player: seat, Type: engine.CmdMoveRobber, Data: raw2(payload)}, true
}

// robberHexScore prices one candidate robber placement.
//
// A hex with no eligible victim resolves nothing hidden, so the ordinary scorer
// prices it. A hex with a victim must not be simulated: see expectedStealScore.
// Separate so robber_test.go can test the exact score moveRobber ranks on.
func (b *Strong) robberHexScore(s *engine.State, seat engine.PlayerID, cmd engine.Command, victim engine.PlayerID, hasVictim bool) (float64, bool) {
	if !hasVictim || b.hiddenInfo {
		return b.score(s, seat, cmd)
	}
	return b.expectedStealScore(s, seat, victim, cmd)
}

func blocksOwn(s *engine.State, h board.Hex, seat engine.PlayerID) bool {
	for _, v := range h.Vertices() {
		if bld, ok := s.Buildings[v]; ok && bld.Owner == seat {
			return true
		}
	}
	return false
}

// victimPriority ranks robber victims: cards first, then how far ahead they are.
//
// Cards are DiscardableCount, the module-aware count eligibility uses (Knights
// steals from resources and commodities together). VP is PublicVPWithModules,
// so Knights metropolises count.
func victimPriority(s *engine.State, p engine.PlayerID) int {
	return s.DiscardableCount(p)*100 + s.PublicVPWithModules(p)
}

// robberVictim picks, among the engine's eligible victims on hex h, the one with
// the highest victimPriority. Eligibility comes from engine.RobberVictims, so the
// bot never proposes a victim the engine rejects. Ties break toward the lower
// PlayerID for determinism.
func (b *Strong) robberVictim(s *engine.State, seat engine.PlayerID, h board.Hex) (engine.PlayerID, bool) {
	best := engine.NoPlayer
	bestKey := -1
	for p := range engine.RobberVictims(s, h, seat) {
		key := victimPriority(s, p)
		if key > bestKey || (key == bestKey && (best == engine.NoPlayer || p < best)) {
			bestKey, best = key, p
		}
	}
	return best, best != engine.NoPlayer
}

// stealEvent reports whether e is a robber steal. It is the one event a robber
// command produces that Decide resolves from the RNG, and therefore the one that
// must never be simulated. Knights steals from the combined resource+commodity
// pool through its own StealCard hook, hence the second type.
func stealEvent(e engine.Event) bool {
	return e.Type == engine.EvCardStolen || e.Type == knights.EvCommodityStolen
}

// expectedStealScore prices a command that moves the robber onto a victim
// (CmdMoveRobber, or the Knights CmdChaseRobber) without conditioning on the
// card the steal turns up.
//
// Decide resolves the steal from the seeded RNG, so simulating it would reveal
// the drawn card and the victim's hand (see docs/bots.md; Bishop and
// expectedStealValue follow the same rule).
//
// Every other event from Decide is applied; the steal is priced as the average
// over publicHandEstimate, which uses only public information. WithHiddenInfo
// restores the peek.
//
// Robber moves are rare, so the extra clones per resource are cheap.
func (b *Strong) expectedStealScore(s *engine.State, seat, victim engine.PlayerID, cmd engine.Command) (float64, bool) {
	c := s.Clone()
	events, err := engine.Decide(c, cmd)
	if err != nil {
		return 0, false
	}
	for _, e := range events {
		if stealEvent(e) {
			continue
		}
		if err := engine.Apply(c, e); err != nil {
			return 0, false
		}
	}
	est := publicHandEstimate(s, victim)
	total := 0.0
	for _, r := range board.Resources {
		total += est[r]
	}
	if total <= 0 {
		return b.eval(c, seat), true // nothing we can expect to take
	}
	exp := 0.0
	for _, r := range board.Resources {
		if est[r] <= 0 {
			continue
		}
		cc := c.Clone()
		cc.Players[seat].Hand[r]++
		cc.Players[victim].Hand[r]--
		exp += est[r] / total * b.eval(cc, seat)
	}
	return exp, true
}
