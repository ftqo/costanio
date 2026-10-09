package scenarios

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	_ "github.com/ftqo/costan.io/engine/islands"
)

// TestComposedWinThresholds pins the number a stacked game is actually played to,
// through the real Decide path.
//
// The target composes three mechanisms: ConfigDefaulters fill TargetVP only when
// it is zero (first module in lexicographic order wins, as cak's 13 does),
// TargetVPAdjusters are summed on top (Caravans' +2), and Fishermen's boot is a
// per-seat WinThresholdDelta above the target. base+cak+caravans+fishermen
// therefore plays to 15.
//
// Each case walks the boot-holder up one VP at a time and records the total at
// which engine.Decide first ends the game. State is constructed, so the number is
// exact.
func TestComposedWinThresholds(t *testing.T) {
	cases := []struct {
		ruleset string
		target  int // the configured target, before the boot
		want    int // what the boot-holder actually needs
	}{
		{"base+fishermen", 10, 11},
		{"base+caravans+fishermen", 12, 13},
		{"base+cak+fishermen", 13, 14},
		{"base+cak+caravans+fishermen", 15, 16},
	}
	for _, tc := range cases {
		t.Run(tc.ruleset, func(t *testing.T) {
			s, _ := newGame(t, tc.ruleset, 7)
			if s.Config.TargetVP != tc.target {
				t.Fatalf("%s defaults TargetVP to %d, want %d", tc.ruleset, s.Config.TargetVP, tc.target)
			}
			s.Phase = engine.PhasePlay
			s.Rolled = true
			p := s.Cur
			fishExt(s).BootHolder = p
			if got := winsAt(t, s, p); got != tc.want {
				t.Fatalf("%s: boot holder won at %d VP, want %d (target %d + 1)",
					tc.ruleset, got, tc.want, tc.target)
			}

			// The same seat without the boot wins at the bare target: the delta is
			// the boot's.
			s2, _ := newGame(t, tc.ruleset, 7)
			s2.Phase = engine.PhasePlay
			s2.Rolled = true
			fishExt(s2).BootHolder = engine.NoPlayer
			if got := winsAt(t, s2, s2.Cur); got != tc.target {
				t.Fatalf("%s: seat without the boot won at %d VP, want %d",
					tc.ruleset, got, tc.target)
			}
		})
	}
}

// winsAt plants settlements for p one at a time, running a real command after
// each so the engine's own victory check gets to fire, and returns the public
// VP total at which it ended the game.
func winsAt(t *testing.T, s *engine.State, p engine.PlayerID) int {
	t.Helper()
	for range 40 {
		if s.Phase == engine.PhaseFinished {
			return s.PublicVPWithModules(p)
		}
		if !plantSettlement(s, p) {
			t.Fatalf("ran out of free vertices at %d VP", s.PublicVPWithModules(p))
		}
		nudge(t, s, p)
	}
	t.Fatalf("game never ended: seat %d at %d VP, target %d",
		p, s.PublicVPWithModules(p), s.Config.TargetVP)
	return 0
}

// plantSettlement drops one settlement for p on the first free, non-adjacent
// land vertex in board order, placed directly since the threshold is under test,
// not the build rules.
func plantSettlement(s *engine.State, p engine.PlayerID) bool {
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		if !s.Board.Land(h) {
			continue
		}
		for _, v := range h.Vertices() {
			if _, taken := s.Buildings[v]; taken {
				continue
			}
			clear := true
			for _, n := range v.Neighbors() {
				if _, adj := s.Buildings[n]; adj {
					clear = false
					break
				}
			}
			if !clear {
				continue
			}
			s.Buildings[v] = engine.Building{Owner: p}
			s.Players[p].SettlementsLeft--
			return true
		}
	}
	return false
}

// nudge runs one real command for p so the victory check runs over the current
// state. A trade offer is the cheapest command that emits an event without
// moving a card; it is replaced on the next pass.
func nudge(t *testing.T, s *engine.State, p engine.PlayerID) {
	t.Helper()
	s.ActiveOffer = nil
	s.Players[p].Hand[board.Wood] = 1
	var give, want engine.Hand
	give[board.Wood] = 1
	want[board.Brick] = 1
	events, err := engine.Decide(s, engine.Command{Player: p, Type: engine.CmdOfferTrade,
		Data: mustJSON(t, engine.TradeOfferedData{Player: p, Give: give, Want: want})})
	if err != nil {
		t.Fatalf("nudge: %v", err)
	}
	for _, e := range events {
		e.Seq = s.NextSeq
		if err := engine.Apply(s, e); err != nil {
			t.Fatalf("nudge apply(%s): %v", e.Type, err)
		}
	}
}
