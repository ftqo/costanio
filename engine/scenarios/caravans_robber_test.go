package scenarios

import (
	"errors"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// TestCaravansRobberStartsBesideTheBoard: the scenario starts the robber beside
// the board; on the first 7 it goes to any hex with a number token, never the
// oasis. The base game would park it on the desert, which here is the oasis.
func TestCaravansRobberStartsBesideTheBoard(t *testing.T) {
	for _, rs := range []string{
		"base+caravans",
		engine.CanonicalRuleset("base+islands+caravans"),
		engine.CanonicalRuleset("base+cak+caravans"),
		engine.CanonicalRuleset("base+caravans+fishermen"),
	} {
		for _, players := range []int{3, 4, 6} {
			for seed := uint64(1); seed <= 12; seed++ {
				log, err := engine.New(engine.GameConfig{Players: players, Ruleset: rs}, engine.SeedsFrom(seed))
				if err != nil {
					t.Fatal(err)
				}
				s, err := engine.Replay(log)
				if err != nil {
					t.Fatal(err)
				}
				e := caravansExtRO(s)
				if !e.HasOasis {
					t.Fatalf("%s %dp seed %d: no oasis", rs, players, seed)
				}
				if s.Board.RobberOnBoard() {
					t.Fatalf("%s %dp seed %d: robber starts on %v (oasis %v), want beside the board",
						rs, players, seed, s.Board.Robber, e.Oasis)
				}
			}
		}
	}
}

// TestCaravansRobberNeverEntersTheOasis: once in play the robber may go to any
// hex but the oasis. The client's legal set and the server's validation must
// agree, including under Fishermen, where the oasis is the lake.
func TestCaravansRobberNeverEntersTheOasis(t *testing.T) {
	for _, rs := range []string{"base+caravans", engine.CanonicalRuleset("base+caravans+fishermen")} {
		s, _ := newGame(t, rs, 7)
		e := caravansExtRO(s)
		if !e.HasOasis {
			t.Fatalf("%s: no oasis", rs)
		}
		s.RobberPending = true
		s.PendingDiscards = nil
		legal := s.LegalRobberHexes(s.Cur)
		if len(legal) == 0 {
			t.Fatalf("%s: no legal robber hex at all", rs)
		}
		for _, h := range legal {
			if h == e.Oasis {
				t.Fatalf("%s: the oasis %v is offered as a robber destination", rs, h)
			}
		}
		if engine.RobberMayEnter(s, e.Oasis) {
			t.Fatalf("%s: RobberMayEnter says yes to the oasis", rs)
		}
		_, err := engine.Decide(s, engine.Command{
			Player: s.Cur, Type: engine.CmdMoveRobber,
			Data: mustJSON(t, map[string]any{"hex": e.Oasis}),
		})
		if !errors.Is(err, engine.ErrBadPlacement) {
			t.Fatalf("%s: moving the robber onto the oasis: err %v, want ErrBadPlacement", rs, err)
		}
		// The auto-player (timeouts) must pick a legal hex, never the oasis.
		cmd, ok := engine.AutoCommand(s)
		if !ok || cmd.Type != engine.CmdMoveRobber {
			t.Fatalf("%s: auto-play did not move the robber: %v %v", rs, cmd, ok)
		}
		step(t, s, cmd)
		if s.Board.Robber == e.Oasis || !s.Board.Land(s.Board.Robber) {
			t.Fatalf("%s: auto-play put the robber on %v (oasis %v)", rs, s.Board.Robber, e.Oasis)
		}
	}
	// Without Caravans the desert stays a legal destination: the ban is the
	// scenario's, not the base game's.
	s, _ := newGame(t, "base", 7)
	for h, tile := range s.Board.Tiles {
		if tile.Res == board.ResNone && !engine.RobberMayEnter(s, h) {
			t.Fatalf("base: the desert %v is refused to the robber", h)
		}
	}
}
