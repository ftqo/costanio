package islands

import (
	"encoding/json"
	"errors"
	"os"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// landBoard builds a board from a land hex list, the way a curated map arrives:
// generic land, framed. Radius is generous because only the land set matters to
// MainIsland.
func landBoard(hexes []board.Hex) *board.Board {
	b := &board.Board{Radius: 20, Tiles: map[board.Hex]board.Tile{}}
	for _, h := range hexes {
		b.Tiles[h] = board.Tile{Res: board.ResLand}
	}
	return b
}

// strip is a horizontal run of n land hexes starting at (q, r).
func strip(q, r, n int) []board.Hex {
	out := make([]board.Hex, 0, n)
	for i := range n {
		out = append(out, board.Hex{Q: q + i, R: r})
	}
	return out
}

// islandsOf lays out landmasses of the given sizes, each a strip on its own row
// with sea rows between, so they never touch.
func islandsOf(sizes ...int) []board.Hex {
	var out []board.Hex
	for i, n := range sizes {
		out = append(out, strip(0, 3*i, n)...)
	}
	return out
}

// TestMainIslandThresholds pins the definition at its edges: the largest
// landmass is the main island only when it is at least twice the next AND more
// than half of all land.
func TestMainIslandThresholds(t *testing.T) {
	cases := []struct {
		name  string
		sizes []int
		main  int // size of the main island; 0 = none
	}{
		{"one landmass", []int{12}, 12},
		{"exactly twice, and two thirds", []int{10, 5}, 10},
		{"just under twice", []int{9, 5}, 0},
		{"two equal", []int{6, 6}, 0},
		{"twice the next but not half the land", []int{10, 5, 5, 5, 5, 5}, 0},
		{"exactly half the land is not more than half", []int{10, 5, 5}, 0},
		{"just over half", []int{11, 5, 5}, 11},
		{"archipelago shape", []int{6, 6, 5, 5, 5, 5}, 0},
		{"no land", nil, 0},
	}
	for _, tc := range cases {
		got := MainIsland(landBoard(islandsOf(tc.sizes...)))
		if len(got) != tc.main {
			t.Errorf("%s %v: main island of %d hexes, want %d", tc.name, tc.sizes, len(got), tc.main)
		}
	}
}

// galleryBoards reads the curated maps' land out of the frontend gallery, so
// the classification is measured on the maps players actually pick.
func galleryBoards(t *testing.T) map[string]*board.Board {
	t.Helper()
	src, err := os.ReadFile("../../frontend/src/lib/maps/gallery.ts")
	if err != nil {
		t.Fatalf("read gallery: %v", err)
	}
	consts := map[string]string{}
	for _, m := range regexp.MustCompile(`const ([A-Z_]+) =\s*"([^"]*)"`).FindAllStringSubmatch(string(src), -1) {
		consts[m[1]] = m[2]
	}
	parse := func(spec string) []board.Hex {
		var out []board.Hex
		for p := range strings.FieldsSeq(spec) {
			q, r, _ := strings.Cut(p, ",")
			qi, e1 := strconv.Atoi(q)
			ri, e2 := strconv.Atoi(r)
			if e1 != nil || e2 != nil {
				t.Fatalf("bad hex %q", p)
			}
			out = append(out, board.Hex{Q: qi, R: ri})
		}
		return out
	}
	boards := map[string]*board.Board{}
	// id: land constant, gold constant (optional).
	for id, names := range map[string][2]string{
		"shores":          {"SHORES_LAND", "SHORES_GOLD"},
		"shores-expanded": {"SHORES_EXP_LAND", "SHORES_EXP_GOLD"},
		"shores-large":    {"SHORES_LARGE_LAND", "SHORES_LARGE_GOLD"},
		"archipelago":     {"ARCHIPELAGO_LAND", "ARCHIPELAGO_GOLD"},
		"japan":           {"JAPAN_LAND", ""},
		"uk-ireland":      {"UK_LAND", ""},
		"united-states":   {"US_LAND", ""},
		"china":           {"CHINA_LAND", ""},
	} {
		land, ok := consts[names[0]]
		if !ok {
			t.Fatalf("gallery.ts has no %s", names[0])
		}
		hexes := parse(land)
		if names[1] != "" {
			hexes = append(hexes, parse(consts[names[1]])...)
		}
		b := landBoard(hexes)
		b.Frame()
		boards[id] = b
	}
	return boards
}

// mainIslandVectors is the file the frontend's classifier is checked against
// (frontend/src/lib/maps/mainIsland.test.ts): the Go answer for every curated
// map and threshold case, so the two implementations cannot drift.
const mainIslandVectors = "../../frontend/src/lib/maps/mainIsland.vectors.json"

type mainIslandVector struct {
	ID    string      `json:"id,omitempty"`   // a gallery map id, or
	Land  []board.Hex `json:"land,omitempty"` // an explicit land list
	Main  int         `json:"main"`           // main-island size; 0 = none
	Total int         `json:"total"`
}

// TestMainIslandOnTheGallery is the classification table in
// docs/rules/islands.md, asserted. Every map with an obvious home island has
// one, and the Archipelago has none.
func TestMainIslandOnTheGallery(t *testing.T) {
	want := map[string]int{
		"shores":          19, // of 28: 68%, 3.8x the next
		"shores-expanded": 37, // of 49: 76%, 12.3x
		"shores-large":    61, // of 81: 75%, 12.2x
		"archipelago":     0,  // 6,6,5,5,5,5: 19%, 1.0x
		"japan":           62, // of 92: 67%, 2.8x
		"uk-ireland":      82, // of 108: 76%, 3.2x
		"united-states":   157,
		"china":           151,
	}
	boards := galleryBoards(t)
	var vectors []mainIslandVector
	ids := make([]string, 0, len(want))
	for id := range want {
		ids = append(ids, id)
	}
	slices.Sort(ids)
	for _, id := range ids {
		b := boards[id]
		got := len(MainIsland(b))
		if got != want[id] {
			t.Errorf("%s: main island of %d hexes, want %d", id, got, want[id])
		}
		vectors = append(vectors, mainIslandVector{ID: id, Main: got, Total: len(b.Islands())})
	}
	for _, sizes := range [][]int{{12}, {10, 5}, {9, 5}, {6, 6}, {10, 5, 5, 5, 5, 5}, {10, 5, 5}, {11, 5, 5}} {
		b := landBoard(islandsOf(sizes...))
		vectors = append(vectors, mainIslandVector{Land: islandsOf(sizes...), Main: len(MainIsland(b)), Total: len(b.Islands())})
	}
	raw, err := json.MarshalIndent(vectors, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	raw = append(raw, '\n')
	if os.Getenv("UPDATE_VECTORS") != "" {
		if err := os.WriteFile(mainIslandVectors, raw, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	have, err := os.ReadFile(mainIslandVectors)
	if err != nil || string(have) != string(raw) {
		t.Errorf("%s is stale; regenerate with UPDATE_VECTORS=1 go test ./engine/islands -run TestMainIslandOnTheGallery", mainIslandVectors)
	}
}

// TestEveryProceduralBoardHasAMainIsland: the carve cuts one mainland and one to
// three outer arcs, so a procedural Islands board always has a main island,
// and it is the mainland, never an arc.
func TestEveryProceduralBoardHasAMainIsland(t *testing.T) {
	for players := 2; players <= 10; players++ {
		for seed := uint64(1); seed <= 40; seed++ {
			b := proceduralBoard(t, players, seed, "fair")
			main := MainIsland(b)
			if main == nil {
				t.Fatalf("%dp seed %d: no main island (sizes %v)", players, seed, islandSizes(b))
			}
			if !slices.Contains(main, board.Hex{}) {
				t.Fatalf("%dp seed %d: main island does not contain the centre", players, seed)
			}
		}
	}
}

// setupGame starts a game and returns it at the first setup placement.
func setupGame(t *testing.T, cfg engine.GameConfig, seed uint64) (*engine.State, []engine.Event) {
	t.Helper()
	log, err := engine.New(cfg, engine.SeedsFrom(seed))
	if err != nil {
		t.Fatal(err)
	}
	s, err := engine.Replay(log)
	if err != nil {
		t.Fatal(err)
	}
	if s.Phase != engine.PhaseSetup {
		t.Fatalf("phase %v, want setup", s.Phase)
	}
	return s, log
}

func withStart(cfg engine.GameConfig, start string) engine.GameConfig {
	cfg.Modules = map[string]json.RawMessage{Name: json.RawMessage(`{"start_island":"` + start + `"}`)}
	return cfg
}

// landVertices lists every buildable vertex and the landmass it is on.
func landVertices(s *engine.State) map[board.Vertex]int {
	ids := s.Board.Islands()
	out := map[board.Vertex]int{}
	for h, id := range ids {
		for _, v := range h.Vertices() {
			if s.Board.LandVertex(v) {
				out[v] = id
			}
		}
	}
	return out
}

func mainID(s *engine.State) int {
	main := MainIsland(s.Board)
	if main == nil {
		return -1
	}
	return s.Board.Islands()[main[0]]
}

// TestSetupSettlementsGoOnTheMainIsland: with a main island on the board, a
// starting settlement off it is refused by both the command and the legal
// targets, and one on it is accepted.
func TestSetupSettlementsGoOnTheMainIsland(t *testing.T) {
	for _, rs := range []string{"base+islands", "base+cak+islands"} {
		for players := 2; players <= 8; players += 3 {
			s, _ := setupGame(t, engine.GameConfig{Players: players, Ruleset: rs}, 3)
			main := mainID(s)
			if main < 0 {
				t.Fatalf("%s %dp: no main island", rs, players)
			}
			offered := map[board.Vertex]bool{}
			for _, v := range s.LegalSettlements(s.Cur) {
				offered[v] = true
			}
			var onMain, offMain int
			for v, id := range landVertices(s) {
				err := engine.CheckSettlementSpot(s, v)
				if id != main {
					offMain++
					if !errors.Is(err, engine.ErrBadPlacement) {
						t.Fatalf("%s %dp: outer-island vertex %v: err %v, want ErrBadPlacement", rs, players, v, err)
					}
					if offered[v] {
						t.Fatalf("%s %dp: outer-island vertex %v is offered in setup", rs, players, v)
					}
					_, err := engine.Decide(s, engine.Command{Player: s.Cur, Type: engine.CmdPlaceSettlement,
						Data: mustJSON(t, engine.SettlementPlacedData{V: v})})
					if !errors.Is(err, engine.ErrBadPlacement) {
						t.Fatalf("%s %dp: placing on outer island %v: err %v", rs, players, v, err)
					}
					continue
				}
				if err == nil {
					onMain++
					if !offered[v] {
						t.Fatalf("%s %dp: main-island vertex %v accepted but not offered", rs, players, v)
					}
				}
			}
			if onMain == 0 || offMain == 0 {
				t.Fatalf("%s %dp: %d main and %d outer vertices, want both nonzero", rs, players, onMain, offMain)
			}
		}
	}
}

// TestStartAnyAllowsOuterIslands is the host's opt-out: "any island" restores
// the old rule, and an outer-island vertex is a legal start again.
func TestStartAnyAllowsOuterIslands(t *testing.T) {
	s, _ := setupGame(t, withStart(engine.GameConfig{Players: 4, Ruleset: "base+islands"}, StartAny), 3)
	main := mainID(s)
	for v, id := range landVertices(s) {
		if id != main && engine.CheckSettlementSpot(s, v) == nil {
			return
		}
	}
	t.Fatal("start_island=any still refuses every outer-island vertex")
}

// TestArchipelagoStartsAnywhere: a board with no main island allows any
// island under the default auto setting.
func TestArchipelagoStartsAnywhere(t *testing.T) {
	b := galleryBoards(t)["archipelago"]
	s, _ := setupGame(t, engine.GameConfig{Players: 5, Ruleset: "base+islands", Board: b}, 3)
	if MainIsland(s.Board) != nil {
		t.Fatal("the dealt archipelago has a main island")
	}
	reached := map[int]bool{}
	for v, id := range landVertices(s) {
		if engine.CheckSettlementSpot(s, v) == nil {
			reached[id] = true
		}
	}
	if len(reached) < 6 {
		t.Fatalf("setup may start on %d of the archipelago's 6 islands, want all", len(reached))
	}
}

// TestWholeSetupLandsOnTheMainIsland plays the whole placement snake with the
// engine's auto-pass, under Knights too (whose round-2 placement is a city),
// and checks every starting building is on the main island. It also plays one
// real outer settlement per seat afterwards: the first one on an outer island
// earns the chip, and one more on the main island earns nothing.
func TestWholeSetupLandsOnTheMainIsland(t *testing.T) {
	for _, rs := range []string{"base+islands", "base+cak+islands"} {
		for seed := uint64(1); seed <= 6; seed++ {
			s, _ := setupGame(t, engine.GameConfig{Players: 4, Ruleset: rs}, seed)
			for i := 0; s.Phase == engine.PhaseSetup; i++ {
				if i > 400 {
					t.Fatal("setup stuck")
				}
				cmd, ok := engine.AutoCommand(s)
				if !ok {
					t.Fatal("no auto command in setup")
				}
				step(t, s, cmd)
			}
			ids := s.Board.Islands()
			main := mainID(s)
			cities := 0
			for v, bld := range s.Buildings {
				if bld.City {
					cities++
				}
				if got := vertexIslands(v, ids); len(got) != 1 || got[0] != main {
					t.Fatalf("%s seed %d: seat %d started at %v on landmass %v, want main %d", rs, seed, bld.Owner, v, got, main)
				}
			}
			if rs == "base+cak+islands" && cities == 0 {
				t.Fatalf("%s seed %d: no setup city", rs, seed)
			}

			// The island bonus, measured from a main-island start.
			v, island, ok := offshoreVertex(s, ids, main, 0)
			if !ok {
				t.Fatalf("%s seed %d: no free outer vertex", rs, seed)
			}
			s.Buildings[v] = engine.Building{Owner: 0}
			out := (Module{}).onEvents(s, []engine.Event{engine.NewEvent(engine.EvSettlementBuilt, engine.BuiltData{Player: 0, V: &v})})
			delete(s.Buildings, v)
			if !hasEvent(out, EvIslandChip) {
				t.Fatalf("%s seed %d: first settlement on outer island %d earned no chip", rs, seed, island)
			}
			var home board.Vertex
			found := false
			for w, id := range landVertices(s) {
				if id == main && engine.CheckSettlementSpot(s, w) == nil {
					home, found = w, true
					break
				}
			}
			if !found {
				t.Fatalf("%s seed %d: no free main-island vertex", rs, seed)
			}
			s.Buildings[home] = engine.Building{Owner: 0}
			out = (Module{}).onEvents(s, []engine.Event{engine.NewEvent(engine.EvSettlementBuilt, engine.BuiltData{Player: 0, V: &home})})
			delete(s.Buildings, home)
			if hasEvent(out, EvIslandChip) {
				t.Fatalf("%s seed %d: a settlement on the main island earned a chip", rs, seed)
			}
		}
	}
}

// TestStartRuleIsSetupOnly: in play, a settlement on an outer island is a
// normal build (that is what ships are for); the start rule must not reach it.
func TestStartRuleIsSetupOnly(t *testing.T) {
	s, _ := newGame(t, 3)
	main := mainID(s)
	for v, id := range landVertices(s) {
		if id != main && engine.CheckSettlementSpot(s, v) == nil {
			return
		}
	}
	t.Fatal("in play, every outer-island vertex is refused by the spot check")
}
