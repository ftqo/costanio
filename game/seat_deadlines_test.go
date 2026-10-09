package game

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/knights"
	"github.com/ftqo/costan.io/timings"
)

// loadTimed seeds and loads a timed N-player game for direct actor inspection.
func loadTimed(t *testing.T, players, turnTimerSec int) (*Actor, *fakeClock) {
	t.Helper()
	st := openStore(t)
	clock := &fakeClock{}
	seedGame(t, st, "g1", players, engine.GameConfig{Players: players, TurnTimerSec: turnTimerSec})
	a, err := Load("g1", st, Options{Clock: clock})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(a.Stop)
	return a, clock
}

// loadTimedKnights is loadTimed for a Knights game, so armTimer's Alchemist floor
// branch has cak's FixedDice hook to see.
func loadTimedKnights(t *testing.T, players, turnTimerSec int) (*Actor, *fakeClock) {
	t.Helper()
	st := openStore(t)
	clock := &fakeClock{}
	seedGame(t, st, "g1", players, engine.GameConfig{Players: players, Ruleset: "base+cak", TurnTimerSec: turnTimerSec})
	a, err := Load("g1", st, Options{Clock: clock})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(a.Stop)
	return a, clock
}

// TestArmTimerMultipleDiscardersEachGetDeadline: when several seats owe a
// discard at once, every one of them gets its own countdown.
func TestArmTimerMultipleDiscardersEachGetDeadline(t *testing.T) {
	a, _ := loadTimed(t, 4, 60)
	var n int
	var d0, d2 bool
	a.call(func() {
		a.state.Phase = engine.PhasePlay
		a.state.Rolled = true
		a.state.PendingDiscards = map[engine.PlayerID]int{0: 3, 2: 4}
		a.armTimer()
		n = len(a.seatDeadlines)
		d0 = !a.seatDeadlines[0].deadline.IsZero()
		d2 = !a.seatDeadlines[2].deadline.IsZero()
	})
	if n != 2 || !d0 || !d2 {
		t.Fatalf("want deadlines for seats 0 and 2, got n=%d d0=%v d2=%v", n, d0, d2)
	}
}

// TestArmTimerBotSeatStillGetsDeadline: a bot/auto seat carries a cosmetic
// countdown so the timer is never blank mid-game.
func TestArmTimerBotSeatStillGetsDeadline(t *testing.T) {
	a, _ := loadTimed(t, 4, 60)
	var armed bool
	a.call(func() {
		a.autoSeats[a.state.Cur] = true
		a.armTimer()
		armed = !a.seatDeadlines[a.state.Cur].deadline.IsZero()
	})
	if !armed {
		t.Fatal("bot/auto seat should still get a display deadline")
	}
}

// TestArmTimerPreservesUnrelatedDeadline: when one discarder acts, the other
// discarder's countdown must not reset.
func TestArmTimerPreservesUnrelatedDeadline(t *testing.T) {
	a, clock := loadTimed(t, 4, 60)
	var same, gone bool
	a.call(func() {
		a.state.Phase = engine.PhasePlay
		a.state.Rolled = true
		a.state.PendingDiscards = map[engine.PlayerID]int{0: 3, 2: 4}
		a.armTimer()
		before := a.seatDeadlines[2].deadline
		// Time passes, then seat 0 resolves its discard; re-arm.
		clock.Advance(3_000_000_000) // 3s
		delete(a.state.PendingDiscards, 0)
		a.armTimer()
		same = a.seatDeadlines[2].deadline.Equal(before)
		_, has0 := a.seatDeadlines[0]
		gone = !has0
	})
	if !same {
		t.Error("seat 2 deadline was reset by an unrelated seat acting")
	}
	if !gone {
		t.Error("seat 0 deadline should be cleared once it no longer owes a discard")
	}
}

// TestSuspendResumeReArmsFreshBudget: after a suspension, the returning
// player's deadline must not fire instantly on one that went stale while
// wall-clock time passed.
func TestSuspendResumeReArmsFreshBudget(t *testing.T) {
	a, clock := loadTimed(t, 3, 60)
	if d := turnDeadlineSet(a); !d {
		t.Fatal("expected an initial armed deadline")
	}
	a.Suspend()
	a.call(func() {
		if len(a.seatDeadlines) != 0 {
			t.Fatalf("suspend should clear deadlines, got %d", len(a.seatDeadlines))
		}
	})
	clock.Advance(10 * time.Minute) // long past any per-decision budget
	a.Resume()
	a.call(func() {
		if len(a.seatDeadlines) == 0 {
			t.Fatal("resume should re-arm a deadline")
		}
		for seat, st := range a.seatDeadlines {
			if !st.deadline.After(clock.Now()) {
				t.Fatalf("seat %d resumed with a stale deadline %v (now %v)", seat, st.deadline, clock.Now())
			}
		}
	})
}

func turnDeadlineSet(a *Actor) bool {
	var ok bool
	a.call(func() { ok = len(a.seatDeadlines) > 0 })
	return ok
}

// TestSuspendResumePreservesRemaining: suspend then resume restores the time
// the seat had left, not a fresh budget, and the suspended gap does not count
// against them. Otherwise reconnecting would reset the countdown.
func TestSuspendResumePreservesRemaining(t *testing.T) {
	a, clock := loadTimed(t, 3, 60)
	a.call(func() { armMain(a) })   // current seat: 60s main budget
	clock.Advance(45 * time.Second) // 15s left
	a.Suspend()                     // last human leaves -> capture 15s remaining
	clock.Advance(10 * time.Minute) // a long disconnect; must not count against them
	a.Resume()                      // they reconnect

	var remaining time.Duration
	a.call(func() {
		st, ok := a.seatDeadlines[a.state.Cur]
		if !ok {
			t.Fatal("resumed seat has no countdown")
		}
		remaining = st.deadline.Sub(clock.Now())
	})
	if remaining != 15*time.Second {
		t.Fatalf("resume should preserve 15s left, got %v (fresh-budget reset?)", remaining)
	}
}

// armMain puts the current seat on a fresh DecisionMain countdown: PhasePlay,
// dice rolled, nothing else pending, then arm. Mirrors how a normal turn's
// build/trade phase is armed.
func armMain(a *Actor) {
	a.state.Phase = engine.PhasePlay
	a.state.Rolled = true
	a.state.PendingDiscards = nil
	a.armTimer()
}

// TestMainTurnFloorRefreshesDecayedBudget: once the main budget has decayed
// below the floor, a refreshing action (re-arm) tops the countdown back up to
// min(15s, TurnTimerSec).
func TestMainTurnFloorRefreshesDecayedBudget(t *testing.T) {
	a, clock := loadTimed(t, 4, 60)
	var remaining time.Duration
	a.call(func() {
		armMain(a)                      // 60s budget for the current seat
		clock.Advance(55 * time.Second) // 5s left
		a.armTimer()                    // refreshing action floors to 15s
		remaining = a.seatDeadlines[a.state.Cur].deadline.Sub(clock.Now())
	})
	if remaining != 15*time.Second {
		t.Fatalf("want floored remaining 15s, got %v", remaining)
	}
}

// TestMainTurnFloorNeverShortens: a refreshing action with more than the floor
// remaining keeps the larger deadline; acting never reduces your clock.
func TestMainTurnFloorNeverShortens(t *testing.T) {
	a, clock := loadTimed(t, 4, 60)
	var remaining time.Duration
	a.call(func() {
		armMain(a)                     // 60s
		clock.Advance(5 * time.Second) // 55s left
		a.armTimer()                   // floor (15s) < remaining → keep 55s
		remaining = a.seatDeadlines[a.state.Cur].deadline.Sub(clock.Now())
	})
	if remaining != 55*time.Second {
		t.Fatalf("want preserved remaining 55s, got %v", remaining)
	}
}

// TestMainTurnFloorClampedToBudget: on a fast game the floor never exceeds the
// configured budget (min(15s, TurnTimerSec)). With a 10s timer the floor is 10s.
func TestMainTurnFloorClampedToBudget(t *testing.T) {
	a, clock := loadTimed(t, 4, 10)
	var remaining time.Duration
	a.call(func() {
		armMain(a)                     // 10s
		clock.Advance(8 * time.Second) // 2s left
		a.armTimer()                   // floor = min(15,10) = 10s
		remaining = a.seatDeadlines[a.state.Cur].deadline.Sub(clock.Now())
	})
	if remaining != 10*time.Second {
		t.Fatalf("want floored remaining 10s (clamped to budget), got %v", remaining)
	}
}

// TestNonMainDecisionNotFloored: the inactivity floor is main-turn only. A
// decayed discard countdown is preserved on re-arm, not raised to the floor.
// (A roll with the Alchemist's fixed dice has its own exception; see
// TestAlchemistFloorsRollDeadline.)
func TestNonMainDecisionNotFloored(t *testing.T) {
	a, clock := loadTimed(t, 4, 60)
	var remaining time.Duration
	a.call(func() {
		a.state.Phase = engine.PhasePlay
		a.state.Rolled = true
		a.state.PendingDiscards = map[engine.PlayerID]int{0: 3}
		a.armTimer()                    // seat 0 discard, 30s cap
		clock.Advance(28 * time.Second) // 2s left
		a.armTimer()                    // discard kind → no floor
		remaining = a.seatDeadlines[0].deadline.Sub(clock.Now())
	})
	if remaining != 2*time.Second {
		t.Fatalf("want preserved discard remaining 2s (no floor), got %v", remaining)
	}
}

// armRoll puts the current seat on a fresh DecisionRoll countdown: PhasePlay,
// dice not yet rolled, nothing else pending, then arm. Mirrors armMain above.
func armRoll(a *Actor) {
	a.state.Phase = engine.PhasePlay
	a.state.Rolled = false
	a.state.PendingDiscards = nil
	a.armTimer()
}

// playAlchemist grants seat p the Alchemist (a raw EvProgressDrawn, as a real
// draw produces) and plays it through engine.Decide/CmdPlayProgress with the
// given dice, the command a client submits. That is the only way to populate
// cak's unexported ext from game/. Both commits go through a.commit, so
// armTimer re-arms as in production.
//
// Must run inside a.call. Returns an error rather than calling t.Fatal,
// because Goexit would skip a.call's close(done) and hang the caller.
func playAlchemist(a *Actor, p engine.PlayerID, d1, d2 int) error {
	drawn := engine.NewEvent(knights.EvProgressDrawn, map[string]any{
		"player": p, "card": knights.CardAlchemist, "track": knights.Science,
	})
	drawn.Seq = a.state.NextSeq // raw event, bypassing Decide: Seq isn't auto-assigned
	if err := a.commit([]engine.Event{drawn}, engine.SourceHuman); err != nil {
		return err
	}
	data, _ := json.Marshal(map[string]any{"card": knights.CardAlchemist, "d1": d1, "d2": d2})
	events, err := engine.Decide(a.state, engine.Command{Player: p, Type: knights.CmdPlayProgress, Data: data})
	if err != nil {
		return err
	}
	return a.commit(events, engine.SourceHuman)
}

// TestPlainRollDeadlineNotExtended: a roll with no Alchemist gets no floor;
// its RollCap countdown runs down like any capped decision.
func TestPlainRollDeadlineNotExtended(t *testing.T) {
	a, clock := loadTimedKnights(t, 4, 60) // cak ruleset, but no card played
	var remaining time.Duration
	a.call(func() {
		armRoll(a)                      // RollCap = 15s
		clock.Advance(10 * time.Second) // 5s left
		a.armTimer()                    // no fixed dice → deadline untouched
		remaining = a.seatDeadlines[a.state.Cur].deadline.Sub(clock.Now())
	})
	if remaining != 5*time.Second {
		t.Fatalf("want untouched remaining 5s, got %v", remaining)
	}
}

// TestAlchemistFloorsRollDeadline: playing the Alchemist leaves the decision
// unchanged (still DecisionRoll), so the RollCap countdown would normally keep
// running. Once the dice are fixed, armTimer floors the deadline so the player
// has at least AlchemistBonus to submit the roll.
func TestAlchemistFloorsRollDeadline(t *testing.T) {
	a, clock := loadTimedKnights(t, 4, 60)
	var remaining time.Duration
	var playErr error
	a.call(func() {
		armRoll(a) // RollCap = 15s
		p := a.state.Cur
		clock.Advance(10 * time.Second)     // 5s left, below AlchemistBonus (10s)
		playErr = playAlchemist(a, p, 3, 4) // card played, dice fixed; commit re-arms
		remaining = a.seatDeadlines[p].deadline.Sub(clock.Now())
	})
	if playErr != nil {
		t.Fatalf("play alchemist: %v", playErr)
	}
	if remaining != timings.AlchemistBonus {
		t.Fatalf("want floored remaining %v, got %v", timings.AlchemistBonus, remaining)
	}
}

// TestAlchemistFloorNeverShortens: a player who played the card with more than
// AlchemistBonus left keeps the larger remaining time; the floor only adds.
func TestAlchemistFloorNeverShortens(t *testing.T) {
	a, clock := loadTimedKnights(t, 4, 60)
	var remaining time.Duration
	var playErr error
	a.call(func() {
		armRoll(a) // RollCap = 15s
		p := a.state.Cur
		clock.Advance(3 * time.Second) // 12s left, above AlchemistBonus (10s)
		playErr = playAlchemist(a, p, 5, 6)
		remaining = a.seatDeadlines[p].deadline.Sub(clock.Now())
	})
	if playErr != nil {
		t.Fatalf("play alchemist: %v", playErr)
	}
	if remaining != 12*time.Second {
		t.Fatalf("want preserved remaining 12s, got %v", remaining)
	}
}

// TestRefreshesTurnTimerExcludesTradesOnly: the only events that must not
// refresh the turn timer are the trade-negotiation events. Every other
// voluntary main-turn action is bounded, so refreshing on it cannot allow
// indefinite stalling.
func TestRefreshesTurnTimerExcludesTradesOnly(t *testing.T) {
	noRefresh := []engine.EventType{
		engine.EvTradeOffered, engine.EvTradeResponded,
		engine.EvTradeCancelled, engine.EvTradeCountered,
	}
	for _, et := range noRefresh {
		if refreshesTurnTimer([]engine.Event{{Type: et}}) {
			t.Errorf("%v must not refresh the turn timer", et)
		}
	}
	// A representative build action must refresh.
	if !refreshesTurnTimer([]engine.Event{{Type: engine.EvRoadBuilt}}) {
		t.Error("EvRoadBuilt must refresh the turn timer")
	}
	// A batch mixing a trade event with a build still refreshes (build wins).
	if !refreshesTurnTimer([]engine.Event{{Type: engine.EvTradeOffered}, {Type: engine.EvRoadBuilt}}) {
		t.Error("a batch containing a build must refresh")
	}
}

// TestViewForStampsSeatDeadlines: the broadcast view carries a positive ms
// remaining for each pending seat.
func TestViewForStampsSeatDeadlines(t *testing.T) {
	a, _ := loadTimed(t, 4, 60)
	a.call(func() {
		a.state.Phase = engine.PhasePlay
		a.state.Rolled = true
		a.state.PendingDiscards = map[engine.PlayerID]int{0: 3, 2: 4}
		a.armTimer()
	})
	v := a.View(1) // a viewer who owes nothing still sees everyone's countdowns
	if len(v.SeatDeadlines) != 2 {
		t.Fatalf("want 2 seat deadlines in view, got %+v", v.SeatDeadlines)
	}
	for seat, ms := range v.SeatDeadlines {
		if ms <= 0 {
			t.Fatalf("seat %d deadline ms must be positive, got %d", seat, ms)
		}
	}
}

// TestViewForStampsSeatBudgets: the view carries each decision's full budget
// (the bar's fixed full mark). It must match budgetFor for the decision kind
// and never be below the remaining time.
func TestViewForStampsSeatBudgets(t *testing.T) {
	a, _ := loadTimed(t, 4, 60)
	a.call(func() {
		a.state.Phase = engine.PhasePlay
		a.state.Rolled = true
		a.state.PendingDiscards = map[engine.PlayerID]int{0: 3, 2: 4}
		a.armTimer()
	})
	v := a.View(1)
	wantBudget := budgetFor(engine.Decider{Kind: engine.DecisionDiscard}, 60).Milliseconds()
	if len(v.SeatBudgets) != len(v.SeatDeadlines) {
		t.Fatalf("want one budget per seat deadline, got budgets=%+v deadlines=%+v", v.SeatBudgets, v.SeatDeadlines)
	}
	for seat, rem := range v.SeatDeadlines {
		budget, ok := v.SeatBudgets[seat]
		if !ok {
			t.Fatalf("seat %d has a deadline but no budget", seat)
		}
		if budget != wantBudget {
			t.Fatalf("seat %d budget = %d ms, want discard budget %d ms", seat, budget, wantBudget)
		}
		if rem > budget {
			t.Fatalf("seat %d remaining %d ms exceeds its budget %d ms", seat, rem, budget)
		}
	}
}

// placeSetupPiece commits the minimal legal setup move for whoever is on the
// clock, as if the player had made it. Loop-only: call it inside a.call.
func placeSetupPiece(t *testing.T, a *Actor) {
	t.Helper()
	cmd, ok := engine.AutoCommand(a.state)
	if !ok {
		t.Fatal("no legal setup move")
	}
	events, err := engine.Decide(a.state, cmd)
	if err != nil {
		t.Fatalf("decide %s: %v", cmd.Type, err)
	}
	if err := a.commit(events, engine.SourceHuman); err != nil {
		t.Fatalf("commit %s: %v", cmd.Type, err)
	}
}

// TestSetupRoadArmsItsOwnBudget: placing the setup settlement moves the seat
// to a different decision, the road, which re-arms on the road's own short
// budget.
func TestSetupRoadArmsItsOwnBudget(t *testing.T) {
	a, clock := loadTimed(t, 4, 60)
	var settlement, road time.Duration
	a.call(func() {
		a.armTimer()
		settlement = a.seatDeadlines[a.state.Cur].deadline.Sub(clock.Now())
		clock.Advance(20 * time.Second) // the player deliberates over the spot
		placeSetupPiece(t, a)
		road = a.seatDeadlines[a.state.Cur].deadline.Sub(clock.Now())
	})
	if settlement != timings.SetupCap {
		t.Errorf("settlement budget = %v, want %v", settlement, timings.SetupCap)
	}
	if road != timings.SetupRoadCap {
		t.Errorf("road budget = %v, want %v", road, timings.SetupRoadCap)
	}
}

// TestSetupRoadAfterTimeoutArmsRoadBudget: letting the settlement clock run
// out must not give the forced road the long settlement budget.
func TestSetupRoadAfterTimeoutArmsRoadBudget(t *testing.T) {
	a, clock := loadTimed(t, 4, 60)
	var road time.Duration
	a.call(func() {
		a.armTimer()
		clock.Advance(timings.SetupCap + turnTimerBuffer)
		a.autoTimeoutDecision(a.timerGen)
		road = a.seatDeadlines[a.state.Cur].deadline.Sub(clock.Now())
	})
	if road != timings.SetupRoadCap {
		t.Errorf("road budget after a forced settlement = %v, want %v", road, timings.SetupRoadCap)
	}
}
