package game

import (
	"reflect"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/explorers"
	"github.com/ftqo/costan.io/engine/wagons"
)

// TestLegalViewCarriesEveryEngineList: every list engine.LegalTargets can hand
// a seat must have a LegalView field, checked by name. A missing one leaves the
// client's control dark (WagonSteps, BarbarianEdges, Harbours and
// ExplorerShips were each missing at some point; see also
// views_barbarian_test.go).
func TestLegalViewCarriesEveryEngineList(t *testing.T) {
	lv := reflect.TypeFor[LegalView]()
	lt := reflect.TypeFor[engine.LegalTargets]()
	for f := range lt.Fields() {
		got, ok := lv.FieldByName(f.Name)
		if !ok {
			t.Errorf("engine.LegalTargets.%s never reaches the wire: LegalView has no such field", f.Name)
			continue
		}
		if got.Type != f.Type {
			t.Errorf("LegalView.%s is %s, engine.LegalTargets.%s is %s", f.Name, got.Type, f.Name, f.Type)
		}
	}
}

// playUntil advances a game with the engine's auto-commands until ok accepts
// the state, and fails if it never does (a skip would hide a dead test).
//
// nudge, when set, is tried before each auto-command: the auto-player takes
// the shortest path through a turn and never enters some states a person
// reaches every turn (Explorers' sailing phase).
func playUntil(t *testing.T, cfg engine.GameConfig, seed uint64, budget int, ok func(*engine.State) bool, nudge func(*engine.State) (engine.Command, bool)) *engine.State {
	t.Helper()
	evs, err := engine.New(cfg, engine.SeedsFrom(seed))
	if err != nil {
		t.Fatal(err)
	}
	s, err := engine.Replay(evs)
	if err != nil {
		t.Fatal(err)
	}
	for range budget {
		if ok(s) {
			return s
		}
		if nudge != nil {
			if cmd, try := nudge(s); try {
				if out, err := engine.Decide(s, cmd); err == nil {
					for _, e := range out {
						if err := engine.Apply(s, e); err != nil {
							t.Fatal(err)
						}
					}
					continue
				}
			}
		}
		cmd, more := engine.AutoCommand(s)
		if !more {
			break
		}
		out, err := engine.Decide(s, cmd)
		if err != nil {
			t.Fatalf("%s: %v", cmd.Type, err)
		}
		for _, e := range out {
			if err := engine.Apply(s, e); err != nil {
				t.Fatal(err)
			}
		}
	}
	t.Fatalf("%s: never reached the wanted state in %d commands", cfg.Ruleset, budget)
	return nil
}

// TestFullViewCarriesWagonSteps is the behavioural half for Wagons: at the
// first moment the engine offers the active wagon a step, the active seat's own
// view must offer the same steps.
func TestFullViewCarriesWagonSteps(t *testing.T) {
	s := playUntil(t, engine.GameConfig{Players: 4, Ruleset: "base+" + wagons.WagonsName}, 11, 4000,
		func(s *engine.State) bool {
			return s.Phase == engine.PhasePlay && len(s.LegalTargetsFor(s.Cur).WagonSteps) > 0
		}, nil)
	want := len(s.LegalTargetsFor(s.Cur).WagonSteps)
	v := NewFullView(s, s.Cur)
	if v.Legal == nil || len(v.Legal.WagonSteps) != want {
		got := 0
		if v.Legal != nil {
			got = len(v.Legal.WagonSteps)
		}
		t.Fatalf("view offers %d wagon steps, engine offers %d", got, want)
	}
}

// TestFullViewCarriesExplorerShips is the same for Explorers: a seat whose
// ships the engine will move must be able to see where.
func TestFullViewCarriesExplorerShips(t *testing.T) {
	s := playUntil(t, engine.GameConfig{
		Players: 4, Ruleset: explorers.Name, DiceMode: engine.DiceFair, BoardMode: board.BoardFair,
	}, 3, 4000, func(s *engine.State) bool {
		return s.Phase == engine.PhasePlay && len(s.LegalTargetsFor(s.Cur).ExplorerShips) > 0
	}, func(s *engine.State) (engine.Command, bool) {
		// Sail as a player does after building; the auto-player ends the turn
		// from the action phase and never opens the movement one.
		return engine.Command{Type: explorers.CmdEnterMovement, Player: s.Cur}, s.Phase == engine.PhasePlay && s.Rolled
	})
	want := len(s.LegalTargetsFor(s.Cur).ExplorerShips)
	v := NewFullView(s, s.Cur)
	if v.Legal == nil || len(v.Legal.ExplorerShips) != want {
		got := 0
		if v.Legal != nil {
			got = len(v.Legal.ExplorerShips)
		}
		t.Fatalf("view offers %d explorer ships, engine offers %d: no ship can be sailed by hand", got, want)
	}
}
