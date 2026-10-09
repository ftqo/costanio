package sim

import (
	"encoding/json"
	"strconv"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/islands"
	"github.com/ftqo/costan.io/engine/rivers"
	"github.com/ftqo/costan.io/engine/scenarios"
)

// Three scenario invariants:
//
//   - The longest route the engine credits equals what an independent walker
//     finds over the same roads, ships, camels and bridges. A route crossing
//     from a camel-doubled road onto a ship chain must score the combined
//     length, not the larger of the two modules' numbers.
//   - The old boot's holder is a seated player once the boot is in play.
//   - The public fish tile count per seat equals the tiles that seat holds on
//     the truth fold (FishExt.Tiles is folded from the public halves of each
//     catch, Held from the private halves, so they can only be compared on a
//     fold that saw both). The value is not published (see FishExt.Tiles), so
//     it is not compared.
//
// checkScenarioInvariants is called from checkRuleInvariants, so the adversarial
// games check all three at every step; TestScenarioInvariantsInBotGames checks them
// again over full Strong-bot logs, including each game's final state.

// bruteRoute is an independent longest-route walker: edge-keyed maps, its own
// DFS, and its own reading of the rules (a route changes between road and
// ship only at the player's own building; an opponent's building or a module
// blocker at a vertex cuts the route there; any path a camel walks beside
// counts twice; a bridge is a road). It shares nothing with engine/route.go but
// the state it reads.
//
// A camel beside a ship doubles it too ("a ship is equivalent to a road"), so
// the camel pass runs last, after roads and ships. The engine gets the same
// ordering by doubling in a RouteWeights pass after every module's RouteEdges.
func bruteRoute(s *engine.State, p engine.PlayerID) int {
	const (
		road = iota
		ship
	)
	kind := map[board.Edge]int{}
	weight := map[board.Edge]int{}
	for e, owner := range s.Roads {
		if owner == p {
			kind[e], weight[e] = road, 1
		}
	}
	if ix, ok := islands.StateExt(s); ok {
		for e, owner := range ix.Ships {
			if owner == p {
				kind[e], weight[e] = ship, 1
			}
		}
	}
	// A Rivers bridge is a road segment ("counts as a road segment for the
	// longest route"): it joins roads freely at either vertex and joins ships
	// only through the owner's own building.
	if rx, ok := rivers.StateExt(s); ok {
		for e, owner := range rx.Bridges {
			if owner == p {
				kind[e], weight[e] = road, 1
			}
		}
	}
	if cx, ok := scenarios.CaravansStateExt(s); ok {
		for e := range kind {
			if cx.Occupied[e] {
				weight[e] = 2
			}
		}
	}
	best := 0
	visited := map[board.Edge]bool{}
	var walk func(at board.Vertex, prev int, length int)
	walk = func(at board.Vertex, prev int, length int) {
		best = max(best, length)
		b, built := s.Buildings[at]
		if built && b.Owner != p {
			return
		}
		if s.VertexBlocked(at, p) {
			return
		}
		for _, e := range at.Edges() {
			k, owned := kind[e]
			if !owned || visited[e] {
				continue
			}
			if prev >= 0 && k != prev && !(built && b.Owner == p) {
				continue
			}
			visited[e] = true
			walk(e.Other(at), k, length+weight[e])
			visited[e] = false
		}
	}
	for e := range kind {
		walk(e.A, -1, 0)
		walk(e.B, -1, 0)
	}
	return best
}

// checkScenarioInvariants asserts the three invariants above on s. label names the
// game for the failure message.
func checkScenarioInvariants(t *testing.T, s *engine.State, label string) {
	t.Helper()
	for p := range s.Players {
		pid := engine.PlayerID(p)
		if got, want := engine.LongestRouteLength(s, pid), bruteRoute(s, pid); got != want {
			t.Fatalf("%s: seat %d longest route = %d, brute force = %d",
				label, p, got, want)
		}
	}
	if fx, ok := scenarios.FishStateExt(s); ok {
		if fx.BootInPlay && (fx.BootHolder < 0 || int(fx.BootHolder) >= len(s.Players)) {
			t.Fatalf("%s: boot holder %d out of range (%d seats)",
				label, fx.BootHolder, len(s.Players))
		}
		if !fx.BootInPlay && fx.BootHolder != engine.NoPlayer {
			t.Fatalf("%s: boot not in play but held by seat %d", label, fx.BootHolder)
		}
		for p := range fx.Held {
			if p >= len(fx.Tiles) {
				t.Fatalf("%s: seat %d holds fish but has no public tile count", label, p)
			}
			if want := scenarios.FishTileCount(fx.Held[p]); fx.Tiles[p] != want {
				t.Fatalf("%s: seat %d public fish tile count %d, holding is %d tiles (%v)",
					label, p, fx.Tiles[p], want, fx.Held[p])
			}
			// The holding limit counts tiles, not fish ("if you already have 7 fish
			// tokens and would obtain another, you may exchange one of your 1-fish
			// tokens for a fresh draw"). A seat over the cap means a catch drew
			// with no room or an exchange didn't return a tile first; the value
			// totals above can't show either.
			if n := scenarios.FishTileCount(fx.Held[p]); n > scenarios.FishTileCap {
				t.Fatalf("%s: seat %d holds %d fish tiles (%v), over the %d-tile cap",
					label, p, n, fx.Held[p], scenarios.FishTileCap)
			}
		}
	}
}

// TestScenarioInvariantsInBotGames plays Strong-bot games under every scenario
// combination that composes a route (Islands with Caravans), fishes (Fishermen)
// or does all of it at once, and asserts the invariants at every step and on
// the final state. The batch narrows under -race like supplySeeds.
func TestScenarioInvariantsInBotGames(t *testing.T) {
	st := openStore(t)
	rulesets := canonical([]string{
		"base+islands+caravans",
		"base+fishermen",
		"base+islands+fishermen",
		"base+islands+cak+fishermen+caravans",
	})
	mixed := 0 // seats whose final route uses both a ship and a camel-doubled road
	shipsBuilt, camelsPlaced, boots := 0, 0, 0
	for _, rs := range rulesets {
		for _, seed := range supplySeeds() {
			events := botGame(t, rs, seed, st)
			label := rs + " seed " + strconv.FormatUint(seed, 10)
			final := foldChecked(t, events, func(s *engine.State, e engine.Event, next engine.EventType) {
				// Mid-transaction: the public total has moved with the catch and the
				// per-seat gains are still queued. Wait for the batch to close.
				if next == scenarios.EvFishGained {
					return
				}
				checkScenarioInvariants(t, s, label+" seq "+strconv.Itoa(e.Seq)+" ("+string(e.Type)+")")
			})
			checkScenarioInvariants(t, final, label+" final")
			for p := range final.Players {
				pid := engine.PlayerID(p)
				if routeUsesShipAndCamel(final, pid) {
					mixed++
				}
			}
			for _, e := range events {
				switch e.Type {
				case islands.EvShipBuilt:
					shipsBuilt++
				case scenarios.EvCamelPlaced:
					camelsPlaced++
				case scenarios.EvFishCaught:
					// The boot enters play on the catch that draws it.
					var d struct {
						BootTo engine.PlayerID `json:"boot_to"`
					}
					if json.Unmarshal(e.Data, &d) == nil && d.BootTo != engine.NoPlayer {
						boots++
					}
				default:
					// a tally, not a dispatch
				}
			}
		}
	}
	t.Logf("%d ships built, %d camels placed, %d boots drawn, %d seats with ship and camel on one route",
		shipsBuilt, camelsPlaced, boots, mixed)
	// The checks prove nothing unless ships, camels and the boot actually
	// appeared.
	if shipsBuilt == 0 {
		t.Fatal("no ship built in any Islands game")
	}
	if camelsPlaced == 0 {
		t.Fatal("no camel placed in any Caravans game")
	}
	if boots == 0 {
		t.Fatal("boot never drawn in any Fishermen game")
	}
}

// routeUsesShipAndCamel reports whether seat p owns both a ship and a road a
// camel walks beside. A coarse "the composition was exercised"; logged, not
// asserted.
func routeUsesShipAndCamel(s *engine.State, p engine.PlayerID) bool {
	ix, ok := islands.StateExt(s)
	if !ok {
		return false
	}
	cx, ok := scenarios.CaravansStateExt(s)
	if !ok {
		return false
	}
	hasShip := false
	for _, owner := range ix.Ships {
		if owner == p {
			hasShip = true
			break
		}
	}
	if !hasShip {
		return false
	}
	for e, owner := range s.Roads {
		if owner == p && cx.Occupied[e] {
			return true
		}
	}
	return false
}
