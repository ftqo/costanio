package game

import (
	"testing"
	"time"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/engine"
)

// Bot pacing applies before a bot acts: a bot that becomes the seat to act
// waits out its delay first, so a watching human sees it think, then act.
//
// All seats are bots and TurnTimerSec is 0, so the only clock timer is the
// pacing tick. A bot owes the opening placement, so the seq must stay put
// until the timer fires.
func TestBotPausesBeforeFirstAction(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3, TurnTimerSec: 0})
	for _, seat := range []int{0, 1, 2} {
		if err := st.SetSeatStatus("g1", seat, "bot"); err != nil {
			t.Fatal(err)
		}
	}
	seededSeq := mirrorState(t, st, "g1").NextSeq

	clock := &fakeClock{}
	m := NewManager(st, clock)
	m.SetBotFactory(func(engine.PlayerID) CommandSource { return bot.NewStrong() })
	m.SetBotDelay(time.Second)
	defer m.StopAll()

	a, err := m.Get("g1")
	if err != nil {
		t.Fatal(err)
	}

	// The bot owes the opening placement but has not acted: the seq is where
	// the seeded log left it.
	if got := actorState(a).NextSeq; got != seededSeq {
		t.Fatalf("bot acted before its pacing delay fired: seq advanced from %d to %d", seededSeq, got)
	}

	// Firing the armed pacing timer releases exactly one bot action.
	clock.Fire()
	if got := actorState(a).NextSeq; got <= seededSeq {
		t.Fatalf("bot did not act after its pacing delay fired: seq still %d", got)
	}
}
