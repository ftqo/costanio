package game

import (
	"bytes"
	"encoding/gob"
	"encoding/json"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/islands"
	"github.com/ftqo/costan.io/engine/knights"
	"github.com/ftqo/costan.io/engine/scenarios"
	"github.com/ftqo/costan.io/store"
)

// State.InitMaps heals the maps State owns, but expansions keep their own maps
// in State.Ext. A game restored from a snapshot could fold an event into a nil
// Ext map and panic ("assignment to entry in nil map"), which Actor.apply
// turns into a paused-error game after an ordinary move.
//
// encoding/gob does not omit empty maps: it skips a map field only when it is
// nil, and keeps zero-length non-nil maps. Empty slices are what it drops.
// TestGobKeepsEmptyMapsDropsEmptySlices pins this. So a field is missing from
// the blob only if it was nil at encode time, or did not exist yet (gob
// ignores fields the stream does not mention, leaving them zero; e.g.
// knights.Ext.Walled added after older snapshots).
//
// The fix is engine.ExtRestorer, called from InitMaps, so each module repairs
// its own state. It cannot recover a non-map field whose zero value is
// meaningful (a sentinel like MerchantOwner = NoPlayer decodes as player 0);
// that still needs a snapshotVersion bump.

// applyAfterRestore folds an event and turns the nil-map panic into a test
// failure. The recover mirrors Actor.apply; without it the panic aborts the
// whole test binary.
func applyAfterRestore(t *testing.T, s *engine.State, e engine.Event) {
	t.Helper()
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("folding %s after a snapshot restore panicked: %v", e.Type, r)
		}
	}()
	e.Seq = s.NextSeq
	if err := engine.Apply(s, e); err != nil {
		t.Fatalf("apply %s: %v", e.Type, err)
	}
}

// snapshotAndRebuild puts s through the production restore path: gob into a
// versioned blob, into the store, and back through rebuild(). The round trip
// is what drops the field, so it is tested rather than InitMaps alone.
func snapshotAndRebuild(t *testing.T, ruleset string, s *engine.State) *engine.State {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "s.db"))
	if err != nil {
		t.Fatal(err)
	}
	host, _ := st.CreateGuest("host")
	cfgJSON, _ := json.Marshal(s.Config)
	if err := st.CreateGame(&store.Game{
		ID: "g", Ruleset: ruleset, Config: cfgJSON, CreatedBy: host.ID,
	}); err != nil {
		t.Fatal(err)
	}

	var buf bytes.Buffer
	buf.WriteByte(snapshotVersion)
	if err := gob.NewEncoder(&buf).Encode(s); err != nil {
		t.Fatal(err)
	}
	if err := st.SaveSnapshot("g", s.NextSeq, buf.Bytes()); err != nil {
		t.Fatal(err)
	}
	got, err := rebuild("g", st)
	if err != nil {
		t.Fatalf("rebuild: %v", err)
	}
	return got
}

// newSeededGame builds a real game from the engine's own creation log, so the
// module state under test is what the module itself constructs.
func newSeededGame(t *testing.T, ruleset string, players int) *engine.State {
	t.Helper()
	cfg := engine.GameConfig{Players: players, Ruleset: ruleset}
	log, err := engine.New(cfg, engine.SeedsFrom(1))
	if err != nil {
		t.Fatal(err)
	}
	s := engine.Empty()
	for _, e := range log {
		if err := engine.Apply(s, e); err != nil {
			t.Fatal(err)
		}
	}
	return s
}

// anyVertex returns a vertex that exists on the board, so events below carry a
// plausible payload rather than a zero value.
func anyVertex(t *testing.T, s *engine.State) board.Vertex {
	t.Helper()
	for h := range s.Board.Tiles {
		return h.Vertices()[0]
	}
	t.Fatal("board has no tiles")
	return board.Vertex{}
}

// TestGobKeepsEmptyMapsDropsEmptySlices pins the encoding/gob behaviour the
// snapshot design relies on: empty maps survive the round trip, empty slices
// do not.
func TestGobKeepsEmptyMapsDropsEmptySlices(t *testing.T) {
	type shape struct {
		M map[string]int
		S []int
		N int // keeps the struct non-empty so something is always encoded
	}
	round := func(in shape) shape {
		var buf bytes.Buffer
		if err := gob.NewEncoder(&buf).Encode(in); err != nil {
			t.Fatal(err)
		}
		var out shape
		if err := gob.NewDecoder(bytes.NewReader(buf.Bytes())).Decode(&out); err != nil {
			t.Fatal(err)
		}
		return out
	}
	got := round(shape{M: map[string]int{}, S: []int{}, N: 1})
	if got.M == nil {
		t.Error("gob dropped an empty map")
	}
	if got.S != nil {
		t.Error("gob kept an empty slice")
	}
	// A nil map is dropped. A field that did not exist at encode time looks
	// the same.
	if got := round(shape{M: nil, S: nil, N: 1}); got.M != nil {
		t.Error("gob kept a nil map")
	}
}

func TestRebuildHealsKnightsExtMaps(t *testing.T) {
	s := newSeededGame(t, "base+cak", 4)
	x, ok := knights.StateExt(s)
	if !ok {
		t.Fatal("no Knights module state on a base+cak game")
	}

	// Simulate a blob written before Walled existed: gob omits an absent field
	// and a nil map identically, so the bytes match an older binary's.
	if x.Walled == nil {
		t.Fatal("precondition: Walled is already nil")
	}
	x.Walled = nil
	x.Knights = nil

	got := snapshotAndRebuild(t, "base+cak", s)
	gx, ok := knights.StateExt(got)
	if !ok {
		t.Fatal("rebuild lost the Knights module state")
	}
	if gx.Walled == nil {
		t.Error("Walled is nil after a restore")
	}
	if gx.Knights == nil {
		t.Error("Knights is nil after a restore")
	}

	// Fold a city wall, an ordinary Knights move that needs no prior state.
	v := anyVertex(t, got)
	applyAfterRestore(t, got, engine.NewEvent(knights.EvKnightBuilt, map[string]any{
		"player": engine.PlayerID(0), "v": v, "free": true,
	}))
	if len(gx.Knights) != 1 {
		t.Errorf("knight not recorded after restore: %d knights", len(gx.Knights))
	}
}

func TestRebuildHealsIslandsExtMaps(t *testing.T) {
	s := newSeededGame(t, "base+islands", 4)

	// The Islands Ext is built lazily by its own fold, so create it as the
	// module would. EvTurnReset only clears a map that is already empty.
	e := engine.NewEvent(islands.EvTurnReset, struct{}{})
	e.Seq = s.NextSeq
	if err := engine.Apply(s, e); err != nil {
		t.Fatalf("seeding the islands ext: %v", err)
	}
	x, ok := s.Ext[islands.Name].(*islands.Ext)
	if !ok {
		t.Fatal("no Islands module state after folding a turn reset")
	}
	x.PendingGold = nil
	x.Ships = nil
	x.BuiltTurn = nil
	x.Reached = nil
	x.IslandVP = nil

	got := snapshotAndRebuild(t, "base+islands", s)
	gx, ok := got.Ext[islands.Name].(*islands.Ext)
	if !ok {
		t.Fatal("rebuild lost the Islands module state")
	}
	for name, m := range map[string]any{
		"Ships": gx.Ships, "BuiltTurn": gx.BuiltTurn, "PendingGold": gx.PendingGold,
		"Reached": gx.Reached, "IslandVP": gx.IslandVP,
	} {
		if reflect.ValueOf(m).IsNil() {
			t.Errorf("%s is nil after a restore", name)
		}
	}

	applyAfterRestore(t, got, engine.NewEvent(islands.EvGoldOwed, map[string]any{
		"owed": []engine.PlayerDiscard{{Player: 0, Count: 1}},
	}))
	if gx.PendingGold[0] != 1 {
		t.Errorf("gold not recorded after restore: PendingGold = %v", gx.PendingGold)
	}
}

// TestEveryExtMapSurvivesRestore enumerates Ext map fields by reflection, nils
// them all (as a blob from an older binary decodes), and requires the restore
// to bring every one back. A new map field without a matching RestoreExt
// change fails here.
func TestEveryExtMapSurvivesRestore(t *testing.T) {
	cases := []struct {
		ruleset string
		// seed folds one harmless module event so a lazily built Ext exists.
		seed func(t *testing.T, s *engine.State)
	}{
		{"base+cak", nil}, // seeded at creation, see knights.Module.InitExt
		{"base+islands", func(t *testing.T, s *engine.State) {
			e := engine.NewEvent(islands.EvTurnReset, struct{}{})
			e.Seq = s.NextSeq
			if err := engine.Apply(s, e); err != nil {
				t.Fatal(err)
			}
		}},
		{"base+caravans", func(t *testing.T, s *engine.State) {
			e := engine.NewEvent(scenarios.EvCamelBuilt, struct{}{})
			e.Seq = s.NextSeq
			if err := engine.Apply(s, e); err != nil {
				t.Fatal(err)
			}
		}},
	}
	for _, tc := range cases {
		t.Run(tc.ruleset, func(t *testing.T) {
			s := newSeededGame(t, tc.ruleset, 4)
			if tc.seed != nil {
				tc.seed(t, s)
			}
			if len(s.Ext) == 0 {
				t.Fatalf("no module state to test on %s", tc.ruleset)
			}
			// Nil every map field in every Ext, counting them so a module whose
			// Ext holds no maps cannot pass vacuously.
			nilled := 0
			for _, x := range s.Ext {
				nilled += nilAllMaps(reflect.ValueOf(x))
			}
			if nilled == 0 {
				// Fatal, not Skip: a skip would also pass vacuously.
				t.Fatalf("%s: no Ext map fields were nilled", tc.ruleset)
			}

			got := snapshotAndRebuild(t, tc.ruleset, s)
			for name, x := range got.Ext {
				for _, path := range nilMapPaths(reflect.ValueOf(x), name) {
					t.Errorf("%s is nil after a restore; add it to that module's RestoreExt", path)
				}
			}
		})
	}
}

// nilAllMaps sets every settable map field reachable in v to nil and returns
// how many it changed. Only the top level of each Ext struct is walked, which
// is where gob field omission acts.
func nilAllMaps(v reflect.Value) int {
	if v.Kind() == reflect.Pointer || v.Kind() == reflect.Interface {
		if v.IsNil() {
			return 0
		}
		return nilAllMaps(v.Elem())
	}
	if v.Kind() != reflect.Struct {
		return 0
	}
	n := 0
	for _, f := range v.Fields() {
		if f.Kind() == reflect.Map && f.CanSet() && !f.IsNil() {
			f.Set(reflect.Zero(f.Type()))
			n++
		}
	}
	return n
}

// nilMapPaths lists the map fields still nil in v, named for the failure message.
func nilMapPaths(v reflect.Value, prefix string) []string {
	if v.Kind() == reflect.Pointer || v.Kind() == reflect.Interface {
		if v.IsNil() {
			return nil
		}
		return nilMapPaths(v.Elem(), prefix)
	}
	if v.Kind() != reflect.Struct {
		return nil
	}
	var out []string
	for i := range v.NumField() {
		if f := v.Field(i); f.Kind() == reflect.Map && f.IsNil() {
			out = append(out, prefix+"."+v.Type().Field(i).Name)
		}
	}
	return out
}
