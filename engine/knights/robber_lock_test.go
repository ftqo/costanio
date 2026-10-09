package knights

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
)

// rollSeven forces the active player's roll to total 7 through the Alchemist
// fixed-dice channel and applies the decision events.
func rollSeven(t *testing.T, s *engine.State) {
	t.Helper()
	ext(s).AlchemistD1, ext(s).AlchemistD2 = 3, 4 // fixed 7 via the FixedDice hook
	evs, err := engine.Decide(s, engine.Command{Type: engine.CmdRollDice, Player: s.Cur})
	if err != nil {
		t.Fatalf("roll: %v", err)
	}
	for _, e := range evs {
		e.Seq = s.NextSeq
		if err := engine.Apply(s, e); err != nil {
			t.Fatalf("apply %s: %v", e.Type, err)
		}
	}
}

// TestRobberLockedBeforeFirstAttack: before any barbarian attack (Attacks==0) a
// 7 must not make the robber pending (discards still happen via the base).
func TestRobberLockedBeforeFirstAttack(t *testing.T) {
	s, _ := newGame(t, 3, nil)
	if ext(s).Attacks != 0 {
		t.Fatalf("precondition: Attacks=%d want 0", ext(s).Attacks)
	}
	rollSeven(t, s)
	if s.RobberPending {
		t.Error("robber pending on a 7 before the first barbarian attack; must be suppressed")
	}
}

// TestRobberActiveAfterFirstAttack: once an attack has happened, a 7 moves the
// robber as normal.
func TestRobberActiveAfterFirstAttack(t *testing.T) {
	s, _ := newGame(t, 3, nil)
	ext(s).Attacks = 1 // simulate one completed barbarian attack
	rollSeven(t, s)
	if !s.RobberPending {
		t.Error("robber not pending on a 7 after the first attack; should be active")
	}
}

// decideSeven forces a 7 and returns the events without applying them, so a
// test can check what the roll announced.
func decideSeven(t *testing.T, s *engine.State) []engine.Event {
	t.Helper()
	ext(s).AlchemistD1, ext(s).AlchemistD2 = 3, 4
	evs, err := engine.Decide(s, engine.Command{Type: engine.CmdRollDice, Player: s.Cur})
	if err != nil {
		t.Fatalf("roll: %v", err)
	}
	return evs
}

func hasEvent(evs []engine.Event, want engine.EventType) bool {
	for _, e := range evs {
		if e.Type == want {
			return true
		}
	}
	return false
}

// TestRobberIdleAnnounced: a 7 that leaves the robber standing says so.
func TestRobberIdleAnnounced(t *testing.T) {
	s, _ := newGame(t, 3, nil)
	if !hasEvent(decideSeven(t, s), EvRobberIdle) {
		t.Error("no EvRobberIdle on a 7 before the first barbarian attack")
	}
}

// TestRobberIdleNotAnnouncedOnceInPlay: once the robber is live a 7 moves it,
// so the announcement would be wrong.
func TestRobberIdleNotAnnouncedOnceInPlay(t *testing.T) {
	s, _ := newGame(t, 3, nil)
	ext(s).Attacks = 1
	if hasEvent(decideSeven(t, s), EvRobberIdle) {
		t.Error("EvRobberIdle on a 7 after the first attack; the robber does move")
	}
}

// TestRobberIdleOnlyOnSeven: it is the 7 that is being explained, not the roll.
func TestRobberIdleOnlyOnSeven(t *testing.T) {
	s, _ := newGame(t, 3, nil)
	ext(s).AlchemistD1, ext(s).AlchemistD2 = 3, 5 // an 8
	evs, err := engine.Decide(s, engine.Command{Type: engine.CmdRollDice, Player: s.Cur})
	if err != nil {
		t.Fatalf("roll: %v", err)
	}
	if hasEvent(evs, EvRobberIdle) {
		t.Error("EvRobberIdle on a roll that was never going to move the robber")
	}
}
