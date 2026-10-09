package scenarios

import (
	"encoding/json"
	"math"
	"math/rand/v2"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// TestSettlementDrawsOneAndCityDrawsTwo: every adjacent settlement draws one fish
// tile and every city two. Pinned for both building kinds at once on a
// constructed lake shore.
func TestSettlementDrawsOneAndCityDrawsTwo(t *testing.T) {
	s, _ := newGame(t, "base+fishermen", 2)
	var lake board.Hex
	found := false
	for h, tile := range s.Board.Tiles {
		if tile.Res == board.Lake {
			lake, found = h, true
		}
	}
	if !found {
		t.Fatal("no lake")
	}
	// Clear every building off the lake shore, then place exactly one
	// settlement for seat 0 and one city for seat 2 on two non-adjacent
	// corners (0 and 3), so each seat's draw is one building's.
	for _, v := range lake.Vertices() {
		delete(s.Buildings, v)
	}
	vs := lake.Vertices()
	s.Buildings[vs[0]] = engine.Building{Owner: 0}
	s.Buildings[vs[3]] = engine.Building{Owner: 2, City: true}
	// The robber must not be on the lake, or it blocks all four numbers.
	s.Board.Robber = board.OffBoard
	// Nobody may be near the cap, which trims a draw rather than counting it.
	x := fishExt(s)
	for p := range x.Held {
		x.Held[p] = [3]int{}
		x.Tiles[p] = 0
	}

	events := fishCatch(s, 1, 1) // a 2: a lake number, and no fishing ground's
	if len(events) == 0 || events[0].Type != EvFishCaught {
		t.Fatalf("no catch on a lake number: %+v", events)
	}
	var caught struct {
		Draws []int `json:"draws"`
		Total int   `json:"total"`
	}
	if err := json.Unmarshal(events[0].Data, &caught); err != nil {
		t.Fatal(err)
	}
	want := []int{1, 0, 2}
	for p, n := range want {
		if caught.Draws[p] != n {
			t.Errorf("seat %d drew %d tiles, want %d (settlement 1, city 2): %v", p, caught.Draws[p], n, caught.Draws)
		}
	}
	if caught.Total != 3 {
		t.Errorf("total drawn %d, want 3", caught.Total)
	}
}

// TestBootLandsInProportionToTilesDrawn: the old boot goes to one of that roll's
// drawers, weighted by draws. TestWeightedDrawer only checks it never lands on a
// non-drawer; this checks the weights, over a fixed-seed sample large enough that
// a first-drawer or uniform rule is off by tens of points.
func TestBootLandsInProportionToTilesDrawn(t *testing.T) {
	draws := []int{1, 0, 3, 2}
	const n = 60000
	counts := make([]int, len(draws))
	rng := rand.New(rand.NewPCG(7, 13))
	for range n {
		p := weightedDrawer(draws, rng)
		if p == engine.NoPlayer {
			t.Fatal("weightedDrawer returned no seat with tiles drawn")
		}
		counts[p]++
	}
	if counts[1] != 0 {
		t.Fatalf("seat 1 drew nothing and got the boot %d times", counts[1])
	}
	for p, d := range draws {
		want := float64(d) / 6
		got := float64(counts[p]) / n
		if math.Abs(got-want) > 0.01 {
			t.Errorf("seat %d: boot share %.3f, want %.3f (tiles %d of 6)", p, got, want, d)
		}
	}
}
