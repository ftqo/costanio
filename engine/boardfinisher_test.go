package engine

import (
	"math/rand/v2"
	"testing"

	"github.com/ftqo/costan.io/engine/board"
)

// Two synthetic modules reproduce the Caravans/Islands shape in miniature:
// "zcarver" reshapes the board in SetupBoard and "asurveyor" draws a conclusion
// from it. The surveyor sorts first, as CanonicalRuleset puts Caravans ahead
// of Islands.

type carverModule struct{}

func (carverModule) Name() string { return "zcarver" }
func (carverModule) SetupBoard(b *board.Board, cfg GameConfig, rng *rand.Rand) {
	// Drown every desert, the way Islands drowns the outer ring.
	for h, t := range b.Tiles {
		if t.Res == board.ResNone {
			b.Tiles[h] = board.Tile{Res: board.Sea}
		}
	}
}
func (carverModule) Decide(*State, Command) ([]Event, bool, error) { return nil, false, nil }
func (carverModule) Apply(*State, Event) (bool, error)             { return false, nil }
func (carverModule) Hooks() Hooks                                  { return Hooks{} }

type surveyorModule struct{}

func (surveyorModule) Name() string { return "asurveyor" }

// SetupBoard does nothing: a survey here would see the pre-carve board.
func (surveyorModule) SetupBoard(b *board.Board, cfg GameConfig, rng *rand.Rand) {}

// FinishBoard runs after every SetupBoard, so the survey is truthful: if no
// desert survives, make one.
func (surveyorModule) FinishBoard(b *board.Board, cfg GameConfig, rng *rand.Rand) {
	for _, t := range b.Tiles {
		if t.Res == board.ResNone {
			return
		}
	}
	for _, h := range board.HexesInRadius(b.Radius) {
		if t, ok := b.Tiles[h]; ok && t.Res.Producing() {
			b.Tiles[h] = board.Tile{Res: board.ResNone}
			return
		}
	}
}
func (surveyorModule) Decide(*State, Command) ([]Event, bool, error) { return nil, false, nil }
func (surveyorModule) Apply(*State, Event) (bool, error)             { return false, nil }
func (surveyorModule) Hooks() Hooks                                  { return Hooks{} }

// TestFinishBoardRunsAfterEverySetupBoard: without the second dispatch pass in
// State.New, the surveyor's repair runs before the carver (or not at all) and
// the board ends with no desert.
func TestFinishBoardRunsAfterEverySetupBoard(t *testing.T) {
	RegisterModule("zcarver", func() Module { return carverModule{} })
	RegisterModule("asurveyor", func() Module { return surveyorModule{} })

	// Both orders of the ruleset string must give the same outcome.
	for _, rs := range []string{"base+asurveyor+zcarver", "base+zcarver+asurveyor"} {
		evs, err := New(GameConfig{Players: 4, Ruleset: rs}, Seeds{Public: 7, Private: 7})
		if err != nil {
			t.Fatalf("%s: %v", rs, err)
		}
		s, err := Replay(evs)
		if err != nil {
			t.Fatalf("%s: replay: %v", rs, err)
		}
		deserts := 0
		for _, tile := range s.Board.Tiles {
			if tile.Res == board.ResNone {
				deserts++
			}
		}
		if deserts != 1 {
			t.Fatalf("%s: %d deserts on the finished board, want 1", rs, deserts)
		}
	}
}
