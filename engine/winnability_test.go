package engine

import (
	"testing"

	"github.com/ftqo/costan.io/engine/board"
)

func TestMaxVPWithoutCards(t *testing.T) {
	cases := []struct {
		ruleset string
		want    int
	}{
		{"base", 13},
		{"", 13},             // empty ruleset == base
		{"base+islands", 13}, // island chips are board-dependent, not counted
	}
	for _, c := range cases {
		got := MaxVPWithoutCards(GameConfig{Players: 4, Ruleset: c.ruleset})
		if got != c.want {
			t.Errorf("MaxVPWithoutCards(%q) = %d, want %d", c.ruleset, got, c.want)
		}
	}
}

// TestRecommendedVPWithinCeiling checks the base anchors against the base
// ceiling. The sweep over every ruleset needs the modules, which engine cannot
// import, so it lives in ruletest.TestEveryTargetIsWinnable.
func TestRecommendedVPWithinCeiling(t *testing.T) {
	for p := 3; p <= 10; p++ {
		anchor := 10
		switch {
		case p >= 9:
			anchor = 12
		case p >= 7:
			anchor = 11
		}
		if ceil := MaxVPWithoutCards(GameConfig{Players: p, Ruleset: "base"}); anchor > ceil {
			t.Errorf("base/%dp: the anchor %d exceeds the ceiling %d", p, anchor, ceil)
		}
	}
}

// forceFinishState creates a clean 3-player state ready for ForceFinish tests.
// All buildings, roads, and titles are cleared so tests control VP exactly.
func forceFinishState(t *testing.T) *State {
	t.Helper()
	s, _ := newGame(t, 3, 1)
	runSetup(t, s)
	s.Buildings = map[board.Vertex]Building{}
	s.Roads = map[board.Edge]PlayerID{}
	s.LongestRoadHolder = NoPlayer
	s.LargestArmyHolder = NoPlayer
	for i := range s.Players {
		s.Players[i].SettlementsLeft = MaxSettlements
		s.Players[i].CitiesLeft = MaxCities
		s.Players[i].RoadsLeft = MaxRoads
		s.Players[i].KnightsPlayed = 0
		s.Players[i].DevCards = DevHand{}
		s.Players[i].NewDevCards = DevHand{}
	}
	return s
}

// collectVerts returns the first n distinct vertices from the board.
func collectVerts(t *testing.T, s *State, n int) []board.Vertex {
	t.Helper()
	verts := make([]board.Vertex, 0, n)
	seen := map[board.Vertex]bool{}
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, v := range h.Vertices() {
			if seen[v] {
				continue
			}
			seen[v] = true
			verts = append(verts, v)
			if len(verts) >= n {
				return verts
			}
		}
	}
	t.Fatalf("board has fewer than %d vertices", n)
	return nil
}

// TestForceFinishAlreadyFinished: calling ForceFinish on a finished game returns nil, nil.
func TestForceFinishAlreadyFinished(t *testing.T) {
	s := forceFinishState(t)
	s.Phase = PhaseFinished
	s.Winner = 0

	evs, err := ForceFinish(s)
	if err != nil {
		t.Fatal(err)
	}
	if evs != nil {
		t.Errorf("want nil events for already-finished game, got %+v", evs)
	}
}

// TestForceFinishTiebreak: two players tied on VP; the one with more cities wins.
// Player 0: 5 VP, 1 city built. Player 1: 5 VP, 2 cities built. Player 2: 0 VP.
// Tiebreak picks player 1 (more cities).
func TestForceFinishTiebreak(t *testing.T) {
	s := forceFinishState(t)
	verts := collectVerts(t, s, 8)

	// Player 0: 1 city (2VP) + 3 settlements (3VP) = 5 VP total, 1 city built.
	s.Buildings[verts[0]] = Building{Owner: 0, City: true}
	s.Players[0].CitiesLeft--
	s.Buildings[verts[1]] = Building{Owner: 0}
	s.Players[0].SettlementsLeft--
	s.Buildings[verts[2]] = Building{Owner: 0}
	s.Players[0].SettlementsLeft--
	s.Buildings[verts[3]] = Building{Owner: 0}
	s.Players[0].SettlementsLeft--

	// Player 1: 2 cities (4VP) + 1 settlement (1VP) = 5 VP total, 2 cities built.
	s.Buildings[verts[4]] = Building{Owner: 1, City: true}
	s.Players[1].CitiesLeft--
	s.Buildings[verts[5]] = Building{Owner: 1, City: true}
	s.Players[1].CitiesLeft--
	s.Buildings[verts[6]] = Building{Owner: 1}
	s.Players[1].SettlementsLeft--

	// Player 2 has nothing (0 VP), so does not affect the p0 vs p1 tiebreak.

	vp0 := s.VPWithModules(0)
	vp1 := s.VPWithModules(1)
	if vp0 != 5 || vp1 != 5 {
		t.Fatalf("setup VP: player0=%d player1=%d; want 5,5", vp0, vp1)
	}
	cities0 := MaxCities - s.Players[0].CitiesLeft
	cities1 := MaxCities - s.Players[1].CitiesLeft
	if cities0 != 1 || cities1 != 2 {
		t.Fatalf("city counts: player0=%d player1=%d; want 1,2", cities0, cities1)
	}

	wantSeq := s.NextSeq
	evs, err := ForceFinish(s)
	if err != nil {
		t.Fatal(err)
	}
	if len(evs) != 1 || evs[0].Type != EvGameFinished {
		t.Fatalf("want one EvGameFinished, got %+v", evs)
	}
	if evs[0].Seq != wantSeq {
		t.Errorf("Seq = %d, want %d", evs[0].Seq, wantSeq)
	}
	if err := Apply(s, evs[0]); err != nil {
		t.Fatal(err)
	}
	if s.Phase != PhaseFinished || s.Winner != 1 {
		t.Errorf("phase=%s winner=%d, want finished/1 (city tiebreak)", s.Phase, s.Winner)
	}
}

// TestForceFinishFinalFallback: all tiebreak criteria equal → lowest seat index wins.
func TestForceFinishFinalFallback(t *testing.T) {
	s := forceFinishState(t)
	// All players have identical state: 0 VP, 0 cities, 0 settlements, 0 knights.
	// Lowest seat index (0) should win.

	evs, err := ForceFinish(s)
	if err != nil {
		t.Fatal(err)
	}
	if len(evs) != 1 || evs[0].Type != EvGameFinished {
		t.Fatalf("want one EvGameFinished, got %+v", evs)
	}
	if err := Apply(s, evs[0]); err != nil {
		t.Fatal(err)
	}
	if s.Phase != PhaseFinished || s.Winner != 0 {
		t.Errorf("phase=%s winner=%d, want finished/0 (seat fallback)", s.Phase, s.Winner)
	}
}

// TestForceFinishSeqStamped: the returned event has Seq == s.NextSeq (so
// Apply accepts it and the log is contiguous).
func TestForceFinishSeqStamped(t *testing.T) {
	s := forceFinishState(t)
	wantSeq := s.NextSeq

	evs, err := ForceFinish(s)
	if err != nil {
		t.Fatal(err)
	}
	if len(evs) != 1 {
		t.Fatalf("want 1 event, got %d", len(evs))
	}
	if evs[0].Seq != wantSeq {
		t.Errorf("event Seq = %d, want %d", evs[0].Seq, wantSeq)
	}
	// Apply must succeed (seq continuity is enforced there).
	if err := Apply(s, evs[0]); err != nil {
		t.Fatalf("Apply failed: %v", err)
	}
}
