package game

import (
	"testing"
	"time"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/islands"
	"github.com/ftqo/costan.io/engine/knights"
)

// TestBotsDiscardWithoutWaitingOnLowerHuman: on a 7 every over-limit player
// owes a discard at once, and the engine accepts them in any order, so bots
// must discard immediately even while a lower-seated human still owes one.
func TestBotsDiscardWithoutWaitingOnLowerHuman(t *testing.T) {
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
	m.SetBotDelay(0) // no pacing: the bots' discards should flush immediately
	defer m.StopAll()

	a, err := m.Get("g1")
	if err != nil {
		t.Fatal(err)
	}

	// Force a multi-seat discard where the human (seat 0) owes alongside the two
	// bots (seats 1, 2), then drive the auto seats.
	a.call(func() {
		a.state.Phase = engine.PhasePlay
		a.state.Rolled = true
		for p := range 3 {
			a.state.Players[p].Hand = engine.Hand{board.Wood: 8} // 8 cards → discard 4
		}
		a.state.PendingDiscards = map[engine.PlayerID]int{0: 4, 1: 4, 2: 4}
		a.runAutoSeats()
	})

	a.call(func() {
		if _, owes := a.state.PendingDiscards[1]; owes {
			t.Error("bot seat 1 did not discard while the human owed")
		}
		if _, owes := a.state.PendingDiscards[2]; owes {
			t.Error("bot seat 2 did not discard while the human owed")
		}
		if _, owes := a.state.PendingDiscards[0]; !owes {
			t.Error("human seat 0 no longer owes its discard")
		}
	})
}

// TestBotResolvesAqueductOwedByNonCurrentSeat: the Aqueduct (Knights, Science
// L3) is owed by whoever produced nothing on a roll, often not the current
// player. The game is blocked until the pick resolves, so a bot must resolve
// its own aqueduct even when it is not the current player.
func TestBotResolvesAqueductOwedByNonCurrentSeat(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3, Ruleset: "base+cak", TurnTimerSec: 0})
	if err := st.SetSeatStatus("g1", 2, "bot"); err != nil {
		t.Fatal(err)
	}
	clock := &fakeClock{}
	m := NewManager(st, clock)
	m.SetBotFactory(func(engine.PlayerID) CommandSource { return bot.NewStrong() })
	m.SetBotDelay(0)
	defer m.StopAll()

	a, err := m.Get("g1")
	if err != nil {
		t.Fatal(err)
	}

	a.call(func() {
		a.state.Phase = engine.PhasePlay
		a.state.Rolled = true
		a.state.Cur = 0 // the human's turn; bot seat 2 owes the aqueduct
		// Seed the obligation as the engine does on a production roll.
		owed := engine.NewEvent(knights.EvAqueductOwed, map[string]any{"players": []engine.PlayerID{2}})
		owed.Seq = a.state.NextSeq
		if err := a.commit([]engine.Event{owed}, engine.SourceHuman); err != nil {
			t.Fatalf("seed aqueduct: %v", err)
		}
		x, ok := knights.StateExt(a.state)
		if !ok || len(x.Aqueduct) != 1 || x.Aqueduct[0] != 2 {
			t.Fatalf("aqueduct not owed by seat 2 after seeding (ext ok=%v)", ok)
		}
		a.runAutoSeats()
	})

	a.call(func() {
		x, _ := knights.StateExt(a.state)
		for _, p := range x.Aqueduct {
			if p == 2 {
				t.Fatal("bot seat 2 still owes its aqueduct")
			}
		}
	})
}

// TestBotResolvesOwnAqueductBeforeHuman: when a human (seat 0) and
// a bot (seat 2) owe the same simultaneous module pick, the bot resolves its
// own immediately rather than waiting for the human. The engine accepts these
// in any order.
func TestBotResolvesOwnAqueductBeforeHuman(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3, Ruleset: "base+cak", TurnTimerSec: 0})
	if err := st.SetSeatStatus("g1", 2, "bot"); err != nil {
		t.Fatal(err)
	}
	clock := &fakeClock{}
	m := NewManager(st, clock)
	m.SetBotFactory(func(engine.PlayerID) CommandSource { return bot.NewStrong() })
	m.SetBotDelay(0)
	defer m.StopAll()

	a, err := m.Get("g1")
	if err != nil {
		t.Fatal(err)
	}

	a.call(func() {
		a.state.Phase = engine.PhasePlay
		a.state.Rolled = true
		a.state.Cur = 1 // neither owing seat is the current player
		// Human seat 0 and bot seat 2 both owe an aqueduct.
		owed := engine.NewEvent(knights.EvAqueductOwed, map[string]any{"players": []engine.PlayerID{0, 2}})
		owed.Seq = a.state.NextSeq
		if err := a.commit([]engine.Event{owed}, engine.SourceHuman); err != nil {
			t.Fatalf("seed aqueduct: %v", err)
		}
		a.runAutoSeats()
	})

	a.call(func() {
		x, _ := knights.StateExt(a.state)
		var botOwes, humanOwes bool
		for _, p := range x.Aqueduct {
			switch p {
			case 2:
				botOwes = true
			case 0:
				humanOwes = true
			default:
			}
		}
		if botOwes {
			t.Error("bot seat 2 did not resolve its own aqueduct")
		}
		if !humanOwes {
			t.Error("human seat 0's aqueduct was resolved for it")
		}
	})
}

// TestTimeoutLeavesNoExpiredDeadline: autoTimeoutDecision drains the
// timed-out batch with engine.AutoCommand, which serves the engine's next
// obligation. With two modules owing two seats off one roll, that can be the
// seat that has not timed out. The timed-out seat must not be left holding an
// expired deadline with no timer behind it.
//
// The premise (AutoCommand answering a seat outside the batch) is asserted so
// the test cannot pass vacuously. Failures use Errorf, never Fatal: this body
// runs on the actor goroutine, and Fatal's Goexit would deadlock the test.
func TestTimeoutLeavesNoExpiredDeadline(t *testing.T) {
	st := openStore(t)
	clock := &fakeClock{}
	seedGame(t, st, "g1", 4, engine.GameConfig{Players: 4, Ruleset: "base+cak+islands", TurnTimerSec: 30})
	a, err := Load("g1", st, Options{Clock: clock})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(a.Stop)

	a.call(func() {
		a.state.Phase = engine.PhasePlay
		a.state.Rolled = true
		a.state.Cur = 0
		// islands builds its ext on its first event; stand in the empty value.
		ix, ok := islands.StateExt(a.state)
		if !ok {
			ix = &islands.Ext{
				Ships:       map[board.Edge]engine.PlayerID{},
				BuiltTurn:   map[board.Edge]bool{},
				PendingGold: map[engine.PlayerID]int{},
				Reached:     map[engine.PlayerID]map[int]bool{},
				IslandVP:    map[engine.PlayerID]int{},
			}
			for range a.state.Players {
				ix.ShipsLeft = append(ix.ShipsLeft, islands.MaxShips)
			}
			a.state.Ext[islands.Name] = ix
		}
		cx, ok := knights.StateExt(a.state)
		if !ok {
			t.Error("cak ext missing")
			return
		}
		ix.PendingGold[1] = 1                   // islands owes seat 1
		cx.DefenderDraws = []engine.PlayerID{3} // cak owes seat 3
		a.armTimer()

		// Premise: AutoCommand answers for seat 3 while seat 1 is the one whose
		// clock we are about to expire.
		cmd, ok := engine.AutoCommand(a.state)
		if !ok || cmd.Player != 3 {
			t.Errorf("premise not reached: AutoCommand = %+v ok=%v, want a command for seat 3", cmd, ok)
			return
		}
		st1, ok1 := a.seatDeadlines[1]
		st3, ok3 := a.seatDeadlines[3]
		if !ok1 || !ok3 {
			t.Errorf("premise not reached: deadlines armed for seats %v", a.seatDeadlines)
			return
		}
		st1.deadline = clock.Now().Add(-time.Second) // batch = {1}
		a.seatDeadlines[1] = st1
		st3.deadline = clock.Now().Add(time.Minute)
		a.seatDeadlines[3] = st3

		a.autoTimeoutDecision(a.timerGen)

		now := clock.Now()
		for seat, d := range a.seatDeadlines {
			if d.deadline.Before(now) {
				t.Errorf("seat %d has a deadline that expired at %v", seat, d.deadline)
			}
		}
		if _, still := ix.PendingGold[1]; still {
			if _, armed := a.seatDeadlines[1]; !armed {
				t.Error("seat 1 owes its gold pick but has no deadline")
			}
		}
	})
}
