package engine

import (
	"math/rand/v2"
	"slices"
	"testing"

	"github.com/ftqo/costan.io/engine/board"
)

// Seams added for Harbormaster, tested here against synthetic modules: `engine`
// registers no expansion (see engine/ruletest's package doc), and a seam must hold
// for every module, not just the one that asked for it.

const evSeamMark EventType = "test_seam_mark"

const (
	seamAfterName    = "testseamafter"
	seamEarlyName    = "testseamearly"
	seamAdjustName   = "testseamadjust"
	seamSuppressName = "testseamsuppress"
)

// seamAfter records every batch its AfterEvents phase sees, and emits one event
// the first time it sees a batch in a given phase so the caller can prove the
// hook ran and its event was folded.
type seamAfter struct{ name string }

// seamLog is written by the hooks below. Package-level because the tests
// check the order two different modules ran in.
var seamLog []string

func (m seamAfter) Name() string                                  { return m.name }
func (seamAfter) SetupBoard(*board.Board, GameConfig, *rand.Rand) {}
func (seamAfter) Decide(*State, Command) ([]Event, bool, error)   { return nil, false, nil }
func (seamAfter) Apply(s *State, e Event) (bool, error)           { return e.Type == evSeamMark, nil }
func (m seamAfter) Hooks() Hooks {
	return Hooks{
		OnEvents: func(after *State, _ []Event) []Event {
			seamLog = append(seamLog, m.name+":onevents")
			return nil
		},
		AfterEvents: func(after *State, _ []Event) []Event {
			seamLog = append(seamLog, m.name+":afterevents:"+string(after.Phase))
			return nil
		},
	}
}

// seamEarly sorts after seamAfter: "testseamafter" < "testseamearly", which is
// why the names look backwards (see TestAfterEventsRunsAfterEveryOnEvents).
type seamEarly struct{}

func (seamEarly) Name() string                                    { return seamEarlyName }
func (seamEarly) SetupBoard(*board.Board, GameConfig, *rand.Rand) {}
func (seamEarly) Decide(*State, Command) ([]Event, bool, error)   { return nil, false, nil }
func (seamEarly) Apply(*State, Event) (bool, error)               { return false, nil }
func (seamEarly) Hooks() Hooks {
	return Hooks{
		OnEvents: func(*State, []Event) []Event {
			seamLog = append(seamLog, seamEarlyName+":onevents")
			return nil
		},
	}
}

// seamAdjust adds 2 to the target and nothing else.
type seamAdjust struct{}

func (seamAdjust) Name() string                                    { return seamAdjustName }
func (seamAdjust) SetupBoard(*board.Board, GameConfig, *rand.Rand) {}
func (seamAdjust) Decide(*State, Command) ([]Event, bool, error)   { return nil, false, nil }
func (seamAdjust) Apply(*State, Event) (bool, error)               { return false, nil }
func (seamAdjust) Hooks() Hooks                                    { return Hooks{} }
func (seamAdjust) AdjustTargetVP(GameConfig) int                   { return 2 }

// seamSuppress suppresses whatever vertex the test names.
type seamSuppress struct{}

var seamSuppressed = map[board.Vertex]bool{}

func (seamSuppress) Name() string                                    { return seamSuppressName }
func (seamSuppress) SetupBoard(*board.Board, GameConfig, *rand.Rand) {}
func (seamSuppress) Decide(*State, Command) ([]Event, bool, error)   { return nil, false, nil }
func (seamSuppress) Apply(*State, Event) (bool, error)               { return false, nil }
func (seamSuppress) Hooks() Hooks {
	return Hooks{BuildingVPSuppressed: func(_ *State, v board.Vertex) bool { return seamSuppressed[v] }}
}

func init() {
	RegisterModule(seamAfterName, func() Module { return seamAfter{name: seamAfterName} })
	RegisterModule(seamEarlyName, func() Module { return seamEarly{} })
	RegisterModule(seamAdjustName, func() Module { return seamAdjust{} })
	RegisterModule(seamSuppressName, func() Module { return seamSuppress{} })
}

// TestAfterEventsRunsAfterEveryOnEvents: hooks run in lexicographic name order,
// so a module that must see what every other module did cannot rely on going
// last. "testseamafter" sorts before "testseamearly", yet its AfterEvents must run
// after the latter's OnEvents.
func TestAfterEventsRunsAfterEveryOnEvents(t *testing.T) {
	if seamAfterName >= seamEarlyName {
		t.Fatalf("fixture: %q must sort before %q", seamAfterName, seamEarlyName)
	}
	ruleset := CanonicalRuleset("base+" + seamAfterName + "+" + seamEarlyName)
	s := seamGame(t, ruleset, 60)
	seamLog = nil
	step(t, s, Command{Player: s.Cur, Type: CmdRollDice})

	iAfter := slices.Index(seamLog, seamAfterName+":afterevents:play")
	iEarly := slices.Index(seamLog, seamEarlyName+":onevents")
	if iAfter < 0 || iEarly < 0 {
		t.Fatalf("hooks did not both run: %v", seamLog)
	}
	if iAfter < iEarly {
		t.Errorf("AfterEvents ran at %d, before a later module's OnEvents at %d: %v", iAfter, iEarly, seamLog)
	}
}

// TestOnlyAfterEventsRunsInSetup: AfterEvents runs during the
// draft (a title derived from buildings is already true while they are placed),
// and OnEvents does not (every existing OnEvents assumes no setup).
func TestOnlyAfterEventsRunsInSetup(t *testing.T) {
	events, err := New(GameConfig{Players: 3, Ruleset: "base+" + seamAfterName}, SeedsFrom(61))
	if err != nil {
		t.Fatal(err)
	}
	s := Empty()
	for _, e := range events {
		if err := Apply(s, e); err != nil {
			t.Fatal(err)
		}
	}
	if s.Phase != PhaseSetup {
		t.Fatalf("phase %q, want setup", s.Phase)
	}
	seamLog = nil
	cmd, ok := AutoCommand(s)
	if !ok {
		t.Fatal("setup produced no command")
	}
	step(t, s, cmd)

	if !slices.Contains(seamLog, seamAfterName+":afterevents:setup") {
		t.Errorf("AfterEvents did not run during setup: %v", seamLog)
	}
	if slices.Contains(seamLog, seamAfterName+":onevents") {
		t.Errorf("OnEvents ran during setup: %v", seamLog)
	}
}

// TestTargetVPAdjustmentsCommute: the adjustment is summed
// after every ConfigDefaulter and after the base defaults, so the ruleset
// string's alphabet cannot change the answer and two adjusters stack.
func TestTargetVPAdjustmentsCommute(t *testing.T) {
	for _, tc := range []struct {
		ruleset string
		want    int
	}{
		{"base", 10},
		{"base+" + seamAdjustName, 12},
		{CanonicalRuleset("base+" + seamAdjustName + "+" + seamAfterName), 12},
		{CanonicalRuleset("base+" + seamAfterName + "+" + seamAdjustName), 12},
	} {
		if got := ResolveTargetVP(GameConfig{Players: 3, Ruleset: tc.ruleset}); got != tc.want {
			t.Errorf("ResolveTargetVP(%q) = %d, want %d", tc.ruleset, got, tc.want)
		}
		events, err := New(GameConfig{Players: 3, Ruleset: tc.ruleset}, SeedsFrom(62))
		if err != nil {
			t.Fatal(err)
		}
		if got := decode[GameCreatedData](events[0]).Config.TargetVP; got != tc.want {
			t.Errorf("New(%q) recorded target %d, want %d", tc.ruleset, got, tc.want)
		}
	}
}

// TestNamedTargetSurvivesAdjusters: the adjustment moves the ruleset's
// default. A target the caller named is played as named, so the lobby's request
// is not adjusted twice.
func TestNamedTargetSurvivesAdjusters(t *testing.T) {
	cfg := GameConfig{Players: 3, Ruleset: "base+" + seamAdjustName, TargetVP: 9}
	if got := ResolveTargetVP(cfg); got != 9 {
		t.Errorf("ResolveTargetVP with an explicit 9 = %d, want 9", got)
	}
	events, err := New(cfg, SeedsFrom(63))
	if err != nil {
		t.Fatal(err)
	}
	if got := decode[GameCreatedData](events[0]).Config.TargetVP; got != 9 {
		t.Errorf("New recorded target %d, want the 9 the caller named", got)
	}
}

// TestBuildingVPSuppressedAsksEveryModule: the helper ORs over the active
// modules and is false when none implements the hook.
func TestBuildingVPSuppressedAsksEveryModule(t *testing.T) {
	v := board.Vertex{Q: 1, R: 2, Side: board.N}
	w := board.Vertex{Q: 1, R: 2, Side: board.S}
	seamSuppressed = map[board.Vertex]bool{v: true}
	t.Cleanup(func() { seamSuppressed = map[board.Vertex]bool{} })

	plain := &State{Config: GameConfig{Players: 3, Ruleset: "base"}}
	if plain.BuildingVPSuppressed(v) {
		t.Error("base suppresses a building")
	}
	with := &State{Config: GameConfig{Players: 3, Ruleset: "base+" + seamSuppressName}}
	if !with.BuildingVPSuppressed(v) {
		t.Error("a module that suppresses v was not asked")
	}
	if with.BuildingVPSuppressed(w) {
		t.Error("a vertex the module does not suppress came back suppressed")
	}
}

// seamGame creates a game on the given ruleset and plays it to the first
// actionable turn.
func seamGame(t *testing.T, ruleset string, seed uint64) *State {
	t.Helper()
	events, err := New(GameConfig{Players: 3, Ruleset: ruleset}, SeedsFrom(seed))
	if err != nil {
		t.Fatal(err)
	}
	s := Empty()
	for _, e := range events {
		if err := Apply(s, e); err != nil {
			t.Fatal(err)
		}
	}
	runSetup(t, s)
	return s
}
