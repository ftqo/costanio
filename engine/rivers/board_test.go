package rivers

import (
	"math/rand/v2"
	"strings"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// The board bullets of docs/rules/rivers.md's Engine conformance list. One test
// per bullet, named for the bullet.

// TestRiverCountFormula: "riverCount = 1 + (landHexes-1)/30 rivers", which is 1
// at radius 2 (19 hexes), 2 at radius 3 (37) and 3 at radius 4 (61).
func TestRiverCountFormula(t *testing.T) {
	for _, c := range []struct{ land, want int }{
		{0, 0}, {1, 1}, {19, 1}, {30, 1}, {31, 2}, {37, 2}, {60, 2}, {61, 3}, {91, 4},
	} {
		if got := riverCount(c.land); got != c.want {
			t.Errorf("riverCount(%d) = %d, want %d", c.land, got, c.want)
		}
	}
}

// TestRiverCountOnRealBoards: a procedural board gets the number of rivers the
// formula asks for. The spec's "fails loudly rather than producing fewer
// rivers" is asserted here rather than as a panic in board generation, because
// the same code serves authored maps, where a shape with no qualifying chain is
// the author's choice.
func TestRiverCountOnRealBoards(t *testing.T) {
	boards(t, "base+rivers", 8, func(t *testing.T, s *engine.State, x *Ext) {
		land := 0
		for _, h := range board.HexesInRadius(s.Board.Radius) {
			if s.Board.Land(h) {
				land++
			}
		}
		if got, want := len(x.Rivers), riverCount(land); got != want {
			t.Fatalf("%d land hexes dealt %d rivers, want %d", land, got, want)
		}
	})
}

// TestRiverCountOnIslandsBoards is the same check on Islands boards, which are
// cut into pieces. With six-direction stepping no board in this sweep (200
// seeds at each of 2, 4, 6 and 8 seats) comes up short at floor 4, so the
// budget is an exact 0: any regression fails here.
func TestRiverCountOnIslandsBoards(t *testing.T) {
	// Seats and seeds are the sweep the budget was measured on.
	const seeds = 200
	short, total := 0, 0
	for _, players := range []int{2, 4, 6, 8} {
		for seed := range uint64(seeds) {
			s, _ := newGame(t, "base+islands+rivers", players, seed)
			x, ok := StateExt(s)
			if !ok {
				t.Fatalf("%dp seed %d: no rivers ext", players, seed)
			}
			land := 0
			for _, h := range board.HexesInRadius(s.Board.Radius) {
				if s.Board.Land(h) {
					land++
				}
			}
			total++
			if len(x.Rivers) != riverCount(land) {
				short++
			}
			// The Islands half of TestEveryChannelClearsTheChip, checked on the
			// boards this test already deals.
			checkShapesAreAuthored(t, "base+islands+rivers", players, seed, x)
		}
	}
	// Seeds 0..199 at 2, 4, 6 and 8 seats, and every one of the 800 seats its
	// full river count at the scenario's floor.
	const budget = 0
	if short != budget {
		t.Fatalf("%d of %d Islands boards short of their river count, want %d",
			short, total, budget)
	}
}

// TestChainShape holds the conditions on every river of every dealt board:
// length bounds, every hex eligible land, non-self-adjacency, and the estuary
// end reaching the coast. Only that end: the headwater may sit anywhere, coast
// included.
func TestChainShape(t *testing.T) {
	for _, rs := range []string{"base+rivers", "base+islands+rivers", "base+caravans+fishermen+rivers"} {
		boards(t, rs, 4, func(t *testing.T, s *engine.State, x *Ext) {
			b := s.Board
			for ri, r := range x.Rivers {
				n := len(r.Hexes)
				if n < minChainLen || n > maxChainLen(b.Radius) {
					t.Fatalf("%s: river %d is %d hexes, want %d..%d", rs, ri, n, minChainLen, maxChainLen(b.Radius))
				}
				on := map[board.Hex]bool{}
				for _, h := range r.Hexes {
					if on[h] {
						t.Fatalf("%s: river %d visits %v twice", rs, ri, h)
					}
					on[h] = true
					if !b.Land(h) {
						t.Fatalf("%s: river %d runs through non-land %v", rs, ri, h)
					}
				}
				for i, h := range r.Hexes {
					for j := range r.Hexes {
						if j == i || j == i-1 || j == i+1 {
							continue
						}
						if hexDist(h, r.Hexes[j]) == 1 {
							t.Fatalf("%s: river %d has non-consecutive neighbours %v and %v", rs, ri, h, r.Hexes[j])
						}
					}
				}
				if !openWater(b, r.MouthHex()) {
					t.Fatalf("%s: river %d's estuary %v does not reach the sea", rs, ri, r.MouthHex())
				}
			}
		})
	}
}

// TestChainHexesAreNeverExcludedTerrain: no chain runs through the desert,
// Fishermen's lake or an Islands gold hex. Re-derives from the finished board
// (what the ext holds) and reads the terrain painting left.
func TestChainHexesAreNeverExcludedTerrain(t *testing.T) {
	for _, rs := range []string{"base+rivers", "base+islands+rivers", "base+fishermen+rivers", "base+caravans+rivers"} {
		boards(t, rs, 4, func(t *testing.T, s *engine.State, x *Ext) {
			for ri, r := range x.Rivers {
				for _, h := range r.Hexes {
					switch s.Board.Tiles[h].Res { //nolint:exhaustive // only the excluded terrains are named
					case board.ResNone:
						t.Fatalf("%s: river %d runs through the desert at %v", rs, ri, h)
					case board.Lake:
						t.Fatalf("%s: river %d runs through the lake at %v", rs, ri, h)
					case board.Gold:
						t.Fatalf("%s: river %d runs through a gold hex at %v", rs, ri, h)
					case board.Sea, board.Border:
						t.Fatalf("%s: river %d runs through water at %v", rs, ri, h)
					}
				}
			}
		})
	}
}

// TestTwoRiversAreNeverAdjacent: each later river's candidates exclude every
// hex in or next to an already-chosen river, so rivers never touch and bridge
// sites are unambiguous.
func TestTwoRiversAreNeverAdjacent(t *testing.T) {
	boards(t, "base+rivers", 8, func(t *testing.T, s *engine.State, x *Ext) {
		for i := range x.Rivers {
			for j := i + 1; j < len(x.Rivers); j++ {
				for _, a := range x.Rivers[i].Hexes {
					for _, b := range x.Rivers[j].Hexes {
						if hexDist(a, b) <= 1 {
							t.Fatalf("rivers %d and %d touch at %v / %v", i, j, a, b)
						}
					}
				}
			}
		}
	})
}

// TestPaintedTerrain: the source ends as mountains, every hex between keeps its
// dealt terrain, and the estuary becomes a swamp and loses its chit. Compared
// against the same seed dealt without Rivers (the board FinishBoard received):
// an interior channel hex must keep exactly its terrain, forest and fields
// included.
func TestPaintedTerrain(t *testing.T) {
	for _, rs := range []string{"base+rivers", "base+islands+rivers", "base+caravans+fishermen+rivers"} {
		without := strings.Replace(rs, "+rivers", "", 1)
		sawForestOrFields := false
		boardsWithSeeds(t, rs, 4, func(t *testing.T, s *engine.State, x *Ext, players int, seed uint64) {
			plain, _ := newGame(t, without, players, seed)
			for ri, r := range x.Rivers {
				for i, h := range r.Hexes {
					tile := s.Board.Tiles[h]
					switch i {
					case r.Mouth:
						if tile.Res != board.Swamp {
							t.Fatalf("%s: river %d's mouth %v is %v, want swamp", rs, ri, h, tile.Res)
						}
						if tile.Number != 0 {
							t.Fatalf("%s: river %d's mouth %v kept chit %d; the mouth's chit is discarded",
								rs, ri, h, tile.Number)
						}
					case 0:
						// The headwater is mountains only: the one-mouth tile
						// exists for that terrain alone.
						if tile.Res != sourceTerrain {
							t.Fatalf("%s: river %d's source %v is %v, want mountains", rs, ri, h, tile.Res)
						}
					default:
						// The exception: at radius 4 three rivers can run
						// through every mountain hex, and a headwater then
						// swaps with an interior channel hex that was
						// mountains.
						if want := plain.Board.Tiles[h].Res; tile.Res != want && want != sourceTerrain {
							t.Fatalf("%s %dp seed %d: river %d hex %v is %v, want the %v it was dealt",
								rs, players, seed, ri, h, tile.Res, want)
						}
						if tile.Res == board.Wood || tile.Res == board.Wheat {
							sawForestOrFields = true
						}
					}
				}
			}
		})
		if !sawForestOrFields {
			t.Errorf("%s: no channel ran through forest or fields on any board swept", rs)
		}
	}
}

// TestPaintingMovesTerrainNotChits: "Chits stay with their hexes and do not move
// with the terrain, so the board's number multiset is untouched; only which
// resource sits under which number changes." The only chit that leaves is the
// mouth's, one per river.
func TestPaintingMovesTerrainNotChits(t *testing.T) {
	for _, players := range []int{4, 6, 8} {
		for seed := range uint64(6) {
			rng := rand.New(rand.NewPCG(seed, 0x5eed))
			b, err := board.GenerateRadius(rng, players, board.RadiusFor(players), board.BoardFair)
			if err != nil {
				t.Fatal(err)
			}
			before := map[int]int{}
			for _, h := range board.HexesInRadius(b.Radius) {
				if tl, ok := b.Tiles[h]; ok && tl.Number != 0 {
					before[tl.Number]++
				}
			}
			rs := DeriveRivers(b, rand.New(rand.NewPCG(seed, 1)))
			dealt := b.Clone()
			var lost []int
			for _, r := range rs {
				if n := b.Tiles[r.MouthHex()].Number; n != 0 {
					lost = append(lost, n)
				}
			}
			paint(b, rs)
			after := map[int]int{}
			for _, h := range board.HexesInRadius(b.Radius) {
				if tl, ok := b.Tiles[h]; ok && tl.Number != 0 {
					after[tl.Number]++
				}
			}
			for _, n := range lost {
				before[n]--
				if before[n] == 0 {
					delete(before, n)
				}
			}
			for n, c := range before {
				if after[n] != c {
					t.Fatalf("%dp seed %d: chit %d appears %d times after painting, want %d",
						players, seed, n, after[n], c)
				}
			}
			for n, c := range after {
				if before[n] != c {
					t.Fatalf("%dp seed %d: chit %d appears %d times after painting, want %d",
						players, seed, n, c, before[n])
				}
			}
			// Terrain moves only at the ends: interior channel hexes keep their
			// tiles, and off the rivers at most one hex per headwater changed
			// (its swap partner).
			ends := map[board.Hex]bool{}
			for _, r := range rs {
				ends[r.SourceHex()], ends[r.MouthHex()] = true, true
			}
			moved := 0
			for _, h := range board.HexesInRadius(b.Radius) {
				if ends[h] || b.Tiles[h] == dealt.Tiles[h] {
					continue
				}
				moved++
				if dealt.Tiles[h].Res != sourceTerrain {
					t.Fatalf("%dp seed %d: %v changed from %v to %v; only a headwater's mountains partner may",
						players, seed, h, dealt.Tiles[h], b.Tiles[h])
				}
			}
			if moved > len(rs) {
				t.Fatalf("%dp seed %d: %d hexes besides the river ends changed for %d rivers",
					players, seed, moved, len(rs))
			}
		}
	}
}

// TestDeriveRiversIsPure: two calls on the same board return the same chains in
// the same order.
//
// It also survives its own painting: FinishBoard derives from the raw board and
// paints, InitExtBoard derives again from the painted board and that is what
// the log records, so the two must agree.
func TestDeriveRiversIsPure(t *testing.T) {
	for _, players := range []int{2, 4, 6, 8} {
		for seed := range uint64(6) {
			rng := rand.New(rand.NewPCG(seed, 0x5eed))
			b, err := board.GenerateRadius(rng, players, board.RadiusFor(players), board.BoardFair)
			if err != nil {
				t.Fatal(err)
			}
			one := DeriveRivers(b, rand.New(rand.NewPCG(seed, 1)))
			two := DeriveRivers(b, rand.New(rand.NewPCG(seed, 1)))
			sameRivers(t, "repeat call", players, seed, one, two)
			paint(b, one)
			three := DeriveRivers(b, rand.New(rand.NewPCG(seed, 1)))
			sameRivers(t, "after painting", players, seed, one, three)
			// Painting again changes nothing, as BoardFinisher requires.
			snapshot := b.Clone()
			paint(b, three)
			for _, h := range board.HexesInRadius(b.Radius) {
				if b.Tiles[h] != snapshot.Tiles[h] {
					t.Fatalf("%dp seed %d: painting twice moved %v", players, seed, h)
				}
			}
		}
	}
}

func sameRivers(t *testing.T, what string, players int, seed uint64, a, b []River) {
	t.Helper()
	if len(a) != len(b) {
		t.Fatalf("%dp seed %d: %s derived %d rivers, want %d", players, seed, what, len(b), len(a))
	}
	for i := range a {
		if len(a[i].Hexes) != len(b[i].Hexes) || a[i].Mouth != b[i].Mouth {
			t.Fatalf("%dp seed %d: %s changed river %d", players, seed, what, i)
		}
		for k := range a[i].Hexes {
			if a[i].Hexes[k] != b[i].Hexes[k] {
				t.Fatalf("%dp seed %d: %s moved river %d hex %d: %v vs %v",
					players, seed, what, i, k, a[i].Hexes[k], b[i].Hexes[k])
			}
		}
		for k := range a[i].Sites {
			if a[i].Sites[k] != b[i].Sites[k] {
				t.Fatalf("%dp seed %d: %s moved river %d site %d", players, seed, what, i, k)
			}
		}
		if len(a[i].Variants) != len(b[i].Variants) {
			t.Fatalf("%dp seed %d: %s changed river %d's variant list", players, seed, what, i)
		}
		for k := range a[i].Variants {
			if a[i].Variants[k] != b[i].Variants[k] {
				t.Fatalf("%dp seed %d: %s moved river %d hex %d's tile variant", players, seed, what, i, k)
			}
		}
	}
}

// TestVariantsDeterministicOnStraights: a hex's meander comes from
// the reserved public slot, so the same seed gives the same answer, and only
// the east-west straight has more than one.
func TestVariantsDeterministicOnStraights(t *testing.T) {
	spread := map[int]int{}
	ew := 0
	for _, players := range []int{2, 6, 8} {
		for seed := range uint64(25) {
			a, _ := newGame(t, "base+rivers", players, seed)
			b, _ := newGame(t, "base+rivers", players, seed)
			xa, _ := StateExt(a)
			xb, _ := StateExt(b)
			for ri, r := range xa.Rivers {
				if len(r.Variants) != len(r.Hexes) {
					t.Fatalf("%dp seed %d: river %d has %d variants for %d hexes",
						players, seed, ri, len(r.Variants), len(r.Hexes))
				}
				for i, h := range r.Hexes {
					v := r.Variants[i]
					if xb.Rivers[ri].Variants[i] != v {
						t.Fatalf("%dp seed %d: river %d hex %d drew variant %d and then %d",
							players, seed, ri, i, v, xb.Rivers[ri].Variants[i])
					}
					if !isEastWest(h, r.In[i], r.Out[i]) {
						if v != 0 {
							t.Fatalf("%dp seed %d: river %d hex %d draws %q, which has one "+
								"authored meander, but was given variant %d",
								players, seed, ri, i, ChannelShape(h, r.In[i], r.Out[i]), v)
						}
						continue
					}
					ew++
					if v < 0 || v >= EWVariants {
						t.Fatalf("%dp seed %d: river %d hex %d drew variant %d of %d",
							players, seed, ri, i, v, EWVariants)
					}
					spread[v]++
				}
			}
		}
	}
	// Both meanders must actually be used; a chooser that always answered 0
	// would pass every check above.
	if ew == 0 {
		t.Fatal("sweep found no east-west hexes")
	}
	for v := range EWVariants {
		if spread[v] == 0 {
			t.Fatalf("meander %d was never drawn over %d east-west hexes: %v", v, ew, spread)
		}
	}
}

// TestCoinsAndAdjacencyDoNotReadTheChannel: coins and adjacency depend on which
// hexes a river runs through ("1 coin per road on a path adjacent to a river
// hex", "1 coin per settlement adjacent to 1 or 2 river hexes"), not on which
// edges the channel crosses. Two rivers over the same hexes with different
// channels have the same coin-bearing edges and vertices and different bridge
// sites.
func TestCoinsAndAdjacencyDoNotReadTheChannel(t *testing.T) {
	hexes := []board.Hex{{Q: 0, R: 0}, {Q: 1, R: 0}, {Q: 2, R: 0}, {Q: 3, R: 0}}
	// The same chain twice. One leaves its estuary to the north-west, the other
	// to the south-west: a different shape and bridge site.
	build := func(outlet int) *Ext {
		r := River{Hexes: append([]board.Hex(nil), hexes...), Mouth: len(hexes) - 1}
		n := len(hexes)
		r.In = make([]board.Edge, n)
		r.Out = make([]board.Edge, n)
		for i := range n - 1 {
			seam, _ := seamEdge(hexes[i], hexes[i+1])
			r.Out[i] = seam
			r.In[i+1] = seam
		}
		r.Out[n-1] = hexes[n-1].Edges()[edgeIndexForDir(outlet)]
		r.In[0] = r.Out[0]
		r.Sites = append([]board.Edge(nil), r.Out...)
		x := emptyExt(2)
		x.Rivers = []River{r}
		x.cache()
		return x
	}
	a, b := build(dirNW), dirSE
	c := build(b)

	edges := func(x *Ext) map[board.Edge]bool {
		out := map[board.Edge]bool{}
		for _, e := range x.edgeList {
			out[e] = true
		}
		return out
	}
	verts := func(x *Ext) map[board.Vertex]bool {
		out := map[board.Vertex]bool{}
		for _, v := range x.vertList {
			out[v] = true
		}
		return out
	}
	if len(edges(a)) != len(edges(c)) {
		t.Fatalf("the coin ledger walks %d edges one way and %d the other", len(edges(a)), len(edges(c)))
	}
	for e := range edges(a) {
		if !edges(c)[e] {
			t.Fatalf("edge %v earns a coin with one channel and not with the other", e)
		}
		if !a.IsRiverEdge(e) || !c.IsRiverEdge(e) {
			t.Fatalf("edge %v is on the ledger but is not a river edge", e)
		}
	}
	for v := range verts(a) {
		if !verts(c)[v] {
			t.Fatalf("vertex %v earns a coin with one channel and not with the other", v)
		}
		if !a.IsRiverVertex(v) || !c.IsRiverVertex(v) {
			t.Fatalf("vertex %v is on the ledger but is not a river vertex", v)
		}
	}
	// What does differ: the estuary's outlet is a bridge site in one and an
	// ordinary edge in the other.
	outletA := hexes[len(hexes)-1].Edges()[edgeIndexForDir(dirNW)]
	outletC := hexes[len(hexes)-1].Edges()[edgeIndexForDir(dirSE)]
	if !a.IsBridgeSite(outletA) || a.IsBridgeSite(outletC) {
		t.Fatal("the north-west channel's bridge sites did not follow its channel")
	}
	if !c.IsBridgeSite(outletC) || c.IsBridgeSite(outletA) {
		t.Fatal("the south-east channel's bridge sites did not follow its channel")
	}
	// The south-east outlet is one of the two edges the number chip sits
	// against, and the derivation may use it.
	if got := ChannelShape(hexes[len(hexes)-1], c.Rivers[0].In[3], outletC); got != ShapeWSE {
		t.Fatalf("an estuary turning from west to south-east draws %q, want %q", got, ShapeWSE)
	}
}

// TestBridgeSitesSeamsAndOutlet: bridge sites are the n-1 seams
// plus the one coastal edge at the estuary, and no edge is a site for two
// rivers.
//
// n per river, not n+1: the reference layout has 7 sites over a 3-hex and a
// 4-hex river, which needs one sea outlet each.
func TestBridgeSitesSeamsAndOutlet(t *testing.T) {
	boards(t, "base+rivers", 8, func(t *testing.T, s *engine.State, x *Ext) {
		seen := map[board.Edge]int{}
		for ri, r := range x.Rivers {
			n := len(r.Hexes)
			if len(r.Sites) != n {
				t.Fatalf("river %d of %d hexes has %d bridge sites, want %d", ri, n, len(r.Sites), n)
			}
			// The n-1 seams, in chain order, are sites 0..n-2.
			for i := range n - 1 {
				seam, ok := seamEdge(r.Hexes[i], r.Hexes[i+1])
				if !ok {
					t.Fatalf("river %d: hexes %d and %d are not neighbours", ri, i, i+1)
				}
				if r.Sites[i] != seam {
					t.Fatalf("river %d site %d is not the seam between %v and %v", ri, i, r.Hexes[i], r.Hexes[i+1])
				}
			}
			// The last site is the estuary's outlet, and it borders water.
			outlet := r.Sites[n-1]
			water := false
			for _, h := range board.EdgeHexes(outlet) {
				if !s.Board.Land(h) {
					water = true
				}
			}
			if !water {
				t.Fatalf("river %d: the coastal outlet %v borders no water", ri, outlet)
			}
			// The source has no outlet: its only channel edge is the seam with
			// the second hex, already site 0.
			if r.In[0] != r.Out[0] {
				t.Fatalf("river %d: the source has two mouths, so it is not a headwater", ri)
			}
			for _, e := range r.Sites {
				seen[e]++
				if seen[e] > 1 {
					t.Fatalf("edge %v is a bridge site for two rivers", e)
				}
			}
		}
	})
}

// TestEveryVertexKeepsARoadEdge: every vertex has at least one edge that is not
// a bridge site, so setup can always give a settlement a road.
//
// The spec argues a vertex's three edges lie between three mutually adjacent
// hexes, a non-self-adjacent chain uses at most two, and rivers never touch.
// This checks the stronger property setup needs on real boards: at least one
// edge that is neither a bridge site nor water.
func TestEveryVertexKeepsARoadEdge(t *testing.T) {
	for _, rs := range []string{"base+rivers", "base+islands+rivers"} {
		boards(t, rs, 6, func(t *testing.T, s *engine.State, x *Ext) {
			for _, h := range board.HexesInRadius(s.Board.Radius) {
				if !s.Board.Land(h) {
					continue
				}
				for _, v := range h.Vertices() {
					sites, usable := 0, 0
					for _, e := range v.Edges() {
						if x.IsBridgeSite(e) {
							sites++
							continue
						}
						if s.Board.LandEdge(e) {
							usable++
						}
					}
					if sites > 2 {
						t.Fatalf("%s: vertex %v touches %d bridge sites, want at most 2", rs, v, sites)
					}
					if usable == 0 {
						t.Fatalf("%s: vertex %v has no edge a road could take (%d of its 3 are bridge sites)",
							rs, v, sites)
					}
				}
			}
		})
	}
}

// TestRobberStartsOnDesertOrSwamp: the robber starts on the desert when there
// is one, otherwise on the first swamp in board order.
//
// Rivers does not move the robber; this pins that the base rule survives. The
// derivation never takes the desert, and where every desert is drowned or
// flooded the swamp is a legal home like any other non-producing land hex.
func TestRobberStartsOnDesertOrSwamp(t *testing.T) {
	for _, rs := range []string{"base+rivers", "base+islands+rivers", "base+fishermen+rivers"} {
		boards(t, rs, 6, func(t *testing.T, s *engine.State, x *Ext) {
			if !s.Board.RobberOnBoard() {
				return // Fishermen starts it beside the board; its own rule.
			}
			if !s.Board.RobberOK(s.Board.Robber) {
				t.Fatalf("%s: the robber starts on %v, which is %v", rs, s.Board.Robber, s.Board.Tiles[s.Board.Robber].Res)
			}
			if !s.Board.RobberNeutral(s.Board.Robber) {
				t.Fatalf("%s: the robber starts on producing land at %v", rs, s.Board.Robber)
			}
		})
	}
}

// TestSwampsTakeNoChitAndProduceNothing, which also covers "no hex ever carries
// two chits" (our board cannot express that): the mouth's chit is discarded,
// not stacked onto another hex.
func TestSwampsTakeNoChitAndProduceNothing(t *testing.T) {
	boards(t, "base+rivers", 8, func(t *testing.T, s *engine.State, x *Ext) {
		swamps := 0
		for _, h := range board.HexesInRadius(s.Board.Radius) {
			tl, ok := s.Board.Tiles[h]
			if !ok || tl.Res != board.Swamp {
				continue
			}
			swamps++
			if tl.Number != 0 {
				t.Fatalf("swamp %v carries chit %d", h, tl.Number)
			}
			if tl.Res.Producing() {
				t.Fatalf("swamp %v produces", h)
			}
			if !s.Board.Land(h) || !s.Board.RobberOK(h) || !s.Board.RobberNeutral(h) {
				t.Fatalf("swamp %v is not land the robber may stand on", h)
			}
		}
		if swamps != len(x.Rivers) {
			t.Fatalf("%d swamps for %d rivers", swamps, len(x.Rivers))
		}
	})
}

// TestBoardStillValidates: a Rivers board passes the same layout validator as
// every other board. Without board.Swamp in the non-producing set, a swamp
// would read as a numbered producing tile, or the board would have no home for
// the robber.
func TestBoardStillValidates(t *testing.T) {
	for _, rs := range []string{"base+rivers", "base+islands+rivers", "base+caravans+fishermen+rivers"} {
		boards(t, rs, 4, func(t *testing.T, s *engine.State, x *Ext) {
			if err := s.Board.ValidateLayout(); err != nil {
				t.Fatalf("%s: %v", rs, err)
			}
		})
	}
}

// TestDrawableRejectsTheHairpin pins the tile-shape rule on its own: a channel
// may leave on the opposite edge (straight) or two apart (a bend), and never on
// an adjacent one.
func TestDrawableRejectsTheHairpin(t *testing.T) {
	for a := range 6 {
		for b := range 6 {
			d := ((a - b) + 6) % 6
			want := d == 2 || d == 3 || d == 4
			if got := drawable(a, b); got != want {
				t.Errorf("drawable(%d, %d) = %v, want %v", a, b, got, want)
			}
		}
	}
	if drawable(0, 1) || drawable(0, 5) || drawable(3, 3) {
		t.Fatal("drawable accepted a 60 degree turn or a channel that does not turn at all")
	}
}

// TestChannelShapeIsDrawableEverywhere: every hex of every river has mouths a
// shipped tile can draw, on real boards. The renderer depends on this, and it
// is why non-self-adjacency is a rule.
//
// The source (hex 0) is the one hex with a single mouth (In == Out); every
// other hex has two, opposite or two apart.
func TestChannelShapeIsDrawableEverywhere(t *testing.T) {
	boards(t, "base+rivers", 6, func(t *testing.T, s *engine.State, x *Ext) {
		for ri, r := range x.Rivers {
			for i, h := range r.Hexes {
				in, out := r.In[i], r.Out[i]
				if in == out {
					if i != 0 {
						t.Fatalf("river %d hex %d has one mouth; only the source does", ri, i)
					}
					continue
				}
				if i == 0 {
					t.Fatalf("river %d's source has two mouths, so it is not a headwater", ri)
				}
				di, oki := edgeDirOf(h, in)
				do, oko := edgeDirOf(h, out)
				if !oki || !oko {
					t.Fatalf("river %d hex %d: a mouth is not one of its own six edges", ri, i)
				}
				if !drawable(di, do) {
					t.Fatalf("river %d hex %d has mouths %d and %d apart, which no tile draws", ri, i, di, do)
				}
			}
			// And consecutive hexes meet mouth to mouth on their shared edge.
			for i := 0; i+1 < len(r.Hexes); i++ {
				if r.Out[i] != r.In[i+1] {
					t.Fatalf("river %d: hexes %d and %d do not meet mouth to mouth", ri, i, i+1)
				}
			}
		}
	})
}

// edgeDirOf returns which of h's six edges e is.
func edgeDirOf(h board.Hex, e board.Edge) (int, bool) {
	for i, he := range h.Edges() {
		if he == e {
			return i, true
		}
	}
	return 0, false
}

// TestEdgeIndexForDirMatchesGeometry pins the edge toward Neighbors[d] as
// Edges[(1-d) mod 6]. A wrong formula puts bridge sites on the wrong edges,
// which counting sites would not catch.
func TestEdgeIndexForDirMatchesGeometry(t *testing.T) {
	h := board.Hex{Q: 2, R: -1}
	for d, n := range h.Neighbors() {
		e := h.Edges()[edgeIndexForDir(d)]
		hexes := board.EdgeHexes(e)
		if len(hexes) != 2 {
			t.Fatalf("edge %d of %v borders %d hexes", d, h, len(hexes))
		}
		if (hexes[0] != h || hexes[1] != n) && (hexes[1] != h || hexes[0] != n) {
			t.Fatalf("edgeIndexForDir(%d) gave the edge between %v and %v, want %v and %v",
				d, hexes[0], hexes[1], h, n)
		}
	}
}

// TestMouthIsAlwaysTheSeaEnd: the watercourse runs source to sea, so the swamp
// is the last hex of the chain and the headwater the first. Nothing in the
// derivation reads terrain.
func TestMouthIsAlwaysTheSeaEnd(t *testing.T) {
	boards(t, "base+rivers", 6, func(t *testing.T, s *engine.State, x *Ext) {
		for ri, r := range x.Rivers {
			if want := len(r.Hexes) - 1; r.Mouth != want {
				t.Fatalf("river %d has its mouth at index %d of %d, want %d", ri, r.Mouth, len(r.Hexes), want)
			}
			if !openWater(s.Board, r.MouthHex()) {
				t.Fatalf("river %d's mouth %v is not at the coast", ri, r.MouthHex())
			}
			if s.Board.Tiles[r.SourceHex()].Res != sourceTerrain {
				t.Fatalf("river %d's source %v is %v, want mountains", ri, r.SourceHex(),
					s.Board.Tiles[r.SourceHex()].Res)
			}
		}
	})
}

// TestReferenceLayoutsAreReproducible builds the two rivers of the scenario's
// reference setup hex by hex and asserts the engine describes them as that
// layout does.
//
// The 3-hex river's estuary turns from east to south-west, which needs
// six-direction stepping. Both layouts are constructed: the derivation would
// not choose these chains, and the claim is about what the engine can describe.
//
// The layout has 7 bridge sites, and 3 + 4 = 7 only with a single sea outlet
// per river.
func TestReferenceLayoutsAreReproducible(t *testing.T) {
	// A board with sea to the west and north-west of the origin, so the estuary
	// hexes below have somewhere to empty into.
	b := &board.Board{Radius: 3, Tiles: map[board.Hex]board.Tile{}}
	for _, h := range board.HexesInRadius(3) {
		b.Tiles[h] = board.Tile{Res: board.Wheat, Number: 5}
	}

	for _, c := range []struct {
		name   string
		hexes  []board.Hex
		outlet int // the direction of the estuary's coastal outlet
		shapes []Shape
	}{
		{
			// Four hexes running west from the source: mountains (one mouth,
			// west), hills straight, pasture straight, swamp turning from east
			// to north-west into the sea.
			name:   "the 4-hex river",
			hexes:  []board.Hex{{Q: 3, R: 0}, {Q: 2, R: 0}, {Q: 1, R: 0}, {Q: 0, R: 0}},
			outlet: dirNW,
			shapes: []Shape{ShapeSrcW, ShapeEW, ShapeEW, ShapeENW},
		},
		{
			// Three hexes, the same run one shorter, with the estuary turning
			// from east to south-west instead (the mirror of the other
			// river's).
			name:   "the 3-hex river",
			hexes:  []board.Hex{{Q: 2, R: 0}, {Q: 1, R: 0}, {Q: 0, R: 0}},
			outlet: dirSW,
			shapes: []Shape{ShapeSrcW, ShapeEW, ShapeESW},
		},
	} {
		t.Run(c.name, func(t *testing.T) {
			n := len(c.hexes)
			r := buildRiver(b, candidate{hexes: c.hexes, outDir: c.outlet})
			if r.Mouth != n-1 {
				t.Fatalf("mouth at %d, want the sea end at %d", r.Mouth, n-1)
			}
			for i, h := range r.Hexes {
				if got := ChannelShape(h, r.In[i], r.Out[i]); got != c.shapes[i] {
					t.Errorf("hex %d (%v) draws %q, want %q", i, h, got, c.shapes[i])
				}
			}
			// n sites: the n-1 seams and the estuary's outlet. 4 + 3 = 7, the
			// reference layout's number.
			if len(r.Sites) != n {
				t.Fatalf("%d bridge sites, want %d", len(r.Sites), n)
			}
			if want := c.hexes[n-1].Edges()[edgeIndexForDir(c.outlet)]; r.Sites[n-1] != want {
				t.Errorf("the last site is not the estuary's outlet")
			}
			// Painting gives the reference ends: mountains at the source and
			// swamp at the estuary. The channel between keeps its dealt terrain
			// (wheat here) rather than the reference layout's hills and
			// pasture; a generated board does not repaint to imitate a fixed
			// one.
			pb := b.Clone()
			pb.Tiles[board.Hex{Q: -3, R: 3}] = board.Tile{Res: board.Ore, Number: 5}
			paint(pb, []River{r})
			if got := pb.Tiles[r.SourceHex()].Res; got != board.Ore {
				t.Errorf("the source is %v, want mountains", got)
			}
			if got := pb.Tiles[r.MouthHex()].Res; got != board.Swamp {
				t.Errorf("the estuary is %v, want swamp", got)
			}
			for i := 1; i < n-1; i++ {
				if got := pb.Tiles[r.Hexes[i]].Res; got != board.Wheat {
					t.Errorf("hex %d is %v, want the wheat it was dealt", i, got)
				}
			}
		})
	}
}

// TestPaintWithNoMountainsLeavesTheSource: an authored board with no mountains
// off the rivers. The headwater has nothing to swap with and keeps its own
// terrain rather than the board losing a resource; the channel keeps its
// terrain. Only the estuary changes.
func TestPaintWithNoMountainsLeavesTheSource(t *testing.T) {
	b := &board.Board{Radius: 2, Tiles: map[board.Hex]board.Tile{}}
	for _, h := range board.HexesInRadius(2) {
		b.Tiles[h] = board.Tile{Res: board.Wheat, Number: 6}
	}
	r := River{
		Hexes: []board.Hex{{Q: -2, R: 0}, {Q: -1, R: 0}, {Q: 0, R: 0}, {Q: 1, R: 0}},
		Mouth: 3,
	}
	paint(b, []River{r})
	for i, h := range r.Hexes {
		got := b.Tiles[h]
		if i == r.Mouth {
			if got.Res != board.Swamp || got.Number != 0 {
				t.Fatalf("mouth %v is %v, want a swamp with no chit", h, got)
			}
			continue
		}
		if got != (board.Tile{Res: board.Wheat, Number: 6}) {
			t.Fatalf("hex %d (%v) is %v, want the wheat 6 it was dealt", i, h, got)
		}
	}
}

// TestSourceSwapsForMountainsWhenItCan is the ordinary case: an off-river
// mountains hex exists, so the source swaps with the nearest in board order and
// the board keeps every resource.
func TestSourceSwapsForMountainsWhenItCan(t *testing.T) {
	b := &board.Board{Radius: 2, Tiles: map[board.Hex]board.Tile{}}
	for _, h := range board.HexesInRadius(2) {
		b.Tiles[h] = board.Tile{Res: board.Wheat, Number: 6}
	}
	// One mountains hex, off the chain and two steps from its source.
	ore := board.Hex{Q: -2, R: 2}
	b.Tiles[ore] = board.Tile{Res: board.Ore, Number: 8}
	r := River{
		Hexes: []board.Hex{{Q: -2, R: 0}, {Q: -1, R: 0}, {Q: 0, R: 0}, {Q: 1, R: 0}},
		Mouth: 3,
	}
	paint(b, []River{r})
	if got := b.Tiles[r.SourceHex()].Res; got != board.Ore {
		t.Fatalf("the source is %v, want the mountains it swapped for", got)
	}
	if got := b.Tiles[ore].Res; got != board.Wheat {
		t.Fatalf("the partner hex is %v, want the wheat the source gave it", got)
	}
	// Chits stay with their hexes: the swap moves terrain and nothing else.
	if b.Tiles[r.SourceHex()].Number != 6 || b.Tiles[ore].Number != 8 {
		t.Fatalf("the swap moved a chit: source %d, partner %d",
			b.Tiles[r.SourceHex()].Number, b.Tiles[ore].Number)
	}
}

// TestSourceSwapPrefersTheSamePips: of two off-river mountains, the headwater
// takes the one whose token is worth what its own is, even when it is further
// away, so the swap moves no production from one resource to another.
func TestSourceSwapPrefersTheSamePips(t *testing.T) {
	b := &board.Board{Radius: 2, Tiles: map[board.Hex]board.Tile{}}
	for _, h := range board.HexesInRadius(2) {
		b.Tiles[h] = board.Tile{Res: board.Wheat, Number: 3}
	}
	src := board.Hex{Q: -2, R: 0}
	b.Tiles[src] = board.Tile{Res: board.Wheat, Number: 9} // 4 pips
	near := board.Hex{Q: -2, R: 1}                         // one step, 6: 5 pips
	far := board.Hex{Q: 2, R: -2}                          // across the board, 5: 4 pips
	b.Tiles[near] = board.Tile{Res: board.Ore, Number: 6}
	b.Tiles[far] = board.Tile{Res: board.Ore, Number: 5}
	r := River{Hexes: []board.Hex{src, {Q: -1, R: 0}, {Q: 0, R: 0}, {Q: 1, R: 0}}, Mouth: 3}
	paint(b, []River{r})
	if b.Tiles[src].Res != board.Ore || b.Tiles[far].Res != board.Wheat || b.Tiles[near].Res != board.Ore {
		t.Fatalf("source swapped with the wrong mountains: src %v, near %v, far %v",
			b.Tiles[src], b.Tiles[near], b.Tiles[far])
	}
}

// TestBoardFinisherSlotReserved: Rivers reads its own public slot
// rather than the shared slot 3. It draws on every board, while Caravans and
// Fishermen draw only when repairing.
func TestBoardFinisherSlotReserved(t *testing.T) {
	var m any = Module{}
	f, ok := m.(engine.BoardFinisherSlot)
	if !ok {
		t.Fatal("Module does not implement BoardFinisherSlot")
	}
	if got := f.FinishBoardSeq(); got != engine.RiversBoardSeq {
		t.Fatalf("FinishBoardSeq = %d, want engine.RiversBoardSeq (%d)", got, engine.RiversBoardSeq)
	}
	if engine.RiversBoardSeq >= 0 {
		t.Fatalf("RiversBoardSeq = %d, want negative", engine.RiversBoardSeq)
	}
}

// TestSameSeedSameBoard: the whole derivation is reproducible from the public
// seed, which is what the fairness audit re-derives.
func TestSameSeedSameBoard(t *testing.T) {
	for seed := range uint64(5) {
		a, _ := newGame(t, "base+rivers", 6, seed)
		b, _ := newGame(t, "base+rivers", 6, seed)
		xa, _ := StateExt(a)
		xb, _ := StateExt(b)
		sameRivers(t, "second deal", 6, seed, xa.Rivers, xb.Rivers)
		for _, h := range board.HexesInRadius(a.Board.Radius) {
			if a.Board.Tiles[h] != b.Board.Tiles[h] {
				t.Fatalf("seed %d: the same seed dealt a different tile at %v", seed, h)
			}
		}
	}
}
