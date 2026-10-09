package game

import (
	"testing"
	"time"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/engine"
)

// A human (seat 0) plus two bots (seats 1, 2). TurnTimerSec 0 means no turn
// timer arms, so the only clock timers are the pacing ticks: each tick must
// release exactly one bot action, never a whole turn.
func TestMixedGameBotsArePaced(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3, TurnTimerSec: 0})
	for _, seat := range []int{1, 2} {
		if err := st.SetSeatStatus("g1", seat, "bot"); err != nil {
			t.Fatal(err)
		}
	}
	clock := &fakeClock{}
	m := NewManager(st, clock)
	m.SetBotFactory(func(engine.PlayerID) CommandSource { return bot.NewStrong() })
	m.SetBotDelay(time.Second)
	defer m.StopAll()

	a, err := m.Get("g1")
	if err != nil {
		t.Fatal(err)
	}

	for range 400 {
		s := actorState(a)
		if s.Phase == engine.PhaseFinished {
			return
		}
		decider, owes := nextToAct(s)
		if !owes {
			return
		}
		if decider == 0 {
			// Human seat: make the minimal legal move ourselves.
			cmd, ok := engine.AutoCommand(s)
			if !ok {
				return
			}
			_ = a.Do(cmd)
			continue
		}
		// A bot owes the next action. Exactly one clock tick should let exactly
		// one bot action through; a big jump means the bot burst its whole turn.
		before := actorState(a).NextSeq
		clock.Fire()
		after := actorState(a).NextSeq
		if after-before > 6 {
			t.Fatalf("one clock tick advanced seq by %d (bot seat %d)", after-before, decider)
		}
	}
}
