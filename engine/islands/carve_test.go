package islands

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// proceduralBoard generates the board a real base+islands game would get.
func proceduralBoard(t *testing.T, players int, seed uint64, mode string) *board.Board {
	t.Helper()
	log, err := engine.New(engine.GameConfig{Players: players, Ruleset: "base+islands", BoardMode: mode}, engine.SeedsFrom(seed))
	if err != nil {
		t.Fatalf("%dp seed %d: %v", players, seed, err)
	}
	for _, e := range log {
		if e.Type == engine.EvBoardGenerated {
			if b := engine.DecodeEvent[engine.BoardGeneratedData](e).Board; b != nil {
				return b
			}
		}
	}
	t.Fatalf("%dp seed %d: no board_generated event", players, seed)
	return nil
}

// islandSizes groups Board.Islands() by component id.
func islandSizes(b *board.Board) map[int]int {
	sizes := map[int]int{}
	for _, id := range b.Islands() {
		sizes[id]++
	}
	return sizes
}

// TestCarveActuallyMakesIslands: the carve must split the board into more than
// one landmass. Drowning only the outermost ring leaves every survivor
// connected through ring R-1, so this checks the component count.
//
// 60 seeds per player count: the structure depends on geometry and one rotation
// draw over 6R positions, so a few dozen seeds per radius cover every offset
// several times.
func TestCarveActuallyMakesIslands(t *testing.T) {
	for players := 2; players <= 10; players++ {
		radius := board.RadiusFor(players)
		want := 1 + outerIslands(radius)
		for _, mode := range []string{"fair", "random"} {
			for seed := uint64(1); seed <= 60; seed++ {
				b := proceduralBoard(t, players, seed, mode)
				sizes := islandSizes(b)
				if len(sizes) != want {
					t.Fatalf("%dp/%s/seed %d: %d landmasses, want %d (sizes %v)",
						players, mode, seed, len(sizes), want, sizes)
				}
				for id, n := range sizes {
					// A one-hex island can be reached but never grown on; every
					// island must be worth the ships.
					if n < 2 {
						t.Fatalf("%dp/%s/seed %d: island %d is %d hex(es)", players, mode, seed, id, n)
					}
				}
			}
		}
	}
}

// TestCarvedBoardsStayValid: the carve moves terrain around, so everything that
// validates a board has to keep accepting one. ValidateLayout is the gate the
// share code, POST /api/maps/* and the builder all run; ValidateMap is the
// ruleset-terrain gate (Islands needs sea, and nothing else may claim Gold).
func TestCarvedBoardsStayValid(t *testing.T) {
	for players := 2; players <= 10; players++ {
		for seed := uint64(1); seed <= 60; seed++ {
			b := proceduralBoard(t, players, seed, "fair")
			if err := b.ValidateLayout(); err != nil {
				t.Fatalf("%dp seed %d: ValidateLayout: %v", players, seed, err)
			}
			if err := engine.ValidateMap(b, "base+islands"); err != nil {
				t.Fatalf("%dp seed %d: ValidateMap: %v", players, seed, err)
			}
			if !hasNeutral(b) {
				t.Fatalf("%dp seed %d: no desert or lake survived the carve", players, seed)
			}
			if !b.RobberOK(b.Robber) {
				t.Fatalf("%dp seed %d: robber at %v is not on a hex it may occupy", players, seed, b.Robber)
			}
		}
	}
}

// TestEveryIslandIsReachableBySea: ships run along sea edges, so some vertex of
// the island must share a sea-edge component with the mainland coast.
func TestEveryIslandIsReachableBySea(t *testing.T) {
	for players := 2; players <= 10; players++ {
		for seed := uint64(1); seed <= 40; seed++ {
			b := proceduralBoard(t, players, seed, "fair")
			ids := b.Islands()
			sizes := islandSizes(b)
			mainland, best := -1, -1
			for id, n := range sizes {
				if n > best {
					mainland, best = id, n
				}
			}
			reached := seaReachableIslands(b, ids, mainland)
			for id := range sizes {
				if !reached[id] {
					t.Fatalf("%dp seed %d: island %d cannot be reached by ship from the mainland", players, seed, id)
				}
			}
		}
	}
}

// seaReachableIslands floods the sea-edge graph out from every vertex of the
// mainland coast and reports which landmasses it touches.
func seaReachableIslands(b *board.Board, ids map[board.Hex]int, mainland int) map[int]bool {
	adj := map[board.Vertex][]board.Vertex{}
	for _, h := range board.HexesInRadius(b.Radius) {
		for _, e := range h.Edges() {
			ne := board.NewEdge(e.A, e.B)
			if !ne.Valid() || !b.SeaEdge(ne) {
				continue
			}
			adj[ne.A] = append(adj[ne.A], ne.B)
			adj[ne.B] = append(adj[ne.B], ne.A)
		}
	}
	seen := map[board.Vertex]bool{}
	var stack []board.Vertex
	for v := range adj {
		for _, h := range v.Hexes() {
			if id, ok := ids[h]; ok && id == mainland && !seen[v] {
				seen[v] = true
				stack = append(stack, v)
			}
		}
	}
	for len(stack) > 0 {
		cur := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		for _, n := range adj[cur] {
			if !seen[n] {
				seen[n] = true
				stack = append(stack, n)
			}
		}
	}
	out := map[int]bool{}
	for v := range seen {
		for _, h := range v.Hexes() {
			if id, ok := ids[h]; ok {
				out[id] = true
			}
		}
	}
	return out
}

// TestEveryCarvedBoardHasGold: gold is a whole terrain with its own pending
// action (choose_gold), so every board must have it, as Caravans guarantees its
// oasis.
func TestEveryCarvedBoardHasGold(t *testing.T) {
	for players := 2; players <= 10; players++ {
		for _, mode := range []string{"fair", "random"} {
			for seed := uint64(1); seed <= 60; seed++ {
				b := proceduralBoard(t, players, seed, mode)
				gold := 0
				for _, t := range b.Tiles {
					if t.Res == board.Gold {
						gold++
					}
				}
				if gold == 0 {
					t.Fatalf("%dp/%s/seed %d: no gold hex on the board", players, mode, seed)
				}
			}
		}
	}
}

// TestCarveIsDeterministic: the carve is a function of the seed alone.
// verify/modules.mjs depends on this, and map iteration leaking into a decision
// would break it.
func TestCarveIsDeterministic(t *testing.T) {
	for players := 2; players <= 10; players += 2 {
		for seed := uint64(1); seed <= 20; seed++ {
			a := proceduralBoard(t, players, seed, "fair")
			c := proceduralBoard(t, players, seed, "fair")
			if len(a.Tiles) != len(c.Tiles) || a.Robber != c.Robber || len(a.Harbors) != len(c.Harbors) {
				t.Fatalf("%dp seed %d: board shape differs between runs", players, seed)
			}
			for h, tile := range a.Tiles {
				if c.Tiles[h] != tile {
					t.Fatalf("%dp seed %d: hex %v is %v then %v", players, seed, h, tile, c.Tiles[h])
				}
			}
			for i, hb := range a.Harbors {
				if c.Harbors[i] != hb {
					t.Fatalf("%dp seed %d: harbor %d moved", players, seed, i)
				}
			}
		}
	}
}

// TestIslandChipFiresOnAProceduralBoard: TestIslandChipsOnAuthoredBoard covers
// the authored path; this covers the generated one.
func TestIslandChipFiresOnAProceduralBoard(t *testing.T) {
	for seed := uint64(1); seed <= 25; seed++ {
		s, _ := newGame(t, seed)
		ids := s.Board.Islands()
		sizes := islandSizes(s.Board)
		mainland, best := -1, -1
		for id, n := range sizes {
			if n > best {
				mainland, best = id, n
			}
		}
		v, island, ok := offshoreVertex(s, ids, mainland, 0)
		if !ok {
			continue
		}
		built := engine.NewEvent(engine.EvSettlementBuilt, engine.BuiltData{Player: 0, V: &v})
		out := (Module{}).onEvents(s, []engine.Event{built})
		if !hasEvent(out, EvIslandChip) {
			t.Fatalf("seed %d: settling island %d at %v awarded no chip", seed, island, v)
		}
		for _, e := range out {
			if e.Type != EvIslandChip {
				continue
			}
			d := engine.DecodeEvent[islandChipData](e)
			if d.VP != configFrom(s.Config).IslandVP {
				t.Fatalf("seed %d: chip is worth %d VP, want %d", seed, d.VP, configFrom(s.Config).IslandVP)
			}
		}
		return
	}
	// The search budget ran out. Fail rather than skip so this path cannot go
	// silently untested.
	t.Fatal("no seed in 1..25 has a free offshore vertex")
}

// offshoreVertex finds a free vertex whose hexes all belong to one non-mainland
// island p has no building on, the case the chip is for.
func offshoreVertex(s *engine.State, ids map[board.Hex]int, mainland int, p engine.PlayerID) (board.Vertex, int, bool) {
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		id, ok := ids[h]
		if !ok || id == mainland {
			continue
		}
		for _, v := range h.Vertices() {
			if _, taken := s.Buildings[v]; taken {
				continue
			}
			only := true
			for _, vh := range v.Hexes() {
				if vid, ok := ids[vh]; ok && vid != id {
					only = false
				}
			}
			if !only || playerOnIslandElsewhere(s, p, id, v, ids) {
				continue
			}
			return v, id, true
		}
	}
	return board.Vertex{}, 0, false
}
