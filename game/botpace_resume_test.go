package game

import (
	"testing"
	"time"

	"github.com/ftqo/costan.io/engine"
)

// After an idle human's turn times out, the actor must keep the game moving
// when the next seats are bots, rather than stalling on the following bot turn.
func TestBotsResumeAfterHumanTimeout(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3, TurnTimerSec: 1})
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

	// The human (seat 0) never acts. Driving the clock fires the human's turn
	// timer (auto-placing for them) and the bots' pacing ticks; the game must
	// advance through the whole setup.
	last := 0
	for range 80 {
		clock.Fire()
		last = actorState(a).NextSeq // syncs through the actor loop
	}
	// A 3-player setup is ~13 events; reaching the play phase means the bots
	// resumed on their own after the human's timeouts.
	if actorState(a).Phase == engine.PhaseSetup {
		t.Fatalf("game still in setup at seq %d after human timeouts", last)
	}
}
