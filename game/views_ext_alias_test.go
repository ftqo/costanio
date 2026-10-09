package game

import (
	"bytes"
	"encoding/json"
	"sync"
	"testing"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/engine"
	_ "github.com/ftqo/costan.io/engine/harbormaster"
	_ "github.com/ftqo/costan.io/engine/islands"
	_ "github.com/ftqo/costan.io/engine/knights"
	_ "github.com/ftqo/costan.io/engine/rivers"
	_ "github.com/ftqo/costan.io/engine/scenarios"
	_ "github.com/ftqo/costan.io/engine/wagons"
)

// NewFullView runs on the actor goroutine, and the *FullView it returns is
// marshalled later on a connection goroutine (Actor.Subscribe hands out the
// pointer; server/ws.go serializes it), while the actor keeps folding. So the
// view must not alias any mutable State.Ext map or slice the module's Apply
// writes (islands ShipsLeft/PendingGold/IslandVP, cak
// PendingGive/HarborGive/Aqueduct). Without -race the map case is a fatal
// "concurrent map iteration and map write" that takes the whole process down.
//
// Two tests: one holds a view across each fold (deterministic, no race
// needed), the other runs both goroutines for the race detector. Played games
// only reach some fields (IslandVP and Aqueduct are not reached here); the
// exhaustive guard is engine/ruletest's TestViewExtSharesNothingWithLiveExt,
// which reflects over every module's ext.

// TestFullViewDoesNotAliasModuleExt: a view, once built, is a snapshot.
// Folding the next command must not change what it serializes to. Checked at
// every step, because the fields at risk are transient (PendingGold exists
// only between a gold roll and the picks).
func TestFullViewDoesNotAliasModuleExt(t *testing.T) {
	for _, tc := range []struct {
		name    string
		ruleset string
		seeds   []uint64
		strong  bool
	}{
		// Strong, not Simple: Simple never builds a ship or moves the pirate,
		// so its Islands ext barely moves.
		{"base+islands", "base+islands", []uint64{9, 17, 23}, true},
		{"base+cak", "base+cak", []uint64{9, 17, 23}, false},
		{"base+cak+islands", "base+cak+islands", []uint64{9, 17}, false},
		{"base+fishermen+caravans", "base+fishermen+caravans", []uint64{9}, false},
		// One game with the Strong bot, because Simple never reaches the
		// progress-card-driven cak fields (PendingGive, HarborGive, Aqueduct).
		// About six seconds under -race.
		{"base+cak+islands/strong", "base+cak+islands", []uint64{23}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel() // independent games; nothing shared but the module registry
			var b CommandSource = bot.NewSimple()
			if tc.strong {
				b = bot.NewStrong()
			}
			changed := 0
			for _, seed := range tc.seeds {
				changed += playCheckingViews(t, tc.ruleset, seed, b)
			}
			// A game whose module state never moved would pass with nothing to
			// leak, so fail instead.
			if changed < 5 {
				t.Fatalf("%s: module ext changed on only %d steps across %d games",
					tc.name, changed, len(tc.seeds))
			}
		})
	}
}

// playCheckingViews plays one seeded game, holding a freshly built view across
// each fold and requiring it to serialize identically afterwards. It returns
// how many steps moved the module state, which the caller checks.
func playCheckingViews(t *testing.T, ruleset string, seed uint64, b CommandSource) int {
	t.Helper()
	s := freshStateSeed(t, ruleset, seed)
	moved := 0
	var prevExt []byte
	for step := range 20000 {
		if s.Phase == engine.PhaseFinished {
			break
		}
		// The view a client is handed, built once per step. Its ext also
		// answers whether the module state moved since the last step, so no
		// second (expensive) view is needed.
		view := NewFullView(s, 0)
		if view == nil {
			t.Fatalf("%s seed %d step %d: NewFullView returned nil", ruleset, seed, step)
		}
		before := mustJSON(t, view)
		if ext := mustJSON(t, view.Ext); !bytes.Equal(prevExt, ext) {
			if prevExt != nil {
				moved++
			}
			prevExt = ext
		}

		if !stepGame(t, s, b) {
			break
		}

		if after := mustJSON(t, view); !bytes.Equal(before, after) {
			t.Fatalf("%s seed %d step %d: published view changed after the next command (aliases State.Ext)\n"+
				"  was: %s\n  now: %s", ruleset, seed, step, before, after)
		}
	}
	return moved
}

// TestFullViewMarshalRacesActorFold is the same bug seen by the race
// detector: one goroutine folds and hands out a view, another serializes views
// while the next fold runs. No Actor or store is needed; Subscribe's part is
// only building the view on the loop and returning the pointer, and without
// pacing and SQLite the loops overlap densely enough to be caught every run.
//
// A view per fold, because the risky fields are transient and omitted from the
// view while empty; fresh views guarantee some are taken while a map is live.
// The reader keeps the last few and re-marshals them, like a slow client.
//
// Needs -race; without it this passes on broken code, which is why the
// deterministic test above exists too.
func TestFullViewMarshalRacesActorFold(t *testing.T) {
	s := freshStateSeed(t, "base+cak+islands", 23)
	b := bot.NewSimple()

	views := make(chan *FullView, 1)
	var wg sync.WaitGroup
	wg.Go(func() {
		// The actor loop: fold, then publish the view a subscriber would get.
		// It never touches a view once handed out.
		defer close(views)
		for range 20000 {
			if s.Phase == engine.PhaseFinished || !stepGame(t, s, b) {
				return
			}
			v := NewFullView(s, 0)
			if v == nil {
				t.Error("NewFullView returned nil")
				return
			}
			select {
			case views <- v:
			default: // the reader is behind; drop the frame, as the ring does
			}
		}
	})
	wg.Go(func() {
		// The connection goroutine: serialize views, holding the last few so a
		// view outlives several folds.
		var held []*FullView
		for v := range views {
			held = append(held, v)
			if len(held) > 8 {
				held = held[1:]
			}
			for _, h := range held {
				if _, err := json.Marshal(h); err != nil {
					t.Errorf("marshal: %v", err)
					return
				}
			}
		}
	})
	wg.Wait()
}

// stepGame plays one move: the bot's, or the engine's minimal move when the
// bot has none or it is rejected. Reports whether it moved. AutoCommand alone
// never builds, so module state would never change.
func stepGame(t *testing.T, s *engine.State, b CommandSource) bool {
	t.Helper()
	auto, ok := engine.AutoCommand(s)
	if !ok {
		return false
	}
	cmd := auto
	if c, ok := b.Act(s, auto.Player); ok {
		cmd = c
	}
	events, err := engine.Decide(s, cmd)
	if err != nil {
		if events, err = engine.Decide(s, auto); err != nil {
			t.Fatalf("decide %s: %v", auto.Type, err)
		}
	}
	for _, e := range events {
		if err := engine.Apply(s, e); err != nil {
			t.Fatalf("apply %s: %v", e.Type, err)
		}
	}
	return true
}

// freshStateSeed is freshState with the seed opened up, so one ruleset can be
// played several ways.
func freshStateSeed(t *testing.T, ruleset string, seed uint64) *engine.State {
	t.Helper()
	log, err := engine.New(engine.GameConfig{Players: 3, Ruleset: ruleset}, engine.SeedsFrom(seed))
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

func mustJSON(t *testing.T, v any) []byte {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return raw
}
