package game

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// tinyFullLand mirrors the frontend's fullLandBoard(radius): a full hexagon of
// generic land, which the engine fills in at start.
func tinyFullLand(radius int) *board.Board {
	b := &board.Board{Radius: radius, Tiles: map[board.Hex]board.Tile{}, Robber: board.Hex{Q: 0, R: 0}}
	for _, h := range board.HexesInRadius(radius) {
		b.Tiles[h] = board.Tile{Res: board.ResLand}
	}
	return b
}

// TestWedgedTableIsPaused: a 10-player table on the
// Small map (radius 2, 19 hexes) cannot place its twentieth setup settlement,
// so AutoCommand refuses every seat. Re-arming forever logs nothing, so the
// event cap never fires; after maxEmptyDrains the game must pause.
//
// board.ValidateSeats refuses this config at creation, so the game is seeded
// through the store: the loop guard must still hold for any future permanent
// refusal. Seed 6 is one that wedges (see the engine's
// TestTenPlayersTinyBoardWedge).
func TestWedgedTableIsPaused(t *testing.T) {
	st := openStore(t)
	clock := &fakeClock{}
	cfg := engine.GameConfig{
		Players: 10, Ruleset: "base", TargetVP: 10, DiscardLimit: 7,
		TurnTimerSec: 30, DiceMode: "random", BoardMode: "fair",
		Board: tinyFullLand(2),
	}
	events, err := engine.New(cfg, engine.SeedsFrom(6))
	if err != nil {
		t.Fatal(err)
	}
	engine.StampSource(events, engine.SourceServer)
	seedGameWithLog(t, st, "g1", events)

	m := NewManager(st, clock)
	defer m.StopAll()
	a, err := m.Get("g1")
	if err != nil {
		t.Fatal(err)
	}
	actorState(a) // sync on the loop's opening armTimer

	// Time out repeatedly: ~40 auto-placements, the wedge, then at most
	// maxEmptyDrains empty drains. Running out of iterations means it is still
	// looping.
	paused := false
	for range 300 {
		clock.Fire()
		actorState(a)
		g, err := st.GameByID("g1")
		if err != nil {
			t.Fatal(err)
		}
		if g.Status == statusPausedError {
			paused = true
			break
		}
	}
	if !paused {
		t.Fatal("wedged table timed out 300 times without being paused")
	}
}
