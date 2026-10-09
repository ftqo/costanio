package scenarios

import (
	"errors"
	"maps"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/knights"
)

// The fish-spend table meets two Knights suppressions: NoDevCards (only progress
// cards) and NoRobber (the robber stays out until the barbarians first land). A
// spend the ruleset cannot honour must be refused before any tile is destroyed.
//
// engine.New always fills s.DevDeck, so an unguarded 7-fish draw could hand out a
// dead card or a victory-point card counting toward Knights' 13 from a deck the
// ruleset lacks. Under Knights the combination rule replaces the rung with one
// progress card of the player's choice, so dev_card is refused exactly where
// progress_card is offered; both directions are tested.
func TestFishSpendsRespectModuleSuppressions(t *testing.T) {
	const startFish = 20

	cases := []struct {
		name    string
		ruleset string
		use     string
		data    func(t *testing.T, s *engine.State) map[string]any
		wantErr error // nil = the spend must succeed
	}{
		{
			name:    "dev card refused under knights",
			ruleset: "base+fishermen+cak",
			use:     FishDevCard,
			wantErr: ErrSpendUnavailable,
		},
		{
			name:    "dev card allowed without knights",
			ruleset: "base+fishermen",
			use:     FishDevCard,
		},
		{
			name:    "progress card allowed under knights",
			ruleset: "base+fishermen+cak",
			use:     FishProgressCard,
			data:    func(*testing.T, *engine.State) map[string]any { return map[string]any{"deck": 0} },
		},
		{
			name:    "progress card refused without knights",
			ruleset: "base+fishermen",
			use:     FishProgressCard,
			data:    func(*testing.T, *engine.State) map[string]any { return map[string]any{"deck": 0} },
			wantErr: ErrSpendUnavailable,
		},
		{
			name:    "robber removal refused under knights",
			ruleset: "base+fishermen+cak",
			use:     FishRemoveRobber,
			wantErr: ErrSpendUnavailable,
		},
		{
			name:    "robber removal allowed without knights",
			ruleset: "base+fishermen",
			use:     FishRemoveRobber,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s, _ := newGame(t, tc.ruleset, 7)
			rolled(t, s)
			p := s.Cur
			x := fishExt(s)
			setHeld(x, p, [3]int{startFish, 0, 0})

			// Fishermen's setup leaves the robber beside the board, where the
			// two-fish spend has nothing to remove. Park it on a producing hex
			// first, as a 7 would.
			robberOntoProducing(t, s)

			data := map[string]any{"use": tc.use}
			if tc.data != nil {
				maps.Copy(data, tc.data(t, s))
			}

			devBefore := s.DevDeck.Count()
			cmd := engine.Command{Player: p, Type: CmdSpendFish, Data: mustJSON(t, data)}
			if tc.wantErr == nil {
				step(t, s, cmd)
				if got := fishTotal(x.Held[p]); got != startFish-fishCosts[tc.use] {
					t.Errorf("allowed spend took %d fish, want %d", startFish-got, fishCosts[tc.use])
				}
				return
			}
			ev, err := engine.Decide(s, cmd)
			if !errors.Is(err, tc.wantErr) {
				t.Fatalf("spend %s in %s: err = %v, want %v", tc.use, tc.ruleset, err, tc.wantErr)
			}
			// A refusal costs nothing. Events returned alongside an error never
			// reach a caller (Decide drops them), so asserting on ev would be
			// vacuous. The live risk is a module writing s.Ext directly;
			// decideSpend reads through fishExtRO to avoid that, so these
			// assertions are on s.
			if len(ev) != 0 {
				t.Fatalf("refused spend returned events: %+v", ev)
			}
			if got := fishTotal(x.Held[p]); got != startFish {
				t.Errorf("refused spend still took fish: held = %d, want %d", got, startFish)
			}
			if s.DevDeck.Count() != devBefore {
				t.Errorf("refused spend touched the dev deck: %d, want %d", s.DevDeck.Count(), devBefore)
			}
		})
	}
}

// Once the barbarians land the robber is in play and the 2-fish removal
// returns: the suppression follows the state, not the ruleset.
func TestFishRobberRemovalReturnsWithTheRobber(t *testing.T) {
	s, _ := newGame(t, "base+fishermen+cak", 7)
	rolled(t, s)
	p := s.Cur
	setHeld(fishExt(s), p, [3]int{20, 0, 0})

	cx, ok := knights.StateExt(s)
	if !ok {
		t.Fatal("cak module not active")
	}
	cx.Attacks = 1 // the barbarians have landed once; the robber is out of the box

	robberOntoProducing(t, s)
	step(t, s, engine.Command{Player: p, Type: CmdSpendFish,
		Data: mustJSON(t, map[string]any{"use": FishRemoveRobber})})
	if s.Board.RobberOnBoard() {
		t.Errorf("robber = %v, want it off the board", s.Board.Robber)
	}
}

// robberOntoProducing parks the robber on a producing hex, as a rolled 7 would.
// Fishermen's setup leaves it beside the board (it enters on the first 7), so a
// fixture exercising the two-fish removal must put it in play first.
func robberOntoProducing(t *testing.T, s *engine.State) {
	t.Helper()
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		if s.Board.Tiles[h].Res.Producing() {
			s.Board.Robber = h
			return
		}
	}
	t.Fatal("no producing hex to park the robber on")
}
