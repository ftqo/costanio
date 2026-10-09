package knights

import (
	"errors"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// TestDeserterReplacementTierIsTheTakersChoice: the taker may place a knight of
// the same strength or lower, so the tier is a free choice at or below the
// removed knight (among tiers with a free piece). The view's owed level is the
// ceiling; a place command with no level takes the ceiling, as older logs and
// the timeout do.
func TestDeserterReplacementTierIsTheTakersChoice(t *testing.T) {
	cases := []struct {
		name     string
		removed  int   // level of the surrendered knight
		deployed []int // tiers of knights the taker already has on the board
		wantCap  int   // the owed ceiling after the surrender
		place    int   // level sent on the place command (0 = omitted)
		want     int   // level placed, or 0 when the place must be refused
		wantErr  error
	}{
		{name: "mighty removed, no level named, takes mighty", removed: 3, wantCap: 3, want: 3},
		{name: "mighty removed, taker chooses basic", removed: 3, wantCap: 3, place: 1, want: 1},
		{name: "mighty removed, taker chooses strong", removed: 3, wantCap: 3, place: 2, want: 2},
		{name: "strong removed, may not choose mighty", removed: 2, wantCap: 2, place: 3, wantErr: engine.ErrBadCommand},
		{name: "mighty tier full, strong is the ceiling", removed: 3, deployed: []int{3, 3}, wantCap: 2, want: 2},
		{name: "strong tier full, choosing strong is refused", removed: 3, deployed: []int{2, 2}, wantCap: 3, place: 2, wantErr: engine.ErrNoPieces},
		{name: "only basic free", removed: 3, deployed: []int{3, 3, 2, 2}, wantCap: 1, want: 1},
		{name: "no piece at or below", removed: 2, deployed: []int{2, 2, 1, 1}, wantCap: 0},
		{name: "level out of range", removed: 3, wantCap: 3, place: 4, wantErr: engine.ErrBadCommand},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s, _ := newGame(t, 32, nil)
			rolled(t, s)
			p := s.Cur
			x := ext(s)
			q := (p + 1) % engine.PlayerID(len(s.Players))
			v := board.Vertex{Q: 2, R: -1, Side: board.N}
			x.Knights[v] = Knight{Owner: q, Level: tc.removed}
			for _, lvl := range tc.deployed {
				x.Knights[offNetworkVertex(t, s, p)] = Knight{Owner: p, Level: lvl}
			}
			x.Players[p].Progress = []ProgressCard{CardDeserter}

			step(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
				Data: mustJSON(t, map[string]any{"card": CardDeserter, "victim": q})})
			step(t, s, engine.Command{Player: q, Type: CmdDeserterSurrender,
				Data: mustJSON(t, map[string]any{"v": v})})
			if x.DeserterLevel != tc.wantCap {
				t.Fatalf("owed ceiling = %d, want %d", x.DeserterLevel, tc.wantCap)
			}
			if tc.wantCap == 0 {
				return // forfeited: the opponent still lost the knight
			}
			spot := knightSpotFor(t, s, p)
			data := map[string]any{"v": spot}
			if tc.place != 0 {
				data["level"] = tc.place
			}
			cmd := engine.Command{Player: p, Type: CmdDeserterPlace, Data: mustJSON(t, data)}
			if tc.wantErr != nil {
				_, err := engine.Decide(s.Clone(), cmd)
				if !errors.Is(err, tc.wantErr) {
					t.Fatalf("place level %d: err = %v, want %v", tc.place, err, tc.wantErr)
				}
				return
			}
			step(t, s, cmd)
			if got := x.Knights[spot].Level; got != tc.want {
				t.Fatalf("placed level = %d, want %d", got, tc.want)
			}
			if x.DeserterLevel != 0 || x.DeserterTaker != engine.NoPlayer {
				t.Fatal("the Deserter interaction did not clear")
			}
		})
	}
}

// offNetworkVertex returns an empty vertex touching none of p's roads, so a
// knight parked there uses up a piece without using up a spot the Deserter
// replacement could take.
func offNetworkVertex(t *testing.T, s *engine.State, p engine.PlayerID) board.Vertex {
	t.Helper()
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, v := range h.Vertices() {
			if _, taken := s.Buildings[v]; taken {
				continue
			}
			if _, taken := ext(s).Knights[v]; taken {
				continue
			}
			touches := false
			for _, e := range v.Edges() {
				if owner, ok := s.Roads[e]; ok && owner == p {
					touches = true
				}
			}
			if !touches {
				return v
			}
		}
	}
	t.Fatal("no empty vertex off p's network")
	return board.Vertex{}
}
