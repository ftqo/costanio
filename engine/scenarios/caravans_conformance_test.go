package scenarios

import (
	"errors"
	"math/rand/v2"
	"slices"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	_ "github.com/ftqo/costan.io/engine/knights"
)

// Caravans bullets of docs/rules/scenarios.md: the occupied-spoke guard, the "a
// camel and a road side by side, but never two camels" path rule, and the two
// promises FinishBoard makes about the oasis swap. State is constructed, never
// searched for.

// camelVote puts a real base+caravans game (real board, derived oasis and
// spokes) into an open vote whose placement half seat p has won.
func camelVote(t *testing.T, seed uint64, p engine.PlayerID) (*engine.State, *CaravansExt) {
	t.Helper()
	s, _ := newGame(t, "base+caravans", seed)
	s.Phase = engine.PhasePlay
	s.Rolled = true
	x, ok := InitCaravansExt(s)
	if !ok {
		t.Fatal("caravans module not active on base+caravans")
	}
	if !x.HasOasis {
		t.Fatal("no oasis on the generated board")
	}
	x.Voting = true
	x.Finisher = p
	x.Placer = p
	for q := range len(s.Players) {
		x.Bidded[engine.PlayerID(q)] = true
	}
	return s, x
}

// place puts a camel on caravan i's edge e through the real command path.
func place(t *testing.T, s *engine.State, p engine.PlayerID, i int, e board.Edge) {
	t.Helper()
	step(t, s, engine.Command{Player: p, Type: CmdPlaceCamel,
		Data: mustJSON(t, camelPlacedData{Caravan: i, E: e})})
}

// TestOccupiedSpokeCannotStartACaravan: a caravan with no camels starts on its
// oasis spoke and nowhere else, so if another caravan already covers that spoke
// it has no legal path. Without the x.Occupied[arr] check two camels could share
// a path.
func TestOccupiedSpokeCannotStartACaravan(t *testing.T) {
	s, x := camelVote(t, 5, 0)
	spoke := x.Arrows[0]
	if spoke == (board.Edge{}) {
		t.Fatal("caravan 0 has no spoke on this board")
	}
	if !slices.Contains(edgesOf((Caravans{}).legalPaths(x, s), 0), spoke) {
		t.Fatalf("caravan 0's own spoke %v is not among its legal paths to begin with", spoke)
	}

	x.Occupied[spoke] = true
	if got := edgesOf((Caravans{}).legalPaths(x, s), 0); len(got) != 0 {
		t.Fatalf("an empty caravan whose spoke is occupied offers %v, want nothing", got)
	}
	if _, err := engine.Decide(s, engine.Command{Player: 0, Type: CmdPlaceCamel,
		Data: mustJSON(t, camelPlacedData{Caravan: 0, E: spoke})}); !errors.Is(err, engine.ErrBadPlacement) {
		t.Fatalf("placing on an occupied spoke gave %v, want ErrBadPlacement", err)
	}
}

// TestPathHoldsACamelAndARoadButNeverTwoCamels is the path rule in one test,
// both halves through the real Decide path: a road on the path does not close
// it to a camel, and a camel on it closes it to every later camel.
func TestPathHoldsACamelAndARoadButNeverTwoCamels(t *testing.T) {
	t.Run("road leaves the path open", func(t *testing.T) {
		s, x := camelVote(t, 5, 0)
		spoke := x.Arrows[0]
		if spoke == (board.Edge{}) {
			t.Fatal("caravan 0 has no spoke on this board")
		}
		s.Roads[spoke] = 1 // somebody else's road, sharing the path
		if !slices.Contains(edgesOf((Caravans{}).legalPaths(x, s), 0), spoke) {
			t.Fatalf("a road on %v closed the path to the camel", spoke)
		}
		place(t, s, 0, 0, spoke)
		if !x.Occupied[spoke] {
			t.Fatal("the camel did not land on the road's path")
		}
		if owner, ok := s.Roads[spoke]; !ok || owner != 1 {
			t.Fatal("placing the camel disturbed the road sharing its path")
		}
	})

	t.Run("camel closes the path", func(t *testing.T) {
		s, x := camelVote(t, 5, 0)
		spoke := x.Arrows[0]
		if spoke == (board.Edge{}) {
			t.Fatal("caravan 0 has no spoke on this board")
		}
		place(t, s, 0, 0, spoke)

		// Reopen the vote for a second placement and check every caravan: the
		// occupied path is offered by none of them.
		x.Voting, x.Placer = true, 0
		for i := range caravansPerOasis {
			if got := edgesOf((Caravans{}).legalPaths(x, s), i); slices.Contains(got, spoke) {
				t.Fatalf("caravan %d still offers the occupied path %v", i, spoke)
			}
			if _, err := engine.Decide(s, engine.Command{Player: 0, Type: CmdPlaceCamel,
				Data: mustJSON(t, camelPlacedData{Caravan: i, E: spoke})}); !errors.Is(err, engine.ErrBadPlacement) {
				t.Fatalf("a second camel on %v via caravan %d gave %v, want ErrBadPlacement", spoke, i, err)
			}
		}

		// The same rule one step along the chain (a different branch of
		// caravanFrontEdges): an edge another caravan already covers is not
		// offered from a growing caravan's front. Marked occupied directly,
		// since the guard reads Occupied and reaching this geometry by play
		// depends on the board.
		front := edgesOf((Caravans{}).legalPaths(x, s), 0)
		if len(front) == 0 {
			t.Fatal("caravan 0 has nowhere to grow after its first camel")
		}
		taken := front[0]
		x.Occupied[taken] = true
		if got := edgesOf((Caravans{}).legalPaths(x, s), 0); slices.Contains(got, taken) {
			t.Fatalf("growing caravan offers occupied %v", taken)
		}
		if _, err := engine.Decide(s, engine.Command{Player: 0, Type: CmdPlaceCamel,
			Data: mustJSON(t, camelPlacedData{Caravan: 0, E: taken})}); !errors.Is(err, engine.ErrBadPlacement) {
			t.Fatalf("a second camel on the occupied front edge %v gave %v, want ErrBadPlacement", taken, err)
		}
	})
}

func edgesOf(paths []legalPath, caravan int) []board.Edge {
	var out []board.Edge
	for _, lp := range paths {
		if lp.caravan == caravan {
			out = append(out, lp.edge)
		}
	}
	return out
}

// TestFinishBoardSwapKeepsRedsParksRobber pins the oasis swap's
// promises on a hand-built board, and the robber starting beside the board
// rather than on the oasis.
//
// The board is a full radius-3 hexagon of land with the desert on the ring, where
// the oasis has fewer than three spokes and the swap must fire. Every interior hex
// but one carries a 6 or 8, so the only allowed partner is unique and the
// assertion does not depend on the rng: reds are never candidates.
func TestFinishBoardSwapKeepsRedsParksRobber(t *testing.T) {
	const radius = 3
	b := &board.Board{Radius: radius, Tiles: map[board.Hex]board.Tile{}}
	interior := []board.Hex{}
	var ringHexes []board.Hex
	for _, h := range board.HexesInRadius(radius) {
		if hexRing(h) < radius {
			interior = append(interior, h)
			b.Tiles[h] = board.Tile{Res: board.Wood, Number: 6}
			continue
		}
		ringHexes = append(ringHexes, h)
		b.Tiles[h] = board.Tile{Res: board.Wood, Number: 5}
	}
	if len(interior) < 2 || len(ringHexes) == 0 {
		t.Fatalf("degenerate test board: %d interior, %d ring hexes", len(interior), len(ringHexes))
	}
	// The single hex the swap is allowed to choose.
	partner := interior[len(interior)/2]
	b.Tiles[partner] = board.Tile{Res: board.Wheat, Number: 9}
	// The oasis, out on the ring, with the robber standing on it as the base
	// game leaves it.
	oasis := ringHexes[0]
	b.Tiles[oasis] = board.Tile{Res: board.ResNone}
	b.Robber = oasis

	if spokeCount(b, oasis) == caravansPerOasis {
		t.Fatalf("fixture: ring oasis %v already has three spokes", oasis)
	}

	(Caravans{}).FinishBoard(b, engine.GameConfig{}, rand.New(rand.NewPCG(1, 2)))

	got, ok := pickOasis(b)
	if !ok {
		t.Fatal("the swap left the board with no oasis at all")
	}
	if got != partner {
		t.Fatalf("the oasis moved to %v (number %d), want the one non-red interior hex %v: "+
			"a 6 or an 8 must never be the partner", got, b.Tiles[got].Number, partner)
	}
	if b.Tiles[oasis].Number == 0 || b.Tiles[oasis].Res != board.Wheat {
		t.Fatalf("the vacated ring hex holds %+v, want the partner's tile and token", b.Tiles[oasis])
	}
	if b.RobberOnBoard() {
		t.Fatalf("robber on %v after FinishBoard (oasis %v), want beside the board",
			b.Robber, got)
	}
	if spokeCount(b, got) != caravansPerOasis {
		t.Fatalf("the swap put the oasis on %v, which starts %d caravans, want %d",
			got, spokeCount(b, got), caravansPerOasis)
	}
}

// TestFinishBoardParksRobberAnywhere: the robber starts beside the
// board wherever the generator left it, producing hex or oasis (the generator
// leaves it on the desert, which here is the oasis).
func TestFinishBoardParksRobberAnywhere(t *testing.T) {
	const radius = 3
	for _, onOasis := range []bool{false, true} {
		b := &board.Board{Radius: radius, Tiles: map[board.Hex]board.Tile{}}
		for _, h := range board.HexesInRadius(radius) {
			b.Tiles[h] = board.Tile{Res: board.Wood, Number: 5}
		}
		oasis := board.Hex{Q: 1, R: 0}
		b.Tiles[oasis] = board.Tile{Res: board.ResNone}
		b.Robber = board.Hex{Q: -1, R: 0}
		if onOasis {
			b.Robber = oasis
		}
		(Caravans{}).FinishBoard(b, engine.GameConfig{}, rand.New(rand.NewPCG(3, 4)))
		if b.RobberOnBoard() {
			t.Fatalf("robber started on oasis=%v: on %v after FinishBoard, want beside the board", onOasis, b.Robber)
		}
		// Idempotent, as BoardFinisher requires.
		(Caravans{}).FinishBoard(b, engine.GameConfig{}, rand.New(rand.NewPCG(3, 4)))
		if b.RobberOnBoard() {
			t.Fatal("a second FinishBoard put the robber back on the board")
		}
	}
}
