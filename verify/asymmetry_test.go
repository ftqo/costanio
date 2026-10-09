package verify

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// auditBoard builds one game and returns the auditor's report and exit code.
// No bots, no store: engine.New already performs every derivation the board
// check audits.
func auditBoard(t *testing.T, name string, cfg engine.GameConfig, seed uint64) (string, int) {
	t.Helper()
	gs := engine.SeedsFrom(seed)
	events, err := engine.New(cfg, gs)
	if err != nil {
		t.Fatalf("building the game: %v", err)
	}
	blob, err := json.Marshal(map[string]any{
		"game":   name,
		"events": events,
		"audit":  map[string]any{"public_seed_commit": engine.SeedCommitment(gs.Public)},
	})
	if err != nil {
		t.Fatal(err)
	}
	return node(t, "verify/cli.mjs", writeTemp(t, blob))
}

// TestJSNumberedDesertFlooded: Fishermen's SetupBoard turns every desert
// into a lake with its number zeroed (a lake pays on four numbers, so a number
// on the tile would be wrong). The port must zero it too. The honest path never
// numbers a desert, but the auditor does not run ValidateLayout, so it can meet
// this input.
func TestJSNumberedDesertFlooded(t *testing.T) {
	b := fullLandShape(2)
	// A desert carrying a token: ValidateLayout rejects it, but the auditor
	// may still see it.
	b.Tiles[board.Hex{Q: 0, R: 0}] = board.Tile{Res: board.ResNone, Number: 5}
	b.Robber = board.Hex{Q: 0, R: 0}
	out, code := auditBoard(t, "numbered-desert", engine.GameConfig{
		Players: 4, Ruleset: "base+fishermen", DiceMode: "fair",
		BoardMode: board.BoardFair, TurnOrder: engine.TurnOrderRandom, Board: b,
	}, 3)
	if !strings.Contains(out, "[PASS] board built from the seed") {
		t.Errorf("numbered desert board not re-derived (exit %d):\n%s", code, out)
	}
}

// TestJSOffBoardRobber covers verify/board.mjs's Resolve. In Go
// (`b.Tiles[b.Robber].Res != ResNone`) a map miss yields the zero Tile, whose
// Res is ResNone, so a robber on no tile is left where it is. The port must
// match. ValidateLayout rejects this input, but the auditor does not run it.
func TestJSOffBoardRobber(t *testing.T) {
	b := fullLandShape(2)
	b.Tiles[board.Hex{Q: 0, R: 0}] = board.Tile{Res: board.ResNone}
	b.Robber = board.Hex{Q: 9, R: 9} // outside the radius, on no tile
	out, code := auditBoard(t, "off-board-robber", engine.GameConfig{
		Players: 4, Ruleset: "base", DiceMode: "fair",
		BoardMode: board.BoardFair, TurnOrder: engine.TurnOrderRandom, Board: b,
	}, 3)
	if !strings.Contains(out, "[PASS] board built from the seed") {
		t.Errorf("off-board robber board not re-derived (exit %d):\n%s", code, out)
	}
}
