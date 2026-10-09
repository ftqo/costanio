package scenarios

import (
	"encoding/json"
	"errors"
	"maps"
	"slices"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// keys of a JSON payload, for asking what a redacted event still says.
func payloadKeys(t *testing.T, raw json.RawMessage) map[string]bool {
	t.Helper()
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("unmarshal %s: %v", raw, err)
	}
	out := map[string]bool{}
	for k := range m {
		out[k] = true
	}
	return out
}

// TestFishCatchSealsTheMix pins the two halves of a catch: a public event with
// how many tiles each seat drew, and a per-seat event with which tiles, visible
// to that seat alone and redacted to just the seat number for everyone else.
func TestFishCatchSealsTheMix(t *testing.T) {
	s, _ := newGame(t, "base+fishermen", 2)
	// Plant a city on the lake shore so a 2 yields.
	var lake board.Hex
	for h, tile := range s.Board.Tiles {
		if tile.Res == board.Lake {
			lake = h
		}
	}
	v := lake.Vertices()[0]
	delete(s.Buildings, v)
	s.Buildings[v] = engine.Building{Owner: 1, City: true}

	events := fishCatch(s, 1, 1)
	if len(events) < 2 {
		t.Fatalf("catch produced %d events, want a public half and at least one per-seat half", len(events))
	}

	// The public half.
	if events[0].Type != EvFishCaught {
		t.Fatalf("events[0] = %s, want %s", events[0].Type, EvFishCaught)
	}
	if events[0].Visible != nil {
		t.Errorf("EvFishCaught is not public: Visible = %v", events[0].Visible)
	}
	pub := payloadKeys(t, events[0].Data)
	// supply/used are on the truth event (Apply restores them verbatim) and
	// are removed from every wire by the redactor, checked below.
	for _, k := range []string{"draws", "total", "supply", "used"} {
		if !pub[k] {
			t.Errorf("EvFishCaught lost its field %q: %s", k, events[0].Data)
		}
	}
	if pub["gains"] || pub["gain"] {
		t.Errorf("EvFishCaught publishes the per-seat mix: %s", events[0].Data)
	}
	if pub["values"] {
		t.Errorf("EvFishCaught publishes the per-seat fish value: %s", events[0].Data)
	}
	var caught struct {
		Draws []int `json:"draws"`
	}
	if err := json.Unmarshal(events[0].Data, &caught); err != nil {
		t.Fatal(err)
	}
	if caught.Draws[1] != 2 { // a city draws two tiles
		t.Errorf("public draw count for the lake city = %d, want 2", caught.Draws[1])
	}

	// The supply snapshot reaches nobody: the tile set is constant, so what
	// is not in the supply or spent pile is in someone's hand, and Used moves
	// by exactly a named spender's discard.
	redactCaught, ok := engine.RedactorFor(EvFishCaught)
	if !ok {
		t.Fatal("EvFishCaught has no registered redactor")
	}
	wire := payloadKeys(t, redactCaught(events[0]))
	for _, k := range []string{"supply", "used"} {
		if wire[k] {
			t.Errorf("redacted EvFishCaught carries %q: %s", k, redactCaught(events[0]))
		}
	}
	for _, k := range []string{"draws", "total", "boot_to"} {
		if !wire[k] {
			t.Errorf("the redacted EvFishCaught lost its public field %q: %s", k, redactCaught(events[0]))
		}
	}

	// The per-seat halves.
	seen := 0
	for _, e := range events[1:] {
		if e.Type != EvFishGained {
			t.Fatalf("unexpected catch event %s", e.Type)
		}
		var d fishGainData
		if err := json.Unmarshal(e.Data, &d); err != nil {
			t.Fatal(err)
		}
		if len(e.Visible) != 1 || e.Visible[0] != d.Player {
			t.Fatalf("EvFishGained for seat %d has Visible = %v, want exactly [%d]", d.Player, e.Visible, d.Player)
		}
		if d.Gain == ([3]int{}) {
			t.Fatalf("EvFishGained for seat %d carries no tiles", d.Player)
		}
		redact, ok := engine.RedactorFor(EvFishGained)
		if !ok {
			t.Fatal("EvFishGained has no registered redactor")
		}
		k := payloadKeys(t, redact(e))
		if k["gain"] {
			t.Errorf("redacted EvFishGained carries the mix: %s", redact(e))
		}
		if !k["player"] {
			t.Errorf("the redacted EvFishGained hides who drew: %s", redact(e))
		}
		seen++
	}
	if seen == 0 {
		t.Fatal("no per-seat gain events")
	}
}

// TestFishSpendSealsTheDiscard: which tiles a spend hands in is the spender's
// own information; what it bought is not.
func TestFishSpendSealsTheDiscard(t *testing.T) {
	s, _ := newGame(t, "base+fishermen", 2)
	rolled(t, s)
	p := s.Cur
	// A lopsided holding so the discard is a genuine mix: 4 fish is paid as
	// one 3-tile plus one 1-tile.
	setHeld(fishExt(s), p, [3]int{2, 0, 2})
	s.Bank[board.Wheat] = 5

	evs, err := engine.Decide(s, engine.Command{Player: p, Type: CmdSpendFish,
		Data: mustJSON(t, map[string]any{"use": FishTakeResource, "res": board.Wheat})})
	if err != nil {
		t.Fatalf("spend: %v", err)
	}
	var spent engine.Event
	for _, e := range evs {
		if e.Type == EvFishSpent {
			spent = e
		}
	}
	if spent.Type == "" {
		t.Fatalf("no EvFishSpent in %+v", evs)
	}
	if len(spent.Visible) != 1 || spent.Visible[0] != p {
		t.Fatalf("EvFishSpent has Visible = %v, want exactly [%d]", spent.Visible, p)
	}
	var d fishSpentData
	if err := json.Unmarshal(spent.Data, &d); err != nil {
		t.Fatal(err)
	}
	if d.Value != fishTotal(d.Discard) {
		t.Errorf("value %d does not match the discard %v", d.Value, d.Discard)
	}
	if d.Value < 4 {
		t.Errorf("value = %d, want at least the 4-fish cost", d.Value)
	}
	if d.Tiles != tileCount(d.Discard) {
		t.Errorf("public tile count %d does not match the discard %v", d.Tiles, d.Discard)
	}
	redact, ok := engine.RedactorFor(EvFishSpent)
	if !ok {
		t.Fatal("EvFishSpent has no registered redactor")
	}
	k := payloadKeys(t, redact(spent))
	if k["discard"] {
		t.Errorf("redacted EvFishSpent names the tiles: %s", redact(spent))
	}
	// The value goes with the tiles: spendTiles is deterministic and the
	// price ladder public, so (use, value) would pin the discard for most
	// costs. See fishSpentData.
	if k["value"] {
		t.Errorf("redacted EvFishSpent names the tile value: %s", redact(spent))
	}
	for _, want := range []string{"player", "use", "tiles"} {
		if !k[want] {
			t.Errorf("the redacted EvFishSpent lost its public field %q: %s", want, redact(spent))
		}
	}
}

// TestFishFreeRoadNeedsALegalPlacement: the 5-fish road grants a credit, so an
// edge nobody could build on must not cost five fish. An illegal edge produces no
// events and ErrBadPlacement; a legal one produces the spend that grants the
// road.
func TestFishFreeRoadNeedsALegalPlacement(t *testing.T) {
	s, _ := newGame(t, "base+fishermen", 2)
	rolled(t, s)
	p := s.Cur
	setHeld(fishExt(s), p, [3]int{0, 0, 5}) // 15 fish: never the binding constraint

	bad := illegalRoadEdge(t, s, p)
	evs, err := engine.Decide(s, engine.Command{Player: p, Type: CmdSpendFish,
		Data: mustJSON(t, map[string]any{"use": FishFreeRoad, "e": bad})})
	if !errors.Is(err, engine.ErrBadPlacement) {
		t.Errorf("illegal free-road edge err = %v, want ErrBadPlacement", err)
	}
	if len(evs) != 0 {
		t.Fatalf("unbuildable edge charged fish: %+v", evs)
	}

	// The same command with a legal edge is accepted, and the credit lands.
	good := legalRoadEdge(t, s, p)
	before := fishTotal(fishExt(s).Held[p])
	step(t, s, engine.Command{Player: p, Type: CmdSpendFish,
		Data: mustJSON(t, map[string]any{"use": FishFreeRoad, "e": good})})
	if s.FreeRoads != 1 {
		t.Errorf("free roads = %d, want 1", s.FreeRoads)
	}
	if after := fishTotal(fishExt(s).Held[p]); after >= before {
		t.Errorf("fish after a legal free road = %d, want less than %d", after, before)
	}
	// The credit is spendable: the legal edge is still there to build on.
	step(t, s, engine.Command{Player: p, Type: engine.CmdBuildRoad,
		Data: mustJSON(t, map[string]any{"e": good})})
	if s.Roads[board.NewEdge(good.A, good.B)] != p {
		t.Errorf("the granted road did not land on %v", good)
	}
	if s.FreeRoads != 0 {
		t.Errorf("free roads after building = %d, want 0", s.FreeRoads)
	}
}

// TestFishFreeRoadRefusedWithNoRoadPieces: with no road pieces there is no legal
// placement, so the spend is refused rather than charged.
func TestFishFreeRoadRefusedWithNoRoadPieces(t *testing.T) {
	s, _ := newGame(t, "base+fishermen", 2)
	rolled(t, s)
	p := s.Cur
	setHeld(fishExt(s), p, [3]int{0, 0, 5})
	good := legalRoadEdge(t, s, p)
	s.Players[p].RoadsLeft = 0

	evs, err := engine.Decide(s, engine.Command{Player: p, Type: CmdSpendFish,
		Data: mustJSON(t, map[string]any{"use": FishFreeRoad, "e": good})})
	if !errors.Is(err, engine.ErrBadPlacement) {
		t.Errorf("err = %v, want ErrBadPlacement", err)
	}
	if len(evs) != 0 {
		t.Fatalf("charged fish with no road pieces left: %+v", evs)
	}
}

// TestLegacyCatchStillFolds: a log from before the catch was split carries the
// mix on EvFishCaught with no EvFishGained after it, and must fold to the same
// holdings.
func TestLegacyCatchStillFolds(t *testing.T) {
	s, _ := newGame(t, "base+fishermen", 2)
	x := fishExt(s)
	before := x.Held[1]

	supply := [3]int{fishSupply[0] - 1, fishSupply[1] - 2, fishSupply[2]}
	legacy := engine.NewEvent(EvFishCaught, fishCaughtData{
		Gains:  [][3]int{{0, 0, 0}, {1, 2, 0}},
		Total:  3,
		BootTo: engine.NoPlayer,
		Supply: &supply,
	})
	if !json.Valid(legacy.Data) {
		t.Fatal("bad event")
	}
	legacy.Seq = s.NextSeq
	if err := engine.Apply(s, legacy); err != nil {
		t.Fatal(err)
	}
	want := [3]int{before[0] + 1, before[1] + 2, before[2]}
	if got := fishExt(s).Held[1]; got != want {
		t.Errorf("legacy fold gave seat 1 %v, want %v", got, want)
	}

	// And nothing this build emits carries the legacy field.
	if payloadKeys(t, freshCatchPayload(t))["gains"] {
		t.Error("new EvFishCaught carries the old gains field")
	}
}

// freshCatchPayload returns the payload of a freshly emitted EvFishCaught.
func freshCatchPayload(t *testing.T) json.RawMessage {
	t.Helper()
	s, _ := newGame(t, "base+fishermen", 2)
	var lake board.Hex
	for h, tile := range s.Board.Tiles {
		if tile.Res == board.Lake {
			lake = h
		}
	}
	v := lake.Vertices()[0]
	delete(s.Buildings, v)
	s.Buildings[v] = engine.Building{Owner: 1, City: true}
	events := fishCatch(s, 1, 1)
	if len(events) == 0 {
		t.Fatal("no catch")
	}
	return events[0].Data
}

// TestFishSpendRedactedFoldKeepsThePublicTotal: a viewer who is not the spender
// folds an EvFishSpent with the discard redacted, and that seat's public count
// must still fall correctly; only the mix may go missing. Folded through Apply
// rather than by re-adding numbers by hand (see
// game.TestFishRedactedStreamFoldsPublicState).
func TestFishSpendRedactedFoldKeepsThePublicTotal(t *testing.T) {
	s, _ := newGame(t, "base+fishermen", 2)
	rolled(t, s)
	p := s.Cur
	setHeld(fishExt(s), p, [3]int{2, 0, 2})
	s.Bank[board.Wheat] = 5

	evs, err := engine.Decide(s, engine.Command{Player: p, Type: CmdSpendFish,
		Data: mustJSON(t, map[string]any{"use": FishTakeResource, "res": board.Wheat})})
	if err != nil {
		t.Fatalf("spend: %v", err)
	}
	var spent engine.Event
	for _, e := range evs {
		if e.Type == EvFishSpent {
			spent = e
		}
	}
	if spent.Type == "" {
		t.Fatalf("no EvFishSpent in %+v", evs)
	}
	var d fishSpentData
	if err := json.Unmarshal(spent.Data, &d); err != nil {
		t.Fatal(err)
	}
	redact, ok := engine.RedactorFor(EvFishSpent)
	if !ok {
		t.Fatal("EvFishSpent has no registered redactor")
	}
	redacted := spent
	redacted.Data = redact(spent)
	// Event.Payload caches the unredacted struct and would bypass the
	// redaction; game.RedactEvent drops it for the same reason.
	redacted.Payload = nil

	x := fishExt(s)
	before := x.Tiles[p]
	if before != tileCount(x.Held[p]) {
		t.Fatalf("fixture: tiles %d, held %v", before, x.Held[p])
	}
	heldBefore := x.Held[p]
	if _, err := (Fishermen{}).Apply(s, redacted); err != nil {
		t.Fatalf("apply redacted spend: %v", err)
	}
	if got, want := x.Tiles[p], before-d.Tiles; got != want {
		t.Errorf("public tile count after folding the redacted spend = %d, want %d", got, want)
	}
	// The mix is what a non-spender loses, and losing it is correct.
	if x.Held[p] != heldBefore {
		t.Errorf("the redacted spend moved tiles: %v, want %v (unchanged)", x.Held[p], heldBefore)
	}
}

// TestFishTilesTrackHeldOnTruth: on the server's unredacted state, the public
// tile count equals the number of tiles in the mix at every point in a real game.
// Tiles exists because a redacted fold cannot count Held; it must never drift
// from it.
func TestFishTilesTrackHeldOnTruth(t *testing.T) {
	s, _ := newGame(t, "base+fishermen", 3)
	rolled(t, s)
	x := fishExt(s)
	setHeld(x, 0, [3]int{2, 1, 3})
	setHeld(x, 1, [3]int{0, 0, 4})
	s.Bank[board.Wheat] = 5

	check := func(when string) {
		t.Helper()
		for p := range x.Held {
			if x.Tiles[p] != tileCount(x.Held[p]) {
				t.Errorf("%s: seat %d tiles = %d, held %v (count %d)",
					when, p, x.Tiles[p], x.Held[p], tileCount(x.Held[p]))
			}
		}
	}
	check("after the fixture")

	// A catch: both halves folded, as the server folds them.
	x.Supply = [3]int{8, 8, 8}
	supply, used := [3]int{6, 7, 8}, x.Used
	caught := engine.NewEvent(EvFishCaught, fishCaughtData{
		Draws: []int{2, 0, 1}, Total: 3, BootTo: engine.NoPlayer,
		Supply: &supply, Used: &used,
	})
	if _, err := (Fishermen{}).Apply(s, caught); err != nil {
		t.Fatal(err)
	}
	for _, g := range []fishGainData{{Player: 0, Gain: [3]int{1, 1, 0}}, {Player: 2, Gain: [3]int{0, 1, 0}}} {
		if _, err := (Fishermen{}).Apply(s, engine.NewEvent(EvFishGained, g, g.Player)); err != nil {
			t.Fatal(err)
		}
	}
	check("after a catch")

	// And a real spend, driven through Decide so the discard is the engine's.
	step(t, s, engine.Command{Player: s.Cur, Type: CmdSpendFish,
		Data: mustJSON(t, map[string]any{"use": FishTakeResource, "res": board.Wheat})})
	check("after a spend")
}

// TestFishSpendValueLeaksTheDiscard shows why a spend's value is not public.
//
// spendTiles is deterministic (minimum waste, then fewest tiles) and the price
// ladder is public, so for most (cost, value) pairs an observer can read the exact
// tiles off. The table below is that arithmetic: several pairs pin the discard to
// one multiset and others narrow it to two. The public per-seat number is the tile
// count, so the value is off the wire (see fishSpentData).
//
// Changing a cost or spendTiles' tie-break breaks the table, prompting a review
// before the value is published again. (A cost of 6 paid with 7 fish has one
// no-waste answer, a 3 and two 2s.)
func TestFishSpendValueLeaksTheDiscard(t *testing.T) {
	// want[cost][value] = how many distinct discards an observer cannot tell
	// apart. 1 means the public half determines the tiles exactly.
	want := map[int]map[int]int{
		2: {2: 2, 3: 1},
		3: {3: 3, 4: 1},
		4: {4: 4, 5: 1, 6: 1},
		5: {5: 5, 6: 2},
		6: {6: 7, 7: 1},
		7: {7: 8, 8: 2, 9: 1},
	}
	for use, cost := range fishCosts {
		candidates := map[int]map[[3]int]bool{}
		const maxTiles = 8 // beyond this the answer stops changing
		for a := range maxTiles + 1 {
			for b := range maxTiles + 1 {
				for c := range maxTiles + 1 {
					held := [3]int{a, b, c}
					if fishTotal(held) < cost {
						continue
					}
					d := spendTiles(held, cost)
					v := fishTotal(d)
					if candidates[v] == nil {
						candidates[v] = map[[3]int]bool{}
					}
					candidates[v][d] = true
				}
			}
		}
		got := map[int]int{}
		for v, set := range candidates {
			got[v] = len(set)
		}
		if !maps.Equal(got, want[cost]) {
			t.Errorf("%s (cost %d): value -> distinct discards = %v, want %v (see docs/scenarios.md)",
				use, cost, got, want[cost])
		}
	}
}

// TestFishTilesRepairedWhenMissing pins the ensureTiles guard: with Tiles not
// matching Held, the view publishes counts derived from Held without writing to
// state, and the first fold repairs Tiles rather than starting from zero.
//
// A guard test: Tiles is nil only because this test sets it so. Stale snapshots
// cannot reach a fold (game.snapshotVersion), but the fold sites and setHeld rely
// on the guard for hand-built exts.
func TestFishTilesRepairedWhenMissing(t *testing.T) {
	s, _ := newGame(t, "base+fishermen", 3)
	rolled(t, s)
	x := fishExt(s)
	setHeld(x, 0, [3]int{1, 1, 1}) // three tiles
	setHeld(x, 1, [3]int{0, 2, 0}) // two tiles
	x.Tiles = nil                  // the state the guard exists to survive

	v, ok := x.ViewExt(0).(map[string]any)
	if !ok {
		t.Fatalf("ViewExt type = %T", x.ViewExt(0))
	}
	if got := v["tiles"].([]int); !slices.Equal(got, []int{3, 2, 0}) {
		t.Errorf("view tiles with Tiles missing = %v, want [3 2 0]", got)
	}
	if x.Tiles != nil {
		t.Error("ViewExt wrote to the state")
	}

	// The first fold repairs Tiles rather than starting from zero.
	x.Supply = [3]int{8, 8, 8}
	supply, used := [3]int{8, 7, 8}, x.Used
	caught := engine.NewEvent(EvFishCaught, fishCaughtData{
		Draws: []int{1, 0, 0}, Total: 1, BootTo: engine.NoPlayer,
		Supply: &supply, Used: &used,
	})
	if _, err := (Fishermen{}).Apply(s, caught); err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(x.Tiles, []int{4, 2, 0}) {
		t.Errorf("tile counts after the first fold on a repaired ext = %v, want [4 2 0]", x.Tiles)
	}
}

// TestFishLegacyValueLogStillFoldsItsCounts: a log from the release that
// published a per-seat fish value and no tile count must fold to the right public
// numbers on a truth replay. A value does not give a count, so applyGain
// reconciles the count against Held where the mix is known (the truth fold and the
// owner's stream).
func TestFishLegacyValueLogStillFoldsItsCounts(t *testing.T) {
	s, _ := newGame(t, "base+fishermen", 3)
	rolled(t, s)
	x := fishExt(s)

	// A legacy catch: `values`, no `draws`.
	supply, used := [3]int{9, 9, 8}, x.Used
	legacy := engine.NewEvent(EvFishCaught, fishCaughtData{
		Values: []int{4, 0, 1}, Total: 3, BootTo: engine.NoPlayer,
		Supply: &supply, Used: &used,
	})
	if _, err := (Fishermen{}).Apply(s, legacy); err != nil {
		t.Fatal(err)
	}
	// The catch alone cannot know the counts.
	if !slices.Equal(x.Tiles, []int{0, 0, 0}) {
		t.Errorf("a legacy catch invented tile counts: %v", x.Tiles)
	}
	for _, g := range []fishGainData{{Player: 0, Gain: [3]int{1, 0, 1}}, {Player: 2, Gain: [3]int{1, 0, 0}}} {
		if _, err := (Fishermen{}).Apply(s, engine.NewEvent(EvFishGained, g, g.Player)); err != nil {
			t.Fatal(err)
		}
	}
	if !slices.Equal(x.Tiles, []int{2, 0, 1}) {
		t.Errorf("tile counts after a legacy catch and its gains = %v, want [2 0 1]", x.Tiles)
	}
}
