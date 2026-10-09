package islands

import (
	"encoding/json"
	"errors"
	"os"
	"slices"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// testdata/strait_road_log.json is a whole base+islands game (four Simple bots,
// seed 9, sim.RunGame) recorded under an older LandEdge. At seq 118 seat 2 pays
// for a road on the edge between (-2,2) and (-1,1), both sea hexes, so the road
// crosses open water. The old LandEdge only asked whether each end of the edge
// touched land.
const straitRoadSeq = 118

func loadStraitLog(t *testing.T) []engine.Event {
	t.Helper()
	blob, err := os.ReadFile("testdata/strait_road_log.json")
	if err != nil {
		t.Fatal(err)
	}
	var evs []engine.Event
	if err := json.Unmarshal(blob, &evs); err != nil {
		t.Fatal(err)
	}
	return evs
}

func straitEdge(t *testing.T, e engine.Event) (engine.PlayerID, board.Edge) {
	t.Helper()
	if e.Seq != straitRoadSeq || e.Type != engine.EvRoadBuilt {
		t.Fatalf("fixture: event %d is %s, want %s at seq %d", e.Seq, e.Type, engine.EvRoadBuilt, straitRoadSeq)
	}
	var d engine.BuiltData
	if err := json.Unmarshal(e.Data, &d); err != nil || d.E == nil {
		t.Fatalf("fixture: road_built payload: %v", err)
	}
	return d.Player, board.NewEdge(d.E.A, d.E.B)
}

// TestRoadAcrossAStraitIsRefused: the command the old engine accepted is now
// refused, and the edge is not offered.
func TestRoadAcrossAStraitIsRefused(t *testing.T) {
	evs := loadStraitLog(t)
	s, err := engine.Replay(evs[:straitRoadSeq])
	if err != nil {
		t.Fatal(err)
	}
	p, e := straitEdge(t, evs[straitRoadSeq])
	if slices.ContainsFunc(board.EdgeHexes(e), s.Board.Land) {
		t.Fatalf("fixture: edge %v borders land %v", e, board.EdgeHexes(e))
	}
	if !s.Board.SeaEdge(e) {
		t.Fatalf("fixture: edge %v is not a sea edge", e)
	}

	data, _ := json.Marshal(map[string]any{"e": e})
	_, err = engine.Decide(s, engine.Command{Player: p, Type: engine.CmdBuildRoad, Data: data})
	if !errors.Is(err, engine.ErrBadPlacement) {
		t.Errorf("build_road across the strait %v: err = %v, want %v", e, err, engine.ErrBadPlacement)
	}
	if slices.Contains(s.LegalRoads(p), e) {
		t.Errorf("LegalRoads(%d) offers the strait %v", p, e)
	}
}

// TestOldLogWithAStraitRoadStillFolds: legality lives in Decide, so an old log
// holding a road the engine would now refuse still replays to the end with that
// road on the board.
func TestOldLogWithAStraitRoadStillFolds(t *testing.T) {
	evs := loadStraitLog(t)
	s, err := engine.Replay(evs)
	if err != nil {
		t.Fatalf("replaying the recorded game: %v", err)
	}
	p, e := straitEdge(t, evs[straitRoadSeq])
	if owner, ok := s.Roads[e]; !ok || owner != p {
		t.Errorf("strait road %v: owner %v present %v, want seat %d", e, owner, ok, p)
	}
	if s.Phase != engine.PhaseFinished {
		t.Errorf("replayed game ends in phase %v, want %v", s.Phase, engine.PhaseFinished)
	}
}
