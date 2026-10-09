package sim

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/explorers"
	"github.com/ftqo/costan.io/engine/knights"
)

// checkPieceConservation asserts that every piece is somewhere: on the board or
// in its owner's supply, never both and never neither. checkRuleInvariants only
// checks supplies are non-negative, which catches a missing piece but not a
// duplicated one (e.g. a laid-down city upgraded back crediting a settlement
// that never left supply; SettlementsLeft gates building, so that would be a
// real extra settlement).
//
// Explorers correction: a harbour settlement is a base settlement in
// State.Buildings but comes from its own supply, and its upgrade returns the
// settlement piece, so it reads as a settlement no settlement piece paid for.
//
// Knights correction (knights.LaidCityCount): a laid city is a city piece standing
// in for a settlement, so it reads as a settlement while having come from the
// city supply (which razeCity credited back, so a player at the city cap can
// still restore it).
func checkPieceConservation(t *testing.T, s *engine.State, ruleset string) {
	t.Helper()
	roads := make([]int, len(s.Players))
	setts := make([]int, len(s.Players))
	cities := make([]int, len(s.Players))
	for _, owner := range s.Roads {
		roads[owner]++
	}
	for _, b := range s.Buildings {
		if b.City {
			cities[b.Owner]++
		} else {
			setts[b.Owner]++
		}
	}
	for p := range s.Players {
		ps := s.Players[p]
		seat := engine.PlayerID(p)
		laid := knights.LaidCityCount(s, seat)
		harbours := explorersHarbours(s, seat)
		if got := roads[p] + ps.RoadsLeft; got != engine.MaxRoads {
			t.Fatalf("%s: player %d roads not conserved: %d on board + %d left = %d (want %d)",
				ruleset, p, roads[p], ps.RoadsLeft, got, engine.MaxRoads)
		}
		if got := setts[p] - laid - harbours + ps.SettlementsLeft; got != engine.MaxSettlements {
			t.Fatalf("%s: player %d settlements not conserved: %d on board - %d laid - %d harbour + %d left = %d (want %d)",
				ruleset, p, setts[p], laid, harbours, ps.SettlementsLeft, got, engine.MaxSettlements)
		}
		// And the module's own supplies, which nothing else counts.
		if x, ok := explorers.StateExt(s); ok {
			if got := harbours + x.Seats[p].HarboursLeft; got != explorers.MaxHarbours {
				t.Fatalf("%s: player %d harbour settlements not conserved: %d on board + %d left = %d (want %d)",
					ruleset, p, harbours, x.Seats[p].HarboursLeft, got, explorers.MaxHarbours)
			}
			if got := explorersShips(s, seat) + x.Seats[p].ShipsLeft; got != explorers.MaxShips {
				t.Fatalf("%s: player %d ships not conserved: %d on board + %d left = %d (want %d)",
					ruleset, p, explorersShips(s, seat), x.Seats[p].ShipsLeft, got, explorers.MaxShips)
			}
		}
		if got := cities[p] + ps.CitiesLeft; got != engine.MaxCities {
			t.Fatalf("%s: player %d cities not conserved: %d on board + %d left = %d (want %d)",
				ruleset, p, cities[p], ps.CitiesLeft, got, engine.MaxCities)
		}
	}
}

// explorersHarbours is how many of seat's buildings are harbour settlements, and
// explorersShips how many of its hulls are on the water. Both are zero for every
// other ruleset.
func explorersHarbours(s *engine.State, seat engine.PlayerID) int {
	x, ok := explorers.StateExt(s)
	if !ok {
		return 0
	}
	n := 0
	for _, owner := range x.Harbours {
		if owner == seat {
			n++
		}
	}
	return n
}

func explorersShips(s *engine.State, seat engine.PlayerID) int {
	x, ok := explorers.StateExt(s)
	if !ok {
		return 0
	}
	return len(explorers.ShipsOf(x, seat))
}
