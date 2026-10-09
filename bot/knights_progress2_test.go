package bot

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/knights"
)

// ruleCardState hands seat 0 a Spy and gives seat 1 progress cards to spy on, so
// knightsProgressCandidates2 has a legal rule-played candidate to propose.
func ruleCardState(t *testing.T) (*engine.State, *Strong) {
	t.Helper()
	s := newKnightsGame(t, 17)
	s.Phase = engine.PhasePlay
	s.Cur = 0
	s.Rolled = true
	x := knightsExtOf(t, s)
	x.Players[0].Progress = []knights.ProgressCard{knights.CardSpy}
	x.Players[1].Progress = []knights.ProgressCard{knights.CardCrane, knights.CardSmith}
	return s, NewStrong()
}

// TestRuleProgressCardsScoreFromBaseline pins what ruleScore means.
//
// It is an epsilon above the do-nothing baseline, not an absolute score: the
// baseline (b.eval of the current position) is several hundred negative for most
// of the game, so a bare 1e-6 would always beat it.
func TestRuleProgressCardsScoreFromBaseline(t *testing.T) {
	s, b := ruleCardState(t)
	base := b.eval(s, 0)

	var scores []float64
	b.knightsProgressCandidates2(s, 0, func(cmd engine.Command, sc float64) {
		scores = append(scores, sc)
	})
	if len(scores) == 0 {
		t.Fatal("no rule-played progress candidate proposed")
	}
	for _, sc := range scores {
		if sc <= base {
			t.Errorf("rule card scores %.6f, at or below baseline %.6f", sc, base)
		}
		if sc > base+1 {
			t.Errorf("rule card scores %.6f, baseline %.6f, want a small margin", sc, base)
		}
	}
}

// TestRuleProgressCardYieldsToARealMove: an affordable city upgrade is a
// measurable improvement and must beat a rule-played card.
func TestRuleProgressCardYieldsToARealMove(t *testing.T) {
	s, b := ruleCardState(t)

	// Give seat 0 a settlement on a producing spot and the cards to upgrade it.
	v := commodityVertex(s)
	s.Buildings[v] = engine.Building{Owner: 0}
	s.Players[0].Hand = engine.Hand{board.Ore: 3, board.Wheat: 2}

	// Seat the opponents properly: eval is opponent-relative, and only a real
	// mid-game position puts the baseline well below zero.
	skip := map[board.Vertex]bool{v: true}
	for p := engine.PlayerID(1); p < 4; p++ {
		for i := range 3 {
			s.Buildings[freeVertex(s, skip)] = engine.Building{Owner: p, City: i == 0}
		}
	}
	if base := b.eval(s, 0); base > -100 {
		t.Fatalf("fixture baseline is %.1f, too small", base)
	}

	cmd, ok := b.bestPlay(s, 0)
	if !ok {
		t.Fatal("bestPlay found nothing to do")
	}
	if cmd.Type == knights.CmdPlayProgress {
		t.Errorf("bestPlay played a progress card (%s) over an affordable city upgrade", cmd.Data)
	}
	if cmd.Type != engine.CmdBuildCity {
		t.Logf("bestPlay chose %s, not the city", cmd.Type)
	}
}

// TestAlchemistWeighsBothSidesEqually: alchemistPlay compares our buildings
// on a dice total against the opponents' on the same total, so the opponent
// side is taken at oppNeutralWeight, not Weights.Opp (as for the camel bid in
// docs/bots.md).
//
// Here seat 0 holds a city (weight 2) and seat 1 a settlement (weight 1) on the
// only numbered hex with anything on it. 2 - 1 is a gain; 2 - 9.6 is not.
func TestAlchemistWeighsBothSidesEqually(t *testing.T) {
	s := newKnightsGame(t, 19)
	s.Phase = engine.PhasePlay
	s.Cur = 0
	s.Rolled = false
	x := knightsExtOf(t, s)
	x.Players[0].Progress = []knights.ProgressCard{knights.CardAlchemist}

	// Park every other tile on 7, which alchemistPlay never considers, so exactly
	// one dice total has anything on it. A vertex touches three hexes, so without
	// this the two buildings below also produce on their neighbours' numbers.
	var hex board.Hex
	found := false
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		tl, ok := s.Board.Tiles[h]
		if !ok {
			continue
		}
		if !found && tl.Res.Producing() && h != s.Board.Robber {
			hex, found = h, true
			tl.Number = 8
		} else {
			tl.Number = 7
		}
		s.Board.Tiles[h] = tl
	}
	if !found {
		t.Fatal("no producing hex on the board")
	}
	vs := hex.Vertices()
	s.Buildings[vs[0]] = engine.Building{Owner: 0, City: true}
	s.Buildings[vs[2]] = engine.Building{Owner: 1}

	b := NewStrong()
	cmd, ok := b.alchemistPlay(s, 0)
	if !ok {
		t.Fatal("Alchemist declined the 8 (our city vs one opponent settlement)")
	}
	var d struct {
		D1 int `json:"d1"`
		D2 int `json:"d2"`
	}
	mustUnmarshal(t, cmd.Data, &d)
	if d.D1+d.D2 != 8 {
		t.Errorf("Alchemist picked %d+%d = %d, want the 8 our city sits on", d.D1, d.D2, d.D1+d.D2)
	}
}
