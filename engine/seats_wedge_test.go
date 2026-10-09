package engine_test

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// fullLandShape mirrors the frontend's fullLandBoard(radius) and the "small",
// "medium" and "large" gallery maps: a full hexagon of generic land with no
// numbers, which the engine fills in at start.
func fullLandShape(radius int) *board.Board {
	b := &board.Board{Radius: radius, Tiles: map[board.Hex]board.Tile{}, Robber: board.Hex{Q: 0, R: 0}}
	for _, h := range board.HexesInRadius(radius) {
		b.Tiles[h] = board.Tile{Res: board.ResLand}
	}
	return b
}

// setupCompletes plays the automatic setup placements and reports whether the
// game reached play.
func setupCompletes(t *testing.T, cfg engine.GameConfig, seed uint64) bool {
	t.Helper()
	evs, err := engine.New(cfg, engine.SeedsFrom(seed))
	if err != nil {
		t.Fatalf("seed %d: New: %v", seed, err)
	}
	st, err := engine.Replay(evs)
	if err != nil {
		t.Fatalf("seed %d: replay: %v", seed, err)
	}
	for range 400 {
		cmd, ok := engine.AutoCommand(st)
		if !ok {
			return false
		}
		out, err := engine.Decide(st, cmd)
		if err != nil {
			return false
		}
		for _, e := range out {
			if err := engine.Apply(st, e); err != nil {
				t.Fatalf("seed %d: apply: %v", seed, err)
			}
		}
		if st.Phase != engine.PhaseSetup {
			return true
		}
	}
	return false
}

// TestEverySeatCountFinishesSetupOnItsOwnBoard: a table the server accepts must
// be able to start.
//
// Ten players on the 19-hex Small map need twenty setup settlements, and in 21 of
// 300 seeds the automatic placer got stuck at nineteen, leaving the game in setup
// with nothing more appended to the log. It is not a pure capacity limit (279 seeds
// finish), so the guard is a seat check with headroom (board.ValidateSeats, ~4.5
// land tiles per seat) and game.maxEmptyDrains bounds the retry loop.
func TestEverySeatCountFinishesSetupOnItsOwnBoard(t *testing.T) {
	for players := 2; players <= 10; players++ {
		b := fullLandShape(board.RadiusFor(players))
		if err := board.ValidateSeats(b, players); err != nil {
			t.Fatalf("%d players: RadiusFor's own board fails the seat check: %v", players, err)
		}
		for seed := uint64(1); seed <= 60; seed++ {
			cfg := engine.GameConfig{
				Players: players, Ruleset: "base", TargetVP: 10, DiscardLimit: 7,
				DiceMode: "random", BoardMode: "fair", Board: fullLandShape(board.RadiusFor(players)),
			}
			if !setupCompletes(t, cfg, seed) {
				t.Errorf("%d players on radius %d, seed %d: setup never completed", players, board.RadiusFor(players), seed)
			}
		}
	}
}

// TestTenPlayersTinyBoardWedge pins the census the seat check was
// sized against: the check refuses the config, and the config really does
// wedge 21 of 300 seeds.
func TestTenPlayersTinyBoardWedge(t *testing.T) {
	small := fullLandShape(2)
	if err := board.ValidateSeats(small, 10); err == nil {
		t.Fatal("19-hex board accepts a 10-player table")
	}
	wedged := 0
	for seed := uint64(1); seed <= 300; seed++ {
		cfg := engine.GameConfig{
			Players: 10, Ruleset: "base", TargetVP: 10, DiscardLimit: 7,
			DiceMode: "random", BoardMode: "fair", Board: fullLandShape(2),
		}
		if !setupCompletes(t, cfg, seed) {
			wedged++
		}
	}
	if wedged == 0 {
		t.Fatal("no seed wedged in setup")
	}
	t.Logf("10 players on 19 hexes: %d of 300 seeds cannot leave setup (%.1f%%)", wedged, float64(wedged)/3)
}
