package bot

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// robberPeekState builds a play-phase board with the robber pending, seat 0 on
// one hex and an opponent on another, and hands the opponent a hand of exactly
// one resource type.
func robberPeekState(t *testing.T, seed uint64, victimRes board.Resource) (*engine.State, engine.Command, engine.PlayerID) {
	t.Helper()
	s := newBaseGame(t, seed)

	var ownHex, oppHex board.Hex
	got := 0
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		tl, ok := s.Board.Tiles[h]
		if !ok || !tl.Res.Producing() || h == s.Board.Robber {
			continue
		}
		if got == 0 {
			ownHex, got = h, 1
			continue
		}
		oppHex = h
		break
	}
	s.Buildings[ownHex.Vertices()[0]] = engine.Building{Owner: 0}
	s.Buildings[oppHex.Vertices()[0]] = engine.Building{Owner: 1}
	s.Players[1].Hand = engine.Hand{}
	s.Players[1].Hand[victimRes] = 4
	s.Phase = engine.PhasePlay
	s.Cur = 0
	s.Rolled = true
	s.RobberPending = true

	cmd := engine.Command{Player: 0, Type: engine.CmdMoveRobber,
		Data: raw2(map[string]any{"hex": oppHex, "victim": engine.PlayerID(1)})}
	return s, cmd, 1
}

// TestRobberDoesNotPeekAtHiddenHands is the robber's version of TestNoDeckPeek.
// Decide resolves the steal from the victim's hand, so simulating it would
// reveal hidden information. A hex's score must depend only on the victim's card
// count: hold the count fixed, vary the contents, and require the score not to
// move beyond floating-point noise.
func TestRobberDoesNotPeekAtHiddenHands(t *testing.T) {
	for _, seed := range []uint64{2, 11, 23} {
		var want float64
		for i, r := range board.Resources {
			s, cmd, victim := robberPeekState(t, seed, r)
			b := NewStrong()
			sc, ok := b.robberHexScore(s, 0, cmd, victim, true)
			if !ok {
				t.Fatalf("seed %d, %v: robber hex scored as illegal", seed, r)
			}
			if i == 0 {
				want = sc
				continue
			}
			if diff := sc - want; diff > 1e-9 || diff < -1e-9 {
				t.Errorf("seed %d: hex scores %.6f with victim holding %v, %.6f holding %v, want equal", seed, sc, r, want, board.Resources[0])
			}
		}
	}
}

// TestRobberPrefersRicherBlock: pricing the steal by expectation must not
// cost the sub-policy its actual job. Denial still decides between hexes.
func TestRobberPrefersRicherBlock(t *testing.T) {
	s := newBaseGame(t, 2)
	var poor, rich board.Hex
	got := 0
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		tl, ok := s.Board.Tiles[h]
		if !ok || !tl.Res.Producing() || h == s.Board.Robber {
			continue
		}
		if got == 0 {
			poor, got = h, 1
			continue
		}
		rich = h
		break
	}
	// Force the two hexes apart: same terrain, wildly different odds.
	pt, rt := s.Board.Tiles[poor], s.Board.Tiles[rich]
	pt.Number, rt.Number = 2, 8
	rt.Res = pt.Res
	s.Board.Tiles[poor], s.Board.Tiles[rich] = pt, rt

	s.Buildings[poor.Vertices()[0]] = engine.Building{Owner: 1}
	s.Buildings[rich.Vertices()[0]] = engine.Building{Owner: 1}
	s.Players[1].Hand = engine.Hand{board.Ore: 4}
	s.Phase = engine.PhasePlay
	s.Cur = 0
	s.Rolled = true
	s.RobberPending = true

	b := NewStrong()
	cmd, ok := b.moveRobber(s, 0)
	if !ok {
		t.Fatal("no robber move")
	}
	var d struct {
		Hex board.Hex `json:"hex"`
	}
	mustUnmarshal(t, cmd.Data, &d)
	if d.Hex == poor {
		t.Errorf("robber went to the 2 (%v) rather than the 8 (%v)", poor, rich)
	}
}
