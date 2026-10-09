package rivers

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
	_ "github.com/ftqo/costan.io/engine/islands"
	_ "github.com/ftqo/costan.io/engine/knights"
	_ "github.com/ftqo/costan.io/engine/scenarios"
)

// Tests here construct the state they need or assert a property over real
// boards; none hunts for a seed, so none can silently stop running when board
// generation changes.

// newGame deals a game and folds its opening log, leaving it in setup.
func newGame(t *testing.T, ruleset string, players int, seed uint64) (*engine.State, []engine.Event) {
	t.Helper()
	log, err := engine.New(engine.GameConfig{Players: players, Ruleset: engine.CanonicalRuleset(ruleset)}, engine.SeedsFrom(seed))
	if err != nil {
		t.Fatalf("%s %dp seed %d: %v", ruleset, players, seed, err)
	}
	s := engine.Empty()
	for _, e := range log {
		if err := engine.Apply(s, e); err != nil {
			t.Fatalf("%s %dp seed %d: apply: %v", ruleset, players, seed, err)
		}
	}
	return s, log
}

// playState deals a game, walks its setup with the auto-mover and leaves it on
// the first player's turn with the dice rolled. A roll that owes an interrupt is
// resolved rather than skipped.
func playState(t *testing.T, ruleset string, players int, seed uint64) *engine.State {
	t.Helper()
	s, _ := newGame(t, ruleset, players, seed)
	for s.Phase == engine.PhaseSetup {
		cmd, ok := engine.AutoCommand(s)
		if !ok {
			t.Fatalf("%s %dp seed %d: setup stuck", ruleset, players, seed)
		}
		step(t, s, cmd)
	}
	return s
}

func step(t *testing.T, s *engine.State, cmd engine.Command) []engine.Event {
	t.Helper()
	evs, err := engine.Decide(s, cmd)
	if err != nil {
		t.Fatalf("%v: %v", cmd.Type, err)
	}
	for _, e := range evs {
		if err := engine.Apply(s, e); err != nil {
			t.Fatalf("apply %v: %v", e.Type, err)
		}
	}
	return evs
}

// boards deals one board per (players, seed) and hands it to fn, so a property
// is asserted over a spread of real layouts.
func boards(t *testing.T, ruleset string, seeds int, fn func(t *testing.T, s *engine.State, x *Ext)) {
	t.Helper()
	// Not 10: board.RadiusFor gives 8 and 10 the same radius, and the
	// derivation depends only on the board, so a 10-seat pass would double the
	// slowest part of the package's tests and cover nothing new.
	for _, players := range []int{2, 4, 6, 8} {
		for seed := range uint64(seeds) {
			s, _ := newGame(t, ruleset, players, seed)
			x, ok := StateExt(s)
			if !ok {
				t.Fatalf("%s %dp seed %d: no rivers ext on a rivers board", ruleset, players, seed)
			}
			fn(t, s, x)
		}
	}
}

// boardsWithSeeds is boards, handing the callback the seat count and seed too.
func boardsWithSeeds(t *testing.T, ruleset string, seeds int, fn func(t *testing.T, s *engine.State, x *Ext, players int, seed uint64)) {
	t.Helper()
	for _, players := range []int{2, 4, 6, 8} {
		for seed := range uint64(seeds) {
			s, _ := newGame(t, ruleset, players, seed)
			x, ok := StateExt(s)
			if !ok {
				t.Fatalf("%s %dp seed %d: no rivers ext on a rivers board", ruleset, players, seed)
			}
			fn(t, s, x, players, seed)
		}
	}
}
