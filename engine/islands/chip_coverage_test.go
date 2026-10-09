package islands

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// Island chips are awarded only for settlements built during play. finalizeWith
// runs module OnEvents only in PhasePlay (decide.go), and setup placements emit
// EvSettlementPlace/EvSetupCityPlace, which the chip handler ignores. This
// end-to-end check auto-plays setup across seeds and asserts no chip and no
// island VP appear.
func TestSetupAwardsNoIslandChips(t *testing.T) {
	for seed := uint64(1); seed <= 12; seed++ {
		s, log := newGame(t, seed)
		for _, e := range log {
			if e.Type == EvIslandChip {
				t.Fatalf("seed %d: island chip awarded during setup: %+v", seed, e)
			}
		}
		for p, vp := range ext(s).IslandVP {
			if vp != 0 {
				t.Fatalf("seed %d: player %d holds %d island VP after setup; want 0", seed, p, vp)
			}
		}
	}
}

// The chip handler must ignore the setup-phase placement events directly, even
// when the placed vertex reaches a brand-new island.
func TestOnEventsIgnoresSetupPlacement(t *testing.T) {
	island := board.Hex{Q: 2, R: -2}
	s := builtState(t, 2,
		board.Hex{Q: 1, R: -1}, board.Hex{Q: 2, R: -1}, board.Hex{Q: 1, R: -2})
	v := island.Vertices()[0]

	for _, typ := range []engine.EventType{engine.EvSettlementPlace, engine.EvSetupCityPlace} {
		ev := engine.NewEvent(typ, engine.SettlementPlacedData{Player: 0, V: v})
		if out := (Module{}).onEvents(s, []engine.Event{ev}); hasEvent(out, EvIslandChip) {
			t.Fatalf("%s on a new island wrongly awarded a chip", typ)
		}
	}
}

// Island VP must count toward a player's victory total via VictoryCheck, in
// both the public total and the own-seat total.
func TestIslandVPCountsTowardVictory(t *testing.T) {
	s := builtState(t, 3, board.Hex{Q: 2, R: -2})
	p := engine.PlayerID(0)
	before := s.PublicVPWithModules(p)

	applyModuleEvent(t, s, engine.NewEvent(EvIslandChip, islandChipData{Player: p, Island: 7, VP: 2}))
	applyModuleEvent(t, s, engine.NewEvent(EvIslandChip, islandChipData{Player: p, Island: 9, VP: 2}))

	if ext(s).IslandVP[p] != 4 {
		t.Fatalf("island_vp = %d; want 4", ext(s).IslandVP[p])
	}
	if got := s.PublicVPWithModules(p); got != before+4 {
		t.Fatalf("public VP with two island chips = %d; want %d (+4)", got, before+4)
	}
	if got := s.VPWithModules(p); got != before+4 {
		t.Fatalf("own-seat VP with two island chips = %d; want %d (+4)", got, before+4)
	}
}

// The chip mechanic must work on an authored Islands board (cfg.Board), not
// just carved ones. Authored boards ship their own sea and SetupBoard skips
// them, so this covers engine.New's cfg.Board path and shows island detection
// and chips depend only on the tiles.
func TestIslandChipsOnAuthoredBoard(t *testing.T) {
	// Radius-2 land with a three-hex sea moat isolating the {2,-2} corner.
	b := &board.Board{Radius: 2, Tiles: map[board.Hex]board.Tile{}}
	moat := map[board.Hex]bool{
		{Q: 1, R: -1}: true, {Q: 2, R: -1}: true, {Q: 1, R: -2}: true,
	}
	for _, h := range board.HexesInRadius(2) {
		if moat[h] {
			b.Tiles[h] = board.Tile{Res: board.Sea}
		} else {
			b.Tiles[h] = board.Tile{Res: board.Wood, Number: 5}
		}
	}
	b.Robber = board.Hex{Q: 0, R: 0}
	b.Tiles[b.Robber] = board.Tile{Res: board.ResNone} // a desert for the robber

	cfg := engine.GameConfig{Players: 3, Ruleset: "base+islands", Board: b.Clone()}
	log, err := engine.New(cfg, engine.SeedsFrom(1))
	if err != nil {
		t.Fatalf("engine.New(custom islands board): %v", err)
	}
	s := engine.Empty()
	for _, e := range log {
		if err := engine.Apply(s, e); err != nil {
			t.Fatalf("apply %s: %v", e.Type, err)
		}
	}

	// The authored sea must split the board into at least 2 islands (the carve
	// was skipped).
	islands := s.Board.Islands()
	corner := board.Hex{Q: 2, R: -2}
	if islands[corner] == islands[board.Hex{Q: 0, R: 0}] {
		t.Fatalf("authored sea did not isolate the corner island: %v", islands)
	}

	// A settlement reaching that island awards a chip.
	v := corner.Vertices()[0]
	built := engine.NewEvent(engine.EvSettlementBuilt, engine.BuiltData{Player: 0, V: &v})
	if out := (Module{}).onEvents(s, []engine.Event{built}); !hasEvent(out, EvIslandChip) {
		t.Fatalf("no island chip for a settlement reaching the authored island")
	}
}
