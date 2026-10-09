package islands

import (
	"slices"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// The start-island setting, GameConfig.Modules["islands"].start_island.
const (
	// StartAuto confines the starting settlements (and the Knights setup city)
	// to the main island when the board has one, and allows any island when it
	// does not. It is the default: an empty or unknown value reads as auto.
	StartAuto = "auto"
	// StartAny allows a starting settlement on any island, main island or not.
	StartAny = "any"
)

// The main-island thresholds. A landmass is the main island when it is the
// largest and both hold:
//
//   - it has at least mainRatio times the land of the next largest landmass, and
//   - it holds more than mainShare (one half) of all the land on the board.
//
// The ratio alone would call a 10-hex island main on a board of 10 + 5x5 hexes,
// where it holds 29% of the land. The share alone would call a 51/49 split a
// main island. If either fails, the board is an archipelago and any island is a
// legal start.
//
// See docs/rules/islands.md for the measurements: every procedural Islands
// board has a ratio of at least 5.5 and a share of at least 0.76; curated maps
// with an obvious home island clear both (Japan, the tightest, is 2.8x and
// 67%), and Archipelago (six islands of 5 or 6 hexes) is 1.0x and 19%.
const (
	mainRatio = 2
	mainShare = 2 // largest*mainShare > total: more than half of all land
)

// MainIsland returns the land hexes of the board's main island, sorted, or nil
// when no landmass qualifies (see mainRatio). It is a pure function of the
// board's land: which hexes are land and how they connect, nothing about
// resources, numbers or the seed. A board that is one landmass has that
// landmass as its main island, trivially.
//
// "Land" is board.Land, so gold, desert and a Fishermen lake all count, and
// components are board.Islands(), the same labelling the island chip is
// awarded by.
func MainIsland(b *board.Board) []board.Hex {
	if b == nil {
		return nil
	}
	comp := b.Islands()
	sizes := map[int]int{}
	for _, id := range comp {
		sizes[id]++
	}
	total, best, bestID, second := 0, 0, -1, 0
	for id, n := range sizes {
		total += n
		switch {
		case n > best:
			second = best
			best, bestID = n, id
		case n > second:
			second = n
		}
	}
	if bestID < 0 || best < mainRatio*second || best*mainShare <= total {
		return nil
	}
	out := make([]board.Hex, 0, best)
	for h, id := range comp {
		if id == bestID {
			out = append(out, h)
		}
	}
	slices.SortFunc(out, func(a, b board.Hex) int {
		if a.Q != b.Q {
			return a.Q - b.Q
		}
		return a.R - b.R
	})
	return out
}

// StartIsland is the set of land hexes a starting settlement must touch in
// this game, or nil when any island will do: the host chose "any", or the
// board has no main island.
func StartIsland(s *engine.State) map[board.Hex]bool {
	if configFrom(s.Config).StartIsland == StartAny {
		return nil
	}
	main := MainIsland(s.Board)
	if main == nil {
		return nil
	}
	set := make(map[board.Hex]bool, len(main))
	for _, h := range main {
		set[h] = true
	}
	return set
}

// blocksNewSettlement is the start-island rule: during setup, a settlement (or
// the Knights setup city, which is placed by the same command) must touch the
// main island when StartIsland names one. It is a Hooks.BlocksNewConstruction,
// so the setup command, LegalSettlements, auto-pass and every bot that asks
// engine.CheckSettlementSpot see the same answer.
//
// A vertex touches at most one landmass: its three hexes are pairwise adjacent,
// so any two land hexes among them are in the same component. "Touches the
// main island" is therefore "is on the main island", with no coastal corner
// that belongs to two.
func blocksNewSettlement(s *engine.State, v board.Vertex) bool {
	if s.Phase != engine.PhaseSetup {
		return false
	}
	start := StartIsland(s)
	if start == nil {
		return false
	}
	for _, h := range v.Hexes() {
		if start[h] {
			return false
		}
	}
	return true
}
