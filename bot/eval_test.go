package bot

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

func TestEvalIsOpponentRelative(t *testing.T) {
	s := newBaseGame(t, 11)
	s.Phase = engine.PhasePlay
	b := NewStrong()

	base := b.eval(s, 0)

	// Give opponent 1 a strong producing city; the bot's eval should drop.
	var hex board.Hex
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		if t2, ok := s.Board.Tiles[h]; ok && t2.Res.Producing() {
			hex = h
			break
		}
	}
	s.Buildings[hex.Vertices()[0]] = engine.Building{Owner: 1, City: true}

	after := b.eval(s, 0)
	if !(after < base) {
		t.Errorf("eval did not fall when an opponent got stronger: base=%.2f after=%.2f", base, after)
	}
}

func TestSelfScoreCountsLongestRoadHolder(t *testing.T) {
	// The title is worth 2 VP whoever holds it, so selfScore must move when it
	// changes hands (the bot sees the title without chasing it).
	s := newBaseGame(t, 12)
	s.Phase = engine.PhasePlay
	b := NewStrong()
	before := b.selfScore(s, 0, 0)
	s.LongestRoadHolder = 0 // grant the bot longest road
	after := b.selfScore(s, 0, 0)
	if after <= before {
		t.Errorf("selfScore did not rise when the bot took longest road (%.4f -> %.4f)", before, after)
	}

	// ...and the same for an opponent.
	s2 := newBaseGame(t, 12)
	s2.Phase = engine.PhasePlay
	oppBefore := b.selfScore(s2, 1, 0)
	s2.LongestRoadHolder = 1
	oppAfter := b.selfScore(s2, 1, 0)
	if oppAfter <= oppBefore {
		t.Errorf("selfScore did not rise when an opponent took longest road (%.4f -> %.4f)", oppBefore, oppAfter)
	}
}

func TestThreatPenalizesNearWinOpponent(t *testing.T) {
	s := newBaseGame(t, 21)
	s.Phase = engine.PhasePlay
	s.Config.TargetVP = 10
	b := NewStrong()

	low := b.threatExcess(s, 0)

	// Give opponent 1 several settlements to push PublicVP near the target.
	placed := 0
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		if placed >= 8 {
			break
		}
		for _, v := range h.Vertices() {
			if _, ok := s.Buildings[v]; !ok {
				s.Buildings[v] = engine.Building{Owner: 1}
				placed++
				break
			}
		}
	}
	high := b.threatExcess(s, 0)
	if !(high > low) {
		t.Errorf("threatExcess did not rise as opponent neared the target: low=%.2f high=%.2f", low, high)
	}
}

func TestThreatAllowanceAtThreshold(t *testing.T) {
	target := 10
	b := NewStrong()

	// Build a state where opponent 1 has exactly `vp` public VP via settlements.
	threatWith := func(seed uint64, vp int) float64 {
		s := newBaseGame(t, seed)
		s.Phase = engine.PhasePlay
		s.Config.TargetVP = target
		placed := 0
		for _, h := range board.HexesInRadius(s.Board.Radius) {
			if placed >= vp {
				break
			}
			for _, v := range h.Vertices() {
				if _, ok := s.Buildings[v]; !ok {
					s.Buildings[v] = engine.Building{Owner: 1}
					placed++
					break
				}
			}
		}
		if got := s.PublicVP(1); got != vp {
			t.Fatalf("setup: opponent PublicVP = %d, want %d", got, vp)
		}
		return b.threatExcess(s, 0)
	}

	// At target-4 (=6): below the allowance threshold (>= target-3 == 7).
	// excess = 6 - (target-2=8) = -2 -> floored to 0.
	below := threatWith(61, target-4)
	// At target-3 (=7): allowance fires. reach = 7 + 0.5 = 7.5; excess = 7.5 - 8 = -0.5 -> floored to 0.
	at := threatWith(62, target-3)
	// At target-1 (=9): allowance fires. reach = 9.5; excess = 9.5 - 8 = 1.5.
	high := threatWith(63, target-1)

	if below != 0 {
		t.Errorf("threat at target-4 = %.2f, want 0 (below endgame)", below)
	}
	if at != 0 {
		t.Errorf("threat at target-3 = %.2f, want 0 (excess still negative even with allowance)", at)
	}
	// The decisive check: at target-1 the allowance is included, giving 1.5 not 1.0.
	if high != 1.5 {
		t.Errorf("threat at target-1 = %.2f, want 1.5 (includes the +0.5 hidden-VP allowance)", high)
	}
}

func TestWinningMoveShortCircuit(t *testing.T) {
	s := newBaseGame(t, 22)
	s.Phase = engine.PhasePlay
	s.Cur = 0
	s.Rolled = true
	s.Config.TargetVP = 3
	s.Players[0].CitiesLeft = 4
	b := NewStrong()

	// Two settlements for seat 0 (→ 2 public VP). Upgrading one to a city = 3 VP.
	var verts []board.Vertex
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, v := range h.Vertices() {
			dup := false
			for _, vv := range verts {
				if vv == v {
					dup = true
				}
			}
			if !dup {
				verts = append(verts, v)
			}
			if len(verts) >= 2 {
				break
			}
		}
		if len(verts) >= 2 {
			break
		}
	}
	s.Buildings[verts[0]] = engine.Building{Owner: 0}
	s.Buildings[verts[1]] = engine.Building{Owner: 0}
	s.Players[0].Hand = engine.CostCity // 3 ore + 2 wheat

	cmd, ok := b.Act(s, 0)
	if !ok || cmd.Type != engine.CmdBuildCity {
		t.Fatalf("expected the winning city build, got %+v ok=%v", cmd, ok)
	}
	var d struct {
		V board.Vertex `json:"v"`
	}
	mustUnmarshal(t, cmd.Data, &d)
	if d.V != verts[0] && d.V != verts[1] {
		t.Errorf("upgraded %+v, want one of the owned settlements %+v", d.V, verts)
	}
}
