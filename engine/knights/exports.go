package knights

import (
	"slices"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// The read-only surface the module exposes outside the package (notably the
// bot's Knights evaluation), so consumers can inspect the position without
// mutating engine-owned state.

// Exported rule constants mirror the unexported ones the state machine uses.
const (
	BarbarianTrack   = barbarianTrack   // ship steps from start to a landfall
	MetropolisLevel  = metropolisLevel  // improvement level that grants a metropolis
	MaxImprovement   = maxImprovement   // highest city-improvement level
	MaxKnightLevel   = maxKnightLevel   // mighty knight
	ProgressHandSize = progressHandSize // progress cards kept without a forced discard
)

// Read returns the module state for inspection. It never stores, and yields a
// fresh empty Ext when the game has not touched module state yet, so callers can
// read unconditionally.
func Read(s *engine.State) *Ext { return extRO(s) }

// StateExt returns the cak module's ext state for s and whether the cak module
// is active. Read-only: callers outside the fold must not mutate it. Returns
// (nil, false) when the cak module is not active.
func StateExt(s *engine.State) (*Ext, bool) {
	e, ok := s.Ext[Name].(*Ext)
	return e, ok
}

// BarbarianDistance is the effective number of ship advances before the fleet
// lands for this game: the configured override when in range, else
// BarbarianTrack. Use this rather than the constant.
func BarbarianDistance(s *engine.State) int { return configFrom(s.Config).barbarianDistance() }

// SacrificeCities lists the cities player p may hand the barbarians right now,
// nil unless p owes the choice. It is the set CmdBarbarianDowngrade validates
// against, so a bot picking from it is never rejected.
func SacrificeCities(s *engine.State, p engine.PlayerID) []board.Vertex {
	x := extRO(s)
	if !slices.Contains(x.PendingDowngrade, p) {
		return nil
	}
	return (Module{}).downgradableCities(s, x, p)
}

// MetropolisChoice reports the metropolis player p has earned but not yet
// placed and the cities it may go on; nil/false unless p owes the choice now.
// The vertex list is the set CmdMetropolisPick validates against.
func MetropolisChoice(s *engine.State, p engine.PlayerID) (MetropolisPick, []board.Vertex, bool) {
	x := extRO(s)
	pick := x.MetropolisPending
	if pick == nil || pick.Player != p {
		return MetropolisPick{}, nil, false
	}
	return *pick, (Module{}).freeCities(s, x, p), true
}

// ImproveCost is the commodity cost to advance a track from level to level+1
// (the cost equals the destination level). Crane and other discounts are applied
// by the engine at decision time and are not reflected here.
func ImproveCost(level int) int { return level + 1 }

// Commodity is the currency a track consumes (Trade→Cloth, Politics→Coin,
// Science→Paper).
func (t Track) Commodity() Commodity { return commodityForTrack(t) }

// CommodityFor maps a producing terrain to the commodity its cities yield
// (sheep→cloth, wood→paper, ore→coin); ok is false for terrain that yields none.
func CommodityFor(r board.Resource) (Commodity, bool) { return commodityFor(r) }

// AttackStrength is the barbarians' strength at the next landfall: the number
// of cities on the board, whoever owns them, metropolis cities included.
// Exported because cak+explorers rule E (all cities, starting island and
// discovered areas, harbour settlements excluded) is pinned in engine/ruletest.
func AttackStrength(s *engine.State) int { return attackStrength(s) }

// attackStrength is the count itself. A harbour settlement is a base settlement
// plus module state, so it is never `b.City` and is excluded automatically.
func attackStrength(s *engine.State) int {
	n := 0
	for _, b := range s.Buildings {
		if b.City {
			n++
		}
	}
	return n
}

// ActiveStrength is the sum of player p's active knight levels, p's share of
// the defense at the next barbarian landfall.
func (e *Ext) ActiveStrength(p engine.PlayerID) int {
	n := 0
	for _, k := range e.Knights {
		if k.Active && k.Owner == p {
			n += k.Level
		}
	}
	return n
}

// KnightLevels totals player p's knight levels split by activation state.
func (e *Ext) KnightLevels(p engine.PlayerID) (active, inactive int) {
	for _, k := range e.Knights {
		if k.Owner != p {
			continue
		}
		if k.Active {
			active += k.Level
		} else {
			inactive += k.Level
		}
	}
	return active, inactive
}

// LaidCityCount is how many of player p's cities are lying on their side:
// pillaged with no settlement piece in supply, so the city piece stays and
// stands in for a settlement until upgraded back. It corrects both piece
// ledgers:
//
//	settlementsOnBoard - laid + SettlementsLeft == MaxSettlements
//	citiesOnBoard      + CitiesLeft            == MaxCities
//
// (the city slot is returned to supply when the piece is laid, so a player at
// the city cap can stand their own laid city back up).
func LaidCityCount(s *engine.State, p engine.PlayerID) int {
	x, ok := StateExt(s)
	if !ok {
		return 0
	}
	return laidCount(s, x, p)
}
