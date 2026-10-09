package verify

import (
	"encoding/json"
	"fmt"
	"math/rand/v2"
	"strings"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/scenarios"
)

// oasisRow is one board handed to verify/oasischeck.mjs: the board before the
// Caravans finisher, the generator it ran on, and what Go made of it.
type oasisRow struct {
	Name     string       `json:"name"`
	Players  int          `json:"players"`
	Fair     bool         `json:"fair"`
	Seed1    uint64       `json:"seed1"`
	Seed2    uint64       `json:"seed2"`
	Board    *board.Board `json:"board"`
	Finished *board.Board `json:"finished"`
}

// TestJSLoneOasisPromotion holds the port to the one-oasis promotion at the
// top of scenarios.finishOasis and the fair-mode rebalance after it (derivation 13).
//
// That branch needs a 2-4 seat board with no desert or lake, which engine.New
// never deals (Islands keeps a desert, board.Resolve deals one wherever a hex
// is left to fill), so TestJSDerivesBoards cannot reach it. These are
// real 2-4 seat Islands boards with every desert and lake turned to sea.
func TestJSLoneOasisPromotion(t *testing.T) {
	var rows []oasisRow
	rebalanced := 0
	for _, mode := range []string{board.BoardFair, board.BoardRandom} {
		for _, players := range []int{2, 3, 4} {
			for seed := uint64(1); seed <= 8; seed++ {
				cfg := engine.GameConfig{Players: players, Ruleset: "base+islands", BoardMode: mode}
				evs, err := engine.New(cfg, engine.SeedsFrom(seed))
				if err != nil {
					t.Fatal(err)
				}
				s, err := engine.Replay(evs)
				if err != nil {
					t.Fatal(err)
				}
				b := s.Board.Clone()
				b.Harbors = nil
				for h, tl := range b.Tiles {
					if tl.Res == board.ResNone || tl.Res == board.Lake {
						b.Tiles[h] = board.Tile{Res: board.Sea}
					}
				}
				cfg.Ruleset = engine.CanonicalRuleset("base+caravans+islands")
				done := b.Clone()
				scenarios.Caravans{}.FinishBoard(done, cfg, rand.New(rand.NewPCG(seed, 3)))
				if mode == board.BoardFair {
					// Finish again without the rebalance to count rows it
					// actually changed.
					plain := b.Clone()
					cfg.BoardMode = board.BoardRandom
					scenarios.Caravans{}.FinishBoard(plain, cfg, rand.New(rand.NewPCG(seed, 3)))
					for h, tl := range plain.Tiles {
						if done.Tiles[h] != tl {
							rebalanced++
							break
						}
					}
				}
				rows = append(rows, oasisRow{
					Name: fmt.Sprintf("%s-%dp-%d", mode, players, seed), Players: players,
					Fair: mode == board.BoardFair, Seed1: seed, Seed2: 3, Board: b, Finished: done,
				})
			}
		}
	}
	if rebalanced == 0 {
		t.Fatal("no fair row was moved by the rebalance")
	}
	blob, err := json.Marshal(rows)
	if err != nil {
		t.Fatal(err)
	}
	out, code := node(t, "verify/oasischeck.mjs", writeTemp(t, blob))
	if code != 0 {
		t.Fatalf("oasischeck.mjs disagrees with the engine (exit %d):\n%s", code, out)
	}
	t.Logf("%s (%d fair rows moved by the rebalance)", strings.TrimSpace(out), rebalanced)
}
