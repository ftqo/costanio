package game

import (
	"testing"
	"time"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/engine"
)

// TestStrongBotDelayGatesActionsOnClock repeats TestBotDelayGatesActionsOnClock
// with the production bot (bot.NewStrong) instead of the autoBot stub.
func TestStrongBotDelayGatesActionsOnClock(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})
	for i := range 3 {
		if err := st.SetSeatStatus("g1", i, "bot"); err != nil {
			t.Fatal(err)
		}
	}
	clock := &fakeClock{}
	m := NewManager(st, clock)
	m.SetBotFactory(func(engine.PlayerID) CommandSource { return bot.NewStrong() })
	m.SetBotDelay(500 * time.Millisecond)
	defer m.StopAll()

	a, err := m.Get("g1")
	if err != nil {
		t.Fatal(err)
	}

	// Without a clock tick the game must not advance: each paced bot action
	// waits on the held clock.
	seq0 := actorState(a).NextSeq
	for range 50 {
		if got := actorState(a).NextSeq; got != seq0 {
			t.Fatalf("seq advanced %d -> %d without a clock tick", seq0, got)
		}
	}
}
