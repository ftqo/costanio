package bot

import (
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/knights"
)

// This file completes the Knights progress deck. Each card lands in one of the
// three shapes the rest of the bot already uses:
//
//   - scored, when the effect is visible immediately (Bishop's robber move);
//   - by rule, when it resolves through a pending or a later turn (Alchemist,
//     Spy, Master Merchant, Commercial Harbor, Merchant Fleet);
//   - never by simulation when a draw is involved, since Decide resolves draws
//     deterministically and simulating one is a peek.
//
// Every rule-played card asks the engine for legality itself; only the scorer
// gets that for free.

// alchemistPlay picks the dice for this turn. It must be played before the
// roll, so it lives outside the usual candidate flow.
//
// It maximizes, over public information, the production a total hands us net
// of what it hands everyone else. Seven is never chosen: the robber and the
// discards hit us as much as anyone.
func (b *Strong) alchemistPlay(s *engine.State, seat engine.PlayerID) (engine.Command, bool) {
	if !b.knightsActive(s) || b.noProgBatch3 {
		return engine.Command{}, false
	}
	x := knights.Read(s)
	if int(seat) >= len(x.Players) {
		return engine.Command{}, false
	}
	held := false
	for _, c := range x.Players[seat].Progress {
		if c == knights.CardAlchemist {
			held = true
		}
	}
	if !held {
		return engine.Command{}, false
	}

	bestTotal, bestNet := 0, -1e18
	for total := 2; total <= 12; total++ {
		if total == 7 {
			continue
		}
		net := 0.0
		for _, h := range board.HexesInRadius(s.Board.Radius) {
			t, ok := s.Board.Tiles[h]
			if !ok || !t.Res.Producing() || t.Number != total || h == s.Board.Robber {
				continue
			}
			for _, v := range h.Vertices() {
				bld, ok := s.Buildings[v]
				if !ok {
					continue
				}
				w := 1.0
				if bld.City {
					w = 2
				}
				if bld.Owner == seat {
					net += w
				} else {
					// oppNeutralWeight, not Weights.Opp: both sides are
					// buildings on the same dice total, so they are compared
					// at the same rate (as for the camel bid).
					net -= w * oppNeutralWeight
				}
			}
		}
		if net > bestNet {
			bestTotal, bestNet = total, net
		}
	}
	if bestTotal == 0 || bestNet <= 0 {
		return engine.Command{}, false // no roll helps us more than it helps them
	}
	d1 := min(6, bestTotal-1)
	d2 := bestTotal - d1
	cmd := engine.Command{Player: seat, Type: knights.CmdPlayProgress,
		Data: raw2(map[string]any{"card": knights.CardAlchemist, "d1": d1, "d2": d2})}
	if _, err := engine.Decide(s.Clone(), cmd); err != nil {
		return engine.Command{}, false
	}
	return cmd, true
}

// knightsProgressCandidates2 adds the remaining cards. propose carries a score the
// caller compares against its incumbent, for the ones that must not be scored by
// simulation.
func (b *Strong) knightsProgressCandidates2(s *engine.State, seat engine.PlayerID, propose func(engine.Command, float64)) {
	if b.noProgBatch3 {
		return
	}
	x := knights.Read(s)
	if int(seat) >= len(x.Players) {
		return
	}
	held := map[knights.ProgressCard]bool{}
	for _, c := range x.Players[seat].Progress {
		held[c] = true
	}
	legal := func(data map[string]any) (engine.Command, bool) {
		cmd := engine.Command{Player: seat, Type: knights.CmdPlayProgress, Data: raw2(data)}
		if _, err := engine.Decide(s.Clone(), cmd); err != nil {
			return engine.Command{}, false
		}
		return cmd, true
	}
	// The do-nothing baseline, on the caller's scale. Computed at most once, and
	// only when a rule-played card is held.
	baseline, haveBaseline := 0.0, false
	ruleFloor := func() float64 {
		if !haveBaseline {
			baseline, haveBaseline = b.eval(s, seat), true
		}
		return baseline + ruleScore
	}

	// Bishop moves the robber and then steals one card from every neighbor. The
	// steals resolve randomly inside Decide, so simulating the play would peek
	// at their outcome. It is scored on the robber move alone (a board with the
	// robber relocated), which understates the card but cannot cheat.
	if held[knights.CardBishop] {
		for _, h := range board.HexesInRadius(s.Board.Radius) {
			if !engine.RobberMayEnter(s, h) || h == s.Board.Robber || blocksOwn(s, h, seat) {
				continue
			}
			cmd, ok := legal(map[string]any{"card": knights.CardBishop, "hex": h})
			if !ok {
				continue
			}
			c := s.Clone()
			c.Board.Robber = h
			propose(cmd, b.eval(c, seat))
		}
	}

	// Spy and Master Merchant both open a look the card itself grants, so acting
	// on what they reveal is legitimate information rather than a peek. Both
	// resolve through a pending pick, so neither is visible to scoring; both are
	// targeted on public counts.
	if held[knights.CardSpy] {
		best, bestN := engine.NoPlayer, 0
		for q := range s.Players {
			p := engine.PlayerID(q)
			if p == seat {
				continue
			}
			if n := len(x.Players[q].Progress); n > bestN {
				best, bestN = p, n
			}
		}
		if best != engine.NoPlayer {
			if cmd, ok := legal(map[string]any{"card": knights.CardSpy, "victim": best}); ok {
				propose(cmd, ruleFloor())
			}
		}
	}
	if held[knights.CardMasterMerchant] {
		mine := s.PublicVPWithModules(seat)
		best, bestN := engine.NoPlayer, 0
		for q := range s.Players {
			p := engine.PlayerID(q)
			// Only a player out-scoring us is a legal target.
			if p == seat || s.PublicVPWithModules(p) <= mine {
				continue
			}
			if n := s.DiscardableCount(p); n > bestN {
				best, bestN = p, n
			}
		}
		if best != engine.NoPlayer {
			if cmd, ok := legal(map[string]any{"card": knights.CardMasterMerchant, "victim": best}); ok {
				propose(cmd, ruleFloor())
			}
		}
	}

	// Commercial Harbor forces every opponent holding a commodity to swap one for
	// a resource of ours. Their holdings are hidden, so the trigger is whether
	// they have cities producing commodities (public). A play when nobody
	// qualifies is legal but wasted, so Decide cannot be the gate.
	if held[knights.CardCommercialHarbor] {
		targets := 0
		for q := range s.Players {
			p := engine.PlayerID(q)
			if p == seat {
				continue
			}
			for c := range knights.Commodity(3) {
				if producesCommodity(s, p, c) {
					targets++
					break
				}
			}
		}
		if targets > 0 {
			if cmd, ok := legal(map[string]any{"card": knights.CardCommercialHarbor}); ok {
				propose(cmd, ruleFloor())
			}
		}
	}

	// Merchant Fleet grants 2:1 on one named card for the rest of the turn. The
	// benefit only materializes in a later trade, which scoring cannot see, so it
	// is played when we are holding a surplus worth converting: the resource we
	// hold most of, at two or more, while we cannot afford the build we want.
	if held[knights.CardMerchantFleet] {
		hand := s.Players[seat].Hand
		bestRes, bestN := board.Wood, 0
		for _, r := range board.Resources {
			if hand[r] > bestN {
				bestRes, bestN = r, hand[r]
			}
		}
		if bestN >= 2 && !hand.Has(engine.CostCity) && !hand.Has(engine.CostSettlement) {
			if cmd, ok := legal(map[string]any{"card": knights.CardMerchantFleet, "res": bestRes}); ok {
				propose(cmd, ruleFloor())
			}
		}
	}
}

// ruleScore is the epsilon a rule-played candidate is lifted above the
// do-nothing baseline (see ruleFloor): enough to be taken when nothing better is
// available, never enough to outrank a measurable improvement.
//
// It must be relative to the baseline, not absolute: bestPlay seeds bestScore
// with b.eval of the current position, which runs several hundred negative for
// most of the game, so a bare 1e-6 would always win. That would also make
// bestPlay return the card to withFollowUp (bot/respond.go) and deepen
// (bot/strong.go) as the best action available.
const ruleScore = 1e-6
