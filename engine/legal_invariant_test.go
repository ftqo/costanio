package engine

import (
	"errors"
	"testing"

	"math/rand/v2"

	"github.com/ftqo/costan.io/engine/board"
)

// TestLegalTargetsMatchValidator: across random base-game playouts, at every
// state the offered legal-target set for the current player must exactly equal
// what the validator accepts positionally: no offered target is rejected and no
// acceptable one is hidden. The hand is filled on a clone so cost is not a
// factor. Both directions are checked for settlements, cities, roads and the
// robber; module placements are covered in their packages.
func TestLegalTargetsMatchValidator(t *testing.T) {
	const games = 12
	for seed := range uint64(games) {
		players := 3 + int(seed%2)
		log, err := New(GameConfig{Players: players}, SeedsFrom(seed))
		if err != nil {
			t.Fatal(err)
		}
		s := Empty()
		for _, e := range log {
			if err := Apply(s, e); err != nil {
				t.Fatal(err)
			}
		}
		rng := rand.New(rand.NewPCG(seed, 4242))
		apply := func(cmd Command) bool {
			events, err := Decide(s, cmd)
			if err != nil {
				return false
			}
			for _, e := range events {
				if err := Apply(s, e); err != nil {
					t.Fatalf("seed %d: apply %s: %v", seed, e.Type, err)
				}
			}
			return true
		}
		for step := 0; s.Phase != PhaseFinished && step < 4000; step++ {
			if !advanceRandomly(t, s, rng, apply) {
				t.Fatalf("seed %d: stuck at step %d", seed, step)
			}
			assertLegalMatchesValidator(t, s, seed)
		}
	}
}

// assertLegalMatchesValidator checks, for every board position and each base
// placement type, that being in the offered set is equivalent to the validator
// accepting it on a fully-funded clone.
func assertLegalMatchesValidator(t *testing.T, s *State, seed uint64) {
	t.Helper()
	cur := s.Cur
	lt := s.LegalTargetsFor(cur)

	// Fund the current player so cost never masks a positional rejection.
	rich := s.Clone()
	for r := range rich.Players[cur].Hand {
		rich.Players[cur].Hand[r] = 30
	}

	accepts := func(ct CommandType, data map[string]any, ok func(error) bool) bool {
		_, err := Decide(rich, Command{Player: cur, Type: ct, Data: mustJSON(t, data)})
		return ok(err)
	}
	nilErr := func(err error) bool { return err == nil }

	// The build commands (CmdBuild*) are play-phase only; setup placement uses
	// CmdPlace* and is checked by the setup tests. Compare those here only in play.
	if s.Phase == PhasePlay {
		verts := map[board.Vertex]bool{}
		for _, v := range lt.Settlements {
			verts[v] = true
		}
		for _, v := range s.boardVertices() {
			legal := accepts(CmdBuildSettlement, map[string]any{"v": v}, nilErr)
			if verts[v] != legal {
				t.Errorf("seed %d: settlement %v offered=%v validator=%v", seed, v, verts[v], legal)
			}
		}

		cityVerts := map[board.Vertex]bool{}
		for _, v := range lt.Cities {
			cityVerts[v] = true
		}
		for _, v := range s.boardVertices() {
			legal := accepts(CmdBuildCity, map[string]any{"v": v}, nilErr)
			if cityVerts[v] != legal {
				t.Errorf("seed %d: city %v offered=%v validator=%v", seed, v, cityVerts[v], legal)
			}
		}

		roadEdges := map[board.Edge]bool{}
		for _, e := range lt.Roads {
			roadEdges[e] = true
		}
		for _, e := range s.boardEdges() {
			legal := accepts(CmdBuildRoad, map[string]any{"e": e}, nilErr)
			if roadEdges[e] != legal {
				t.Errorf("seed %d: road %v offered=%v validator=%v", seed, e, roadEdges[e], legal)
			}
		}
	}

	// Robber: a hex is a legal placement unless ErrBadPlacement; a victim-required
	// hex returns ErrBadVictim, which is still a legal placement.
	robberOK := func(err error) bool { return err == nil || errors.Is(err, ErrBadVictim) }
	robberHexes := map[board.Hex]bool{}
	for _, h := range lt.RobberHexes {
		robberHexes[h] = true
	}
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		legal := accepts(CmdMoveRobber, map[string]any{"hex": h}, robberOK)
		if robberHexes[h] != legal {
			t.Errorf("seed %d: robber %v offered=%v validator=%v", seed, h, robberHexes[h], legal)
		}
	}
}
