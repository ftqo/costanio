package bot

import (
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/scenarios"
)

// fishActive memoizes whether the Fishermen module is in the ruleset.
func (b *Strong) fishActive(s *engine.State) bool {
	if b.noFish {
		return false
	}
	if b.fishOn == nil {
		on := false
		for _, m := range s.Modules() {
			if m.Name() == scenarios.FishermenName {
				on = true
				break
			}
		}
		b.fishOn = &on
	}
	return *b.fishOn
}

// ownFish totals the fish value the seat is holding. Tiles are worth 1, 2 or 3
// and cannot be broken up, but the total is what every cost is checked against.
func ownFish(s *engine.State, seat engine.PlayerID) int {
	x, ok := scenarios.FishStateExt(s)
	if !ok || int(seat) >= len(x.Held) {
		return 0
	}
	h := x.Held[seat]
	return h[0] + 2*h[1] + 3*h[2]
}

// The fish ladder.
//
// The two chance rungs (steal, development card) are scored by expectation, so
// payFish takes their tiles off the clone. The steal, the only spend with a
// denial term, is priced on the neutral opponent scale (expectedStealValue,
// oppNeutralWeight). The top rung is kept reachable by a rule (fishRungFloor).
//
// fishHoldValue, a value on held fish, makes the top rung less reachable: it
// charges each spend for what it consumes, and the top rung consumes the most.
// Measured over 100 seeded 4-player games with the rung gate on:
//
//	hold weight   0     0.25   0.5
//	dev card     14      9      5
//
// So its weight is zero, kept as a field so the sweep can be re-run
// (WithFishHoldWeight). If it is ever made non-zero: it is flat above the cap
// (fish beyond 7 are free to spend), and it is scored for our own seat only,
// since FishExt.Held is a private tile mix and an opponent term would go
// through Weights.Opp.
//
// The two chance rungs' prices, in fish: the module's own numbers
// (engine/scenarios/fishermen.go's fishCosts), repeated because that map is
// unexported.
const (
	fishStealCost   = 3
	fishDevCardCost = 7
)

const (
	// fishHoldCap is the top rung: past it, another fish buys nothing new.
	fishHoldCap = 7
	// fishHoldWeightDefault scales the hold term. Zero on measurement (see the
	// note above).
	fishHoldWeightDefault = 0
)

// fishHoldWeight is the scale in force for this bot (see WithFishHoldWeight).
func (b *Strong) fishHoldWeight() float64 {
	if b.fishHoldSet {
		return b.fishHold
	}
	return fishHoldWeightDefault
}

// fishHoldValue prices the fish this seat is holding, convexly, up to the top
// rung. See the note above for why it is our own seat only.
func (b *Strong) fishHoldValue(s *engine.State, p, viewer engine.PlayerID) float64 {
	if p != viewer {
		return 0
	}
	w := b.fishHoldWeight()
	if w == 0 {
		return 0
	}
	v := min(ownFish(s, p), fishHoldCap)
	// Quadratic, normalised to w*fishHoldCap at a full pile: the marginal fish
	// is cheap at 1 and expensive at 6.
	return w * float64(v*v) / float64(fishHoldCap)
}

// fishCandidates offers the fish-spending plays, scored by the same eval as
// every other action.
//
// Held fish are worth nothing in the evaluator by default (a fish is worth what
// it converts into), so a spend is scored on what it buys.
//
// Steal (3 fish) and the free dev card (7 fish) resolve a random draw inside
// Decide, so they are scored by expectation rather than simulation
// (docs/bots.md).
func (b *Strong) fishCandidates(s *engine.State, seat engine.PlayerID, consider func(engine.Command), propose func(engine.Command, float64)) {
	have := ownFish(s, seat)
	if have < 2 {
		return
	}
	floor := b.fishRungFloor(s, have)
	spend := func(use string, data map[string]any) {
		data["use"] = use
		consider(engine.Command{Player: seat, Type: scenarios.CmdSpendFish, Data: raw2(data)})
	}

	// 2 fish: take the robber off the board until the next 7 or knight. Only
	// when it sits on our production, since the eval prices the unblocking and
	// nothing else.
	if have >= 2 && 2 >= floor && s.Board.RobberOnBoard() && blocksOwn(s, s.Board.Robber, seat) {
		spend(scenarios.FishRemoveRobber, map[string]any{})
	}
	// 4 fish: take any one resource from the bank.
	if have >= 4 && 4 >= floor {
		for _, r := range board.Resources {
			spend(scenarios.FishTakeResource, map[string]any{"res": r})
		}
	}
	// 5 fish: a free road. Offered on the same frontier roads bestPlay would
	// consider, so it extends the network rather than sprawling.
	if have >= 5 && 5 >= floor {
		for _, e := range b.frontierEdges(s, seat) {
			spend(scenarios.FishFreeRoad, map[string]any{"e": e})
		}
	}

	// The two chance-resolving spends are scored by expectation, never by
	// simulation. Both resolve their draw inside Decide from the seed and log
	// position, so simulating would price the exact card that comes up.
	if b.noFishChance {
		return
	}
	if have >= 3 && 3 >= floor {
		for p := range s.Players {
			victim := engine.PlayerID(p)
			if victim == seat || s.DiscardableCount(victim) == 0 {
				continue
			}
			cmd := engine.Command{Player: seat, Type: scenarios.CmdSpendFish,
				Data: raw2(map[string]any{"use": scenarios.FishSteal, "victim": victim})}
			if sc, ok := b.expectedStealValue(s, seat, victim, cmd); ok {
				propose(cmd, sc)
			}
		}
	}
	if have >= 7 && s.DevDeck.Count() > 0 {
		cmd := engine.Command{Player: seat, Type: scenarios.CmdSpendFish,
			Data: raw2(map[string]any{"use": scenarios.FishDevCard})}
		if sc, ok := b.expectedFishDevValue(s, seat, cmd); ok {
			propose(cmd, sc)
		}
	}
}

// payFish takes the tiles the engine would take off a clone, so a candidate
// scored by expectation is scored against the position the spend actually leaves.
//
// The two chance rungs never call Decide for their value, so without this their
// fish would be free whenever fishHoldValue is non-zero.
//
// The tiles come from scenarios.SpendTiles: with no change given, which tiles leave
// is a real decision (fewest wasted fish, then fewest tiles).
func payFish(c *engine.State, seat engine.PlayerID, cost int) {
	x, ok := scenarios.FishStateExt(c)
	if !ok || int(seat) >= len(x.Held) {
		return
	}
	d, ok := scenarios.SpendTiles(x.Held[seat], cost)
	if !ok {
		return
	}
	for i := range 3 {
		x.Held[seat][i] -= d[i]
	}
	// The public number is the tile count, not the value (scenarios.FishExt.Tiles), so
	// the clone's copy moves by the tiles handed in.
	if int(seat) < len(x.Tiles) {
		x.Tiles[seat] -= d[0] + d[1] + d[2]
	}
}

// legalIgnoringResult asks the engine whether a command is legal and throws the
// answer away. Expectation-scored candidates never call Decide for their value,
// so they would otherwise skip every check Decide performs; discarding the
// events keeps the resolved draw out of the decision.
func legalIgnoringResult(s *engine.State, cmd engine.Command) bool {
	_, err := engine.Decide(s.Clone(), cmd)
	return err == nil
}

// expectedStealValue prices a 3-fish steal as the average over what the victim
// might be holding.
//
// The distribution is publicHandEstimate (public card count spread by
// production), since the actual hand is hidden (docs/bots.md).
func (b *Strong) expectedStealValue(s *engine.State, seat, victim engine.PlayerID, cmd engine.Command) (float64, bool) {
	if !legalIgnoringResult(s, cmd) {
		return 0, false
	}
	est := publicHandEstimate(s, victim)
	total := 0.0
	for _, r := range board.Resources {
		total += est[r]
	}
	if total <= 0 {
		return 0, false
	}
	// Priced on the neutral opponent scale (oppNeutralWeight) and returned as a
	// delta on the bot's own scale. The steal is the only fish spend that moves
	// an opponent, so at Weights.Opp it would get a 9.6x denial credit no other
	// rung gets. Other candidates leave the opponent term alone, so their deltas
	// are nearly the same on both scales, and bestPlay can compare them.
	pricer := b.neutralPricer()
	nbase := pricer.eval(s, seat)
	exp := 0.0
	for _, r := range board.Resources {
		if est[r] <= 0 {
			continue
		}
		c := s.Clone()
		payFish(c, seat, fishStealCost)
		c.Players[seat].Hand[r]++
		c.Players[victim].Hand[r]--
		exp += est[r] / total * pricer.eval(c, seat)
	}
	return b.eval(s, seat) + (exp - nbase), true
}

// expectedFishDevValue prices the 7-fish development card over the deck's
// composition, which is public by counting, rather than over the card the draw
// would actually yield, which is not.
func (b *Strong) expectedFishDevValue(s *engine.State, seat engine.PlayerID, cmd engine.Command) (float64, bool) {
	if !legalIgnoringResult(s, cmd) {
		return 0, false
	}
	total := s.DevDeck.Count()
	if total == 0 {
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
		payFish(c, seat, fishDevCardCost)
		c.Players[seat].NewDevCards[card]++
		c.DevDeck[card]--
		exp += float64(n) / float64(total) * b.eval(c, seat)
	}
	return exp, true
}

// passBoot hands the old boot to the strongest player allowed to receive it.
//
// The boot's holder needs one extra victory point to win (the module's
// WinThresholdDelta), and may pass it after rolling to anyone doing at least as
// well on public VP.
//
// A rule rather than a scored candidate: the handicap is in the win threshold,
// which the evaluator does not read, and passing it is never worse.
func (b *Strong) passBoot(s *engine.State, seat engine.PlayerID) (engine.Command, bool) {
	if b.keepBoot {
		return engine.Command{}, false
	}
	x, ok := scenarios.FishStateExt(s)
	if !ok || x.BootHolder != seat {
		return engine.Command{}, false
	}
	// The pass is only legal on an actionable turn: decideGiveBoot gates on
	// RequireActionableTurn, which rejects while a module pending blocks
	// (Islands gold, a Knights choice, a Caravans vote). Act tries the pass
	// right after the roll, so decline here, let the pending resolve, and retry
	// on the next Act.
	if engine.RequireActionableTurn(s, seat) != nil {
		return engine.Command{}, false
	}
	mine := s.PublicVPWithModules(seat)
	best, bestVP := engine.NoPlayer, -1
	for p := range s.Players {
		q := engine.PlayerID(p)
		if q == seat {
			continue
		}
		// Eligibility mirrors decideGiveBoot: at least as well as us, on the same
		// module-aware VP the win check compares.
		vp := s.PublicVPWithModules(q)
		if vp < mine {
			continue
		}
		// Hand it to whoever is furthest ahead: same relief for us, most drag on
		// the player closest to winning.
		if vp > bestVP {
			best, bestVP = q, vp
		}
	}
	if best == engine.NoPlayer {
		return engine.Command{}, false
	}
	return engine.Command{Player: seat, Type: scenarios.CmdGiveBoot,
		Data: raw2(map[string]any{"to": best})}, true
}

// fishTopRung is the last rung of the fish ladder: seven fish for a free
// development card.
const fishTopRung = fishDevCardCost

// fishRungFloor is the cheapest rung the bot may spend at right now.
//
// The evaluator cannot keep the top rung reachable: a two-fish spend at six
// fish costs the development card, which it prices at zero, and a hold value
// does not fix that (see the note on the fish ladder). So, as a rule: with five
// or six fish and the development deck live, only the five-fish rung may be
// spent. With it, seat-games reaching seven fish went from 65 in 400 to 140.
//
// It does not force the climb (the free road is still offered at five and six),
// does not touch a seat below five, and does nothing when the deck is empty or
// the ruleset has no development cards (e.g. base+cak+fishermen), where gating
// toward the top rung would strand fish.
func (b *Strong) fishRungFloor(s *engine.State, have int) int {
	if b.noFishGate || b.noFishChance {
		return 0 // the chance rungs are off, so the top rung is not on the table
	}
	if have < 5 || have >= fishTopRung {
		return 0
	}
	if engine.DevCardsDisabled(s) || s.DevDeck.Count() == 0 {
		return 0
	}
	return fishTopRung
}
