package game

import (
	"sync"
	"testing"

	"github.com/ftqo/costan.io/engine"
)

func seatIsBot(a *Actor, seat engine.PlayerID) bool {
	var b bool
	a.call(func() { _, b = a.botSeats[seat] })
	return b
}

// loadForfeitActor seeds a 3-player active game and loads an actor wired with a
// bot factory and a forfeit recorder.
func loadForfeitActor(t *testing.T) (*Actor, *[]engine.PlayerID, *sync.Mutex) {
	t.Helper()
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})
	var mu sync.Mutex
	var forfeited []engine.PlayerID
	a, err := Load("g1", st, Options{
		Clock:  &fakeClock{},
		Bots:   func(engine.PlayerID) CommandSource { return autoBot{} },
		Humans: []engine.PlayerID{0, 1, 2},
		OnForfeit: func(seat engine.PlayerID) {
			mu.Lock()
			forfeited = append(forfeited, seat)
			mu.Unlock()
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(a.Stop)
	return a, &forfeited, &mu
}

func TestDisconnectEscalatesAfterFullRound(t *testing.T) {
	a, forfeited, mu := loadForfeitActor(t)

	a.MarkAbsent(1)

	// Short of a full round (3 players): no escalation yet.
	a.call(func() { a.turnsCompleted += 2; a.escalateAbsent() })
	if seatIsBot(a, 1) {
		t.Fatal("seat escalated before a full round elapsed")
	}

	// One more turn completes a round: the seat escalates to a bot, but the
	// forfeit is recorded on the bot's first committed move, not on install
	// (see TestForfeitFiresOnFirstBotMove).
	a.call(func() { a.turnsCompleted++; a.escalateAbsent() })
	if !seatIsBot(a, 1) {
		t.Fatal("seat did not escalate to a bot after a full round")
	}
	mu.Lock()
	got := append([]engine.PlayerID(nil), *forfeited...)
	mu.Unlock()
	if len(got) != 0 {
		t.Fatalf("onForfeit fired on escalation = %v, want none (fires on first bot move)", got)
	}
}

func TestReconnectBeforeThresholdCancelsEscalation(t *testing.T) {
	a, forfeited, mu := loadForfeitActor(t)

	a.MarkAbsent(1)
	a.MarkPresent(1) // came back within the grace window
	a.call(func() { a.turnsCompleted += 9; a.escalateAbsent() })

	if seatIsBot(a, 1) {
		t.Error("seat escalated despite reconnecting before the threshold")
	}
	mu.Lock()
	n := len(*forfeited)
	mu.Unlock()
	if n != 0 {
		t.Errorf("forfeit recorded despite timely reconnect: %d", n)
	}
}

func TestReconnectAfterEscalationResumesSeat(t *testing.T) {
	a, _, _ := loadForfeitActor(t)

	a.MarkAbsent(2)
	a.call(func() { a.turnsCompleted += 3; a.escalateAbsent() })
	if !seatIsBot(a, 2) {
		t.Fatal("seat did not escalate")
	}

	a.MarkPresent(2) // player returns and reclaims the seat
	if seatIsBot(a, 2) {
		t.Error("bot still controls the seat after the player reconnected")
	}
}
