package raiders

import (
	"errors"
	"math/rand/v2"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// The coastline alone is not enough: if conquest saturates it, players still
// need numbered terrain that produces and keeps their buildings standing. The
// castle cannot supply that refuge because it never produces.
func TestProceduralBoardsHaveProductiveRefuge(t *testing.T) {
	for _, players := range []int{2, 4, 6, 8, 10} {
		for _, ruleset := range []string{"base+islands+raiders", "base+cak+islands+raiders", "base+cak+caravans+fishermen+islands+raiders"} {
			for seed := range uint64(32) {
				events, err := engine.New(engine.GameConfig{Players: players, Ruleset: ruleset}, engine.SeedsFrom(seed))
				if err != nil {
					t.Fatal(err)
				}
				s, err := engine.Replay(events)
				if err != nil {
					t.Fatal(err)
				}
				x := ext(s)
				set := hexSet(x.Land)
				refuge := false
				for _, h := range x.Land {
					tile := s.Board.Tiles[h]
					if h != x.Castle && tile.Res.Producing() && tile.Number > 0 && !isCoastal(s.Board, set, h) {
						refuge = true
					}
				}
				if !refuge || len(x.Coast) < minCoastHexes {
					t.Fatalf("%s %dp seed %d: refuge=%v coast=%d", ruleset, players, seed, refuge, len(x.Coast))
				}
				components := map[int]bool{}
				for _, id := range s.Board.Islands() {
					components[id] = true
				}
				if len(components) < 2 {
					t.Fatalf("%s %dp seed %d: repair joined every island", ruleset, players, seed)
				}
				before := s.Board.Clone()
				(Module{}).FinishBoard(s.Board, s.Config, nil)
				for h, tile := range before.Tiles {
					if s.Board.Tiles[h] != tile {
						t.Fatalf("repair was not idempotent at %v", h)
					}
				}
			}
		}
	}
}

func TestEnclosedAuthoredMainlandIsRejected(t *testing.T) {
	b := &board.Board{Radius: 3, Tiles: map[board.Hex]board.Tile{}}
	for _, h := range board.HexesInRadius(1) {
		b.Tiles[h] = board.Tile{Res: board.Wood, Number: 5}
	}
	// Small separate islands surround the mainland across a water channel.
	// Each arc is smaller than the mainland, but together they block every
	// attached radius-two refuge patch without joining the islands.
	i := 0
	for _, h := range board.HexesInRadius(3) {
		if max(abs(h.Q), abs(h.R), abs(h.Q+h.R)) != 3 {
			continue
		}
		if i%3 != 0 {
			b.Tiles[h] = board.Tile{Res: board.Sheep, Number: 9}
		}
		i++
	}
	b.Frame()
	cfg := engine.GameConfig{Players: 2, Ruleset: "base+raiders", Board: b}
	(Module{}).FinishBoard(b, cfg, rand.New(rand.NewPCG(1, 2)))
	if err := (Module{}).ValidateFinishedBoard(b, cfg); !errors.Is(err, ErrNoRefuge) {
		t.Fatalf("unrepairable board accepted: %v", err)
	}
	if _, err := engine.New(cfg, engine.SeedsFrom(1)); !errors.Is(err, ErrNoRefuge) {
		t.Fatalf("game creation did not report missing refuge: %v", err)
	}
}
