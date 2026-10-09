package explorers

import (
	"math/rand/v2"
	"slices"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// newGame builds a real Explorers game and folds it to the start of setup.
func newGame(t *testing.T, players int, seed uint64) *engine.State {
	t.Helper()
	evs, err := engine.New(engine.GameConfig{
		Players: players, Ruleset: Name, DiceMode: engine.DiceFair, BoardMode: board.BoardFair,
	}, engine.SeedsFrom(seed))
	if err != nil {
		t.Fatalf("new game: %v", err)
	}
	s, err := engine.Replay(evs)
	if err != nil {
		t.Fatalf("replay: %v", err)
	}
	return s
}

func mustExt(t *testing.T, s *engine.State) *Ext {
	t.Helper()
	x, ok := StateExt(s)
	if !ok {
		t.Fatal("no explorers ext on the state")
	}
	return x
}

// TestHexDirectionsMatchNeighbors pins the direction order this package indexes
// into against the order board.Hex.Neighbors walks. The Council anchors come
// from a direction index, so drift here would move both berths.
func TestHexDirectionsMatchNeighbors(t *testing.T) {
	h := board.Hex{Q: 2, R: -1}
	got := h.Neighbors()
	for i, d := range hexDirections() {
		want := board.Hex{Q: h.Q + d.Q, R: h.R + d.R}
		if got[i] != want {
			t.Fatalf("direction %d: Neighbors gives %v, hexDirections gives %v", i, got[i], want)
		}
	}
}

// TestCornerBetweenMatchesGeometry checks every entry of cornerBetween against
// the grid: the corner it names must be shared by the hex and by both of the
// neighbours in directions i and i+1.
func TestCornerBetweenMatchesGeometry(t *testing.T) {
	h := board.Hex{Q: 3, R: -2}
	verts := h.Vertices()
	dirs := hexDirections()
	for i := range 6 {
		v := verts[cornerBetween[i]]
		a := board.Hex{Q: h.Q + dirs[i].Q, R: h.R + dirs[i].R}
		b := board.Hex{Q: h.Q + dirs[(i+1)%6].Q, R: h.R + dirs[(i+1)%6].R}
		hexes := v.Hexes()
		if !slices.Contains(hexes[:], a) || !slices.Contains(hexes[:], b) {
			t.Fatalf("cornerBetween[%d] = %d gives vertex %v, which does not touch both %v and %v",
				i, cornerBetween[i], v, a, b)
		}
	}
}

// TestBoardRadius: `board.RadiusFor(players) + 3`, which is 5 for 2-4 players, 6
// for 5-6 and 7 for 7-10.
func TestBoardRadius(t *testing.T) {
	for _, tc := range []struct{ players, want int }{
		{2, 5}, {4, 5}, {5, 6}, {6, 6}, {7, 7}, {10, 7},
	} {
		if got := (Module{}).BoardRadius(tc.players); got != tc.want {
			t.Errorf("BoardRadius(%d) = %d, want %d", tc.players, got, tc.want)
		}
		s := newGame(t, tc.players, 1)
		if s.Board.Radius != tc.want {
			t.Errorf("%d players: board radius %d, want %d", tc.players, s.Board.Radius, tc.want)
		}
	}
}

// TestPartitionCoversInterior: home island, home waters and the
// pool are a partition of the interior, with nothing counted twice and nothing
// left out.
func TestPartitionCoversInterior(t *testing.T) {
	for _, players := range []int{2, 4, 6, 8, 10} {
		radius := board.RadiusFor(players) + 3
		l := partition(radius, players)
		seen := map[board.Hex]int{}
		for _, set := range [][]board.Hex{l.home, l.waters, l.pool} {
			for _, h := range set {
				seen[h]++
			}
		}
		interior := board.HexesInRadius(radius - 1)
		if len(seen) != len(interior) {
			t.Errorf("%d players: partition covers %d hexes, interior has %d", players, len(seen), len(interior))
		}
		for _, h := range interior {
			if seen[h] != 1 {
				t.Errorf("%d players: hex %v appears %d times in the partition", players, h, seen[h])
			}
		}
		if want := homeIslandSize(players); len(l.home) != want {
			t.Errorf("%d players: island has %d hexes, want ceil(7*players/2) = %d", players, len(l.home), want)
		}
	}
}

// TestHomeIslandIsContiguous: the (X, |Y|, Y) deal order must produce one
// landmass, not an archipelago.
func TestHomeIslandIsContiguous(t *testing.T) {
	for _, players := range []int{2, 3, 4, 5, 6, 7, 8, 9, 10} {
		l := partition(board.RadiusFor(players)+3, players)
		in := map[board.Hex]bool{}
		for _, h := range l.home {
			in[h] = true
		}
		seen := map[board.Hex]bool{l.home[0]: true}
		queue := []board.Hex{l.home[0]}
		for len(queue) > 0 {
			h := queue[0]
			queue = queue[1:]
			for _, nb := range h.Neighbors() {
				if in[nb] && !seen[nb] {
					seen[nb] = true
					queue = append(queue, nb)
				}
			}
		}
		if len(seen) != len(l.home) {
			t.Errorf("%d players: island of %d hexes has a component of %d", players, len(l.home), len(seen))
		}
	}
}

// TestIslandCoastClearOfFog is what the one-hex home-water ring
// guarantees: both endpoints of an island coastal edge are corners of
// home-island, home-water or rim hexes only, never pool hexes, so every setup
// ship placement is legal.
func TestIslandCoastClearOfFog(t *testing.T) {
	for _, players := range []int{2, 4, 6, 10} {
		s := newGame(t, players, 7)
		x := mustExt(t, s)
		checked := 0
		for _, h := range x.Home {
			for _, e := range h.Edges() {
				if !s.Board.SeaEdge(e) {
					continue
				}
				checked++
				for _, v := range []board.Vertex{e.A, e.B} {
					if vertexTouchesFog(x, v) {
						t.Fatalf("%d players: coastal edge %v of island hex %v looks into the fog", players, e, h)
					}
				}
			}
		}
		if checked == 0 {
			t.Fatalf("%d players: the island has no coastal edges at all", players)
		}
	}
}

// TestRegionsAreBalancedAndComplete: two regions, split about the equator, equal
// to within one hex, and between them the whole pool.
func TestRegionsAreBalancedAndComplete(t *testing.T) {
	for _, players := range []int{2, 4, 6, 8, 10} {
		l := partition(board.RadiusFor(players)+3, players)
		regions := splitRegions(l.pool)
		n, s := len(regions[RegionNorth]), len(regions[RegionSouth])
		if n+s != len(l.pool) {
			t.Errorf("%d players: regions hold %d+%d of %d pool hexes", players, n, s, len(l.pool))
		}
		if diff := n - s; diff > 1 || diff < -1 {
			t.Errorf("%d players: regions are %d and %d, more than one hex apart", players, n, s)
		}
		for _, h := range regions[RegionNorth] {
			if _, y := doubled(h); y > 0 {
				t.Errorf("%d players: hex %v (Y=%d) is south but sits in the north region", players, h, y)
			}
		}
		for _, h := range regions[RegionSouth] {
			if _, y := doubled(h); y < 0 {
				t.Errorf("%d players: hex %v (Y=%d) is north but sits in the south region", players, h, y)
			}
		}
	}
}

// TestRegionHasNineSpecials: 3 gold fields, 3 shoals and 3 farms per
// region, one farm of each village, and shoal numbers 1/2/3 north and 4/5/6
// south, one each.
func TestRegionHasNineSpecials(t *testing.T) {
	for seed := uint64(1); seed <= 12; seed++ {
		for _, players := range []int{2, 4, 6, 10} {
			s := newGame(t, players, seed)
			x := mustExt(t, s)
			var kinds [RegionCount]map[Special]int
			var villages [RegionCount]map[Village]int
			var faces [RegionCount][]int
			for r := range RegionCount {
				kinds[r] = map[Special]int{}
				villages[r] = map[Village]int{}
			}
			for _, p := range x.Pool {
				kinds[p.Region][p.Kind]++
				switch p.Kind {
				case SpecialSpice:
					villages[p.Region][p.Village]++
				case SpecialShoal:
					faces[p.Region] = append(faces[p.Region], p.Shoal)
				case SpecialNone, SpecialGold:
				}
			}
			for r := range RegionCount {
				if kinds[r][SpecialGold] != GoldFieldsPerRegion ||
					kinds[r][SpecialShoal] != ShoalsPerRegion ||
					kinds[r][SpecialSpice] != FarmsPerRegion {
					t.Fatalf("seed %d, %d players, region %d: %d gold, %d shoals, %d farms",
						seed, players, r, kinds[r][SpecialGold], kinds[r][SpecialShoal], kinds[r][SpecialSpice])
				}
				for v := range VillageCount {
					if villages[r][v] != 1 {
						t.Fatalf("seed %d, region %d: village %d appears %d times", seed, r, v, villages[r][v])
					}
				}
				slices.Sort(faces[r])
				want := shoalFaces(r)
				if !slices.Equal(faces[r], want) {
					t.Fatalf("seed %d, region %d: shoal faces %v, want %v", seed, r, faces[r], want)
				}
			}
		}
	}
}

// TestSpecialsOfAKindNotAdjacent checks that no two specials of a kind
// touch.
//
// Nine mutually non-adjacent hexes do not fit in a four-player region (19
// hexes, largest independent set seven), so the placement maximises separation
// and then colours the three kinds so no two of a kind touch: adjacent shoals
// or farms would let one ship work both from one position, and clumped gold
// fields would put a region's lairs in one corner. See the Decision on
// placeSpecials.
func TestSpecialsOfAKindNotAdjacent(t *testing.T) {
	for seed := uint64(1); seed <= 25; seed++ {
		for _, players := range []int{2, 4, 6, 8, 10} {
			s := newGame(t, players, seed)
			x := mustExt(t, s)
			kind := map[board.Hex]Special{}
			for _, p := range x.Pool {
				if p.Kind != SpecialNone {
					kind[p.H] = p.Kind
				}
			}
			for h, k := range kind {
				for _, nb := range h.Neighbors() {
					if kind[nb] == k {
						t.Fatalf("seed %d, %d players: two %v hexes touch at %v and %v", seed, players, k, h, nb)
					}
				}
			}
		}
	}
}

// TestSpecialsAreSpreadOut measures what the relaxation costs. The bound is a
// tripwire set well above every supported count's result, so it fails only on a
// placement that has stopped trying.
func TestSpecialsAreSpreadOut(t *testing.T) {
	worst := map[int]int{}
	for seed := uint64(1); seed <= 12; seed++ {
		for _, players := range []int{2, 4, 6, 8, 10} {
			s := newGame(t, players, seed)
			x := mustExt(t, s)
			var perRegion [RegionCount][]board.Hex
			for _, p := range x.Pool {
				if p.Kind != SpecialNone {
					perRegion[p.Region] = append(perRegion[p.Region], p.H)
				}
			}
			for r := range RegionCount {
				if n := adjacentPairs(perRegion[r]); n > worst[players] {
					worst[players] = n
				}
			}
		}
	}
	for players, n := range worst {
		t.Logf("%d players: worst region had %d adjacent special pairs", players, n)
		if n > 6 {
			t.Errorf("%d players: %d adjacent special pairs in one region is too clumped", players, n)
		}
	}
}

// TestChitStacksExcludeTwoAndTwelve and are sized to the region's producing land
// plus its gold fields.
func TestChitStacksExcludeTwoAndTwelve(t *testing.T) {
	for seed := uint64(1); seed <= 8; seed++ {
		s := newGame(t, 4, seed)
		x := mustExt(t, s)
		land := [RegionCount]int{}
		for _, p := range x.Pool {
			if p.Kind == SpecialNone && s.Board.Tiles[p.H].Res.Producing() {
				land[p.Region]++
			}
		}
		for r := range RegionCount {
			if want := land[r] + GoldFieldsPerRegion; len(x.Chits[r]) != want {
				t.Errorf("seed %d, region %d: %d chits for %d producing hexes plus %d gold fields",
					seed, r, len(x.Chits[r]), land[r], GoldFieldsPerRegion)
			}
			for _, n := range x.Chits[r] {
				if n == 2 || n == 12 {
					t.Errorf("seed %d, region %d: chit stack carries a %d", seed, r, n)
				}
			}
		}
	}
}

// TestCouncilHexPlacement.
func TestCouncilHexPlacement(t *testing.T) {
	for _, players := range []int{2, 4, 6, 10} {
		s := newGame(t, players, 3)
		x := mustExt(t, s)
		if !slices.Contains(x.Waters, x.Council) {
			t.Fatalf("%d players: the Council hex %v is not in home waters", players, x.Council)
		}
		if !s.Board.IsSea(x.Council) {
			t.Fatalf("%d players: the Council hex is not sea", players)
		}
		cx, _ := doubled(x.Council)
		for _, h := range x.Waters {
			if hx, _ := doubled(h); hx > cx {
				t.Fatalf("%d players: water hex %v is further east than the Council %v", players, h, x.Council)
			}
		}
		if len(x.Anchors) != 2 {
			t.Fatalf("%d players: %d anchors, want 2", players, len(x.Anchors))
		}
		verts := x.Council.Vertices()
		var idx []int
		for _, a := range x.Anchors {
			i := slices.Index(verts[:], a)
			if i < 0 {
				t.Fatalf("%d players: anchor %v is not a corner of the Council hex", players, a)
			}
			idx = append(idx, i)
		}
		// Opposite corners of a hex are three apart in Vertices() order.
		if d := (idx[0] - idx[1] + 6) % 6; d != 3 {
			t.Errorf("%d players: anchors at corners %v are not opposite", players, idx)
		}
	}
}

// TestNoRobberNoHarboursNoDesert: three of the four subtractions, on the board
// itself. (The fourth, the development deck, is a hook.)
func TestNoRobberNoHarboursNoDesert(t *testing.T) {
	for seed := uint64(1); seed <= 10; seed++ {
		s := newGame(t, 4, seed)
		x := mustExt(t, s)
		if s.Board.RobberOnBoard() {
			t.Errorf("seed %d: the robber is on the board", seed)
		}
		if len(s.Board.Harbors) != 0 {
			t.Errorf("seed %d: %d harbours were generated", seed, len(s.Board.Harbors))
		}
		for _, h := range x.Home {
			if t2 := s.Board.Tiles[h]; !t2.Res.Producing() {
				t.Errorf("seed %d: home island hex %v is %v, not producing terrain", seed, h, t2.Res)
			} else if t2.Number == 0 {
				t.Errorf("seed %d: home island hex %v has no number", seed, h)
			}
		}
	}
}

// TestRimIsSea at distance exactly R, all the way round.
func TestRimIsSea(t *testing.T) {
	s := newGame(t, 4, 5)
	rim := 0
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		if dist(h) != s.Board.Radius {
			continue
		}
		rim++
		if !s.Board.IsSea(h) {
			t.Fatalf("rim hex %v is %v, not sea", h, s.Board.Tiles[h].Res)
		}
	}
	if rim == 0 {
		t.Fatal("no rim hexes found")
	}
}

// TestBoardDeterministicPerSeed: two games from one seed are the same
// board, and two seeds are (nearly always) different ones.
func TestBoardDeterministicPerSeed(t *testing.T) {
	a := newGame(t, 4, 42)
	b := newGame(t, 4, 42)
	for h, ta := range a.Board.Tiles {
		if tb := b.Board.Tiles[h]; tb != ta {
			t.Fatalf("hex %v: %v vs %v from the same seed", h, ta, tb)
		}
	}
	c := newGame(t, 4, 43)
	same := true
	for h, ta := range a.Board.Tiles {
		if c.Board.Tiles[h] != ta {
			same = false
			break
		}
	}
	if same {
		t.Error("seeds 42 and 43 produced the same board")
	}
}

// TestRefusesAuthoredMap. The board is a partition, a chit stack and
// a hidden pool order; a preset's fixed tiles carry none of it, and reshaping
// one would delete the map the host chose.
func TestRefusesAuthoredMap(t *testing.T) {
	b, err := board.PresetBoard("beginner", 4, rand.New(rand.NewPCG(1, 2)))
	if err != nil {
		t.Skipf("no beginner preset in this build: %v", err)
	}
	if err := engine.ValidateMap(b, Name); err == nil {
		t.Error("an authored map was accepted for the explorers ruleset")
	}
	if iss := engine.MapEligibilityIssues(b, Name); len(iss) == 0 {
		t.Error("the builder lint offers no issue for an explorers map")
	} else if iss[0].Code != "module_refuses_map" {
		t.Errorf("the issue is %q, want module_refuses_map", iss[0].Code)
	}
	// And a game created with one is refused rather than reshaped.
	if _, err := engine.New(engine.GameConfig{
		Players: 4, Ruleset: Name, Preset: "beginner",
		DiceMode: engine.DiceFair, BoardMode: board.BoardFair,
	}, engine.SeedsFrom(1)); err == nil {
		t.Error("a preset Explorers game was created")
	}
	// A procedural one is still fine.
	if _, err := engine.New(engine.GameConfig{
		Players: 4, Ruleset: Name, DiceMode: engine.DiceFair, BoardMode: board.BoardFair,
	}, engine.SeedsFrom(1)); err != nil {
		t.Errorf("a procedural Explorers game was refused: %v", err)
	}
}
