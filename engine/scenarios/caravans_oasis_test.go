package scenarios

import (
	"encoding/json"
	"maps"
	"math/rand/v2"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// testRNG is a board-hook rng for the FinishBoard tests. The hooks draw from it
// to choose which interior hex a repair lands on, so it is not always the same
// tile. Any seed will do; the distribution claims live in sim.
func testRNG() *rand.Rand { return rand.New(rand.NewPCG(11, 22)) }

// TestFinishBoardRestoresDrownedOasis: a board whose only desert was carved into
// sea (as Islands does to the outer ring) must come back from FinishBoard with
// an oasis.
func TestFinishBoardRestoresDrownedOasis(t *testing.T) {
	s, _ := newGame(t, "base+caravans", 4)
	b := s.Board
	// Drown every desert and lake, the way the Islands carve can.
	for h, tile := range b.Tiles {
		if tile.Res == board.ResNone || tile.Res == board.Lake {
			b.Tiles[h] = board.Tile{Res: board.Sea}
		}
	}
	for h, tile := range b.Tiles {
		if tile.Res == board.ResNone || tile.Res == board.Lake {
			t.Fatalf("setup: %v survived the drowning as %v", h, tile.Res)
		}
	}

	(Caravans{}).FinishBoard(b, engine.GameConfig{}, testRNG())

	e := freshCaravans(&engine.State{Board: b, Config: s.Config})
	if !e.HasOasis {
		t.Fatal("FinishBoard left the board with no oasis")
	}
	if got := b.Tiles[e.Oasis].Res; got != board.ResNone {
		t.Fatalf("oasis tile is %v, want a desert", got)
	}
	// Interior, never the outer ring, so the repair holds whether Islands
	// runs before or after this module.
	if r := hexRing(e.Oasis); r >= b.Radius {
		t.Fatalf("oasis %v sits on ring %d of radius %d: Islands could drown it again", e.Oasis, r, b.Radius)
	}
	// Idempotent: a second pass must not add a second desert.
	deserts := func() int {
		n := 0
		for _, tile := range b.Tiles {
			if tile.Res == board.ResNone {
				n++
			}
		}
		return n
	}
	before := deserts()
	(Caravans{}).FinishBoard(b, engine.GameConfig{}, testRNG())
	if after := deserts(); after != before {
		t.Fatalf("second FinishBoard changed the desert count %d -> %d", before, after)
	}
}

// Authored maps ship their own terrain and are never reshaped, matching every
// other module's SetupBoard.
func TestFinishBoardLeavesAuthoredMapsAlone(t *testing.T) {
	s, _ := newGame(t, "base+caravans", 4)
	b := s.Board
	for h, tile := range b.Tiles {
		if tile.Res == board.ResNone || tile.Res == board.Lake {
			b.Tiles[h] = board.Tile{Res: board.Sea}
		}
	}
	(Caravans{}).FinishBoard(b, engine.GameConfig{Preset: "someMap"}, testRNG())
	for _, tile := range b.Tiles {
		if tile.Res == board.ResNone {
			t.Fatal("FinishBoard carved a desert into an authored map")
		}
	}
	// The scenario is still not silently absent there: freshCaravans falls back
	// to a land hex.
	if e := freshCaravans(&engine.State{Board: b, Config: s.Config}); !e.HasOasis {
		t.Fatal("no oasis on an authored map with no desert")
	}
}

// TestViewOasisIsNullable: a Caravans module with no oasis (HasOasis false) must
// not publish {q:0,r:0}, which is identical to a real oasis at the centre and
// would make a client infer from the terrain. Like islands.ExtView.Pirate, the
// key is present only when there is an oasis. Asserted on the encoded JSON, since
// that is what clients read.
func TestViewOasisIsNullable(t *testing.T) {
	s, _ := newGame(t, "base+caravans", 3)
	x := caravansExt(s)
	if !x.HasOasis {
		t.Fatal("setup: a procedural base+caravans board must have an oasis")
	}

	live, err := json.Marshal(x.ViewExt(0))
	if err != nil {
		t.Fatal(err)
	}
	var got map[string]json.RawMessage
	if err := json.Unmarshal(live, &got); err != nil {
		t.Fatal(err)
	}
	raw, present := got["oasis"]
	if !present {
		t.Fatal("a live oasis is absent from the view")
	}
	var h board.Hex
	if err := json.Unmarshal(raw, &h); err != nil {
		t.Fatalf("oasis is not a hex: %s", raw)
	}
	if h != x.Oasis {
		t.Fatalf("oasis on the wire = %v, want %v", h, x.Oasis)
	}

	// An inert module, pinned at the origin, which must not look like a real
	// centre oasis.
	x.HasOasis = false
	x.Oasis = board.Hex{}
	inert, err := json.Marshal(x.ViewExt(0))
	if err != nil {
		t.Fatal(err)
	}
	var got2 map[string]json.RawMessage
	if err := json.Unmarshal(inert, &got2); err != nil {
		t.Fatal(err)
	}
	if raw, present := got2["oasis"]; present {
		t.Fatalf("inert Caravans module names an oasis: %s", raw)
	}
}

// TestFinishBoardsComposeToOneTile: the two modules' FinishBoard hooks compose
// in both orders, since BoardFinisher requires order independence and they run
// in ruleset-string order.
//
// Both repair by deleting a producing tile and its token, so independently they
// would cost two tiles and leave a dry desert under Fishermen. Instead Caravans
// makes a desert that Fishermen floods (oasis and lake are one hex), or
// Fishermen makes the lake and Caravans sees a surviving neutral hex.
//
// Reached by hand: no procedural board reaches either promotion now, and the
// hooks are a backstop for authored maps or a future module that carves the same
// way.
func TestFinishBoardsComposeToOneTile(t *testing.T) {
	drowned := func(t *testing.T) *board.Board {
		t.Helper()
		s, _ := newGame(t, "base+caravans+fishermen", 4)
		b := s.Board
		for h, tile := range b.Tiles {
			if tile.Res == board.ResNone || tile.Res == board.Lake {
				b.Tiles[h] = board.Tile{Res: board.Sea}
			}
		}
		return b
	}
	producing := func(b *board.Board) int {
		n := 0
		for _, t := range b.Tiles {
			if t.Res.Producing() {
				n++
			}
		}
		return n
	}
	orders := []struct {
		name string
		run  func(b *board.Board)
	}{
		{"caravans then fishermen", func(b *board.Board) {
			(Caravans{}).FinishBoard(b, engine.GameConfig{}, testRNG())
			(Fishermen{}).FinishBoard(b, engine.GameConfig{}, testRNG())
		}},
		{"fishermen then caravans", func(b *board.Board) {
			(Fishermen{}).FinishBoard(b, engine.GameConfig{}, testRNG())
			(Caravans{}).FinishBoard(b, engine.GameConfig{}, testRNG())
		}},
	}
	for _, o := range orders {
		t.Run(o.name, func(t *testing.T) {
			b := drowned(t)
			before := producing(b)
			o.run(b)
			if lost := before - producing(b); lost != 1 {
				t.Fatalf("the two hooks spent %d producing tiles, want exactly 1", lost)
			}
			lakes, deserts := 0, 0
			for _, tile := range b.Tiles {
				switch tile.Res {
				case board.Lake:
					lakes++
				case board.ResNone:
					deserts++
				default: // the producing terrain the generator dealt
				}
			}
			if lakes != 1 || deserts != 0 {
				t.Fatalf("finished with %d lakes and %d deserts, want 1 lake and 0 deserts", lakes, deserts)
			}
			// The one hex is both features: the oasis freshCaravans finds is the
			// lake Fishermen left.
			oasis, ok := pickOasis(b)
			if !ok || b.Tiles[oasis].Res != board.Lake {
				t.Fatalf("oasis %v is %v, want the lake", oasis, b.Tiles[oasis].Res)
			}
			if spokeCount(b, oasis) != caravansPerOasis {
				t.Fatalf("the repaired oasis starts only %d of %d caravans", spokeCount(b, oasis), caravansPerOasis)
			}
			// Idempotent, in either order, run again.
			after := producing(b)
			o.run(b)
			if producing(b) != after {
				t.Fatalf("second pass spent another tile, want idempotent")
			}
		})
	}
}

// lobbyBoard is the board a real Caravans game is played on: a generic-land
// hexagon with no resources, numbers or desert, inlined into the config. It is
// what lobby.fullLandBoard builds and what the gallery sends; the engine deals
// the terrain at start.
func lobbyBoard(radius int) *board.Board {
	b := &board.Board{Radius: radius, Tiles: map[board.Hex]board.Tile{}, Robber: board.Hex{}}
	for _, h := range board.HexesInRadius(radius) {
		b.Tiles[h] = board.Tile{Res: board.ResLand}
	}
	return b
}

// lobbyIslandsBoard is the same shape with the outer ring painted sea, as an
// Islands gallery map is (engine.ValidateMap requires open water).
func lobbyIslandsBoard(radius int) *board.Board {
	b := lobbyBoard(radius)
	for _, h := range board.HexesInRadius(radius) {
		if hexRing(h) == radius {
			b.Tiles[h] = board.Tile{Res: board.Sea}
		}
	}
	return b
}

// TestFinishBoardRunsOnLobbyBoards: FinishBoard must run on boards inlined by the
// lobby, which is every real game, not only on cfg.Board == nil boards from
// sim/ and tests. A sweep rather than one seed, since the property is a rate.
// The witness count at the end keeps the test honest if the generator ever stops
// dealing ring deserts.
func TestFinishBoardRunsOnLobbyBoards(t *testing.T) {
	maps := []struct {
		ruleset string
		board   func(int) *board.Board
	}{
		{"base+caravans", lobbyBoard},
		{engine.CanonicalRuleset("base+caravans+fishermen"), lobbyBoard},
		{engine.CanonicalRuleset("base+caravans+islands"), lobbyIslandsBoard},
	}
	repaired := 0
	for _, m := range maps {
		ruleset := m.ruleset
		for _, players := range []int{3, 4, 6} {
			for seed := uint64(1); seed <= 40; seed++ {
				cfg := engine.GameConfig{
					Players: players, Ruleset: ruleset,
					Board: m.board(board.RadiusFor(players)),
				}
				s := replayNew(t, cfg, seed)
				x, ok := CaravansStateExt(s)
				if !ok {
					t.Fatalf("%s p%d seed %d: no caravans ext", ruleset, players, seed)
				}
				if !x.HasOasis {
					t.Fatalf("%s p%d seed %d: a lobby board finished with no oasis", ruleset, players, seed)
				}
				for i, spoke := range x.Arrows {
					if spoke == (board.Edge{}) {
						t.Fatalf("%s p%d seed %d: caravan %d has no spoke (oasis %v on ring %d of %d)",
							ruleset, players, seed, i, x.Oasis, hexRing(x.Oasis), s.Board.Radius)
					}
				}
				// Witness: re-deal the same board without the finisher (Frame/Resolve
				// on the config's shape, as State.New does before the module pass) and
				// count the boards left short, so the sweep cannot pass on boards that
				// were all born right.
				raw := m.board(board.RadiusFor(players))
				raw.Frame()
				raw.Resolve(engine.PublicRngForSeed(seed, 1), cfg.BoardMode)
				if o, ok := pickOasis(raw); !ok || spokeCount(raw, o) != caravansPerOasis {
					repaired++
				}
			}
		}
	}
	if repaired == 0 {
		t.Fatal("no board in the sweep had an oasis short of three spokes")
	}
	t.Logf("%d boards needed the oasis moved", repaired)
}

// TestFinishBoardKeepsPinnedTiles: a tile the author chose is theirs. A map that
// pins its own desert on the ring keeps it there and starts the caravans it
// drew.
func TestFinishBoardKeepsPinnedTiles(t *testing.T) {
	const radius = 2
	b := lobbyBoard(radius)
	// Pin a desert on the outer ring, where an oasis cannot start three
	// caravans, and pin every interior hex so no dealt partner exists.
	ring := board.Hex{Q: radius, R: 0}
	b.Tiles[ring] = board.Tile{Res: board.ResNone}
	for _, h := range board.HexesInRadius(radius) {
		if h != ring && hexRing(h) < radius {
			b.Tiles[h] = board.Tile{Res: board.Wood, Number: 5}
		}
	}
	before := maps.Clone(b.Tiles)

	finished := b.Clone()
	(Caravans{}).FinishBoard(finished, engine.GameConfig{Board: b}, testRNG())

	for h, tile := range before {
		if tile.Res == board.ResLand {
			continue // the author asked the engine to fill this one in
		}
		if got := finished.Tiles[h]; got != tile {
			t.Fatalf("pinned hex %v was %v/%d, got %v/%d",
				h, tile.Res, tile.Number, got.Res, got.Number)
		}
	}
	if o, ok := pickOasis(finished); !ok || o != ring {
		t.Fatalf("oasis = %v (found %v), want the pinned ring desert %v", o, ok, ring)
	}
}

// replayNew creates a game and folds its log, the only way to see the board
// the modules finished (EvBoardGenerated carries it).
func replayNew(t *testing.T, cfg engine.GameConfig, seed uint64) *engine.State {
	t.Helper()
	events, err := engine.New(cfg, engine.SeedsFrom(seed))
	if err != nil {
		t.Fatalf("new (%s, %dp, seed %d): %v", cfg.Ruleset, cfg.Players, seed, err)
	}
	s, err := engine.Replay(events)
	if err != nil {
		t.Fatalf("replay (%s, %dp, seed %d): %v", cfg.Ruleset, cfg.Players, seed, err)
	}
	return s
}
