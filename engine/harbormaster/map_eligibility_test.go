package harbormaster

import (
	"errors"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// A map with fewer than two harbours can never award the card: the threshold is
// 3 harbour points, and no two harbours share a vertex, so 3 points need
// buildings on at least two. The target still rises by 1, so the lobby refuses
// the pairing.
//
// A map with no harbours is fine: engine.New deals it a coastline-scaled set
// (board.EnsureHarbors, at least 5) before anything reads it.
func TestMapWithTooFewHarboursIsRefused(t *testing.T) {
	for _, tc := range []struct {
		harbours int
		ruleset  string
		refused  bool
	}{
		{0, "base+harbormaster", false}, // dealt a full set at start
		{1, "base+harbormaster", true},
		{2, "base+harbormaster", false},
		{1, "base", false}, // the check belongs to the module
	} {
		b := &board.Board{Radius: 2, Tiles: map[board.Hex]board.Tile{}}
		for _, h := range board.HexesInRadius(2) {
			b.Tiles[h] = board.Tile{Res: board.ResLand}
		}
		if tc.harbours > 0 {
			hb, _ := harborBoard(t, tc.harbours)
			b.Harbors = hb.Harbors
		}
		iss := engine.MapEligibilityIssues(b, tc.ruleset)
		got := false
		for _, is := range iss {
			if is.Code == MapIssueNeedsHarbours {
				got = true
				if is.Params["module"] != Name || is.Params["min"] != MinHarbours {
					t.Errorf("%d harbours: params %v, want module %q, min %d", tc.harbours, is.Params, Name, MinHarbours)
				}
			}
		}
		if got != tc.refused {
			t.Errorf("%s with %d harbours: refused=%v, want %v (issues %v)", tc.ruleset, tc.harbours, got, tc.refused, iss)
		}
		err := engine.ValidateMap(b, tc.ruleset)
		var mie *engine.MapIssueError
		if tc.refused {
			if !errors.As(err, &mie) || !mie.IsHarbormasterNeedsHarbours() {
				t.Errorf("%s with %d harbours: ValidateMap = %v, want the harbour refusal", tc.ruleset, tc.harbours, err)
			}
		} else if err != nil {
			t.Errorf("%s with %d harbours: ValidateMap = %v, want nil", tc.ruleset, tc.harbours, err)
		}
	}
}
