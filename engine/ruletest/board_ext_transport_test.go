package ruletest

import (
	"encoding/json"
	"reflect"
	"slices"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	_ "github.com/ftqo/costan.io/engine/islands"
	_ "github.com/ftqo/costan.io/engine/knights"
	"github.com/ftqo/costan.io/engine/scenarios"
)

// deriveGrounds (Fishermen) and freshCaravans (Caravans) decide rules (which
// vertices catch fish, which edges a caravan starts from). The derived layout is
// recorded in EvBoardGenerated and unmarshalled over the derivation on replay, so
// the log wins and a changed derivation cannot rewrite logged games. Neither
// game.snapshotVersion nor sim/'s single-binary determinism sweep would notice a
// fold that ignores the log, so the first pair of tests checks it.

// mutateBoardExt rewrites one module's recorded board ext blob in a log,
// simulating a binary that derives something different from the one that wrote
// the log.
func mutateBoardExt(t *testing.T, evs []engine.Event, module string, edit func(map[string]any)) []engine.Event {
	t.Helper()
	out := append([]engine.Event(nil), evs...)
	for i, e := range out {
		if e.Type != engine.EvBoardGenerated {
			continue
		}
		var d struct {
			Board json.RawMessage            `json:"board"`
			Ext   map[string]json.RawMessage `json:"ext,omitempty"`
		}
		if err := json.Unmarshal(e.Data, &d); err != nil {
			t.Fatalf("decode board event: %v", err)
		}
		raw, ok := d.Ext[module]
		if !ok {
			t.Fatalf("board event carries no recorded ext for %q", module)
		}
		var blob map[string]any
		if err := json.Unmarshal(raw, &blob); err != nil {
			t.Fatalf("decode %s ext: %v", module, err)
		}
		edit(blob)
		edited, e2 := json.Marshal(blob)
		if e2 != nil {
			t.Fatalf("re-encode %s ext: %v", module, e2)
		}
		d.Ext[module] = edited
		nd, e2 := json.Marshal(d)
		if e2 != nil {
			t.Fatalf("re-encode board event: %v", e2)
		}
		out[i].Data = nd
		return out
	}
	t.Fatal("no EvBoardGenerated in log")
	return nil
}

func newGame(t *testing.T, ruleset string, players int, seed uint64) []engine.Event {
	t.Helper()
	evs, e := engine.New(engine.GameConfig{Players: players, Ruleset: ruleset},
		engine.Seeds{Public: seed, Private: seed ^ 0x9E37})
	if e != nil {
		t.Fatalf("new %s: %v", ruleset, e)
	}
	return evs
}

// TestFishingGroundsReadFromLog moves a recorded ground's
// number (which decides which roll pays that ground) and asserts the fold
// honours the log.
func TestFishingGroundsReadFromLog(t *testing.T) {
	evs := newGame(t, "base+fishermen", 4, 7)
	live, e := engine.Replay(evs)
	if e != nil {
		t.Fatalf("replay: %v", e)
	}
	x, ok := scenarios.FishStateExt(live)
	if !ok || len(x.Grounds) == 0 {
		t.Fatal("no fishing grounds derived")
	}
	if x.Grounds[0].Number != 4 {
		t.Fatalf("first ground number %d, expected the lowest ground number", x.Grounds[0].Number)
	}

	// Rewrite the first ground's number to a roll no ground ever carries.
	tampered := mutateBoardExt(t, evs, "fishermen", func(blob map[string]any) {
		gs, ok := blob["Grounds"].([]any)
		if !ok || len(gs) == 0 {
			t.Fatalf("recorded fishermen ext has no Grounds: %v", blob)
		}
		gs[0].(map[string]any)["number"] = float64(11)
	})
	got, e := engine.Replay(tampered)
	if e != nil {
		t.Fatalf("replay tampered: %v", e)
	}
	y, _ := scenarios.FishStateExt(got)
	if y.Grounds[0].Number != 11 {
		t.Fatalf("ground number %d, want 11 from the log", y.Grounds[0].Number)
	}
	// Fields the blob did not touch must survive: the restore unmarshals
	// over a derived value rather than replacing it.
	if len(y.Grounds) != len(x.Grounds) || !reflect.DeepEqual(y.Grounds[0].V, x.Grounds[0].V) ||
		y.Supply != x.Supply || y.TilesLeft != x.TilesLeft || len(y.Held) != len(x.Held) {
		t.Fatalf("restoring one field disturbed the rest:\n got %+v\nwant %+v", y, x)
	}
}

// TestOasisReadFromLog is the same guard for Caravans: the
// oasis is where all three caravans start.
func TestOasisReadFromLog(t *testing.T) {
	evs := newGame(t, "base+caravans", 4, 11)
	live, e := engine.Replay(evs)
	if e != nil {
		t.Fatalf("replay: %v", e)
	}
	x, ok := scenarios.CaravansStateExt(live)
	if !ok || !x.HasOasis {
		t.Fatal("no oasis derived")
	}
	moved := board.Hex{Q: x.Oasis.Q + 1, R: x.Oasis.R}
	tampered := mutateBoardExt(t, evs, "caravans", func(blob map[string]any) {
		blob["Oasis"] = map[string]any{"q": moved.Q, "r": moved.R}
	})
	got, e := engine.Replay(tampered)
	if e != nil {
		t.Fatalf("replay tampered: %v", e)
	}
	y, _ := scenarios.CaravansStateExt(got)
	if y.Oasis != moved {
		t.Fatalf("oasis %v, want the recorded %v",
			y.Oasis, moved)
	}
	if y.CamelsLeft != x.CamelsLeft || !slices.Equal(y.Arrows, x.Arrows) {
		t.Fatalf("restoring one field disturbed the rest:\n got %+v\nwant %+v", y, x)
	}
}

// TestEveryBoardDerivedModuleRecordsItsLayout stops a module that derives board
// state from forgetting to record it, whose only symptom would be a resumed game
// that differs.
func TestEveryBoardDerivedModuleRecordsItsLayout(t *testing.T) {
	for _, rs := range []string{"base", "base+fishermen", "base+caravans", "base+islands",
		"base+cak", "base+caravans+fishermen", "base+caravans+fishermen+islands",
		"base+raiders", "base+islands+raiders", "base+caravans+raiders",
		"base+wagons", "base+caravans+wagons", "explorers"} {
		evs := newGame(t, rs, 4, 3)
		s, e := engine.Replay(evs)
		if e != nil {
			t.Fatalf("%s: replay: %v", rs, e)
		}
		var d struct {
			Ext map[string]json.RawMessage `json:"ext,omitempty"`
		}
		if e := json.Unmarshal(evs[1].Data, &d); e != nil {
			t.Fatalf("%s: decode board event: %v", rs, e)
		}
		for _, m := range s.Modules() {
			if _, ok := m.(engine.ExtBoardInitializer); !ok {
				continue
			}
			if _, ok := d.Ext[m.Name()]; !ok {
				t.Errorf("%s: module %q derives board state but records none in EvBoardGenerated",
					rs, m.Name())
			}
		}
	}
}

// TestRecordedLayoutRoundTripsExactly: transporting the derivation is only safe
// if it survives JSON unchanged. A field that does not (a nil map coming back
// empty, or the reverse) would make a new game's first replay differ from live.
func TestRecordedLayoutRoundTripsExactly(t *testing.T) {
	for _, rs := range []string{"base+fishermen", "base+caravans", "base+caravans+fishermen",
		"base+caravans+fishermen+islands", "base+cak+fishermen",
		"base+raiders", "base+islands+raiders", "base+caravans+fishermen+raiders",
		// Wagons records the trade hexes, their roles and the barbarian
		// start paths, all of which decide where the scenario is played.
		"base+wagons", "base+cak+wagons"} {
		for players := 2; players <= 8; players++ {
			for seed := range uint64(12) {
				evs := newGame(t, rs, players, seed)
				a, e := engine.Replay(evs)
				if e != nil {
					t.Fatalf("%s %dp seed %d: %v", rs, players, seed, e)
				}
				// Strip the recorded layout; the pure derivation from this same
				// binary must be identical.
				stripped := append([]engine.Event(nil), evs...)
				var d struct {
					Board json.RawMessage `json:"board"`
				}
				if e := json.Unmarshal(evs[1].Data, &d); e != nil {
					t.Fatalf("%s: %v", rs, e)
				}
				raw, e := json.Marshal(d)
				if e != nil {
					t.Fatalf("%s: %v", rs, e)
				}
				stripped[1].Data = raw
				b, e := engine.Replay(stripped)
				if e != nil {
					t.Fatalf("%s %dp seed %d stripped: %v", rs, players, seed, e)
				}
				for name, want := range b.Ext {
					got, ok := a.Ext[name]
					if !ok {
						t.Fatalf("%s %dp seed %d: ext %q vanished", rs, players, seed, name)
					}
					if !reflect.DeepEqual(got, want) {
						t.Fatalf("%s %dp seed %d: ext %q does not survive the log round trip:\n"+
							" transported %+v\n   derived %+v", rs, players, seed, name, got, want)
					}
				}
			}
		}
	}
}
