package engine

import (
	"math/rand/v2"
	"reflect"
	"testing"

	"github.com/ftqo/costan.io/engine/board"
)

// deciderModule is a stub expansion whose only job is to report whatever
// ModuleDeciders a test asks it to, so the seat→DecisionKind mapping in
// PendingDeciders can be exercised without any real module's rules.
type deciderModule struct{}

// owedDeciders is what deciderModule reports, set by the test that needs it.
// These tests do not call t.Parallel.
var owedDeciders []ModuleDecider

func (deciderModule) Name() string                                              { return "decidermod" }
func (deciderModule) SetupBoard(b *board.Board, cfg GameConfig, rng *rand.Rand) {}
func (deciderModule) Decide(*State, Command) ([]Event, bool, error)             { return nil, false, nil }
func (deciderModule) Apply(*State, Event) (bool, error)                         { return false, nil }
func (deciderModule) Hooks() Hooks {
	return Hooks{
		PendingDeciders: func(*State) []ModuleDecider { return owedDeciders },
	}
}

func init() { RegisterModule("decidermod", func() Module { return deciderModule{} }) }

// PendingDeciders reports all of a seat's module obligations (the game layer
// sizes the budget), once per seat, since the timer layer keys deadlines by
// seat.
func TestPendingDecidersCollectsModuleDecisions(t *testing.T) {
	cases := []struct {
		name string
		owed []ModuleDecider
		want []Decider
	}{
		{
			"one obligation",
			[]ModuleDecider{{Seat: 1, Decision: "aqueduct"}},
			[]Decider{{Seat: 1, Kind: DecisionModule, Decisions: []string{"aqueduct"}}},
		},
		{
			"two obligations on one seat are collected, not deduped to a kind",
			[]ModuleDecider{{Seat: 1, Decision: "wedding_give"}, {Seat: 1, Decision: "aqueduct"}},
			[]Decider{{Seat: 1, Kind: DecisionModule, Decisions: []string{"aqueduct", "wedding_give"}}},
		},
		{
			"sorted by seat, ids sorted within a seat",
			[]ModuleDecider{{Seat: 2, Decision: "spy"}, {Seat: 0, Decision: "gold_pick"}},
			[]Decider{
				{Seat: 0, Kind: DecisionModule, Decisions: []string{"gold_pick"}},
				{Seat: 2, Kind: DecisionModule, Decisions: []string{"spy"}},
			},
		},
		{
			// armTimer compares a seat's decisions with the previous arming, so a
			// duplicate id must not change the decision's identity.
			"duplicate ids are compacted",
			[]ModuleDecider{{Seat: 1, Decision: "aqueduct"}, {Seat: 1, Decision: "aqueduct"}},
			[]Decider{{Seat: 1, Kind: DecisionModule, Decisions: []string{"aqueduct"}}},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			owedDeciders = tc.owed
			defer func() { owedDeciders = nil }()
			s := &State{Phase: PhasePlay, Rolled: true, Config: GameConfig{Ruleset: "base+decidermod"}}
			if got := PendingDeciders(s); !reflect.DeepEqual(got, tc.want) {
				t.Errorf("PendingDeciders = %+v; want %+v", got, tc.want)
			}
		})
	}
}

// TestPendingDecidersEnumeratesAllOwedSeats checks that PendingDeciders lists
// every seat currently owing an action, sorted, with the right kind: one entry
// normally, several in simultaneous phases (discard-on-7).
func TestPendingDecidersEnumeratesAllOwedSeats(t *testing.T) {
	cases := []struct {
		name string
		s    *State
		want []Decider
	}{
		{"finished", &State{Phase: PhaseFinished}, nil},
		{"setup settlement", &State{Phase: PhaseSetup, Cur: 1}, []Decider{{Seat: 1, Kind: DecisionSetup}}},
		// The road half of a setup turn is its own kind, so the timer re-arms on the
		// road's own budget.
		{"setup road", &State{Phase: PhaseSetup, NeedRoad: true, Cur: 1}, []Decider{{Seat: 1, Kind: DecisionSetupRoad}}},
		{"single roll", &State{Phase: PhasePlay, Rolled: false, Cur: 2}, []Decider{{Seat: 2, Kind: DecisionRoll}}},
		{"single main", &State{Phase: PhasePlay, Rolled: true, Cur: 0}, []Decider{{Seat: 0, Kind: DecisionMain}}},
		{"single robber", &State{Phase: PhasePlay, Rolled: true, RobberPending: true, Cur: 3}, []Decider{{Seat: 3, Kind: DecisionRobber}}},
		{"multi discard sorted", &State{Phase: PhasePlay, Rolled: true, PendingDiscards: map[PlayerID]int{2: 4, 0: 3}}, []Decider{{Seat: 0, Kind: DecisionDiscard}, {Seat: 2, Kind: DecisionDiscard}}},
		{"discard before robber", &State{Phase: PhasePlay, Rolled: true, RobberPending: true, PendingDiscards: map[PlayerID]int{1: 2}}, []Decider{{Seat: 1, Kind: DecisionDiscard}}},
	}
	for _, c := range cases {
		if got := PendingDeciders(c.s); !reflect.DeepEqual(got, c.want) {
			t.Errorf("%s: PendingDeciders = %+v, want %+v", c.name, got, c.want)
		}
	}
}

// TestPendingDecisionClassifies checks that PendingDecision reports the kind of
// decision a state owes, with the same branch precedence AutoCommand uses.
func TestPendingDecisionClassifies(t *testing.T) {
	cases := []struct {
		name string
		s    *State
		want DecisionKind
	}{
		{"finished", &State{Phase: PhaseFinished}, DecisionNone},
		{"setup settlement", &State{Phase: PhaseSetup}, DecisionSetup},
		{"setup road", &State{Phase: PhaseSetup, NeedRoad: true}, DecisionSetupRoad},
		{"discard", &State{Phase: PhasePlay, Rolled: true, PendingDiscards: map[PlayerID]int{0: 3}}, DecisionDiscard},
		{"robber", &State{Phase: PhasePlay, Rolled: true, RobberPending: true}, DecisionRobber},
		{"roll", &State{Phase: PhasePlay, Rolled: false}, DecisionRoll},
		{"main", &State{Phase: PhasePlay, Rolled: true}, DecisionMain},
		// Discard takes precedence over a pending robber, as in AutoCommand.
		{"discard before robber", &State{Phase: PhasePlay, Rolled: true, RobberPending: true, PendingDiscards: map[PlayerID]int{1: 2}}, DecisionDiscard},
	}
	for _, c := range cases {
		if got := PendingDecision(c.s); got != c.want {
			t.Errorf("%s: PendingDecision = %v, want %v", c.name, got, c.want)
		}
	}
}

// TestPendingDecisionMatchesAutoCommand: across many auto-driven games, the
// kind PendingDecision reports must agree with the command AutoCommand emits.
func TestPendingDecisionMatchesAutoCommand(t *testing.T) {
	// In a base (module-free) game, AutoCommand's command type fully determines
	// the decision kind.
	want := map[CommandType]DecisionKind{
		CmdPlaceSettlement: DecisionSetup,
		CmdPlaceRoad:       DecisionSetupRoad,
		CmdDiscardCards:    DecisionDiscard,
		CmdMoveRobber:      DecisionRobber,
		CmdRollDice:        DecisionRoll,
		CmdEndTurn:         DecisionMain,
	}
	for seed := range uint64(20) {
		log, err := New(GameConfig{Players: 3}, SeedsFrom(seed))
		if err != nil {
			t.Fatal(err)
		}
		s := Empty()
		for _, e := range log {
			if err := Apply(s, e); err != nil {
				t.Fatal(err)
			}
		}
		for step := 0; s.Phase != PhaseFinished && step < 4000; step++ {
			cmd, ok := AutoCommand(s)
			kind := PendingDecision(s)
			if !ok {
				t.Fatalf("seed %d: AutoCommand gave no command at phase %s", seed, s.Phase)
			}
			if want[cmd.Type] != kind {
				t.Fatalf("seed %d step %d: AutoCommand %s implies %v, PendingDecision = %v",
					seed, step, cmd.Type, want[cmd.Type], kind)
			}
			events, err := Decide(s, cmd)
			if err != nil {
				t.Fatalf("seed %d: decide %s: %v", seed, cmd.Type, err)
			}
			for _, e := range events {
				if err := Apply(s, e); err != nil {
					t.Fatalf("seed %d: apply %s: %v", seed, e.Type, err)
				}
			}
		}
		// Game finished: nothing is owed.
		if _, ok := AutoCommand(s); !ok {
			if k := PendingDecision(s); k != DecisionNone {
				t.Errorf("seed %d: finished game classifies as %v, want DecisionNone", seed, k)
			}
		}
	}
}
