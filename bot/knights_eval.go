package bot

import (
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/knights"
)

// knightsActive memoizes whether the Knights module is in the ruleset. The ruleset
// is fixed for the life of a game, so the scan runs at most once per bot.
func (b *Strong) knightsActive(s *engine.State) bool {
	if b.knightsOn == nil {
		on := false
		for _, m := range s.Modules() {
			if m.Name() == knights.Name {
				on = true
				break
			}
		}
		b.knightsOn = &on
	}
	return *b.knightsOn
}

// knightsImproveValue is the non-VP positional worth of a city-improvement track at
// each level, indexed by level (0..maxImprovement). Monotone, with the largest
// jump at level 3 (unlocks the discipline's special ability and level-3 knights
// via Politics). The metropolis at level 4 carries +2 victory points, which
// the base eval already counts through PublicVPWithModules, so these numbers
// price only the infrastructure. The table is scaled by Weights.KnightsImprove so
// ablation and sweeps reach it.
var knightsImproveValue = [knights.MaxImprovement + 1]float64{0, 1.2, 2.8, 6.0, 7.0, 9.0}

// The Knights weights live in bot.Weights (KnightsImprove, KnightsLevel and friends),
// so the ablation and sweep machinery reaches them.

// knightsEval adds the Knights-specific positional value for player p:
// improvements, the commodity engine, knight strength, barbarian defense,
// progress-card optionality and walls. It never re-counts module victory points
// (metropolis/defender/merchant), which the base VP term already includes.
// viewer is the seat reasoning: held commodities are hidden information and
// count only for the viewer's own position (docs/bots.md). Production capacity,
// improvements, knights and walls are public.
func (b *Strong) knightsEval(s *engine.State, p, viewer engine.PlayerID) float64 {
	x := knights.Read(s)
	if int(p) >= len(x.Players) {
		return 0
	}
	px := x.Players[p]
	score := 0.0

	// A metropolis earned but not yet placed is worth its 2 VP, and nothing else
	// counts it: with two or more metropolis-free cities (55% of grants) the
	// engine emits EvMetropolisPending and leaves Metropolis[track] false until
	// a city is chosen.
	if mp := x.MetropolisPending; mp != nil && mp.Player == p && !b.noPendingMetro {
		score += 2 * b.w.VP
	}

	// Improvement tracks (Trade/Politics/Science).
	for t := range knights.Track(3) {
		lvl := px.Improve[t]
		if lvl < 0 || lvl > knights.MaxImprovement {
			continue
		}
		score += b.w.KnightsImprove * knightsImproveValue[lvl]
	}

	// Commodity engine: production capacity (commodity-yielding cities) plus held
	// commodities that feed an affordable next improvement.
	score += b.w.KnightsCommodCap * b.commodityCapacity(s, p)
	for t := range knights.Track(3) {
		lvl := px.Improve[t]
		if lvl >= knights.MaxImprovement {
			continue
		}
		need := knights.ImproveCost(lvl)
		if p != viewer {
			continue // an opponent's commodity holdings are hidden
		}
		have := min(px.Commodities[t.Commodity()], need)
		score += b.w.KnightsCommodHold * float64(have)
	}

	// Knight strength, weighted up as the barbarians near landfall.
	imm := b.barbarianImminence(s, x)
	active, inactive := x.KnightLevels(p)
	score += b.w.KnightsLevel * (float64(active) + b.w.KnightsInactive*float64(inactive)) * (0.5 + imm)

	// Barbarian risk / reward at the next landfall.
	score += b.barbarianTerm(s, x, p, imm)

	// Progress cards in hand (optionality), diminishing past the keepable hand.
	if n := len(px.Progress); n > 0 {
		if n > knights.ProgressHandSize {
			n = knights.ProgressHandSize
		}
		score += b.w.KnightsProgress * float64(n)
	}

	// City walls: pillage/discard insurance.
	score += b.w.KnightsWall * float64(px.Walls)

	return score
}

// commodityCapacity sums the pip weight of player p's cities sitting on
// commodity-yielding terrain: the throughput of p's commodity engine.
func (b *Strong) commodityCapacity(s *engine.State, p engine.PlayerID) float64 {
	capVal := 0.0
	for v, bld := range s.Buildings {
		if bld.Owner != p || !bld.City {
			continue
		}
		for _, h := range v.Hexes() {
			t, ok := s.Board.Tiles[h]
			if !ok || !t.Res.Producing() {
				continue
			}
			if _, isCommodity := knights.CommodityFor(t.Res); isCommodity {
				capVal += float64(pips(t.Number))
			}
		}
	}
	return capVal
}

// barbarianImminence is 0 when the fleet is at its start and ramps toward 1 as it
// nears landfall, squared so the pressure concentrates in the final steps. It
// uses the game's configured fleet distance, not a fixed constant.
func (b *Strong) barbarianImminence(s *engine.State, x *knights.Ext) float64 {
	dist := knights.BarbarianDistance(s)
	if dist <= 0 {
		dist = knights.BarbarianTrack
	}
	f := float64(x.Barbarians) / float64(dist)
	if f < 0 {
		f = 0
	}
	if f > 1 {
		f = 1
	}
	return f * f
}

// barbarianTerm rewards being the likely sole defender (who takes the Defender
// VP) and, more heavily, penalizes being the player who would lose a city
// when the city side is under-defended. Both scale with imminence so the
// bot ignores the fleet early and scrambles to defend as it nears.
func (b *Strong) barbarianTerm(s *engine.State, x *knights.Ext, p engine.PlayerID, imm float64) float64 {
	n := len(s.Players)
	perActive := make([]int, n)
	totalActive := 0
	for _, k := range x.Knights {
		if k.Active && int(k.Owner) < n {
			perActive[k.Owner] += k.Level
			totalActive += k.Level
		}
	}
	cities, perCities := 0, make([]int, n)
	for _, bld := range s.Buildings {
		if bld.City && int(bld.Owner) < n {
			cities++
			perCities[bld.Owner]++
		}
	}
	if cities == 0 {
		return 0
	}

	// A player can lose a city only if they hold a non-metropolis ("downgradable")
	// city; metropolis cities are immune.
	downgradable := func(q int) bool {
		metros := 0
		for t := range knights.Track(3) {
			if x.Players[q].Metropolis[t] {
				metros++
			}
		}
		return perCities[q] > metros
	}

	if totalActive >= cities {
		// Defense holds: the unique strongest contributor takes the Defender VP.
		top, topQ, ties := -1, -1, 0
		for q := range n {
			switch {
			case perActive[q] > top:
				top, topQ, ties = perActive[q], q, 1
			case perActive[q] == top:
				ties++
			}
		}
		if topQ == int(p) && top > 0 && ties == 1 {
			return b.w.KnightsDefender * imm
		}
		return 0
	}

	// Defense fails: the weakest downgradable contributor(s) lose a city.
	weakest := 1 << 30
	for q := range n {
		if downgradable(q) && perActive[q] < weakest {
			weakest = perActive[q]
		}
	}
	if downgradable(int(p)) && perActive[p] == weakest {
		return -b.w.KnightsCityLoss * imm
	}
	return 0
}

// producesCommodity reports whether p has a city on a hex yielding commodity c.
// Buildings and the board are public, so this is the fair stand-in for reading
// how many of that commodity p is actually holding.
func producesCommodity(s *engine.State, p engine.PlayerID, c knights.Commodity) bool {
	for v, bld := range s.Buildings {
		if bld.Owner != p || !bld.City {
			continue
		}
		for _, h := range v.Hexes() {
			t, ok := s.Board.Tiles[h]
			if !ok || !t.Res.Producing() {
				continue
			}
			if cc, isCommodity := knights.CommodityFor(t.Res); isCommodity && cc == c {
				return true
			}
		}
	}
	return false
}
