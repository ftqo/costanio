package ruletest

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/islands"
	"github.com/ftqo/costan.io/engine/knights"
)

// Two modules can owe two different seats off one roll: a tied Knights barbarian
// defence owes one seat a defender draw while Islands gold owes another a pick,
// and `cak` sorts before `islands`. AutoCommandFor must not stop at the first
// blocking module that owes the asked-for seat nothing, or that seat freezes.
//
// The invariant (which engine/auto_test.go cannot reach, since that package
// cannot import modules):
//
//	every seat engine.PendingDeciders names must have an AutoCommandFor,
//	and that command must be one engine.Decide accepts.
//
// The premise, that the runs reach a state where two modules owe two different
// seats, is asserted at the end so drift cannot reduce this to the single-module
// case.
func TestAutoServesEveryOwedSeatAcrossModules(t *testing.T) {
	const ruleset = "base+cak+islands"
	twoModuleSteps := 0
	for seed := range uint64(40) {
		log, err := engine.New(engine.GameConfig{Players: 4, Ruleset: ruleset}, engine.SeedsFrom(seed))
		if err != nil {
			t.Fatal(err)
		}
		s := engine.Empty()
		for _, e := range log {
			if err := engine.Apply(s, e); err != nil {
				t.Fatal(err)
			}
		}
		for step := 0; s.Phase != engine.PhaseFinished && step < 6000; step++ {
			ds := engine.PendingDeciders(s)
			if len(ds) == 0 {
				t.Fatalf("seed %d step %d: no seat owes anything at phase %s", seed, step, s.Phase)
			}
			if owedByTwoModules(s) {
				twoModuleSteps++
			}
			for _, d := range ds {
				cmd, ok := engine.AutoCommandFor(s, d.Seat)
				if !ok {
					t.Fatalf("seed %d step %d: seat %d is owed %v but AutoCommandFor refuses it (frozen seat)",
						seed, step, d.Seat, d.Decisions)
				}
				if _, err := engine.Decide(s, cmd); err != nil {
					t.Fatalf("seed %d step %d: AutoCommandFor(seat %d) produced %s, which Decide rejects: %v",
						seed, step, d.Seat, cmd.Type, err)
				}
			}
			cmd, ok := engine.AutoCommand(s)
			if !ok {
				t.Fatalf("seed %d step %d: AutoCommand gave nothing while %d seat(s) are owed", seed, step, len(ds))
			}
			events, err := engine.Decide(s, cmd)
			if err != nil {
				t.Fatalf("seed %d step %d: decide %s: %v", seed, step, cmd.Type, err)
			}
			for _, e := range events {
				if err := engine.Apply(s, e); err != nil {
					t.Fatalf("seed %d: apply %s: %v", seed, e.Type, err)
				}
			}
		}
	}
	t.Logf("observed %d states with two modules owing different seats", twoModuleSteps)
}

// TestAutoServesSeatsOwedByTwoModules builds that shape
// directly, since auto-driven play never buys a city and so never reaches a tied
// barbarian attack with gold outstanding. The premise is asserted from the
// modules' own PendingDeciders hooks, so the test cannot pass vacuously.
func TestAutoServesSeatsOwedByTwoModules(t *testing.T) {
	s := playState(t, "base+cak+islands", 4)

	// islands creates its ext lazily, so a state just out of setup may not
	// have one; stand in an empty value.
	ix, ok := s.Ext[islands.Name].(*islands.Ext)
	if !ok {
		ix = &islands.Ext{
			Ships:       map[board.Edge]engine.PlayerID{},
			BuiltTurn:   map[board.Edge]bool{},
			PendingGold: map[engine.PlayerID]int{},
			Reached:     map[engine.PlayerID]map[int]bool{},
			IslandVP:    map[engine.PlayerID]int{},
		}
		for range s.Players {
			ix.ShipsLeft = append(ix.ShipsLeft, islands.MaxShips)
		}
		if s.Ext == nil {
			s.Ext = map[string]engine.Extension{}
		}
		s.Ext[islands.Name] = ix
	}
	cx, ok := s.Ext[knights.Name].(*knights.Ext)
	if !ok {
		t.Fatal("cak ext missing from a base+cak+islands state")
	}
	// One roll, two modules, two seats: seat 1 owes a gold pick, seat 3 owes the
	// defender draw of a tied barbarian defence.
	ix.PendingGold[1] = 1
	cx.DefenderDraws = []engine.PlayerID{3}

	ds := engine.PendingDeciders(s)
	seats := map[engine.PlayerID]bool{}
	for _, d := range ds {
		seats[d.Seat] = true
	}
	if !seats[1] || !seats[3] {
		t.Fatalf("premise not reached: PendingDeciders = %+v, want seats 1 and 3 both owed", ds)
	}
	if !owedByTwoModules(s) {
		t.Fatal("premise not reached: the two obligations are not held by two different modules")
	}
	// `cak` sorts before `islands`, blocks, and owes seat 1 nothing; seat 1
	// must still be served.
	for _, seat := range []engine.PlayerID{1, 3} {
		cmd, ok := engine.AutoCommandFor(s, seat)
		if !ok {
			t.Fatalf("seat %d is owed an action but AutoCommandFor refuses it", seat)
		}
		if cmd.Player != seat {
			t.Fatalf("AutoCommandFor(seat %d) returned a command for seat %d", seat, cmd.Player)
		}
		if _, err := engine.Decide(s, cmd); err != nil {
			t.Fatalf("AutoCommandFor(seat %d) produced %s, which Decide rejects: %v", seat, cmd.Type, err)
		}
	}
}

// playState returns a fresh game of the given ruleset driven with AutoCommand
// until it is out of setup and into normal play.
func playState(t *testing.T, ruleset string, players int) *engine.State {
	t.Helper()
	log, err := engine.New(engine.GameConfig{Players: players, Ruleset: ruleset}, engine.SeedsFrom(7))
	if err != nil {
		t.Fatal(err)
	}
	s := engine.Empty()
	for _, e := range log {
		if err := engine.Apply(s, e); err != nil {
			t.Fatal(err)
		}
	}
	for step := 0; s.Phase == engine.PhaseSetup && step < 200; step++ {
		cmd, ok := engine.AutoCommand(s)
		if !ok {
			t.Fatal("setup owes nothing")
		}
		events, err := engine.Decide(s, cmd)
		if err != nil {
			t.Fatalf("setup decide %s: %v", cmd.Type, err)
		}
		for _, e := range events {
			if err := engine.Apply(s, e); err != nil {
				t.Fatal(err)
			}
		}
	}
	if s.Phase != engine.PhasePlay {
		t.Fatalf("game is in phase %s, want play", s.Phase)
	}
	return s
}

// owedByTwoModules reports whether two different modules are each awaiting input
// right now, from different seats.
func owedByTwoModules(s *engine.State) bool {
	var seen []engine.PlayerID
	modules := 0
	for _, m := range s.Modules() {
		h := m.Hooks()
		if h.PendingDeciders == nil {
			continue
		}
		mds := h.PendingDeciders(s)
		if len(mds) == 0 {
			continue
		}
		modules++
		for _, md := range mds {
			seen = append(seen, md.Seat)
		}
	}
	if modules < 2 {
		return false
	}
	for _, a := range seen {
		for _, b := range seen {
			if a != b {
				return true
			}
		}
	}
	return false
}

// The defender draws of a tied barbarian defence are a queue: cak accepts only
// the seat at the front and owes only that seat. Whatever AutoCommandFor hands a
// seat must be legal for that seat, so a bot second in the queue must not be
// handed a defender_draw that Decide then rejects.
func TestAutoCommandForDefenderQueue(t *testing.T) {
	s := playState(t, "base+cak", 4)
	cx, ok := s.Ext[knights.Name].(*knights.Ext)
	if !ok {
		t.Fatal("cak ext missing from a base+cak state")
	}
	cx.DefenderDraws = []engine.PlayerID{2, 3}

	// Only the front of the queue is owed anything...
	for _, d := range engine.PendingDeciders(s) {
		if d.Seat == 3 {
			t.Fatalf("seat 3 is second in the defender queue but PendingDeciders owes it %v", d.Decisions)
		}
	}
	// ...so nothing may be handed to the seat behind it.
	if cmd, ok := engine.AutoCommandFor(s, 3); ok {
		if _, err := engine.Decide(s, cmd); err != nil {
			t.Fatalf("AutoCommandFor(seat 3) produced %s ahead of seat 2, Decide rejects it: %v",
				cmd.Type, err)
		}
	}
	cmd, ok := engine.AutoCommandFor(s, 2)
	if !ok {
		t.Fatal("seat 2 is at the front of the defender queue but AutoCommandFor refuses it")
	}
	if _, err := engine.Decide(s, cmd); err != nil {
		t.Fatalf("AutoCommandFor(seat 2) produced %s, which Decide rejects: %v", cmd.Type, err)
	}
}
