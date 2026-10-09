// Package verify tests the fairness audit against the engine.
//
// verify/*.mjs is a JavaScript port of everything a player can verify: Go's
// math/rand/v2 PCG, the dice, the fair deck, board generation and the seating
// shuffle. These tests play real games in Go and require the JavaScript to
// reach the same answers.
//
// If one fails after a change to board generation or the dice, re-port the
// change; the port is what is out of date.
package verify

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand/v2"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/game"
	"github.com/ftqo/costan.io/lobby"
	"github.com/ftqo/costan.io/sim"
	"github.com/ftqo/costan.io/store"

	_ "github.com/ftqo/costan.io/engine/harbormaster"
	_ "github.com/ftqo/costan.io/engine/islands"
	_ "github.com/ftqo/costan.io/engine/knights"
	_ "github.com/ftqo/costan.io/engine/rivers"
	"github.com/ftqo/costan.io/engine/scenarios"
	_ "github.com/ftqo/costan.io/engine/wagons"
)

// node runs a script against the verifier and returns its combined output and
// exit code. It skips the test when node is not installed.
func node(t *testing.T, args ...string) (string, int) {
	t.Helper()
	bin, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node not on PATH; the flake provides nodejs_24")
	}
	cmd := exec.Command(bin, args...)
	cmd.Dir = repoDir(t)
	out, err := cmd.CombinedOutput()
	code := 0
	var exitErr *exec.ExitError
	switch {
	case errors.As(err, &exitErr):
		code = exitErr.ExitCode()
	case err != nil:
		t.Fatalf("running node: %v\n%s", err, out)
	}
	return string(out), code
}

func repoDir(t *testing.T) string {
	t.Helper()
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	return filepath.Dir(wd) // verify/ -> repo root
}

// replayJSON assembles the payload GET /api/games/{id}/replay serves.
func replayJSON(t *testing.T, st *store.Store, gameID string, seed uint64) []byte {
	t.Helper()
	events, err := st.LoadEvents(gameID, 0)
	if err != nil {
		t.Fatal(err)
	}
	blob, err := json.Marshal(map[string]any{
		"game":   gameID,
		"events": events,
		// The simulator has no lobby, so supply the commitment it would store.
		"audit": map[string]any{"public_seed_commit": engine.SeedCommitment(seed)},
	})
	if err != nil {
		t.Fatal(err)
	}
	return blob
}

// decodeReplay unmarshals a replay log with UseNumber, so uint64 seeds survive
// a decode/encode round trip. Plain float64 decoding rounds them, which breaks
// the seed commitment and would make every tamper test pass for the wrong
// reason (see TestJSONRoundTripKeepsVerdict).
func decodeReplay(t *testing.T, blob []byte) map[string]any {
	t.Helper()
	dec := json.NewDecoder(bytes.NewReader(blob))
	dec.UseNumber()
	var payload map[string]any
	if err := dec.Decode(&payload); err != nil {
		t.Fatal(err)
	}
	return payload
}

func writeTemp(t *testing.T, blob []byte) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "replay.json")
	if err := os.WriteFile(path, blob, 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

// verifyCase is one row of TestJSVerifiesRealGames' table.
type verifyCase struct {
	name      string
	ruleset   string
	diceMode  string
	boardMode string
	players   int
	seed      uint64
	// extra lists ruleset-specific checks that must pass; checks that do not
	// apply report as skipped.
	extra []string
}

// verifyCases is the table, shared with the coverage guards below.
func verifyCases() []verifyCase {
	return []verifyCase{
		{"base-random-dice", "base", "random", "fair", 4, 11, nil},
		{"base-fair-dice", "base", "fair", "fair", 4, 12, nil},
		{"base-random-board", "base", "fair", "random", 3, 13, nil},
		{"base-6p", "base", "random", "fair", 6, 14, nil},
		{"islands", "base+islands", "fair", "fair", 4, 15, nil},
		{"knights", "base+cak", "random", "fair", 4, 16,
			[]string{"[PASS] every event die follows from the seed"}},
		{"fishermen", "base+fishermen", "fair", "fair", 4, 17,
			[]string{"[PASS] scenario state derived from the board", "[PASS] the old boot follows from the seed"}},
		{"caravans", "base+caravans", "fair", "fair", 4, 18,
			[]string{"[PASS] scenario state derived from the board"}},
		// Derivation 13's larger tables, played end to end.
		{"fishermen-5p", "base+fishermen", "fair", "fair", 5, 41,
			[]string{"[PASS] scenario state derived from the board", "[PASS] the old boot follows from the seed"}},
		{"caravans-6p", "base+caravans", "fair", "fair", 6, 42,
			[]string{"[PASS] scenario state derived from the board"}},
		{"caravans-fishermen-5p", engine.CanonicalRuleset("base+caravans+fishermen"), "fair", "fair", 5, 43,
			[]string{"[PASS] scenario state derived from the board", "[PASS] the old boot follows from the seed"}},
		// The Caravans repair needs Islands to disturb the oasis. Seed 69 makes
		// the finisher swap an outer-ring oasis inward, and the Simple bots
		// finish the game.
		{"caravans-islands", engine.CanonicalRuleset("base+islands+caravans"), "fair", "fair", 4, 69,
			[]string{"[PASS] scenario state derived from the board"}},
		// Every pair of modules: composition bugs (hook order, two streams, one
		// reshaped board) only show up in pairs.
		{"fishermen-islands", engine.CanonicalRuleset("base+fishermen+islands"), "fair", "fair", 4, 23,
			[]string{"[PASS] scenario state derived from the board", "[PASS] the old boot follows from the seed"}},
		{"caravans-fishermen", engine.CanonicalRuleset("base+caravans+fishermen"), "fair", "fair", 4, 24,
			[]string{"[PASS] scenario state derived from the board", "[PASS] the old boot follows from the seed"}},
		{"knights-islands", engine.CanonicalRuleset("base+cak+islands"), "random", "fair", 4, 25,
			[]string{"[PASS] every event die follows from the seed"}},
		// Seed 26 stalemates under the Simple bots.
		{"knights-fishermen", engine.CanonicalRuleset("base+cak+fishermen"), "random", "fair", 4, 28,
			[]string{"[PASS] every event die follows from the seed", "[PASS] scenario state derived from the board", "[PASS] the old boot follows from the seed"}},
		{"knights-caravans", engine.CanonicalRuleset("base+cak+caravans"), "random", "fair", 4, 27,
			[]string{"[PASS] every event die follows from the seed", "[PASS] scenario state derived from the board"}},
		// Triples beyond the pair coverage guard: caravans+fishermen+islands is
		// the deepest board composition (carve, flood, oasis and lake repairs),
		// and Knights with Caravans and Fishermen puts the event die and the old boot in one
		// log.
		{"caravans-fishermen-islands", engine.CanonicalRuleset("base+caravans+fishermen+islands"), "fair", "fair", 4, 31,
			[]string{"[PASS] scenario state derived from the board", "[PASS] the old boot follows from the seed"}},
		{"knights-caravans-fishermen", engine.CanonicalRuleset("base+cak+caravans+fishermen"), "random", "fair", 4, 32,
			[]string{"[PASS] every event die follows from the seed", "[PASS] scenario state derived from the board", "[PASS] the old boot follows from the seed"}},
		// Harbormaster has no board hooks and draws nothing at board time. These
		// rows fail if it gains an unported hook.
		{"harbormaster", "base+harbormaster", "fair", "fair", 4, 33, nil},
		{"harbormaster-knights", engine.CanonicalRuleset("base+cak+harbormaster"), "random", "fair", 4, 34,
			[]string{"[PASS] every event die follows from the seed"}},
		{"harbormaster-islands", engine.CanonicalRuleset("base+harbormaster+islands"), "fair", "fair", 4, 35, nil},
		{"harbormaster-fishermen", engine.CanonicalRuleset("base+fishermen+harbormaster"), "fair", "fair", 4, 36,
			[]string{"[PASS] scenario state derived from the board", "[PASS] the old boot follows from the seed"}},
		{"harbormaster-caravans", engine.CanonicalRuleset("base+caravans+harbormaster"), "fair", "fair", 4, 37,
			[]string{"[PASS] scenario state derived from the board"}},
		// Rivers, solo and with each compatible module (docs/rules/rivers.md).
		// Rivers both draws and paints at board time, and each partner changes
		// its input: Islands carves the coast, Fishermen and Caravans finish
		// first and leave lakes and deserts it must avoid. Knights checks that
		// the event die and river slots do not collide.
		{"rivers", "base+rivers", "fair", "fair", 4, 41,
			[]string{"[PASS] scenario state derived from the board"}},
		{"rivers-islands", engine.CanonicalRuleset("base+islands+rivers"), "fair", "fair", 4, 42,
			[]string{"[PASS] scenario state derived from the board"}},
		{"rivers-knights", engine.CanonicalRuleset("base+cak+rivers"), "random", "fair", 4, 43,
			[]string{"[PASS] every event die follows from the seed", "[PASS] scenario state derived from the board"}},
		{"rivers-fishermen", engine.CanonicalRuleset("base+fishermen+rivers"), "fair", "fair", 4, 44,
			[]string{"[PASS] scenario state derived from the board", "[PASS] the old boot follows from the seed"}},
		{"rivers-caravans", engine.CanonicalRuleset("base+caravans+rivers"), "fair", "fair", 4, 45,
			[]string{"[PASS] scenario state derived from the board"}},
		// Raiders, solo and with each compatible module. Only the Islands row
		// reaches the landmass-growing half of its FinishBoard.
		{"raiders", "base+raiders", "fair", "fair", 4, 41,
			[]string{"[PASS] scenario state derived from the board"}},
		{"raiders-islands", engine.CanonicalRuleset("base+islands+raiders"), "fair", "fair", 4, 42,
			[]string{"[PASS] scenario state derived from the board"}},
		// Seed 59: the Simple bots stalemate on most base+cak+raiders seeds,
		// and this one finishes.
		{"raiders-knights", engine.CanonicalRuleset("base+cak+raiders"), "random", "fair", 4, 59,
			[]string{"[PASS] every event die follows from the seed", "[PASS] scenario state derived from the board"}},
		{"raiders-fishermen", engine.CanonicalRuleset("base+fishermen+raiders"), "fair", "fair", 4, 44,
			[]string{"[PASS] scenario state derived from the board", "[PASS] the old boot follows from the seed"}},
		{"raiders-caravans", engine.CanonicalRuleset("base+caravans+raiders"), "fair", "fair", 4, 45,
			[]string{"[PASS] scenario state derived from the board"}},
		// Wagons: the trade hexes and roles draw from a reserved public slot.
		{"wagons", "base+wagons", "fair", "fair", 4, 33,
			[]string{"[PASS] scenario state derived from the board"}},
		{"knights-wagons", engine.CanonicalRuleset("base+cak+wagons"), "random", "fair", 4, 34,
			[]string{"[PASS] every event die follows from the seed", "[PASS] scenario state derived from the board"}},
		{"caravans-wagons", engine.CanonicalRuleset("base+caravans+wagons"), "fair", "fair", 4, 35,
			[]string{"[PASS] scenario state derived from the board"}},
		{"fishermen-wagons", engine.CanonicalRuleset("base+fishermen+wagons"), "fair", "fair", 4, 36,
			[]string{"[PASS] scenario state derived from the board", "[PASS] the old boot follows from the seed"}},
		// The remaining pairs among Harbormaster, Raiders, Rivers and Wagons.
		// The last three pair modules that each draw from their own slots, so a
		// slot collision would show here.
		{"harbormaster-raiders", engine.CanonicalRuleset("base+harbormaster+raiders"), "fair", "fair", 4, 61,
			[]string{"[PASS] scenario state derived from the board"}},
		{"harbormaster-rivers", engine.CanonicalRuleset("base+harbormaster+rivers"), "fair", "fair", 4, 62,
			[]string{"[PASS] scenario state derived from the board"}},
		{"harbormaster-wagons", engine.CanonicalRuleset("base+harbormaster+wagons"), "fair", "fair", 4, 63,
			[]string{"[PASS] scenario state derived from the board"}},
		{"raiders-rivers", engine.CanonicalRuleset("base+raiders+rivers"), "fair", "fair", 4, 64,
			[]string{"[PASS] scenario state derived from the board"}},
		{"raiders-wagons", engine.CanonicalRuleset("base+raiders+wagons"), "fair", "fair", 4, 65,
			[]string{"[PASS] scenario state derived from the board"}},
		{"rivers-wagons", engine.CanonicalRuleset("base+rivers+wagons"), "fair", "fair", 4, 66,
			[]string{"[PASS] scenario state derived from the board"}},
		// Explorers is Standalone (`base+explorers` is refused). The extra check
		// covers its face-down pool.
		{"explorers", "explorers", "fair", "fair", 4, 31,
			[]string{"[PASS] scenario state derived from the board"}},
		// Rule B turns one starting-island forest into fields.
		{"knights-explorers", engine.CanonicalRuleset("cak+explorers"), "fair", "fair", 4, 32,
			[]string{"[PASS] scenario state derived from the board"}},
	}
}

// TestJSVerifiesRealGames plays a bot game per case and requires the
// JavaScript to re-derive its board and every roll, with rolls actually
// compared so the test cannot pass vacuously.
func TestJSVerifiesRealGames(t *testing.T) {
	for _, tc := range verifyCases() {
		t.Run(tc.name, func(t *testing.T) {
			st, err := store.OpenMem()
			if err != nil {
				t.Fatal(err)
			}
			defer st.Close()
			res, err := sim.RunGame(st, sim.Options{
				Players: tc.players, Ruleset: tc.ruleset,
				DiceMode: tc.diceMode, BoardMode: tc.boardMode, Seed: tc.seed,
			})
			if err != nil {
				t.Fatalf("running the game: %v", err)
			}
			seeds := engine.SeedsFrom(tc.seed)
			path := writeTemp(t, replayJSON(t, st, res.GameID, seeds.Public))
			out, code := node(t, "verify/cli.mjs", path)
			if code != 0 {
				t.Fatalf("verifier rejected engine game (exit %d):\n%s", code, out)
			}
			want := []string{
				"VERIFIED",
				"[PASS] public seed matches its commitment",
				"[PASS] commitment published at table creation",
				"[PASS] private seed matches its commitment",
				"[PASS] board built from the seed",
				"[PASS] every roll follows from the seed",
			}
			want = append(want, tc.extra...)
			for _, w := range want {
				if !strings.Contains(out, w) {
					t.Errorf("missing %q in:\n%s", w, out)
				}
			}
			// Guard against a vacuous pass where no roll was compared. The
			// regexp is anchored so "340 rolls" does not match "0 rolls".
			if vacuousRolls.MatchString(out) {
				t.Errorf("no rolls compared:\n%s", out)
			}
		})
	}
}

// fullLandShape is the board a lobby table carries in its config: a full
// hexagon of generic land with no numbers, which the engine fills in at start.
// It mirrors lobby.fullLandBoard, which is unexported.
func fullLandShape(radius int) *board.Board {
	b := &board.Board{Radius: radius, Tiles: map[board.Hex]board.Tile{}, Robber: board.Hex{Q: 0, R: 0}}
	for _, h := range board.HexesInRadius(radius) {
		b.Tiles[h] = board.Tile{Res: board.ResLand}
	}
	return b
}

// TestJSDerivesBoards checks board derivation on fixed seeds (the lobby
// test uses a random seed per run, so a rare mismatch would look flaky). Each
// row is a board shape (lobby or procedural, player count, board mode,
// ruleset) on a seed that exercises a specific path. It builds boards with
// engine.New rather than playing games, which keeps the sweep cheap.
func TestJSDerivesBoards(t *testing.T) {
	cases := []struct {
		name      string
		ruleset   string
		players   int
		boardMode string
		// inline carries a lobby table's generic-land shape in the config,
		// which the engine resolves at start. Without it the board is
		// generated from scratch, the path the simulator takes.
		inline bool
		seed   uint64
	}{
		// Seeds sensitive to fused multiply-add on arm64 (see
		// engine/board/solve.go); JavaScript has no FMA.
		{"lobby-base-4p-fma-a", "base", 4, board.BoardFair, true, 17418742259747381416},
		{"lobby-base-4p-fma-b", "base", 4, board.BoardFair, true, 3326683750974675154},
		{"lobby-base-3p-fma", "base", 3, board.BoardFair, true, 5625365687987180108},
		{"lobby-base-6p-fma", "base", 6, board.BoardFair, true, 2298681937012504954},
		{"lobby-knights-4p-fma", "base+cak", 4, board.BoardFair, true, 3326683750974675154},
		{"lobby-fishermen-4p-fma", "base+fishermen", 4, board.BoardFair, true, 5625365687987180108},
		// Caravans on a lobby board (what real games use). Both seeds deal an
		// oasis with only two spokes, so the finisher swaps a tile.
		{"lobby-caravans-4p", "base+caravans", 4, board.BoardFair, true, 1},
		{"lobby-caravans-fishermen-3p", engine.CanonicalRuleset("base+caravans+fishermen"), 3, board.BoardFair, true, 6},
		{"procedural-base-4p-fma", "base", 4, board.BoardFair, false, 14727398570297873639},
		{"procedural-islands-4p-fma", "base+islands", 4, board.BoardFair, false, 13699396756335703439},
		// Random mode (no pip-spread scoring) and a larger radius.
		{"lobby-base-4p-random", "base", 4, board.BoardRandom, true, 11643393128411363039},
		{"procedural-base-8p", "base", 8, board.BoardFair, false, 2298681937012504954},
		// Rivers at each board size. The 8- and 10-player boards need three
		// rivers, which triggers DeriveRivers' cap descent (failed passes still
		// spend draws). Lobby and procedural shapes both.
		{"lobby-rivers-4p", "base+rivers", 4, board.BoardFair, true, 3},
		{"lobby-rivers-6p", "base+rivers", 6, board.BoardFair, true, 5},
		{"procedural-rivers-4p", "base+rivers", 4, board.BoardFair, false, 41},
		{"procedural-rivers-8p", "base+rivers", 8, board.BoardFair, false, 2298681937012504954},
		{"procedural-rivers-10p", "base+rivers", 10, board.BoardFair, false, 7},
		{"procedural-rivers-islands-8p", engine.CanonicalRuleset("base+islands+rivers"), 8, board.BoardFair, false, 9},
		// A small Islands board: the most cut-up land, where the cap descent
		// works hardest.
		{"procedural-rivers-islands-4p-small", engine.CanonicalRuleset("base+islands+rivers"), 4, board.BoardFair, false, 7},
		{"lobby-rivers-caravans-fishermen-6p", engine.CanonicalRuleset("base+caravans+fishermen+rivers"), 6, board.BoardFair, true, 12},
		// Derivation 11: fair-mode Rivers boards are rebalanced after painting
		// (random ones are not), and Rivers routes around Wagons' reserved
		// hexes. At the radius with three rivers.
		{"lobby-rivers-8p-random", "base+rivers", 8, board.BoardRandom, true, 19},
		{"procedural-rivers-8p-random", "base+rivers", 8, board.BoardRandom, false, 23},
		{"lobby-rivers-wagons-8p", engine.CanonicalRuleset("base+rivers+wagons"), 8, board.BoardFair, true, 29},
		{"procedural-rivers-wagons-10p", engine.CanonicalRuleset("base+rivers+wagons"), 10, board.BoardFair, false, 31},
		// Derivation 12, one row per change on a seed where it applies: a lake
		// on a cape swapped inland (seed 1), harbours moved off cape corners
		// (Wagons rows), the Raiders castle avoiding the river (seed 1, or 4
		// with Wagons), and a spoke on a strait (seed 2).
		{"lobby-fishermen-wagons-4p", engine.CanonicalRuleset("base+fishermen+wagons"), 4, board.BoardFair, true, 1},
		{"procedural-fishermen-wagons-8p", engine.CanonicalRuleset("base+fishermen+wagons"), 8, board.BoardFair, false, 1},
		{"lobby-harbormaster-wagons-4p", engine.CanonicalRuleset("base+harbormaster+wagons"), 4, board.BoardFair, true, 2},
		{"lobby-raiders-rivers-4p", engine.CanonicalRuleset("base+raiders+rivers"), 4, board.BoardFair, true, 1},
		{"procedural-raiders-rivers-8p", engine.CanonicalRuleset("base+raiders+rivers"), 8, board.BoardFair, false, 1},
		{"procedural-raiders-rivers-wagons-8p", engine.CanonicalRuleset("base+raiders+rivers+wagons"), 8, board.BoardFair, false, 4},
		{"procedural-caravans-islands-4p-strait", engine.CanonicalRuleset("base+caravans+islands"), 4, board.BoardFair, false, 2},
		// Derivation 13: 5-6 and 7-10 seat content. Each seed hits a specific
		// path: the thin-first grounds walk (lobby 3, procedural 8), the lake
		// number deal, and the second-oasis repair (seed 2 short, seed 7 moved,
		// seed 1 at 8 seats moves two).
		{"lobby-fishermen-5p-thin", "base+fishermen", 5, board.BoardFair, true, 3},
		{"procedural-fishermen-5p-thin", "base+fishermen", 5, board.BoardFair, false, 8},
		{"procedural-fishermen-8p", "base+fishermen", 8, board.BoardFair, false, 1},
		{"lobby-fishermen-10p", "base+fishermen", 10, board.BoardFair, true, 2},
		{"lobby-caravans-5p-short", "base+caravans", 5, board.BoardFair, true, 2},
		{"procedural-caravans-5p-second", "base+caravans", 5, board.BoardFair, false, 7},
		{"lobby-caravans-8p-two", "base+caravans", 8, board.BoardFair, true, 1},
		{"procedural-caravans-fishermen-6p", engine.CanonicalRuleset("base+caravans+fishermen"), 6, board.BoardFair, false, 3},
		{"lobby-caravans-wagons-6p", engine.CanonicalRuleset("base+caravans+wagons"), 6, board.BoardFair, true, 1},
		{"procedural-caravans-islands-6p", engine.CanonicalRuleset("base+caravans+islands"), 6, board.BoardFair, false, 3},
		// Derivation 13, fillOases: the carve drowned a desert, so the finisher
		// promotes a hex per missing oasis and rebalances. One at 5 seats, one
		// at 8, two at 8 (seed 21), one under Fishermen (which floods it), and
		// one under Rivers (which rebalances again).
		{"procedural-caravans-islands-5p-promote", engine.CanonicalRuleset("base+caravans+islands"), 5, board.BoardFair, false, 6},
		{"procedural-caravans-islands-8p-promote", engine.CanonicalRuleset("base+caravans+islands"), 8, board.BoardFair, false, 2},
		{"procedural-caravans-islands-8p-promote-two", engine.CanonicalRuleset("base+caravans+islands"), 8, board.BoardFair, false, 21},
		{"procedural-caravans-fishermen-islands-6p-promote", engine.CanonicalRuleset("base+caravans+fishermen+islands"), 6, board.BoardFair, false, 6},
		{"procedural-caravans-islands-rivers-7p-promote", engine.CanonicalRuleset("base+caravans+islands+rivers"), 7, board.BoardFair, false, 2},
		// Derivation 13: fair-mode Islands boards are rebalanced after the
		// carve, random ones are not. One row per radius, the random case, and
		// one per module that reads the tokens afterwards.
		{"procedural-islands-2p-rebalanced", "base+islands", 2, board.BoardFair, false, 1},
		{"procedural-islands-5p-rebalanced", "base+islands", 5, board.BoardFair, false, 3},
		{"procedural-islands-10p-rebalanced", "base+islands", 10, board.BoardFair, false, 5},
		{"procedural-islands-4p-random-not-rebalanced", "base+islands", 4, board.BoardRandom, false, 1},
		{"procedural-knights-islands-4p-rebalanced", engine.CanonicalRuleset("base+cak+islands"), 4, board.BoardFair, false, 2},
		{"procedural-fishermen-islands-6p-rebalanced", engine.CanonicalRuleset("base+fishermen+islands"), 6, board.BoardFair, false, 4},
		{"procedural-islands-rivers-4p-rebalanced-twice", engine.CanonicalRuleset("base+islands+rivers"), 4, board.BoardFair, false, 1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cfg := engine.GameConfig{
				Players: tc.players, Ruleset: tc.ruleset, DiceMode: "fair",
				BoardMode: tc.boardMode, TurnOrder: engine.TurnOrderRandom,
			}
			if tc.inline {
				cfg.Board = fullLandShape(board.RadiusFor(tc.players))
			}
			seeds := engine.SeedsFrom(tc.seed)
			events, err := engine.New(cfg, seeds)
			if err != nil {
				t.Fatalf("building the game: %v", err)
			}
			blob, err := json.Marshal(map[string]any{
				"game":   tc.name,
				"events": events,
				"audit":  map[string]any{"public_seed_commit": engine.SeedCommitment(seeds.Public)},
			})
			if err != nil {
				t.Fatal(err)
			}
			out, _ := node(t, "verify/cli.mjs", writeTemp(t, blob))
			// Require PASS; a skipped check would not fail the verdict.
			if !strings.Contains(out, "[PASS] board built from the seed") {
				t.Errorf("board not re-derived (seed %d):\n%s", tc.seed, out)
			}
			// The ext layer too, here because this table has the lobby shapes.
			// For Rivers the painted board can match while the recorded chains
			// (re-derived in engine/rivers.InitExtBoard) do not.
			parts := strings.Split(tc.ruleset, "+")
			if slices.Contains(parts, "fishermen") || slices.Contains(parts, "caravans") ||
				slices.Contains(parts, "rivers") || slices.Contains(parts, "raiders") ||
				slices.Contains(parts, "wagons") || slices.Contains(parts, "explorers") {
				if !strings.Contains(out, "[PASS] scenario state derived from the board") {
					t.Errorf("scenario state not re-derived (seed %d):\n%s", tc.seed, out)
				}
			}
		})
	}
}

// TestJSPinnedCapeOasis covers Caravans' TradeHexAllowed (derivation
// 11): an authored map pins a desert on an outer corner, so the oasis stays
// there and is excluded from the Wagons trade hexes. Generated boards never
// reach this.
func TestJSPinnedCapeOasis(t *testing.T) {
	for _, tc := range []struct {
		ruleset string
		players int
		seed    uint64
	}{
		{"base+caravans+wagons", 4, 3},
		{"base+caravans+wagons", 6, 8},
		{engine.CanonicalRuleset("base+caravans+rivers+wagons"), 8, 5},
		// Derivation 12: under Fishermen the pinned desert becomes a pinned
		// lake, which Fishermen excludes from the trade hexes.
		{"base+fishermen+wagons", 4, 1},
		{engine.CanonicalRuleset("base+caravans+fishermen+wagons"), 6, 1},
	} {
		b := fullLandShape(board.RadiusFor(tc.players))
		b.Tiles[board.Hex{Q: b.Radius, R: 0}] = board.Tile{Res: board.ResNone}
		cfg := engine.GameConfig{
			Players: tc.players, Ruleset: tc.ruleset, DiceMode: "fair",
			BoardMode: board.BoardFair, TurnOrder: engine.TurnOrderRandom, Board: b,
		}
		seeds := engine.SeedsFrom(tc.seed)
		events, err := engine.New(cfg, seeds)
		if err != nil {
			t.Fatalf("%s: %v", tc.ruleset, err)
		}
		blob, err := json.Marshal(map[string]any{
			"game": "pinned-cape-oasis", "events": events,
			"audit": map[string]any{"public_seed_commit": engine.SeedCommitment(seeds.Public)},
		})
		if err != nil {
			t.Fatal(err)
		}
		out, _ := node(t, "verify/cli.mjs", writeTemp(t, blob))
		if !strings.Contains(out, "[PASS] board built from the seed") ||
			!strings.Contains(out, "[PASS] scenario state derived from the board") {
			t.Errorf("%s %dp seed %d: pinned-cape-oasis board not re-derived:\n%s",
				tc.ruleset, tc.players, tc.seed, out)
		}
	}
}

// TestJSCrowdedOasisFill covers the lookahead in engine/scenarios.fillOases
// (derivation 13): only candidates that leave room for the next oasis are
// drawn from. This authored 7-seat map (engine/scenarios' crowdedIsletMap) has one
// pinned desert and a few candidates, one clashing with all others. Generated
// boards do not reach this case.
func TestJSCrowdedOasisFill(t *testing.T) {
	sea := map[board.Hex]bool{}
	for _, h := range []board.Hex{
		{Q: -4, R: 0}, {Q: -4, R: 3}, {Q: -3, R: -1}, {Q: -3, R: 0}, {Q: -3, R: 3}, {Q: -3, R: 4},
		{Q: -2, R: 1}, {Q: -2, R: 2}, {Q: -2, R: 4}, {Q: -1, R: -3}, {Q: -1, R: 2}, {Q: -1, R: 3},
		{Q: -1, R: 4}, {Q: 0, R: -4}, {Q: 0, R: -3}, {Q: 0, R: -2}, {Q: 0, R: 0}, {Q: 0, R: 1},
		{Q: 0, R: 2}, {Q: 0, R: 3}, {Q: 1, R: -4}, {Q: 1, R: -3}, {Q: 1, R: 0}, {Q: 2, R: -4},
		{Q: 2, R: -3}, {Q: 2, R: -1}, {Q: 2, R: 0}, {Q: 2, R: 2}, {Q: 3, R: -4}, {Q: 3, R: -2},
		{Q: 3, R: -1}, {Q: 3, R: 0}, {Q: 4, R: -4}, {Q: 4, R: -3},
	} {
		sea[h] = true
	}
	for _, seed := range []uint64{1, 2, 3} {
		b := &board.Board{Radius: 4, Tiles: map[board.Hex]board.Tile{}, Robber: board.Hex{Q: 4, R: 0}}
		for _, h := range board.HexesInRadius(4) {
			switch {
			case sea[h]:
				b.Tiles[h] = board.Tile{Res: board.Sea}
			case h == b.Robber:
				b.Tiles[h] = board.Tile{Res: board.ResNone}
			default:
				b.Tiles[h] = board.Tile{Res: board.ResLand}
			}
		}
		cfg := engine.GameConfig{
			Players: 7, Ruleset: "base+caravans", DiceMode: "fair",
			BoardMode: board.BoardFair, TurnOrder: engine.TurnOrderRandom, Board: b,
		}
		seeds := engine.SeedsFrom(seed)
		events, err := engine.New(cfg, seeds)
		if err != nil {
			t.Fatalf("seed %d: %v", seed, err)
		}
		blob, err := json.Marshal(map[string]any{
			"game": "crowded-oasis-fill", "events": events,
			"audit": map[string]any{"public_seed_commit": engine.SeedCommitment(seeds.Public)},
		})
		if err != nil {
			t.Fatal(err)
		}
		out, _ := node(t, "verify/cli.mjs", writeTemp(t, blob))
		if !strings.Contains(out, "[PASS] board built from the seed") ||
			!strings.Contains(out, "[PASS] scenario state derived from the board") {
			t.Errorf("seed %d: crowded oasis fill not re-derived:\n%s", seed, out)
		}
	}
}

// TestJSRejectsTamperedRoll checks the verifier rejects a log with one die
// in one roll bumped by one.
func TestJSRejectsTamperedRoll(t *testing.T) {
	st, err := store.OpenMem()
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	res, err := sim.RunGame(st, sim.Options{Players: 4, Ruleset: "base", DiceMode: "random", Seed: 21})
	if err != nil {
		t.Fatal(err)
	}
	seeds := engine.SeedsFrom(21)
	payload := decodeReplay(t, replayJSON(t, st, res.GameID, seeds.Public))
	events := payload["events"].([]any)
	tampered := false
	for _, raw := range events {
		e := raw.(map[string]any)
		if e["type"] != "dice_rolled" {
			continue
		}
		d := e["data"].(map[string]any)
		d1, err := d["d1"].(json.Number).Int64()
		if err != nil {
			t.Fatal(err)
		}
		d["d1"] = json.Number(strconv.Itoa(int(d1)%6 + 1)) // bump by one, staying a legal die face
		tampered = true
		break
	}
	if !tampered {
		t.Fatal("game logged no rolls")
	}
	blob, _ := json.Marshal(payload)
	out, code := node(t, "verify/cli.mjs", writeTemp(t, blob))
	if code != 1 {
		t.Fatalf("tampered log passed (exit %d):\n%s", code, out)
	}
	if !strings.Contains(out, "FAILED") && !strings.Contains(out, "FAIL") {
		t.Errorf("expected a failure verdict:\n%s", out)
	}
}

// TestFlaggedRollMustBeDeclared checks that rolls flagged as Alchemist rolls
// need a matching public `cak_dice_fixed` declaration. Here every roll of a
// base game is rewritten to 6+6 and flagged; the audit must fail, not skip.
func TestFlaggedRollMustBeDeclared(t *testing.T) {
	st, err := store.OpenMem()
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	res, err := sim.RunGame(st, sim.Options{Players: 4, Ruleset: "base", DiceMode: "random", Seed: 21})
	if err != nil {
		t.Fatal(err)
	}
	seeds := engine.SeedsFrom(21)
	payload := decodeReplay(t, replayJSON(t, st, res.GameID, seeds.Public))
	rigged := 0
	for _, raw := range payload["events"].([]any) {
		e := raw.(map[string]any)
		if e["type"] != "dice_rolled" {
			continue
		}
		d := e["data"].(map[string]any)
		d["d1"], d["d2"], d["fixed"] = json.Number("6"), json.Number("6"), true
		rigged++
	}
	if rigged == 0 {
		t.Fatal("game logged no rolls")
	}
	blob, _ := json.Marshal(payload)
	out, code := node(t, "verify/cli.mjs", writeTemp(t, blob))
	if code == 0 {
		t.Fatalf("%d rigged, flagged rolls verified:\n%s", rigged, out)
	}
	if !strings.Contains(out, "FAILED") {
		t.Errorf("expected a failure verdict, not a skip:\n%s", out)
	}
}

// TestJSSeatOrderMatchesGo compares the seating permutation directly, since
// the simulator never shuffles seats.
func TestJSSeatOrderMatchesGo(t *testing.T) {
	type row struct {
		Seed  string `json:"seed"`
		N     int    `json:"n"`
		Order []int  `json:"order"`
	}
	var want []row
	for _, seed := range []uint64{0, 1, 42, 0xdeadbeef, 1<<63 | 5} {
		for n := 2; n <= 10; n++ {
			want = append(want, row{Seed: u64s(seed), N: n, Order: engine.SeatOrder(seed, n)})
		}
	}
	blob, _ := json.Marshal(want)
	path := writeTemp(t, blob)
	out, code := node(t, "verify/seatcheck.mjs", path)
	if code != 0 {
		t.Fatalf("seatcheck.mjs disagrees with engine.SeatOrder (exit %d):\n%s", code, out)
	}
}

func u64s(v uint64) string {
	b, _ := json.Marshal(v)
	return strings.Trim(string(b), `"`)
}

// TestBundleIsCurrent rebuilds verify/dist/verify.js and requires it to match
// the committed file byte for byte.
//
// If this fails, run: node scripts/bundle-verify.mjs
func TestBundleIsCurrent(t *testing.T) {
	root := repoDir(t)
	committed, err := os.ReadFile(filepath.Join(root, "verify", "dist", "verify.js"))
	if err != nil {
		t.Fatalf("reading the committed bundle: %v", err)
	}
	// The bundler always writes to verify/dist, so rebuild and compare rather
	// than trying to redirect it. Restore the file afterwards either way.
	out, code := node(t, "scripts/bundle-verify.mjs")
	if code != 0 {
		t.Fatalf("bundle-verify.mjs failed (exit %d):\n%s", code, out)
	}
	rebuilt, err := os.ReadFile(filepath.Join(root, "verify", "dist", "verify.js"))
	if err != nil {
		t.Fatal(err)
	}
	if string(committed) != string(rebuilt) {
		// Restore the committed bytes so the tree stays clean.
		_ = os.WriteFile(filepath.Join(root, "verify", "dist", "verify.js"), committed, 0o644)
		t.Fatal("verify/dist/verify.js is stale; rebuild it with: node scripts/bundle-verify.mjs")
	}
}

// TestBundleVerifiesRealGames runs the generated bundle, not the modules, over
// a real game. The bundler's transform is textual, so "the modules are correct"
// does not imply "the bundle is correct".
func TestBundleVerifiesRealGames(t *testing.T) {
	st, err := store.OpenMem()
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	res, err := sim.RunGame(st, sim.Options{Players: 4, Ruleset: "base+cak", DiceMode: "fair", Seed: 31})
	if err != nil {
		t.Fatal(err)
	}
	path := writeTemp(t, replayJSON(t, st, res.GameID, engine.SeedsFrom(31).Public))
	out, code := node(t, "verify/bundle_cli.mjs", path)
	if code != 0 {
		t.Fatalf("bundle rejected engine game (exit %d):\n%s", code, out)
	}
	if !strings.Contains(out, "[PASS] every roll follows from the seed") {
		t.Errorf("bundle checked no rolls:\n%s", out)
	}
}

// TestWriteFixture regenerates the replay the frontend's audit-page test runs
// against. It is a generator, not an assertion, so it skips unless asked:
//
//	COSTAN_FIXTURE=frontend/src/lib/__fixtures__/verifiedReplay.json \
//	  go test ./verify -run TestWriteFixture
//
// The fixture is a full four-player game. Regenerate it only when the
// replay's shape changes, not to make a failing test pass.
func TestWriteFixture(t *testing.T) {
	out := os.Getenv("COSTAN_FIXTURE")
	if out == "" {
		t.Skip("set COSTAN_FIXTURE=<path> to regenerate the frontend's replay fixture")
	}
	st, err := store.OpenMem()
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	res, err := sim.RunGame(st, sim.Options{
		Players: 4, Ruleset: "base", DiceMode: "fair", BoardMode: "fair", Seed: 4242,
	})
	if err != nil {
		t.Fatal(err)
	}
	blob := replayJSON(t, st, res.GameID, engine.SeedsFrom(4242).Public)
	if err := os.WriteFile(out, blob, 0o644); err != nil {
		t.Fatal(err)
	}
	t.Logf("wrote %d bytes to %s", len(blob), out)
}

// lobbyEventCap bounds the lobby game's log: about 10x the largest finished
// base game (2041 events), so an honest game never reaches it and a livelocked
// one fails in seconds.
const lobbyEventCap = 20_000

// TestJSVerifiesLobbyGame audits a game created through the lobby, the path
// real tables take: the config carries a generic-land shape the engine
// resolves at start, and the seed commitment (written at create) and
// pre-shuffle roster (written at start) come from the lobby.
func TestJSVerifiesLobbyGame(t *testing.T) {
	st, err := store.OpenMem()
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	host, err := st.UpsertDiscordUser("verify-host", "Host", "")
	if err != nil {
		t.Fatal(err)
	}
	mgr := game.NewManager(st, nil)
	// Set explicitly so the bound is this test's own rather than whatever
	// game.DefaultEventCap is.
	mgr.SetEventCap(lobbyEventCap)
	mgr.SetBotDelay(0)
	mgr.SetBotFactory(func(engine.PlayerID) game.CommandSource { return bot.NewSimple() })
	defer mgr.StopAll()
	lb := lobby.New(st, mgr)

	sum, err := lb.Create(host, engine.GameConfig{
		Players: 4, Ruleset: "base", DiceMode: "fair", BoardMode: "fair",
		TurnOrder: engine.TurnOrderRandom,
	}, false)
	if err != nil {
		t.Fatal(err)
	}
	id := sum.Game.ID
	for range 3 {
		if _, err := lb.AddBot(host, id); err != nil {
			t.Fatal(err)
		}
	}
	// Hand the host's seat to a bot before start: the actor reads seat
	// control when it spawns.
	if err := st.SetSeatStatus(id, 0, "bot"); err != nil {
		t.Fatal(err)
	}
	if err := lb.Start(host, id); err != nil {
		t.Fatal(err)
	}

	// The loop tells a slow game from a runaway. The 15-minute deadline is
	// sized for a loaded machine under -race (the test takes about 2s alone).
	// bot.Simple can livelock on some base boards, cycling turns with no VP
	// source left; a log past runawayEvents fails at once as a runaway, and a
	// timeout reports how far the game got. runawayEvents is a backstop in
	// case the cap is removed.
	const runawayEvents = lobbyEventCap * 2
	deadline := time.Now().Add(15 * time.Minute)
	start := time.Now()
	for {
		g, err := st.GameByID(id)
		if err != nil {
			t.Fatal(err)
		}
		if g.Status == "finished" {
			// Log the event count on success too, as a baseline for this
			// machine.
			n, _ := st.CountEvents(id)
			// At the cap the actor force-finishes the game (game/actor.go),
			// so a livelocked game also arrives here.
			if n > lobbyEventCap {
				t.Fatalf("game %s hit the %d-event cap (%d events in %s); bot livelock (see bot/simple.go)",
					id, lobbyEventCap, n, time.Since(start).Round(time.Millisecond))
			}
			t.Logf("lobby game finished: %d events in %s (typical: 451-2041)",
				n, time.Since(start).Round(time.Millisecond))
			break
		}
		if g.Status == "paused-error" {
			t.Fatal("game paused on an engine error")
		}
		if n, err := st.CountEvents(id); err == nil && n > runawayEvents {
			t.Fatalf("game %s logged %d events in %s without finishing (runaway)",
				id, n, time.Since(start).Round(time.Millisecond))
		}
		if time.Now().After(deadline) {
			n, _ := st.CountEvents(id)
			t.Fatalf("game %s not finished by the deadline (%d events in %s, runaway limit %d)",
				id, n, time.Since(start).Round(time.Second), runawayEvents)
		}
		time.Sleep(20 * time.Millisecond)
	}

	g, err := st.GameByID(id)
	if err != nil {
		t.Fatal(err)
	}
	events, err := st.LoadEvents(id, 0)
	if err != nil {
		t.Fatal(err)
	}
	// A force-finished game looks finished to the poll above; the finish
	// event's source tells the two apart.
	for _, e := range events {
		if e.Type == engine.EvGameFinished && e.Src == engine.SourceServer {
			t.Fatalf("game %s was force-finished by the server (event cap)", id)
		}
	}
	seats, err := st.Seats(id)
	if err != nil {
		t.Fatal(err)
	}
	final := make([]int64, len(seats))
	for i, s := range seats {
		final[i] = s.UserID
	}
	// The same envelope handleReplay serves, assembled from the same columns.
	blob, err := json.Marshal(map[string]any{
		"game":   id,
		"events": events,
		"audit": map[string]any{
			"public_seed_commit": g.PublicSeedCommit,
			"pre_shuffle_seats":  json.RawMessage(g.PreShuffleSeats),
			"final_seats":        final,
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	out, code := node(t, "verify/cli.mjs", writeTemp(t, blob))
	if code != 0 {
		t.Fatalf("audit rejected lobby game (exit %d):\n%s", code, out)
	}
	// Every check must pass, not skip.
	for _, want := range []string{
		"VERIFIED",
		"[PASS] board built from the seed",
		"[PASS] seating derived from the seed",
		"[PASS] every roll follows from the seed",
		"[PASS] commitment published at table creation",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in:\n%s", want, out)
		}
	}
}

// TestVerifyTableCoversEveryModule requires every registered module, and every
// pair of modules that forms a legal ruleset, to appear in verifyCases.
// Composition bugs (hook order, separate streams, one reshaped board) only
// show up in pairs.
func TestVerifyTableCoversEveryModule(t *testing.T) {
	covered := map[string]bool{}
	for _, tc := range verifyCases() {
		parts := strings.Split(tc.ruleset, "+")
		for _, a := range parts {
			covered[a] = true
			for _, b := range parts {
				covered[a+"+"+b] = true
			}
		}
	}
	names := engine.RegisteredModuleNames()
	for _, name := range names {
		if !covered[name] {
			t.Errorf("module %q has no case in verifyCases", name)
		}
	}
	for i, a := range names {
		for _, b := range names[i+1:] {
			ruleset := engine.CanonicalRuleset("base+" + a + "+" + b)
			// Only pairs the engine will build (Standalone modules have none).
			if _, err := engine.New(engine.GameConfig{
				Players: 4, Ruleset: ruleset, DiceMode: "fair",
				BoardMode: board.BoardFair, TurnOrder: engine.TurnOrderRandom,
			}, engine.SeedsFrom(1)); err != nil {
				continue
			}
			if !covered[a+"+"+b] && !covered[b+"+"+a] {
				t.Errorf("legal pair %q has no case in verifyCases", ruleset)
			}
		}
	}
}

// TestFirstRollAfterBoardSlots backs an assumption of engine's
// TestPublicSlotsDoNotCollide: random dice read the public stream at their log
// position, and board generation uses slots 1-3, so the first roll must land
// after position 3. Checked against real logs of every ruleset.
func TestFirstRollAfterBoardSlots(t *testing.T) {
	for _, tc := range verifyCases() {
		t.Run(tc.name, func(t *testing.T) {
			st, err := store.OpenMem()
			if err != nil {
				t.Fatal(err)
			}
			defer st.Close()
			res, err := sim.RunGame(st, sim.Options{
				Players: tc.players, Ruleset: tc.ruleset,
				DiceMode: tc.diceMode, BoardMode: tc.boardMode, Seed: tc.seed,
			})
			if err != nil {
				t.Fatalf("running the game: %v", err)
			}
			seeds := engine.SeedsFrom(tc.seed)
			var payload map[string]any
			if err := json.Unmarshal(replayJSON(t, st, res.GameID, seeds.Public), &payload); err != nil {
				t.Fatal(err)
			}
			found := false
			for _, raw := range payload["events"].([]any) {
				e := raw.(map[string]any)
				if e["type"] != "dice_rolled" {
					continue
				}
				found = true
				if seq := int(e["seq"].(float64)); seq <= 3 {
					t.Fatalf("first roll at seq %d, want > 3", seq)
				}
				break
			}
			if !found {
				t.Fatal("game logged no rolls")
			}
		})
	}
}

// TestUnknownDerivationVersionUnauditable checks that a game built
// by another derivation version, or one predating versioning, is reported
// UNAUDITABLE: not FAILED, and not VERIFIED on the commitment checks alone.
func TestUnknownDerivationVersionUnauditable(t *testing.T) {
	// Edit the replay as text so the uint64 seeds are not rounded.
	cases := []struct {
		name string
		edit func(string) string
	}{
		{"future-version", func(raw string) string {
			return strings.Replace(raw,
				fmt.Sprintf(`"derivation_version":%d`, engine.DerivationVersion),
				fmt.Sprintf(`"derivation_version":%d`, engine.DerivationVersion+1), 1)
		}},
		{"unversioned", func(raw string) string {
			return strings.Replace(raw,
				fmt.Sprintf(`,"derivation_version":%d`, engine.DerivationVersion), "", 1)
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			st, err := store.OpenMem()
			if err != nil {
				t.Fatal(err)
			}
			defer st.Close()
			// Knights, since the event die slot has moved before
			// (engine.EventDieSeq).
			res, err := sim.RunGame(st, sim.Options{
				Players: 4, Ruleset: "base+cak", DiceMode: "random", BoardMode: "fair", Seed: 16,
			})
			if err != nil {
				t.Fatal(err)
			}
			seeds := engine.SeedsFrom(16)
			raw := string(replayJSON(t, st, res.GameID, seeds.Public))
			edited := tc.edit(raw)
			if edited == raw {
				t.Fatalf("replay has no derivation_version:\n%.400s", raw)
			}
			out, code := node(t, "verify/cli.mjs", writeTemp(t, []byte(edited)))

			if strings.Contains(out, "[FAIL]") {
				t.Errorf("unreproducible game reported FAILED:\n%s", out)
			}
			if code == 1 {
				t.Errorf("exit 1 (rejected), want 2 (unauditable):\n%s", out)
			}
			if !strings.Contains(out, "UNAUDITABLE") {
				t.Errorf("expected an UNAUDITABLE verdict:\n%s", out)
			}
			if strings.Contains(out, "VERIFIED") {
				t.Errorf("reported VERIFIED on commitment checks alone:\n%s", out)
			}
			// Each derivation check must be reported as skipped; the board
			// would still re-derive here.
			for _, want := range []string{
				"[----] board built from the seed",
				"[----] seating derived from the seed",
				"[----] every roll follows from the seed",
				"[----] every event die follows from the seed",
			} {
				if !strings.Contains(out, want) {
					t.Errorf("missing %q in:\n%s", want, out)
				}
			}
			// And it must name the reason.
			if !strings.Contains(out, "derivation version") && !strings.Contains(out, "predates derivation versioning") {
				t.Errorf("report does not name the derivation version:\n%s", out)
			}
		})
	}
}

// TestJSDerivesPresetBoards checks preset boards, whose tiles are fixed but
// whose harbors PresetBoard deals off the same stream slot as a procedural
// board. It iterates board.PresetNames() so a preset missing from
// verify/board.mjs fails.
func TestJSDerivesPresetBoards(t *testing.T) {
	// Several seeds, since only the harbors vary with the seed.
	seeds := []uint64{1, 7, 99, 20250829}
	// With modules, since hooks treat a preset as authored: Islands and the
	// finishers skip it, Fishermen's SetupBoard does not. Islands is not a
	// legal pairing (these maps are solid land).
	rulesets := []string{"base", "base+fishermen", "base+caravans"}
	for _, name := range board.PresetNames() {
		players := playersForPreset(t, name)
		for _, ruleset := range rulesets {
			for _, seed := range seeds {
				runPresetBoardCase(t, name, ruleset, players, seed)
			}
		}
	}
}

func runPresetBoardCase(t *testing.T, name, ruleset string, players int, seed uint64) {
	t.Helper()
	t.Run(fmt.Sprintf("%s-%s-%d", name, ruleset, seed), func(t *testing.T) {
		cfg := engine.GameConfig{
			Players: players, Ruleset: ruleset, DiceMode: "fair",
			BoardMode: board.BoardFair, TurnOrder: engine.TurnOrderRandom,
			Preset: name,
		}
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
		out, _ := node(t, "verify/cli.mjs", writeTemp(t, blob))
		if !strings.Contains(out, "[PASS] board built from the seed") {
			t.Errorf("preset %q not re-derived (%s, seed %d):\n%s", name, ruleset, seed, out)
		}
	})
}

// playersForPreset finds a seat count a preset accepts (beginner 2-4, expanded
// 5-6, grand 7-10); the ranges are unexported, so it asks.
func playersForPreset(t *testing.T, name string) int {
	t.Helper()
	for n := 2; n <= 10; n++ {
		if board.ValidatePreset(name, n) == nil {
			return n
		}
	}
	t.Fatalf("preset %q accepts no player count between 2 and 10", name)
	return 0
}

// TestPresetHarborsSeeded checks the premise of the test above: a
// preset's harbors change with the seed.
func TestPresetHarborsSeeded(t *testing.T) {
	for _, name := range board.PresetNames() {
		t.Run(name, func(t *testing.T) {
			players := playersForPreset(t, name)
			seen := map[string]bool{}
			for seed := uint64(1); seed <= 8; seed++ {
				b, err := board.PresetBoard(name, players, rand.New(rand.NewPCG(seed, seed)))
				if err != nil {
					t.Fatal(err)
				}
				blob, err := json.Marshal(b.Harbors)
				if err != nil {
					t.Fatal(err)
				}
				seen[string(blob)] = true
			}
			if len(seen) < 2 {
				t.Errorf("preset %q dealt the same harbors on all 8 seeds", name)
			}
		})
	}
}

// TestSkippedBoardCheckUnauditable checks that a skipped board check makes
// the verdict "unauditable" even though the commitment checks pass. The log has
// its board_generated event removed (as in a redacted copy); the rolls must
// still pass. Events stay typed, so the seeds are never rounded.
func TestSkippedBoardCheckUnauditable(t *testing.T) {
	st, err := store.OpenMem()
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	res, err := sim.RunGame(st, sim.Options{
		Players: 4, Ruleset: "base", DiceMode: "fair", BoardMode: "fair", Seed: 11,
	})
	if err != nil {
		t.Fatalf("running the game: %v", err)
	}
	events, err := st.LoadEvents(res.GameID, 0)
	if err != nil {
		t.Fatal(err)
	}
	kept := make([]engine.Event, 0, len(events))
	dropped := 0
	for _, e := range events {
		if e.Type == engine.EvBoardGenerated {
			dropped++
			continue
		}
		kept = append(kept, e)
	}
	if dropped != 1 {
		t.Fatalf("dropped %d board_generated events, want 1", dropped)
	}
	blob, err := json.Marshal(map[string]any{
		"game":   res.GameID,
		"events": kept,
		"audit":  map[string]any{"public_seed_commit": engine.SeedCommitment(engine.SeedsFrom(11).Public)},
	})
	if err != nil {
		t.Fatal(err)
	}
	out, code := node(t, "verify/cli.mjs", writeTemp(t, blob))
	if strings.Contains(out, "VERIFIED") {
		t.Errorf("reported VERIFIED with the board check skipped:\n%s", out)
	}
	if !strings.Contains(out, "UNAUDITABLE") {
		t.Errorf("expected an UNAUDITABLE verdict:\n%s", out)
	}
	if code == 1 {
		t.Errorf("exit 1 (rejected), want 2 (unauditable):\n%s", out)
	}
	if !strings.Contains(out, "[----] board built from the seed") {
		t.Errorf("board check not reported as skipped:\n%s", out)
	}
	// The rest of the audit must still pass.
	if !strings.Contains(out, "[PASS] every roll follows from the seed") {
		t.Errorf("roll check did not pass:\n%s", out)
	}
}

// TestJSMatchesFishermenRobberSetup checks the port of Fishermen.SetupBoard's
// robber placement: off the board, with no draw. The authored board has no
// desert, so any relocation logic on either side would show up.
func TestJSMatchesFishermenRobberSetup(t *testing.T) {
	const radius = 2
	b := &board.Board{Radius: radius, Tiles: map[board.Hex]board.Tile{}}
	// All producing land with pinned numbers and no desert (so no lake).
	// No 6 or 8, so no adjacent reds.
	res := []board.Resource{board.Wood, board.Brick, board.Sheep, board.Wheat, board.Ore}
	nums := []int{3, 4, 5, 9, 10, 11}
	for i, h := range board.HexesInRadius(radius) {
		b.Tiles[h] = board.Tile{Res: res[i%len(res)], Number: nums[i%len(nums)]}
	}
	b.Robber = board.HexesInRadius(radius)[0]

	cfg := engine.GameConfig{
		Players: 4, Ruleset: "base+fishermen", DiceMode: "fair",
		BoardMode: board.BoardFair, TurnOrder: engine.TurnOrderRandom, Board: b,
	}
	seeds := engine.SeedsFrom(4242)
	events, err := engine.New(cfg, seeds)
	if err != nil {
		t.Fatalf("building the game: %v", err)
	}

	// Confirm setup actually moved the robber off the board.
	var built board.Board
	for _, e := range events {
		if e.Type != engine.EvBoardGenerated {
			continue
		}
		var d struct {
			Board board.Board `json:"board"`
		}
		if err := json.Unmarshal(e.Data, &d); err != nil {
			t.Fatal(err)
		}
		built = d.Board
	}
	if built.RobberOnBoard() {
		t.Fatalf("robber still on the board at %+v", built.Robber)
	}

	blob, err := json.Marshal(map[string]any{
		"game":   "fishermen-robber-setup",
		"events": events,
		"audit":  map[string]any{"public_seed_commit": engine.SeedCommitment(seeds.Public)},
	})
	if err != nil {
		t.Fatal(err)
	}
	out, _ := node(t, "verify/cli.mjs", writeTemp(t, blob))
	if !strings.Contains(out, "[PASS] board built from the seed") {
		t.Errorf("board not re-derived:\n%s", out)
	}
}

// TestJSSetupBoot covers the setup bonus (derivation 13): a second
// settlement beside a fishing ground draws one token, which can turn up the
// old boot, keyed on the placement's log position. The log ends after setup,
// so there are no rolls. Requires PASS, then FAIL once the boot is removed.
func TestJSSetupBoot(t *testing.T) {
	for seed := uint64(1); seed <= 400; seed++ {
		cfg := engine.GameConfig{Players: 3, Ruleset: "base+fishermen", DiceMode: "fair",
			BoardMode: board.BoardFair, TurnOrder: engine.TurnOrderRandom}
		seeds := engine.SeedsFrom(seed)
		events, err := engine.New(cfg, seeds)
		if err != nil {
			t.Fatal(err)
		}
		s := engine.Empty()
		for _, e := range events {
			if err := engine.Apply(s, e); err != nil {
				t.Fatal(err)
			}
		}
		apply := func(evs []engine.Event) {
			for _, e := range evs {
				if err := engine.Apply(s, e); err != nil {
					t.Fatal(err)
				}
			}
			events = append(events, evs...)
		}
		booted := false
		for s.Phase == engine.PhaseSetup {
			placed := false
			if s.SetupRound == 1 && !s.NeedRoad {
				fx, _ := scenarios.FishStateExt(s)
			grounds:
				for _, g := range fx.Grounds {
					for _, v := range g.V {
						raw, _ := json.Marshal(map[string]any{"v": v})
						evs, err := engine.Decide(s, engine.Command{Player: s.Cur, Type: engine.CmdPlaceSettlement, Data: raw})
						if err != nil {
							continue
						}
						for _, e := range evs {
							if e.Type == scenarios.EvFishCaught && strings.Contains(string(e.Data), `"boot_to":`) &&
								!strings.Contains(string(e.Data), `"boot_to":-1`) {
								booted = true
							}
						}
						apply(evs)
						placed = true
						break grounds
					}
				}
			}
			if !placed {
				cmd, ok := engine.AutoCommand(s)
				if !ok {
					t.Fatal("setup stuck")
				}
				evs, err := engine.Decide(s, cmd)
				if err != nil {
					t.Fatal(err)
				}
				apply(evs)
			}
		}
		if !booted {
			continue
		}
		audit := func(evs []engine.Event) string {
			blob, err := json.Marshal(map[string]any{"game": "setup-boot", "events": evs,
				"audit": map[string]any{"public_seed_commit": engine.SeedCommitment(seeds.Public)}})
			if err != nil {
				t.Fatal(err)
			}
			out, _ := node(t, "verify/cli.mjs", writeTemp(t, blob))
			return out
		}
		out := audit(events)
		if !strings.Contains(out, "[PASS] the old boot follows from the seed") {
			t.Fatalf("seed %d: setup boot not re-derived:\n%s", seed, out)
		}
		// Hand the boot to nobody: the seed says it turned up.
		tampered := slices.Clone(events)
		for i, e := range tampered {
			if e.Type != scenarios.EvFishCaught {
				continue
			}
			var d map[string]any
			if err := json.Unmarshal(e.Data, &d); err != nil {
				t.Fatal(err)
			}
			if d["boot_to"] == float64(-1) {
				continue
			}
			d["boot_to"] = -1
			raw, _ := json.Marshal(d)
			tampered[i].Data = raw
		}
		if out := audit(tampered); !strings.Contains(out, "[FAIL] the old boot follows from the seed") {
			t.Fatalf("seed %d: removed setup boot still passes:\n%s", seed, out)
		}
		return
	}
	t.Fatal("no seed in 1..400 turns the boot up at setup")
}

// vacuousRolls matches a verifier run that compared no rolls at all. \b keeps
// it off "340 rolls", which a plain substring match does not.
var vacuousRolls = regexp.MustCompile(`\b0 rolls re-derived exactly`)

// TestJSRejectsTamperedBoardExt checks that edits to the board's ext layer
// (BoardGeneratedData.Ext) fail the audit. Apply runs the game off the logged
// blob, so moving a fishing ground's number, the oasis, a spoke or a bridge
// site changes the game.
func TestJSRejectsTamperedBoardExt(t *testing.T) {
	cases := []struct {
		name    string
		ruleset string
		seed    uint64
		module  string
		// tamper edits the module's ext blob in place.
		tamper func(t *testing.T, ext map[string]any)
	}{
		{
			name: "grounds-swap-numbers", ruleset: "base+fishermen", seed: 17,
			module: "fishermen",
			tamper: func(t *testing.T, ext map[string]any) {
				t.Helper()
				grounds, ok := ext["Grounds"].([]any)
				if !ok || len(grounds) < 3 {
					t.Fatalf("no fishing grounds: %v", ext["Grounds"])
				}
				a := grounds[0].(map[string]any)
				b := grounds[2].(map[string]any)
				a["number"], b["number"] = b["number"], a["number"]
			},
		},
		{
			name: "oasis-moved", ruleset: "base+caravans", seed: 18,
			module: "caravans",
			tamper: func(t *testing.T, ext map[string]any) {
				t.Helper()
				oasis, ok := ext["Oasis"].(map[string]any)
				if !ok {
					t.Fatalf("no oasis: %v", ext["Oasis"])
				}
				q, err := oasis["q"].(json.Number).Int64()
				if err != nil {
					t.Fatal(err)
				}
				oasis["q"] = json.Number(strconv.Itoa(int(q) + 1))
			},
		},
		{
			name: "spoke-moved", ruleset: "base+caravans", seed: 18,
			module: "caravans",
			tamper: func(t *testing.T, ext map[string]any) {
				t.Helper()
				arrows, ok := ext["Arrows"].([]any)
				if !ok || len(arrows) < 2 {
					t.Fatalf("no caravan spokes: %v", ext["Arrows"])
				}
				arrows[0], arrows[1] = arrows[1], arrows[0]
			},
		},
		{
			// Swapping two bridge sites (edges that only take a bridge, per
			// docs/rules/rivers.md) leaves the board, chain and site count
			// unchanged; only comparing the edges catches it.
			name: "bridge-site-moved", ruleset: "base+rivers", seed: 41,
			module: "rivers",
			tamper: func(t *testing.T, ext map[string]any) {
				t.Helper()
				rs, ok := ext["rivers"].([]any)
				if !ok || len(rs) == 0 {
					t.Fatalf("no rivers: %v", ext["rivers"])
				}
				sites, ok := rs[0].(map[string]any)["sites"].([]any)
				if !ok || len(sites) < 2 {
					t.Fatalf("no bridge sites: %v", rs[0])
				}
				sites[0], sites[1] = sites[1], sites[0]
			},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			st, err := store.OpenMem()
			if err != nil {
				t.Fatal(err)
			}
			defer st.Close()
			res, err := sim.RunGame(st, sim.Options{
				Players: 4, Ruleset: engine.CanonicalRuleset(tc.ruleset),
				DiceMode: "fair", BoardMode: "fair", Seed: tc.seed,
			})
			if err != nil {
				t.Fatalf("running the game: %v", err)
			}
			seeds := engine.SeedsFrom(tc.seed)
			payload := decodeReplay(t, replayJSON(t, st, res.GameID, seeds.Public))

			tampered := false
			for _, raw := range payload["events"].([]any) {
				e := raw.(map[string]any)
				if e["type"] != string(engine.EvBoardGenerated) {
					continue
				}
				d, ok := e["data"].(map[string]any)
				if !ok {
					t.Fatal("board_generated has no data")
				}
				ext, ok := d["ext"].(map[string]any)
				if !ok {
					t.Fatalf("board_generated has no ext: %v", d["ext"])
				}
				mod, ok := ext[tc.module].(map[string]any)
				if !ok {
					t.Fatalf("no %q in ext: %v", tc.module, ext)
				}
				tc.tamper(t, mod)
				tampered = true
			}
			if !tampered {
				t.Fatal("no board_generated event")
			}

			blob, err := json.Marshal(payload)
			if err != nil {
				t.Fatal(err)
			}
			out, code := node(t, "verify/cli.mjs", writeTemp(t, blob))
			if code != 1 {
				t.Fatalf("tampered ext layer did not fail the audit (exit %d):\n%s", code, out)
			}
		})
	}
}
