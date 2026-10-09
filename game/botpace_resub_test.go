package game

import (
	"testing"
	"time"

	"github.com/ftqo/costan.io/engine"
)

// A connected client re-subscribes on every event, each time lifting
// auto-pass on its own seat. That no-op must not re-run auto/bot play, or each
// re-subscribe would drive another bot action past its pacing.
func TestClientResubDoesNotBurstBots(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3, TurnTimerSec: 0})
	for _, seat := range []int{1, 2} {
		if err := st.SetSeatStatus("g1", seat, "bot"); err != nil {
			t.Fatal(err)
		}
	}
	clock := &fakeClock{}
	m := NewManager(st, clock)
	m.SetBotFactory(func(engine.PlayerID) CommandSource { return autoBot{} })
	m.SetBotDelay(time.Second)
	defer m.StopAll()

	a, err := m.Get("g1")
	if err != nil {
		t.Fatal(err)
	}

	// Drive the human (seat 0) through its setup so a bot is next to act.
	for {
		s := actorState(a)
		decider, owes := nextToAct(s)
		if !owes {
			t.Fatal("game ended during setup")
		}
		if decider != 0 {
			break // a bot is up; the human's last move already paced one bot action
		}
		cmd, ok := engine.AutoCommand(s)
		if !ok || cmd.Player != 0 {
			t.Fatal("no human setup move available")
		}
		if err := a.Do(cmd); err != nil {
			t.Fatalf("human setup move: %v", err)
		}
	}

	paced := actorState(a).NextSeq
	// Simulate repeated re-subscribes (lifting auto on the present human seat).
	// None may advance the game; the bots wait for their pacing tick.
	for range 40 {
		a.SetSeatAuto(0, false)
	}
	if got := actorState(a).NextSeq; got != paced {
		t.Fatalf("re-subscribes advanced seq %d -> %d with no clock tick", paced, got)
	}

	// The bots still advance when the pacing tick actually fires.
	clock.Fire()
	advanced := false
	for i := 0; i < 2000 && !advanced; i++ {
		advanced = actorState(a).NextSeq > paced
	}
	if !advanced {
		t.Fatal("bots did not resume on the clock tick")
	}
}
