package engine

import (
	"bytes"
	"encoding/gob"
	"encoding/json"
	"errors"
	"math/rand/v2"
	"strings"
	"testing"

	"github.com/ftqo/costan.io/engine/board"
)

// testModule is a synthetic expansion exercising every Module seam: a custom
// command/event pair, extension state, dice hooks, and victory points.
type testModule struct{}

type testExt struct {
	Tributes int // paid via the "tribute" command
	Rolls    int // counted via OnDiceRolled
}

func (e *testExt) CloneExt() Extension {
	c := *e
	return &c
}

const (
	cmdTribute CommandType = "test_tribute"
	evTribute  EventType   = "test_tribute_paid"
	evRollSeen EventType   = "test_roll_seen"
)

func (testModule) Name() string                                              { return "testmod" }
func (testModule) SetupBoard(b *board.Board, cfg GameConfig, rng *rand.Rand) {}

func (testModule) Decide(s *State, cmd Command) ([]Event, bool, error) {
	if cmd.Type != cmdTribute {
		return nil, false, nil
	}
	if err := requireActionableTurn(s, cmd.Player); err != nil {
		return nil, true, err
	}
	if s.Players[cmd.Player].Hand[board.Wood] < 1 {
		return nil, true, ErrNoResources
	}
	return []Event{mustEvent(evTribute, DevPlayedData{Player: cmd.Player})}, true, nil
}

func (testModule) Apply(s *State, e Event) (bool, error) {
	ext, _ := s.Ext["testmod"].(*testExt)
	if ext == nil {
		ext = &testExt{}
		s.Ext["testmod"] = ext
	}
	switch e.Type {
	case evTribute:
		d := decode[DevPlayedData](e)
		var cost Hand
		cost[board.Wood] = 1
		s.Players[d.Player].Hand.Sub(cost)
		s.Bank.Add(cost)
		ext.Tributes++
		return true, nil
	case evRollSeen:
		ext.Rolls++
		return true, nil
	default: // other event types intentionally unhandled by this test module
	}
	return false, nil
}

func (testModule) Hooks() Hooks {
	return Hooks{
		OnDiceRolled: func(s *State, d1, d2 int) []Event {
			return []Event{mustEvent(evRollSeen, struct{}{})}
		},
		VictoryCheck: func(s *State, p PlayerID) int {
			if ext, ok := s.Ext["testmod"].(*testExt); ok {
				return ext.Tributes // 1 VP per tribute paid (by anyone; fine for tests)
			}
			return 0
		},
	}
}

func init() {
	RegisterModule("testmod", func() Module { return testModule{} })
	gob.Register(&testExt{})
}

func TestRulesetParsing(t *testing.T) {
	for _, ok := range []string{"base", "base+testmod", "testmod"} {
		if !ValidRuleset(ok) {
			t.Errorf("ruleset %q should be valid", ok)
		}
	}
	if ValidRuleset("base+nope") {
		t.Error("unknown module should invalidate the ruleset")
	}
	if _, err := New(GameConfig{Players: 3, Ruleset: "base+nope"}, SeedsFrom(1)); err == nil {
		t.Error("New should reject unknown modules")
	}
}

func newModGame(t *testing.T, seed uint64) *State {
	t.Helper()
	events, err := New(GameConfig{Players: 3, Ruleset: "base+testmod"}, SeedsFrom(seed))
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
	step(t, s, Command{Player: 0, Type: CmdRollDice})
	settleRoll(t, s, nil)
	return s
}

func TestModuleHookAndCommandDispatch(t *testing.T) {
	s := newModGame(t, 50)

	// The roll hook fired and folded into module state.
	ext := s.Ext["testmod"].(*testExt)
	if ext.Rolls != 1 {
		t.Errorf("rolls seen = %d, want 1", ext.Rolls)
	}

	// Module command path: rejected without funds, then applied.
	s.Players[0].Hand = Hand{}
	if _, err := Decide(s, Command{Player: 0, Type: cmdTribute}); !errors.Is(err, ErrNoResources) {
		t.Errorf("poor tribute err = %v", err)
	}
	s.Players[0].Hand = Hand{board.Wood: 1}
	step(t, s, Command{Player: 0, Type: cmdTribute})
	if ext.Tributes != 1 || s.Players[0].Hand[board.Wood] != 0 {
		t.Errorf("tribute not applied: %+v hand %v", ext, s.Players[0].Hand)
	}

	// Unknown commands still error.
	if _, err := Decide(s, Command{Player: 0, Type: "nonsense"}); !errors.Is(err, ErrUnknownCommand) {
		t.Errorf("unknown cmd err = %v", err)
	}
}

func TestModuleVictoryHook(t *testing.T) {
	s := newModGame(t, 51)
	s.Config.TargetVP = s.PublicVP(0) + 1 // one tribute from winning
	s.Players[0].Hand = Hand{board.Wood: 1}

	events := step(t, s, Command{Player: 0, Type: cmdTribute})
	if events[len(events)-1].Type != EvGameFinished {
		t.Fatalf("expected module VP win, got %+v", events)
	}
	if s.Winner != 0 {
		t.Errorf("winner = %d", s.Winner)
	}
}

func TestModuleExtCloneAndReplay(t *testing.T) {
	s := newModGame(t, 52)
	s.Players[0].Hand = Hand{board.Wood: 1}
	step(t, s, Command{Player: 0, Type: cmdTribute})

	// Clone must deep-copy extension state.
	c := s.Clone()
	c.Ext["testmod"].(*testExt).Tributes = 99
	if s.Ext["testmod"].(*testExt).Tributes == 99 {
		t.Error("Clone shares extension state")
	}

	// Gob round-trip (the snapshot path) preserves Ext.
	var buf bytes.Buffer
	if err := gob.NewEncoder(&buf).Encode(s); err != nil {
		t.Fatalf("gob encode: %v", err)
	}
	restored := Empty()
	if err := gob.NewDecoder(bytes.NewReader(buf.Bytes())).Decode(restored); err != nil {
		t.Fatalf("gob decode: %v", err)
	}
	if restored.Ext["testmod"].(*testExt).Tributes != 1 {
		t.Errorf("ext after gob = %+v", restored.Ext["testmod"])
	}
}

// A ruleset string can arrive off the wire in an uploaded event log (POST
// /api/replay/frames). Repeated or empty parts must be refused: each resolved
// string claims a permanent entry in the process-global moduleCache, so the
// accepted set must be finite.
func TestRulesetRefusesRepeatedAndEmptyParts(t *testing.T) {
	for _, bad := range []string{
		"base+testmod+testmod",
		"testmod+testmod",
		"base+base",
		"base++testmod",
		"base+testmod+",
		"+base+testmod",
	} {
		if ValidRuleset(bad) {
			t.Errorf("ruleset %q resolves, want refused", bad)
		}
	}
	// The spellings a real game can be stored under still resolve, order
	// included: a game played under a non-canonical order keeps resolving in
	// that order (see CanonicalRuleset).
	for _, ok := range []string{"", "base", "testmod", "base+testmod"} {
		if !ValidRuleset(ok) {
			t.Errorf("ruleset %q should still resolve", ok)
		}
	}
}

// A resolved ruleset is cached for the life of the process, so a hostile string
// must never reach the cache. 200000 repetitions of "+testmod" is an 800 KB
// body, and the refusal must come at the second part, before anything is
// cached.
func TestHostileRulesetNotCached(t *testing.T) {
	count := func() int {
		n := 0
		moduleCache.Range(func(_, _ any) bool { n++; return true })
		return n
	}
	before := count()

	hostile := "base" + strings.Repeat("+testmod", 200000)
	s := &State{Config: GameConfig{Ruleset: hostile}}
	func() {
		defer func() {
			if recover() == nil {
				t.Error("Modules resolved a ruleset with 200000 repeated parts")
			}
		}()
		s.Modules()
	}()

	if got := count(); got != before {
		t.Errorf("module cache grew from %d to %d entries on an invalid ruleset", before, got)
	}
	// The panic message is written into an HTTP response by the endpoint that
	// recovers it, so it must not carry the ruleset back at its author.
	if got := clipRuleset(hostile); len(got) > 128 {
		t.Errorf("clipped ruleset is %d bytes, want <= 128", len(got))
	}
}

// An event log may not be one this server wrote, and its opening config sizes
// the state that follows, so Apply bounds it. The case is `players: 1e8` (a
// 110-byte body asking for 16 GB of PlayerState); the test asserts the
// rejection without allocating.
func TestApplyRefusesImpossibleConfig(t *testing.T) {
	for _, tc := range []struct {
		name string
		data string
	}{
		{"more seats than a game has", `{"config":{"players":100}}`},
		{"no seats at all", `{"config":{"players":0}}`},
		{"a negative seat count", `{"config":{"players":-1}}`},
		{"a board wider than any board", `{"config":{"players":2,"board":{"radius":100,"tiles":[]}}}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := Empty()
			err := Apply(s, Event{Seq: 0, Type: EvGameCreated, Data: json.RawMessage(tc.data)})
			if err == nil {
				t.Fatalf("Apply accepted %s", tc.data)
			}
			if len(s.Players) != 0 {
				t.Errorf("Apply sized %d seats before refusing", len(s.Players))
			}
		})
	}
	// The dealt board arrives in its own event, and is held to the same ceiling.
	s := Empty()
	if err := Apply(s, Event{Seq: 0, Type: EvGameCreated, Data: json.RawMessage(`{"config":{"players":2}}`)}); err != nil {
		t.Fatalf("a plain two-player creation must still fold: %v", err)
	}
	if err := Apply(s, Event{Seq: 1, Type: EvBoardGenerated, Data: json.RawMessage(`{"board":{"radius":100,"tiles":[]}}`)}); err == nil {
		t.Error("Apply dealt a board at radius 100")
	}
}
