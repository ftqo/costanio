package scenarios

import (
	"errors"
	"slices"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// Fishermen bullets of docs/rules/scenarios.md: the supply composition, the "no
// draws if short" guard and the pile it counts, the robber's (non-)effect on a
// catch, the fewest-tiles tiebreak in spendTiles, fish not being resources, and
// the order ground numbers are dealt. Each was confirmed by mutating the rule.
//
// State is constructed, not found by seed hunting, so these cannot silently stop
// running when board generation changes.

// fishState builds a base+fishermen game in the play phase with the fish ext in
// a known state: an empty supply, no held tiles, and grounds as the board dealt
// them.
func fishState(t *testing.T, seed uint64) (*engine.State, *FishExt) {
	t.Helper()
	s, _ := newGame(t, "base+fishermen", seed)
	s.Phase = engine.PhasePlay
	s.Rolled = true
	return s, fishExt(s)
}

// TestFishSupplyComposition: 11 one-fish, 10 two-fish and 8 three-fish tiles, 29
// in all. Other rules are priced against these counts ("no draws if short" and the
// boot's entry gate over TilesLeft).
func TestFishSupplyComposition(t *testing.T) {
	if fishSupply != [3]int{11, 10, 8} {
		t.Fatalf("fishSupply = %v, want [11 10 8] (docs/rules/scenarios.md)", fishSupply)
	}
	total := fishSupply[0] + fishSupply[1] + fishSupply[2]
	if total != 29 {
		t.Fatalf("supply holds %d tiles, want 29", total)
	}
	if got := fishTotal(fishSupply); got != 11*1+10*2+8*3 {
		t.Fatalf("supply is worth %d fish, want %d", got, 11+20+24)
	}
	// And a fresh game starts from exactly that, with nothing spent.
	_, x := fishState(t, 3)
	if x.Supply != fishSupply {
		t.Fatalf("a new game starts with supply %v, want %v", x.Supply, fishSupply)
	}
	if x.Used != [3]int{} {
		t.Fatalf("a new game starts with %v tiles already spent", x.Used)
	}
}

// TestNoDrawsIfSupplyIsShort: if the supply cannot cover everyone's draws that
// roll, no one draws. The count compared is supply plus the spent pile, since
// spent tiles reshuffle back when the supply empties: two tiles in supply and six
// used can cover a draw of eight.
func TestNoDrawsIfSupplyIsShort(t *testing.T) {
	cases := []struct {
		name     string
		supply   [3]int
		used     [3]int
		builders int // settlements planted on the ground, one draw each
		want     bool
	}{
		{"supply covers the draw", [3]int{3, 0, 0}, [3]int{}, 3, true},
		{"supply one short", [3]int{2, 0, 0}, [3]int{}, 3, false},
		{"empty supply, spent pile covers it", [3]int{}, [3]int{3, 0, 0}, 3, true},
		{"split across supply and spent pile", [3]int{1, 0, 0}, [3]int{0, 1, 1}, 3, true},
		{"both piles together are one short", [3]int{1, 0, 0}, [3]int{0, 1, 0}, 3, false},
		{"nothing anywhere", [3]int{}, [3]int{}, 1, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s, x := fishState(t, 3)
			g := x.Grounds[0]
			if len(g.V) < 1 {
				t.Fatal("the first fishing ground has no coastal vertex")
			}
			// Plant plain settlements on the ground's own vertices, one draw
			// each, so the number of draws is exactly tc.builders.
			planted := 0
			for _, v := range g.V {
				if planted == tc.builders {
					break
				}
				s.Buildings[v] = engine.Building{Owner: 0}
				planted++
			}
			if planted < tc.builders {
				// Two vertices of a ground are adjacent, so a third draw comes from a
				// city on one of them.
				s.Buildings[g.V[0]] = engine.Building{Owner: 0, City: true}
				planted++
			}
			if planted != tc.builders {
				t.Fatalf("could not construct %d draws (got %d) on a ground with %d vertices",
					tc.builders, planted, len(g.V))
			}
			x.Supply, x.Used = tc.supply, tc.used
			events := fishCatch(s, g.Number-1, 1)
			if got := len(events) > 0; got != tc.want {
				t.Fatalf("a %d-draw catch against supply %v + used %v produced %d events; want any = %v",
					tc.builders, tc.supply, tc.used, len(events), tc.want)
			}
		})
	}
}

// TestRobberAdjacentToAGroundDoesNotBlockIt: a fishing ground is a notch in a sea
// hex and the robber cannot stand on sea. On a land hex sharing the ground's
// intersections it blocks that hex's resources only; the ground still pays fish
// to every building on it. The lake case is TestRobberBlocksTheLake.
func TestRobberAdjacentToAGroundDoesNotBlockIt(t *testing.T) {
	s, x := fishState(t, 3)
	g := x.Grounds[0]
	v := g.V[0]
	s.Buildings[v] = engine.Building{Owner: 0}
	// The land hex the settlement sits on: the closest a robber can get to a
	// fishing ground, since the ground itself is a sea notch.
	placed := false
	for _, h := range v.Hexes() {
		if s.Board.Land(h) {
			s.Board.Robber = h
			placed = true
			break
		}
	}
	if !placed {
		t.Fatalf("fixture: no land hex at %v", v)
	}
	if events := fishCatch(s, g.Number-1, 1); len(events) == 0 {
		t.Fatalf("ground %d paid nothing with the robber on %v", g.Number, s.Board.Robber)
	}
}

// TestSpendTilesMinimisesWasteThenTileCount: no change is given, so a spend
// minimises wasted fish first and, among equal waste, hands in the fewest tiles.
// The frontend has the same rule in frontend/src/lib/fish.test.ts.
func TestSpendTilesMinimisesWasteThenTileCount(t *testing.T) {
	cases := []struct {
		name string
		held [3]int
		cost int
		want [3]int
	}{
		{"exact with one tile", [3]int{0, 0, 1}, 3, [3]int{0, 0, 1}},
		{"exact beats a smaller waste-free pile", [3]int{3, 0, 1}, 3, [3]int{0, 0, 1}},
		{"fewest tiles at equal waste: 2+2 over 1+1+2", [3]int{2, 2, 0}, 4, [3]int{0, 2, 0}},
		{"fewest tiles at equal waste: two 3s over 3+2+1", [3]int{1, 1, 2}, 6, [3]int{0, 0, 2}},
		// Two ones waste nothing; the single three would waste one. Waste is the
		// first key, so the two-tile answer wins over the one-tile answer.
		{"waste wins over tile count", [3]int{2, 0, 1}, 2, [3]int{2, 0, 0}},
		{"overpayment when no exact change exists", [3]int{0, 0, 1}, 2, [3]int{0, 0, 1}},
		{"cheapest overpayment of several", [3]int{0, 1, 1}, 1, [3]int{0, 1, 0}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := spendTiles(tc.held, tc.cost)
			if got != tc.want {
				t.Fatalf("spendTiles(%v, %d) = %v, want %v (value %d vs %d, tiles %d vs %d)",
					tc.held, tc.cost, got, tc.want,
					fishTotal(got), fishTotal(tc.want),
					got[0]+got[1]+got[2], tc.want[0]+tc.want[1]+tc.want[2])
			}
		})
	}
}

// TestFishAreNotResources: through the real command paths, fish do not count
// toward the discard limit on a 7, cannot be stolen, and cannot be discarded.
func TestFishAreNotResources(t *testing.T) {
	t.Run("not counted toward the hand limit", func(t *testing.T) {
		s, x := fishState(t, 3)
		// The two accessors turn.go uses on a 7 define the rule: what counts
		// toward the limit and what the limit is. Both are checked against the
		// config, not the module's own report, so a hook that counted fish
		// would fail here.
		limit := s.Config.DiscardLimit
		if limit == 0 {
			limit = 7
		}
		var h engine.Hand
		h[board.Wood] = limit
		s.Players[0].Hand = h
		setHeld(x, 0, [3]int{11, 10, 8}) // the entire supply, worth 55
		if got := s.DiscardableCount(0); got != limit {
			t.Fatalf("a hand of %d resources plus %d fish value counts as %d discardable cards, want %d",
				limit, fishTotal(x.Held[0]), got, limit)
		}
		if got := s.DiscardThreshold(0); got != limit {
			t.Fatalf("holding %d fish value moved the discard threshold to %d, want %d",
				fishTotal(x.Held[0]), got, limit)
		}
		// A hand exactly at the limit is not over it, however many fish sit
		// beside it.
		if s.DiscardableCount(0) > s.DiscardThreshold(0) {
			t.Fatal("a hand at the limit was pushed over it by fish")
		}
	})

	t.Run("not stealable", func(t *testing.T) {
		s, x := fishState(t, 3)
		// Seat 1 holds nothing but fish, and seat 0 robs the hex it builds on.
		s.Players[1].Hand = engine.Hand{}
		setHeld(x, 1, [3]int{3, 3, 3})
		var target board.Hex
		found := false
		for _, hx := range board.HexesInRadius(s.Board.Radius) {
			if !s.Board.Land(hx) || hx == s.Board.Robber {
				continue
			}
			s.Buildings[hx.Vertices()[0]] = engine.Building{Owner: 1}
			target, found = hx, true
			break
		}
		if !found {
			t.Fatal("no land hex to move the robber to")
		}
		s.Cur = 0
		s.RobberPending = true
		before := x.Held[1]
		// Naming that seat as the victim is refused: with no resources it is
		// not a robbable neighbour, whatever its fish.
		if _, err := engine.Decide(s, engine.Command{Player: 0, Type: engine.CmdMoveRobber,
			Data: mustJSON(t, map[string]any{"hex": target, "victim": 1})}); !errors.Is(err, engine.ErrBadVictim) {
			t.Fatalf("robbing a seat holding %d fish and no cards gave %v, want ErrBadVictim",
				fishTotal(x.Held[1]), err)
		}
		// And moving the robber onto it without naming a victim takes nothing.
		events := step(t, s, engine.Command{Player: 0, Type: engine.CmdMoveRobber,
			Data: mustJSON(t, map[string]any{"hex": target})})
		for _, e := range events {
			if e.Type == engine.EvCardStolen {
				t.Fatal("a card was stolen from a seat whose whole holding is fish")
			}
		}
		if x.Held[1] != before {
			t.Fatalf("the robber took fish: %v -> %v", before, x.Held[1])
		}
	})

	t.Run("not discardable", func(t *testing.T) {
		s, x := fishState(t, 3)
		limit := s.DiscardThreshold(0)
		var h engine.Hand
		h[board.Wood] = limit + 2
		s.Players[0].Hand = h
		setHeld(x, 0, [3]int{4, 0, 0})
		s.PendingDiscards = map[engine.PlayerID]int{0: 1}
		before := x.Held[0]
		// The discard command carries a Hand, which has no fish field, so
		// assert that paying leaves the fish alone and that the count owed
		// came from resources.
		var pay engine.Hand
		pay[board.Wood] = 1
		step(t, s, engine.Command{Player: 0, Type: engine.CmdDiscardCards,
			Data: mustJSON(t, engine.CardsDiscardedData{Cards: pay})})
		if x.Held[0] != before {
			t.Fatalf("discarding touched the fish: %v -> %v", before, x.Held[0])
		}
		if _, still := s.PendingDiscards[0]; still {
			t.Fatal("one resource did not settle a debt of one")
		}
	})
}

// TestGroundNumbersAreDealtInOrder: deriveGrounds takes numbers off
// groundNumbers in order, so the first ground placed is the 4 and a board with
// too little coast is short from the top (it loses the 10, then the 9). Uses
// hand-built silhouettes, from a full board down to barer ones.
func TestGroundNumbersAreDealtInOrder(t *testing.T) {
	sawShort, sawFull := false, false
	for _, land := range groundTestShapes() {
		b := landBoard(land)
		got := deriveGrounds(b, groundNumbers)
		if len(got) > len(groundNumbers) {
			t.Fatalf("%d land hexes produced %d grounds, want at most %d", len(land), len(got), len(groundNumbers))
		}
		var nums []int
		for _, g := range got {
			nums = append(nums, g.Number)
		}
		want := groundNumbers[:len(got)]
		if !slices.Equal(nums, want) {
			t.Fatalf("%d land hexes produced grounds numbered %v, want %v (the first %d of %v)",
				len(land), nums, want, len(got), groundNumbers)
		}
		switch {
		case len(got) == len(groundNumbers):
			sawFull = true
		case len(got) > 0:
			sawShort = true
		}
	}
	if !sawFull {
		t.Fatal("no shape produced six grounds")
	}
	if !sawShort {
		t.Fatal("no shape produced a short board")
	}
}

// groundTestShapes are hand-picked land silhouettes, from a single hex up to a
// full radius-3 hexagon, chosen to bracket the ground count rather than to hit
// one value.
func groundTestShapes() [][]board.Hex {
	var out [][]board.Hex
	for _, r := range []int{0, 1, 2, 3} {
		out = append(out, board.HexesInRadius(r))
	}
	// A one-hex-wide bar: plenty of coast, but its notches overlap heavily.
	var bar []board.Hex
	for q := -3; q <= 3; q++ {
		bar = append(bar, board.Hex{Q: q, R: 0})
	}
	return append(out, bar)
}

// landBoard turns a list of hexes into a board of plain producing land with no
// harbors, which is all deriveGrounds reads.
func landBoard(land []board.Hex) *board.Board {
	b := &board.Board{Radius: 0, Tiles: map[board.Hex]board.Tile{}}
	for _, h := range land {
		b.Tiles[h] = board.Tile{Res: board.Wood, Number: 5}
		if r := hexRing(h); r > b.Radius {
			b.Radius = r
		}
	}
	b.Radius++ // the sea ring the notches are cut from
	b.Robber = land[0]
	return b
}

// TestFishSpendRefusedWithoutEnoughFish is the guard the tiebreak above sits
// behind: spendTiles is only ever asked for a cost the holding covers.
func TestFishSpendRefusedWithoutEnoughFish(t *testing.T) {
	s, x := fishState(t, 3)
	s.Cur = 0
	setHeld(x, 0, [3]int{1, 0, 0})
	_, err := engine.Decide(s, engine.Command{Player: 0, Type: CmdSpendFish,
		Data: mustJSON(t, map[string]any{"use": FishSteal, "victim": 1})})
	if !errors.Is(err, ErrNoFish) {
		t.Fatalf("a 1-fish holding paying a 3-fish cost gave %v, want ErrNoFish", err)
	}
}
