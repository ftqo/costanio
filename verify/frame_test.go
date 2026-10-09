package verify

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/sim"
	"github.com/ftqo/costan.io/store"
)

// galleryMap is one land-only silhouette from the frontend's map gallery
// (frontend/src/lib/maps/gallery.ts). The gallery authors land only; Board.Frame
// adds the ocean at game start, so most of these are not full hexagons.
//
// The land strings are copied verbatim from gallery.ts (sim/shores_test.go has
// its own copy of Shores and Archipelago).
type galleryMap struct {
	id      string
	radius  int
	ruleset string
	players int
	land    string
	gold    string
}

const (
	shoresLandSpec = "0,-3 2,-3 3,-3 3,-2 -1,-1 0,-1 1,-1 3,-1 -2,0 -1,0 0,0 1,0 -3,1 -2,1 -1,1 0,1 1,1 3,1 -3,2 -2,2 -1,2 0,2 2,2 -3,3 -2,3 -1,3 1,3"
	shoresGoldSpec = "4,-1"

	shoresExpLandSpec = "-2,-3 0,-3 1,-3 2,-3 3,-3 5,-3 -3,-2 -1,-2 0,-2 1,-2 2,-2 3,-2 5,-2 -2,-1 -1,-1 0,-1 1,-1 2,-1 3,-1 -3,0 -2,0 -1,0 0,0 1,0 2,0 3,0 -5,1 -3,1 -2,1 -1,1 0,1 1,1 2,1 4,1 -5,2 -3,2 -2,2 -1,2 0,2 1,2 3,2 -5,3 -3,3 -2,3 -1,3 0,3 2,3"
	shoresExpGoldSpec = "-4,-1 5,-1"

	shoresLargeLandSpec = "-6,1 -6,3 -6,4 -6,5 -5,-1 -4,-2 -4,0 -4,1 -4,2 -4,3 -4,4 -3,-3 -3,-1 -3,0 -3,1 -3,2 -3,3 -3,4 -2,-4 -2,-2 -2,-1 -2,0 -2,1 -2,2 -2,3 -2,4 -1,-3 -1,-2 -1,-1 -1,0 -1,1 -1,2 -1,3 -1,4 0,-4 0,-3 0,-2 0,-1 0,0 0,1 0,2 0,3 0,4 1,-4 1,-3 1,-2 1,-1 1,0 1,1 1,2 1,3 2,-4 2,-3 2,-2 2,-1 2,0 2,1 2,2 2,4 3,-4 3,-3 3,-2 3,-1 3,0 3,1 3,3 4,-4 4,-3 4,-2 4,-1 4,0 4,2 5,1 6,-5 6,-4 6,-2 6,-1"
	shoresLargeGoldSpec = "-6,2 -1,-5 1,5 6,-3"

	archiLandSpec = "0,-3 3,-3 5,-3 -1,-2 0,-2 2,-2 3,-2 5,-2 6,-2 -2,-1 -1,-1 1,-1 2,-1 5,-1 -2,1 1,1 2,1 4,1 5,1 -3,2 -2,2 0,2 1,2 3,2 4,2 -3,3 -2,3 0,3 2,3 3,3"
	archiGoldSpec = "1,-3 6,-3"

	usLandSpec = "-8,-5 -8,-4 -9,-3 -9,-2 -10,-1 -10,0 -10,1 -10,2 -9,2 -8,1 -7,0 -6,-1 -5,-2 -4,-3 -3,-4 -2,-5 -1,-5 -1,-4 -2,-3 -3,-2 -4,-1 -5,0 -6,1 -7,2 -8,3 -7,3 -6,3 -5,2 -4,1 -3,0 -2,-1 -1,-2 0,-3 1,-4 2,-5 3,-5 3,-4 2,-3 1,-2 0,-1 -1,0 -2,1 -3,2 -4,3 -5,4 -4,4 -4,5 -3,5 -2,4 -1,3 0,2 1,1 2,0 3,-1 4,-2 5,-3 6,-4 5,-4 5,-5 4,-3 5,-2 5,-1 4,0 3,1 2,2 1,3 0,4 1,4 2,4 3,3 4,2 5,1 6,0 7,-1 8,-2 9,-3 10,-3 8,-3 9,-2 7,-2 6,1 5,2 2,5 2,3 3,2 4,1 5,0 6,-1 6,-2 3,-2 4,-1 2,-1 3,0 1,0 2,1 0,1 1,2 -1,2 0,3 -2,3 -1,4 -3,4 -3,3 -2,2 -1,1 0,0 1,-1 2,-2 3,-3 4,-4 4,-5 1,-5 2,-4 1,-3 0,-2 -1,-1 -2,0 -3,1 -4,2 -5,3 -6,2 -5,1 -4,0 -3,-1 -2,-2 -1,-3 0,-4 0,-5 -3,-5 -4,-5 -5,-4 -6,-3 -7,-2 -8,-1 -7,-3 -6,-4 -6,-5 -5,-5 -2,-4 -4,-4 -3,-3 -5,-3 -4,-2 -6,-2 -5,-1 -7,-1 -6,0 -8,0 -7,1 -8,2 -9,1 -9,0 -9,-1 -8,-2 -8,-3 -7,-4 -7,-5"

	chinaLandSpec = "7,-7 6,-6 5,-5 4,-4 3,-3 2,-2 1,-1 0,0 -1,1 -2,2 -3,3 -4,4 -5,5 -6,6 -7,7 -7,6 -5,6 -5,7 -4,7 -3,6 -2,5 -1,4 0,3 1,2 2,1 2,0 3,-1 4,-2 5,-3 6,-4 7,-5 8,-6 8,-5 8,-4 7,-3 8,-3 9,-4 10,-5 9,-5 7,-4 6,-3 5,-2 1,1 2,2 0,2 1,3 1,4 0,5 -1,6 -1,3 0,4 -2,4 -1,5 -3,5 -2,6 -3,7 -4,6 -6,5 -6,4 -5,3 -4,2 -3,1 -2,0 -1,-1 0,-2 -1,-2 -2,-2 -3,-1 -4,0 -5,1 -6,2 -7,3 -8,3 -9,4 -10,4 -10,3 -9,2 -8,1 -7,0 -6,-1 -5,-2 -4,-3 -5,-3 -6,-3 -7,-2 -8,-1 -9,0 -10,1 -11,2 -11,1 -11,0 -10,-1 -9,-2 -8,-3 -7,-4 -6,-5 -5,-5 -9,-3 -10,-2 -11,-1 -10,0 -9,-1 -8,-2 -6,-4 -7,-3 -4,-2 -6,-2 -5,-1 -7,-1 -6,0 -8,0 -7,1 -9,1 -10,2 -11,3 -11,4 -8,2 -9,3 -7,2 -6,1 -5,0 -4,-1 -3,-2 -2,-1 -3,0 -4,1 -5,2 -6,3 -7,4 -4,5 -5,4 -3,4 -4,3 -2,3 -3,2 -1,2 -2,1 0,1 -1,0 1,0 0,-1 2,-1 1,-2 3,-2 2,-3 4,-3 3,-4 5,-4 6,-5 7,-6 8,-7"

	japanLandSpec = "9,-12 9,-11 8,-10 7,-9 6,-8 7,-8 7,-7 8,-7 9,-8 10,-9 11,-10 12,-10 12,-9 10,-10 11,-9 9,-9 10,-8 8,-8 8,-9 9,-10 10,-11 10,-12 3,-4 3,-3 2,-2 1,-1 1,0 0,1 -1,2 -2,3 -3,4 -4,5 -5,6 -6,7 -7,7 -8,8 -9,9 -10,9 -11,9 -11,8 -10,7 -9,6 -8,6 -7,5 -6,5 -5,4 -10,6 -11,6 -9,7 -11,7 -9,8 -7,6 -8,7 -5,7 -4,7 -3,6 -2,5 -1,4 0,3 -1,5 -2,6 -3,7 -6,6 -4,6 -5,5 -3,5 -4,4 -2,4 -3,3 -1,3 -2,2 0,2 1,1 2,0 3,-1 4,-2 2,-1 3,-2 4,-3 4,-4 4,-5 5,-5 4,-6 5,-6 -6,10 -7,10 -6,11 -11,11 -12,11 -11,12 -12,12 -13,12"

	ukLandSpec = "5,-9 4,-8 3,-7 2,-6 2,-5 2,-4 1,-3 2,-3 2,-2 1,-1 2,-1 2,0 2,1 2,2 1,3 0,4 -1,5 -2,6 -2,7 -3,8 -2,8 -1,8 0,7 1,6 2,5 3,4 4,3 4,2 5,1 5,0 4,0 4,-1 4,-2 5,-3 4,-3 4,-4 5,-5 6,-6 7,-7 6,-7 5,-7 4,-6 5,-6 4,-5 4,1 5,3 5,4 4,5 3,6 2,7 3,7 3,3 4,4 2,4 3,5 1,5 2,6 0,6 1,7 0,8 -1,7 -1,6 -2,5 0,5 1,4 0,3 2,3 3,2 3,1 3,0 3,-1 3,-2 3,-3 3,-4 3,-5 3,-6 2,-7 2,-8 1,-7 4,-7 5,-8 6,-9 -1,-2 -2,-1 -3,0 -4,1 -5,2 -6,3 -6,4 -7,5 -8,6 -7,6 -6,5 -5,4 -4,3 -3,2 -2,1 -1,0 -3,3 -4,4 -5,3 -6,2 -4,2 -5,1 -3,1 -2,0 -3,-1 -1,-1"
)

func galleryMaps() []galleryMap {
	return []galleryMap{
		{"shores", 4, "base+islands", 4, shoresLandSpec, shoresGoldSpec},
		{"shores-expanded", 5, "base+islands", 6, shoresExpLandSpec, shoresExpGoldSpec},
		{"shores-large", 6, "base+islands", 8, shoresLargeLandSpec, shoresLargeGoldSpec},
		{"archipelago", 6, "base+islands", 6, archiLandSpec, archiGoldSpec},
		{"united-states", 13, "base", 4, usLandSpec, ""},
		{"china", 12, "base", 4, chinaLandSpec, ""},
		{"japan", 14, "base+islands", 4, japanLandSpec, ""},
		{"uk-ireland", 11, "base+islands", 4, ukLandSpec, ""},
	}
}

// landOnlyBoard builds the board the lobby sends: land and gold, no sea. It is
// left unframed because the engine frames it at game start.
func landOnlyBoard(t *testing.T, radius int, landSpec, goldSpec string) *board.Board {
	t.Helper()
	parse := func(spec string) []board.Hex {
		var out []board.Hex
		for p := range strings.FieldsSeq(spec) {
			qr := strings.Split(p, ",")
			if len(qr) != 2 {
				t.Fatalf("bad hex %q", p)
			}
			q, err1 := strconv.Atoi(qr[0])
			r, err2 := strconv.Atoi(qr[1])
			if err1 != nil || err2 != nil {
				t.Fatalf("bad hex %q", p)
			}
			out = append(out, board.Hex{Q: q, R: r})
		}
		return out
	}
	land := parse(landSpec)
	b := &board.Board{Radius: radius, Robber: land[0], Tiles: map[board.Hex]board.Tile{}}
	for _, h := range land {
		b.Tiles[h] = board.Tile{Res: board.ResLand}
	}
	for _, h := range parse(goldSpec) {
		b.Tiles[h] = board.Tile{Res: board.Gold}
	}
	return b
}

// TestJSFramesGalleryMaps runs non-hexagonal gallery silhouettes through the
// audit on several seeds. Each must report the board check as passed; an
// "unauditable" verdict (board never derived) counts as a failure too.
func TestJSFramesGalleryMaps(t *testing.T) {
	seeds := []uint64{1, 7, 20260830}
	for _, gm := range galleryMaps() {
		for _, seed := range seeds {
			t.Run(fmt.Sprintf("%s-%d", gm.id, seed), func(t *testing.T) {
				cfg := engine.GameConfig{
					Players: gm.players, Ruleset: gm.ruleset, DiceMode: "fair",
					BoardMode: board.BoardFair, TurnOrder: engine.TurnOrderRandom,
					Board: landOnlyBoard(t, gm.radius, gm.land, gm.gold),
				}
				gs := engine.SeedsFrom(seed)
				events, err := engine.New(cfg, gs)
				if err != nil {
					t.Fatalf("engine.New(%q): %v", gm.id, err)
				}
				blob, err := json.Marshal(map[string]any{
					"game":   gm.id,
					"events": events,
					"audit":  map[string]any{"public_seed_commit": engine.SeedCommitment(gs.Public)},
				})
				if err != nil {
					t.Fatal(err)
				}
				out, code := node(t, "verify/cli.mjs", writeTemp(t, blob))
				if !strings.Contains(out, "[PASS] board built from the seed") {
					t.Errorf("gallery map %q not re-derived (exit %d, seed %d):\n%s", gm.id, code, seed, out)
				}
			})
		}
	}
}

// frameRow is one board handed to verify/framecheck.mjs: the unframed input and
// what Go's Frame made of it.
type frameRow struct {
	Name   string       `json:"name"`
	Board  *board.Board `json:"board"`
	Framed *board.Board `json:"framed"`
}

// frameCase records a board and Go's Frame of a clone of it.
func frameCase(name string, b *board.Board) frameRow {
	framed := b.Clone()
	framed.Frame()
	return frameRow{Name: name, Board: b, Framed: framed}
}

func hexList(t *testing.T, spec string) []board.Hex {
	t.Helper()
	var out []board.Hex
	for p := range strings.FieldsSeq(spec) {
		qr := strings.Split(p, ",")
		if len(qr) != 2 {
			t.Fatalf("bad hex %q", p)
		}
		q, err1 := strconv.Atoi(qr[0])
		r, err2 := strconv.Atoi(qr[1])
		if err1 != nil || err2 != nil {
			t.Fatalf("bad hex %q", p)
		}
		out = append(out, board.Hex{Q: q, R: r})
	}
	return out
}

// landOnly builds a board of ResLand at the given hexes, robber on the first.
func landOnly(radius int, land []board.Hex) *board.Board {
	b := &board.Board{Radius: radius, Tiles: map[board.Hex]board.Tile{}}
	if len(land) > 0 {
		b.Robber = land[0]
	}
	for _, h := range land {
		b.Tiles[h] = board.Tile{Res: board.ResLand}
	}
	return b
}

// TestJSFrameMatchesGo compares the ported Board.Frame with Go's tile for tile.
// It covers the degenerate shapes from the Go frame tests (they drive
// hullInside's no-area branch and the connectivity backstop, which no gallery
// map reaches) plus 1000 random small land sets from the xorshift that
// engine/board.TestFrameAlwaysConnected uses.
func TestJSFrameMatchesGo(t *testing.T) {
	var rows []frameRow

	// Degenerate shapes from engine/board/hull_connectivity_test.go.
	for _, tc := range []struct {
		name string
		land string
	}{
		{"single-hex", "0,0"},
		{"two-distant-hexes", "6,1 -5,2"},
		{"three-collinear", "-9,-3 -5,1 1,7"},
		// Collinear in the doubled X column (X = 2q+r = 0): the only case
		// where the hull sort's secondary key (R) is consulted (reversing it
		// still frames identically).
		{"vertical-collinear", "0,0 -1,2 -2,4"},
		{"thin-triangle", "-10,0 -9,1 0,8"},
		{"sliver-triangle", "-3,2 4,-4 -4,3"},
		{"adjacent-pair", "0,0 1,0"},
		{"horizontal-strip", "-3,0 -2,0 -1,0 0,0 1,0 2,0 3,0"},
		{"two-landmasses", "-4,0 -3,0 -4,1 3,0 4,0 3,1"},
		{"c-shape", "-2,0 -1,-1 0,-2 1,-2 2,-2 -2,1 -2,2 -1,2 0,2 1,2 2,2"},
		{"far-outlier", "0,0 1,0 0,1 1,-1 9,-4"},
		// Shapes whose hull fill fragments, so connectComponents bridges and
		// its lexicographic tie-break is exercised. Such shapes are rare in
		// random sets.
		{"bridged-sliver-a", "0,11 -6,-4 -6,-5"},
		{"bridged-sliver-b", "11,-10 -11,0 9,-9"},
		{"bridged-sliver-c", "-5,4 -8,12 2,-12"},
		{"bridged-sliver-d", "-7,5 -12,7 11,-3"},
	} {
		rows = append(rows, frameCase(tc.name, landOnly(16, hexList(t, tc.land))))
	}

	// Full hexagons must come back untouched (standard maps, full-land shape).
	for _, radius := range []int{2, 3, 4} {
		rows = append(rows, frameCase(fmt.Sprintf("full-hexagon-r%d", radius), fullLandShape(radius)))
	}

	// The gallery silhouettes, unframed as the lobby sends them.
	for _, gm := range galleryMaps() {
		rows = append(rows, frameCase("gallery-"+gm.id, landOnlyBoard(t, gm.radius, gm.land, gm.gold)))
	}

	// Every terrain isGround accepts plus Sea and Fog, which it does not.
	mixed := &board.Board{Radius: 8, Tiles: map[board.Hex]board.Tile{}, Robber: board.Hex{Q: 0, R: 0}}
	for i, res := range []board.Resource{
		board.ResLand, board.Wood, board.Brick, board.Sheep, board.Wheat, board.Ore,
		board.Gold, board.Lake, board.ResNone, board.Border, board.Sea, board.Fog,
	} {
		mixed.Tiles[board.Hex{Q: i - 5, R: 1}] = board.Tile{Res: res, Number: 3 + i%9}
	}
	rows = append(rows, frameCase("every-terrain", mixed))

	// Idempotency: an already-framed board comes back unchanged, and its sea is
	// not read as silhouette.
	preframed := landOnly(16, hexList(t, "-2,0 -1,-1 0,-2 1,-2 2,-2 -2,1 -2,2 -1,2 0,2 1,2 2,2"))
	preframed.Frame()
	rows = append(rows, frameCase("already-framed", preframed))

	// A robber that fell off the board, and one sitting on sea: Frame relocates
	// both to the lexicographically first non-sea hex.
	off := landOnly(16, hexList(t, "0,0 1,0 0,1 -1,1"))
	off.Robber = board.Hex{Q: 15, R: -15}
	rows = append(rows, frameCase("robber-off-board", off))
	onSea := landOnly(16, hexList(t, "0,0 1,0 0,1 -1,1"))
	onSea.Tiles[board.Hex{Q: 4, R: 0}] = board.Tile{Res: board.Sea}
	onSea.Robber = board.Hex{Q: 4, R: 0}
	rows = append(rows, frameCase("robber-on-sea", onSea))

	// Fuzz, with the generator from engine/board.TestFrameAlwaysConnected.
	seed := uint64(0x9e3779b97f4a7c15)
	next := func() uint64 { seed ^= seed << 13; seed ^= seed >> 7; seed ^= seed << 17; return seed }
	for trial := range 1000 {
		count := 1 + int(next()%20)
		tiles := map[board.Hex]board.Tile{}
		var first board.Hex
		for range count {
			h := board.Hex{Q: int(next()%21) - 10, R: int(next()%21) - 10}
			if max(abs(h.Q), abs(h.R), abs(h.Q+h.R)) > 12 {
				continue
			}
			if len(tiles) == 0 {
				first = h
			}
			tiles[h] = board.Tile{Res: board.ResLand}
		}
		if len(tiles) == 0 {
			continue
		}
		rows = append(rows, frameCase(fmt.Sprintf("fuzz-%d", trial),
			&board.Board{Radius: 16, Tiles: tiles, Robber: first}))
	}

	blob, err := json.Marshal(rows)
	if err != nil {
		t.Fatal(err)
	}
	out, code := node(t, "verify/framecheck.mjs", writeTemp(t, blob))
	if code != 0 {
		t.Fatalf("framecheck.mjs disagrees with Board.Frame (exit %d):\n%s", code, out)
	}
	t.Log(strings.TrimSpace(out))
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

// TestJSVerifiesGalleryGames plays bot games on gallery silhouettes and
// requires a "verified" audit with rolls actually compared. Three maps are
// enough since framing itself is covered tile for tile above.
func TestJSVerifiesGalleryGames(t *testing.T) {
	for _, gm := range galleryMaps() {
		switch gm.id {
		case "shores", "archipelago", "united-states":
		default:
			continue
		}
		t.Run(gm.id, func(t *testing.T) {
			st, err := store.OpenMem()
			if err != nil {
				t.Fatal(err)
			}
			defer st.Close()
			const seed = 41
			res, err := sim.RunGame(st, sim.Options{
				Players: gm.players, Ruleset: gm.ruleset,
				DiceMode: "fair", BoardMode: board.BoardFair, Seed: seed,
				// Unframed, as the lobby sends it.
				Board: landOnlyBoard(t, gm.radius, gm.land, gm.gold),
			})
			if err != nil {
				t.Fatalf("running the game: %v", err)
			}
			seeds := engine.SeedsFrom(seed)
			out, code := node(t, "verify/cli.mjs", writeTemp(t, replayJSON(t, st, res.GameID, seeds.Public)))
			if code != 0 {
				t.Fatalf("verifier rejected engine game on %q (exit %d):\n%s", gm.id, code, out)
			}
			for _, w := range []string{"VERIFIED", "[PASS] board built from the seed", "[PASS] every roll follows from the seed"} {
				if !strings.Contains(out, w) {
					t.Errorf("missing %q in:\n%s", w, out)
				}
			}
			if vacuousRolls.MatchString(out) {
				t.Errorf("no rolls compared:\n%s", out)
			}
		})
	}
}
