package scenarios

import (
	"math"
	"math/rand/v2"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// pipSpread is the fair-mode balance measure: the spread of per-resource
// average pips over the producing hexes (engine/rivers' fair-band test uses the
// same one). The generator's fair search stops at 0.34.
func pipSpread(b *board.Board) float64 {
	var sum, count [6]int
	for _, t := range b.Tiles {
		if !t.Res.Producing() {
			continue
		}
		sum[t.Res] += board.Pips(t.Number)
		count[t.Res]++
	}
	lo, hi := math.Inf(1), math.Inf(-1)
	for _, r := range board.Resources {
		if count[r] == 0 {
			continue
		}
		avg := float64(sum[r]) / float64(count[r])
		lo, hi = math.Min(lo, avg), math.Max(hi, avg)
	}
	return hi - lo
}

// TestFillOasesRebalancesAFairBoard: a promotion takes a token off a balanced
// board, so on a fair-mode board finishOasis rebalances the engine-dealt tokens
// afterwards, as Rivers does. Over carved Islands boards at 5 to 10 seats that
// needed a promotion, rebalanced boards are on average better balanced. The oasis
// count is held by ruletest.TestEveryCaravansTableGetsItsOases on real boards.
func TestFillOasesRebalancesAFairBoard(t *testing.T) {
	promotedBoards := 0
	var with, without float64
	for _, players := range []int{5, 6, 7, 8} {
		for seed := uint64(1); seed <= 30; seed++ {
			s := boardGame(t, "base+islands", players, seed)
			cfg := engine.GameConfig{Players: players, Ruleset: engine.CanonicalRuleset("base+caravans+islands"), BoardMode: board.BoardFair}
			n := oasisCountFor(players)
			if len(pickOases(s.Board, n)) == n {
				continue
			}
			a, b := s.Board.Clone(), s.Board.Clone()
			finishOasis(a, cfg, rand.New(rand.NewPCG(seed, 3)))
			for _, o := range pickOases(a, n) {
				if spokeCount(a, o) != caravansPerOasis {
					continue // a stuck ring oasis the swaps could not move
				}
				if tl := a.Tiles[o]; tl.Number != 0 {
					t.Fatalf("%dp seed %d: oasis %v keeps number %d", players, seed, o, tl.Number)
				}
			}
			// Neither a promotion nor a swap partner may be a 6 or an 8: a hex
			// that carried one before the finisher is never an oasis after it.
			for _, o := range pickOases(a, n) {
				if num := s.Board.Tiles[o].Number; num == 6 || num == 8 {
					t.Errorf("%dp seed %d: oasis %v was dealt a %d", players, seed, o, num)
				}
			}
			// The same board, same draws, without the rebalance.
			cfg.BoardMode = board.BoardRandom
			finishOasis(b, cfg, rand.New(rand.NewPCG(seed, 3)))
			promotedBoards++
			with += pipSpread(a)
			without += pipSpread(b)
		}
	}
	if promotedBoards == 0 {
		t.Fatal("no board in the sweep was an oasis short")
	}
	with, without = with/float64(promotedBoards), without/float64(promotedBoards)
	t.Logf("%d promoted boards: mean pip spread %.3f rebalanced, %.3f not", promotedBoards, with, without)
	if with >= without {
		t.Errorf("mean spread %.3f rebalanced, %.3f without: no improvement", with, without)
	}
}

// crowdedIsletMap is an authored 7-seat map (radius 4) broken up by sea so that,
// with its one pinned desert, the table is two oases short and some candidate
// clashes with every other: a blind draw could take it and leave no room for the
// third oasis. verify.TestJSCrowdedOasisFill uses the same map.
func crowdedIsletMap() *board.Board {
	sea := map[board.Hex]bool{}
	for _, h := range []board.Hex{
		{Q: -4, R: 0}, {Q: -4, R: 3}, {Q: -3, R: -1}, {Q: -3, R: 0}, {Q: -3, R: 3}, {Q: -3, R: 4},
		{Q: -2, R: 1}, {Q: -2, R: 2}, {Q: -2, R: 4}, {Q: -1, R: -3}, {Q: -1, R: 2}, {Q: -1, R: 3},
		{Q: -1, R: 4}, {Q: 0, R: -4}, {Q: 0, R: -3}, {Q: 0, R: -2}, {Q: 0, R: 0}, {Q: 0, R: 1},
		{Q: 0, R: 2}, {Q: 0, R: 3}, {Q: 1, R: -4}, {Q: 1, R: -3}, {Q: 1, R: 0}, {Q: 2, R: -4},
		{Q: 2, R: -3}, {Q: 2, R: -1}, {Q: 2, R: 0}, {Q: 2, R: 2}, {Q: 3, R: -4}, {Q: 3, R: -2},
		{Q: 3, R: -1}, {Q: 3, R: 0}, {Q: 4, R: -4}, {Q: 4, R: -3},
	} {
		sea[h] = true
	}
	b := &board.Board{Radius: 4, Tiles: map[board.Hex]board.Tile{}, Robber: board.Hex{Q: 4, R: 0}}
	for _, h := range board.HexesInRadius(4) {
		switch {
		case sea[h]:
			b.Tiles[h] = board.Tile{Res: board.Sea}
		case h == b.Robber:
			b.Tiles[h] = board.Tile{Res: board.ResNone}
		default:
			b.Tiles[h] = board.Tile{Res: board.ResLand}
		}
	}
	return b
}

// TestFillOasesLeavesRoomForTheNextOasis: on crowdedIsletMap the fill must
// promote two hexes, drawing each only among candidates that leave room for the
// rest (fillable). A draw among all candidates would sometimes finish short.
func TestFillOasesLeavesRoomForTheNextOasis(t *testing.T) {
	bound := 0
	for seed := uint64(1); seed <= 12; seed++ {
		cfg := engine.GameConfig{Players: 7, Ruleset: "base+caravans", DiceMode: "fair",
			BoardMode: board.BoardFair, TurnOrder: engine.TurnOrderRandom, Board: crowdedIsletMap()}
		log, err := engine.New(cfg, engine.SeedsFrom(seed))
		if err != nil {
			t.Fatal(err)
		}
		s := engine.Empty()
		for _, e := range log {
			if err := engine.Apply(s, e); err != nil {
				t.Fatal(err)
			}
		}
		x := caravansExt(s)
		if len(x.Oases) != 3 {
			t.Errorf("seed %d: %d oases, want 3", seed, len(x.Oases))
		}
		for i, a := range x.Arrows {
			if a == (board.Edge{}) && x.Oases[i/3] != cfg.Board.Robber {
				t.Errorf("seed %d: promoted oasis %v has no spoke %d", seed, x.Oases[i/3], i%3)
			}
		}
		bound++
	}
	if bound == 0 {
		t.Fatal("no seed built")
	}
}

// TestSinglePromotionRebalancesAFairBoard: at 2 to 4 seats, a board with no
// desert or lake left gets one producing hex promoted at the top of finishOasis.
// That takes a token off a balanced board, so a fair-mode board is rebalanced
// afterwards (derivation 13); a random-mode board is left as is.
//
// engine.New does not deal such a board, so the test builds one: a fair 2-4
// seat Islands board with every desert drowned.
func TestSinglePromotionRebalancesAFairBoard(t *testing.T) {
	promoted, moved := 0, 0
	var with, without float64
	for _, players := range []int{2, 3, 4} {
		for seed := uint64(1); seed <= 40; seed++ {
			base := drownedDesertBoard(t, players, seed)
			cfg := engine.GameConfig{Players: players, Ruleset: engine.CanonicalRuleset("base+caravans+islands"), BoardMode: board.BoardFair}
			a, b := base.Clone(), base.Clone()
			finishOasis(a, cfg, rand.New(rand.NewPCG(seed, 3)))
			if _, ok := pickOasis(a); !ok {
				t.Fatalf("%dp seed %d: no oasis promoted", players, seed)
			}
			cfg.BoardMode = board.BoardRandom
			finishOasis(b, cfg, rand.New(rand.NewPCG(seed, 3)))
			// The same hex was promoted, and the fair board is exactly the
			// random one rebalanced.
			oa, _ := pickOasis(a)
			ob, _ := pickOasis(b)
			if oa != ob {
				t.Fatalf("%dp seed %d: fair promoted %v, random %v", players, seed, oa, ob)
			}
			want := b.Clone()
			want.Rebalance(func(board.Hex) bool { return true })
			for h, tl := range want.Tiles {
				if a.Tiles[h] != tl {
					t.Fatalf("%dp seed %d: fair board at %v is %+v, want the rebalanced %+v", players, seed, h, a.Tiles[h], tl)
				}
			}
			for h, tl := range b.Tiles {
				if a.Tiles[h] != tl {
					moved++
					break
				}
			}
			promoted++
			with += pipSpread(a)
			without += pipSpread(b)
		}
	}
	if moved == 0 {
		t.Fatal("no promoted fair board was rebalanced")
	}
	with, without = with/float64(promoted), without/float64(promoted)
	t.Logf("%d promoted boards, %d moved by the rebalance: mean pip spread %.3f rebalanced, %.3f not", promoted, moved, with, without)
	if with >= without {
		t.Errorf("mean spread %.3f rebalanced, %.3f without: no improvement", with, without)
	}
}

// drownedDesertBoard is a fair base+islands board at `players` seats with every
// desert and lake turned to sea, as a carve that took the last desert would
// leave it.
func drownedDesertBoard(t *testing.T, players int, seed uint64) *board.Board {
	t.Helper()
	log, err := engine.New(engine.GameConfig{Players: players, Ruleset: "base+islands", BoardMode: board.BoardFair}, engine.SeedsFrom(seed))
	if err != nil {
		t.Fatal(err)
	}
	s := engine.Empty()
	for _, e := range log {
		if err := engine.Apply(s, e); err != nil {
			t.Fatal(err)
		}
	}
	b := s.Board.Clone()
	for _, h := range neutralHexes(b) {
		b.Tiles[h] = board.Tile{Res: board.Sea}
	}
	return b
}
