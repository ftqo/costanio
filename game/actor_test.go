package game

import (
	"encoding/json"
	"errors"
	"path/filepath"
	"reflect"
	"sync"
	"testing"
	"time"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/store"
	"github.com/ftqo/costan.io/timings"
)

// autoBot is a trivial CommandSource for tests: the engine's minimal move.
type autoBot struct{}

func (autoBot) Act(s *engine.State, seat engine.PlayerID) (engine.Command, bool) {
	cmd, ok := engine.AutoCommand(s)
	if !ok || cmd.Player != seat {
		return engine.Command{}, false
	}
	return cmd, true
}

// panicBot panics when asked to act, simulating an engine invariant blowup in
// the decide/auto path.
type panicBot struct{}

func (panicBot) Act(*engine.State, engine.PlayerID) (engine.Command, bool) {
	panic("boom from bot Act")
}

// TestPanickingAutoPausesGame: a panic in the auto/bot decide path pauses the
// game rather than killing the actor goroutine (which would leave
// Do/View/Subscribe returning nil forever).
func TestPanickingAutoPausesGame(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})
	m := NewManager(st, &fakeClock{})
	defer m.StopAll()

	a, err := m.Get("g1")
	if err != nil {
		t.Fatal(err)
	}
	// Installing a panicking bot triggers runAutoSeats, src.Act, panic.
	a.SetSeatBot(0, panicBot{})

	// The actor must still be alive: View returns a paused view rather than
	// hanging or returning nil.
	done := make(chan *FullView, 1)
	go func() { done <- a.View(Spectator) }()
	select {
	case v := <-done:
		if v == nil {
			t.Fatal("actor died: View returned nil after auto panic")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("actor hung: View did not return after auto panic")
	}

	// A later command must report the game as paused.
	if err := a.Do(engine.Command{Player: 1, Type: engine.CmdRollDice}); !errors.Is(err, ErrPaused) {
		t.Fatalf("expected ErrPaused after auto panic, got %v", err)
	}
}

// TestConcurrentStopNoPanic: concurrent Stop() calls must not double-close
// a.quit.
func TestConcurrentStopNoPanic(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})
	m := NewManager(st, &fakeClock{})
	defer m.StopAll()

	a, err := m.Get("g1")
	if err != nil {
		t.Fatal(err)
	}

	const callers = 16
	var wg sync.WaitGroup
	wg.Add(callers)
	start := make(chan struct{})
	for range callers {
		go func() {
			defer wg.Done()
			<-start
			a.Stop() // must not panic, even concurrently
		}()
	}
	close(start)
	wg.Wait()
}

func TestBotSeatActsThroughActor(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})
	m := NewManager(st, &fakeClock{})
	defer m.StopAll()

	a, err := m.Get("g1")
	if err != nil {
		t.Fatal(err)
	}
	before := actorState(a)
	if before.Cur != 0 {
		t.Fatalf("expected seat 0 up, got %d", before.Cur)
	}
	a.SetSeatBot(0, autoBot{})
	after := actorState(a)
	if after.Cur == 0 && after.Phase == engine.PhaseSetup {
		t.Error("bot seat did not act")
	}
	a.SetSeatBot(0, nil)
}

func TestBotDelayGatesActionsOnClock(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})
	for i := range 3 {
		if err := st.SetSeatStatus("g1", i, "bot"); err != nil {
			t.Fatal(err)
		}
	}
	clock := &fakeClock{}
	m := NewManager(st, clock)
	m.SetBotFactory(func(engine.PlayerID) CommandSource { return autoBot{} })
	m.SetBotDelay(500 * time.Millisecond)
	defer m.StopAll()

	a, err := m.Get("g1")
	if err != nil {
		t.Fatal(err)
	}

	// Paced bots don't run on their own: each action defers the next onto the
	// clock, which the fake clock holds until fired. Give the loop turns and
	// confirm the sequence number is stuck without a tick.
	seq0 := actorState(a).NextSeq
	for range 20 {
		if got := actorState(a).NextSeq; got != seq0 {
			t.Fatalf("game advanced without a clock tick: seq %d -> %d", seq0, got)
		}
	}

	// Each released tick lets the next bot action through.
	for i := range 10 {
		prev := actorState(a).NextSeq
		clock.Fire()
		advanced := false
		for j := 0; j < 1000 && !advanced; j++ {
			advanced = actorState(a).NextSeq > prev
		}
		if !advanced {
			t.Fatalf("firing the clock did not advance the game (step %d, seq stuck at %d)", i, prev)
		}
	}
}

func TestBotFactoryWiresBotSeats(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})
	if err := st.SetSeatStatus("g1", 0, "bot"); err != nil {
		t.Fatal(err)
	}
	m := NewManager(st, &fakeClock{})
	m.SetBotFactory(func(engine.PlayerID) CommandSource { return autoBot{} })
	defer m.StopAll()

	a, err := m.Get("g1")
	if err != nil {
		t.Fatal(err)
	}
	s := actorState(a)
	if s.Cur == 0 && s.Phase == engine.PhaseSetup {
		t.Error("factory-wired bot did not act for its seat")
	}
}

type fakeClock struct {
	mu     sync.Mutex
	timers []*fakeTimer
	now    time.Time
}

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

// Advance moves the fake clock forward without firing any armed timers, so a
// test can observe how elapsed time changes deadlines.
func (c *fakeClock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
}

type fakeTimer struct {
	c       *fakeClock
	f       func()
	stopped bool // guarded by c.mu
}

func (c *fakeClock) AfterFunc(d time.Duration, f func()) Timer {
	c.mu.Lock()
	defer c.mu.Unlock()
	t := &fakeTimer{c: c, f: f}
	c.timers = append(c.timers, t)
	return t
}

// Stop/Reset run on the actor's loop goroutine (via armTimer) while Fire reads
// stopped on the test goroutine, so both must take the clock's lock.
func (t *fakeTimer) Stop() bool {
	t.c.mu.Lock()
	defer t.c.mu.Unlock()
	t.stopped = true
	return true
}

func (t *fakeTimer) Reset(d time.Duration) bool {
	t.c.mu.Lock()
	defer t.c.mu.Unlock()
	t.stopped = false
	return true
}

// Fire runs all armed timers.
func (c *fakeClock) Fire() {
	c.mu.Lock()
	var fire []func()
	for _, t := range c.timers {
		if !t.stopped {
			t.stopped = true
			fire = append(fire, t.f)
		}
	}
	c.mu.Unlock()
	for _, f := range fire {
		f()
	}
}

func openStore(t *testing.T) *store.Store {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	return st
}

// seedGame creates the game row, seats, and initial engine events.
func seedGame(t *testing.T, st *store.Store, id string, players int, cfg engine.GameConfig) {
	t.Helper()
	host, _ := st.CreateGuest("host")
	cfgJSON, _ := json.Marshal(cfg)
	if err := st.CreateGame(&store.Game{ID: id, Ruleset: "base", Config: cfgJSON, CreatedBy: host.ID}); err != nil {
		t.Fatal(err)
	}
	if err := st.AddSeat(id, 0, host.ID); err != nil {
		t.Fatal(err)
	}
	for i := 1; i < players; i++ {
		u, _ := st.CreateGuest("p" + string(rune('0'+i)))
		if err := st.AddSeat(id, i, u.ID); err != nil {
			t.Fatal(err)
		}
	}
	events, err := engine.New(cfg, engine.SeedsFrom(99))
	if err != nil {
		t.Fatal(err)
	}
	// Stamped as Manager.Start stamps the opening deal, so provenance reads
	// match a real game. TestUnstampedLogStillReplays avoids this helper for
	// that reason.
	engine.StampSource(events, engine.SourceServer)
	if err := st.AppendEvents(id, events); err != nil {
		t.Fatal(err)
	}
	if err := st.SetGameStatus(id, "active"); err != nil {
		t.Fatal(err)
	}
}

// mirrorState rebuilds the engine state straight from the store.
func mirrorState(t *testing.T, st *store.Store, id string) *engine.State {
	t.Helper()
	events, err := st.LoadEvents(id, 0)
	if err != nil {
		t.Fatal(err)
	}
	s, err := engine.Replay(events)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

// turnDeadlineOf reads the current player's seat deadline via the loop.
func turnDeadlineOf(a *Actor) time.Time {
	var d time.Time
	a.call(func() { d = a.seatDeadlines[a.state.Cur].deadline })
	return d
}

// actorState extracts the actor's live state via the loop (test-only).
func actorState(a *Actor) *engine.State {
	var s *engine.State
	a.call(func() {
		clone := *a.state
		s = &clone
	})
	return s
}

func TestActorDrivesGameAndMatchesEngine(t *testing.T) {
	st := openStore(t)
	cfg := engine.GameConfig{Players: 3}
	seedGame(t, st, "g1", 3, cfg)
	m := NewManager(st, &fakeClock{})
	defer m.StopAll()

	a, err := m.Get("g1")
	if err != nil {
		t.Fatal(err)
	}
	sub, view := a.Subscribe(0)
	defer sub.Close()
	if view == nil || view.Phase != engine.PhaseSetup {
		t.Fatalf("initial view = %+v", view)
	}

	// The subscriber must see a contiguous, ordered stream starting at the
	// view seq. Drain as the game runs, as a connection's forwarder does: the
	// ring is a short tail (frameRingCap), and a reader that parks for sixty
	// commands is told to resync. Draining stops at the live NextSeq, so Next()
	// never blocks.
	want := view.Seq
	drain := func() {
		for want < actorState(a).NextSeq {
			_, seq, behind, ok := sub.Next()
			if behind {
				t.Fatalf("subscriber fell behind the ring at seq %d", want)
			}
			if !ok {
				t.Fatalf("stream closed before seq %d", want)
			}
			if seq != want {
				t.Fatalf("event seq %d, want %d", seq, want)
			}
			want++
		}
	}

	// Drive 60 auto-derived commands through the actor, mirroring locally.
	mirror := mirrorState(t, st, "g1")
	for i := 0; i < 60 && mirror.Phase != engine.PhaseFinished; i++ {
		cmd, ok := engine.AutoCommand(mirror)
		if !ok {
			break
		}
		events, err := engine.Decide(mirror, cmd)
		if err != nil {
			t.Fatalf("mirror decide: %v", err)
		}
		for _, e := range events {
			engine.Apply(mirror, e)
		}
		if err := a.Do(cmd); err != nil {
			t.Fatalf("actor.Do(%s): %v", cmd.Type, err)
		}
		drain()
	}

	if got := actorState(a); !reflect.DeepEqual(got, mirror) {
		t.Errorf("actor state diverged from mirror\nactor:  %+v\nmirror: %+v", got, mirror)
	}

	drain()
	sub.Close()
}

func TestActorRejectsIllegalCommand(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})
	m := NewManager(st, &fakeClock{})
	defer m.StopAll()
	a, _ := m.Get("g1")

	if err := a.Do(engine.Command{Player: 2, Type: engine.CmdRollDice}); err == nil {
		t.Error("rolling during setup by wrong player should fail")
	}
	// Nothing persisted beyond the initial 2 events.
	events, _ := st.LoadEvents("g1", 0)
	if len(events) != 2 {
		t.Errorf("events = %d, want 2", len(events))
	}
}

func TestActorRestartRebuilds(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})
	m := NewManager(st, &fakeClock{})

	a, _ := m.Get("g1")
	mirror := mirrorState(t, st, "g1")
	for range 30 {
		cmd, ok := engine.AutoCommand(mirror)
		if !ok {
			break
		}
		evs, err := engine.Decide(mirror, cmd)
		if err != nil {
			t.Fatal(err)
		}
		for _, e := range evs {
			engine.Apply(mirror, e)
		}
		if err := a.Do(cmd); err != nil {
			t.Fatal(err)
		}
	}
	before := actorState(a)
	m.StopAll() // simulated crash/redeploy

	m2 := NewManager(st, &fakeClock{})
	defer m2.StopAll()
	a2, err := m2.Get("g1")
	if err != nil {
		t.Fatal(err)
	}
	after := actorState(a2)
	if !reflect.DeepEqual(before, after) {
		t.Errorf("rebuild diverged\nbefore: %+v\nafter:  %+v", before, after)
	}
}

func TestSnapshotRebuildEquivalence(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})
	m := NewManager(st, &fakeClock{})

	a, _ := m.Get("g1")
	mirror := mirrorState(t, st, "g1")
	// Push well past snapshotEvery events.
	for i := 0; i < 120 && mirror.Phase != engine.PhaseFinished; i++ {
		cmd, ok := engine.AutoCommand(mirror)
		if !ok {
			break
		}
		evs, _ := engine.Decide(mirror, cmd)
		for _, e := range evs {
			engine.Apply(mirror, e)
		}
		if err := a.Do(cmd); err != nil {
			t.Fatal(err)
		}
	}
	if _, _, err := st.LoadLatestSnapshot("g1"); err != nil {
		t.Fatalf("expected a snapshot after 120 commands: %v", err)
	}
	before := actorState(a)
	m.StopAll()

	m2 := NewManager(st, &fakeClock{})
	defer m2.StopAll()
	a2, _ := m2.Get("g1")
	if after := actorState(a2); !reflect.DeepEqual(before, after) {
		t.Error("snapshot rebuild diverged from live state")
	}
}

func TestTimerAutoActsOneDecisionPerExpiry(t *testing.T) {
	st := openStore(t)
	clock := &fakeClock{}
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3, TurnTimerSec: 30})
	m := NewManager(st, clock)
	defer m.StopAll()

	a, _ := m.Get("g1")
	before := actorState(a)
	if before.Phase != engine.PhaseSetup || before.Cur != 0 {
		t.Fatalf("unexpected start: %s %d", before.Phase, before.Cur)
	}
	seq0 := before.NextSeq

	// The first expiry places one setup piece (the settlement); the turn does
	// not pass, since the same player still owes a road.
	clock.Fire()
	mid := actorState(a)
	if mid.Cur != 0 {
		t.Errorf("one expiry should not pass the turn; cur = %d, want 0", mid.Cur)
	}
	if mid.NextSeq <= seq0 {
		t.Error("expiry produced no action")
	}

	// The budget re-arms for the next decision; a second expiry finishes setup
	// (the road) and passes to seat 1.
	clock.Fire()
	after := actorState(a)
	if after.Cur != 1 || after.Phase != engine.PhaseSetup {
		t.Errorf("after second expiry: phase %s cur %d, want setup cur 1", after.Phase, after.Cur)
	}

	// The decider's remaining budget is exposed to clients.
	v := a.View(1)
	if ms, ok := v.SeatDeadlines[1]; !ok || ms <= 0 {
		t.Errorf("expected a positive seat deadline for the human decider, got %v", v.SeatDeadlines)
	}
}

// TestRollGetsShortBudget: once play begins, the not-yet-rolled decider's
// visible deadline is the short roll budget (timings.RollCap), not the full
// 30s turn timer.
func TestRollGetsShortBudget(t *testing.T) {
	st := openStore(t)
	clock := &fakeClock{}
	const turnTimer = 30
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3, TurnTimerSec: turnTimer})
	m := NewManager(st, clock)
	defer m.StopAll()

	a, _ := m.Get("g1")

	// Auto-fire the clock to walk through setup (each expiry resolves one setup
	// piece) until the game reaches play phase owing a dice roll.
	for range 50 {
		s := actorState(a)
		if s.Phase == engine.PhasePlay && !s.Rolled {
			break
		}
		clock.Fire()
	}

	s := actorState(a)
	if s.Phase != engine.PhasePlay || s.Rolled {
		t.Fatalf("setup did not reach a pre-roll play state: phase %s rolled %v", s.Phase, s.Rolled)
	}

	v := a.View(s.Cur)
	ms, ok := v.SeatDeadlines[s.Cur]
	if !ok {
		t.Fatal("expected a turn deadline for the roll decider")
	}
	// The roll budget caps at timings.RollCap; allow a small margin above it
	// for scheduling slack, but well below the 30s timer.
	if want := timings.RollCap.Milliseconds() + 2_000; ms > want {
		t.Errorf("roll deadline = %dms, want ~%dms (turn timer %ds)", ms, timings.RollCap.Milliseconds(), turnTimer)
	}
}

func TestOfferLifetimeScalesWithTurnTimer(t *testing.T) {
	cases := []struct {
		turnTimerSec int
		want         time.Duration
	}{
		{0, timings.OfferDefaultLifetime}, // untimed → fixed default
		{20, timings.OfferMinLifetime},    // 10s → clamped up to the floor
		{30, timings.OfferMinLifetime},    // 15s → exactly the floor
		{60, timings.OfferMaxLifetime},    // half = 30s, exactly the ceiling
		{90, timings.OfferMaxLifetime},    // half = 45s → clamped to the ceiling
		{120, timings.OfferMaxLifetime},   // 60s → clamped to the ceiling
		{600, timings.OfferMaxLifetime},   // 300s → clamped down to the ceiling
	}
	for _, c := range cases {
		if got := offerLifetimeFor(c.turnTimerSec); got != c.want {
			t.Errorf("offerLifetimeFor(%d) = %s, want %s", c.turnTimerSec, got, c.want)
		}
	}
}

func TestOfferAutoExpires(t *testing.T) {
	st := openStore(t)
	clock := &fakeClock{}
	// No turn timer, so the only armed timer is the open offer's.
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3, TurnTimerSec: 0})
	m := NewManager(st, clock)
	defer m.StopAll()

	a, _ := m.Get("g1")

	// Drive deterministically to a play-phase turn where the current player has
	// rolled, owes no robber/discard, and holds something to offer. Both the
	// mirror and the actor replay the same seeded events, so they stay in step.
	mirror := mirrorState(t, st, "g1")
	var offer engine.Command
	found := false
	for i := 0; i < 5000 && !found; i++ {
		if mirror.Phase == engine.PhasePlay && mirror.Rolled && !mirror.RobberPending && len(mirror.PendingDiscards) == 0 {
			hand := mirror.Players[mirror.Cur].Hand
			gi := -1
			for r := 1; r <= 5; r++ {
				if hand[r] > 0 {
					gi = r
					break
				}
			}
			if gi != -1 {
				var give, want engine.Hand
				give[gi] = 1
				want[gi%5+1] = 1 // any resource other than gi
				data, _ := json.Marshal(engine.TradeOfferedData{Give: give, Want: want})
				offer = engine.Command{Player: mirror.Cur, Type: engine.CmdOfferTrade, Data: data}
				found = true
				break
			}
		}
		cmd, ok := engine.AutoCommand(mirror)
		if !ok {
			break
		}
		events, err := engine.Decide(mirror, cmd)
		if err != nil {
			t.Fatalf("mirror decide %s: %v", cmd.Type, err)
		}
		for _, e := range events {
			engine.Apply(mirror, e)
		}
		if err := a.Do(cmd); err != nil {
			t.Fatalf("actor.Do(%s): %v", cmd.Type, err)
		}
	}
	if !found {
		t.Fatal("never reached an offerable play-phase state")
	}

	if err := a.Do(offer); err != nil {
		t.Fatalf("offer_trade: %v", err)
	}
	if before := actorState(a); before.ActiveOffer == nil {
		t.Fatal("offer was not registered")
	}
	// The offer's remaining lifetime is exposed to clients.
	if v := a.View(offer.Player); v.OfferDeadlineMs == nil || *v.OfferDeadlineMs <= 0 {
		t.Errorf("expected a positive offer_deadline_ms, got %v", v.OfferDeadlineMs)
	}

	// When the lifetime elapses, the server auto-cancels on the owner's behalf.
	clock.Fire()
	if after := actorState(a); after.ActiveOffer != nil {
		t.Errorf("offer should have auto-expired, still active: %+v", after.ActiveOffer)
	}
	if v := a.View(offer.Player); v.OfferDeadlineMs != nil {
		t.Errorf("offer_deadline_ms should clear after expiry, got %v", *v.OfferDeadlineMs)
	}
}

// TestResumeReArmsOfferTimer: Suspend stops the open offer's auto-cancel timer
// without saving its remaining time, so Resume must re-arm it. After Resume,
// firing the clock must expire the offer.
func TestResumeReArmsOfferTimer(t *testing.T) {
	st := openStore(t)
	clock := &fakeClock{}
	// No turn timer, so the only armed timer is the open offer's.
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3, TurnTimerSec: 0})
	m := NewManager(st, clock)
	defer m.StopAll()

	a, _ := m.Get("g1")

	// Drive deterministically to an offerable play-phase turn and post an offer
	// (mirrors TestOfferAutoExpires).
	mirror := mirrorState(t, st, "g1")
	var offer engine.Command
	found := false
	for i := 0; i < 5000 && !found; i++ {
		if mirror.Phase == engine.PhasePlay && mirror.Rolled && !mirror.RobberPending && len(mirror.PendingDiscards) == 0 {
			hand := mirror.Players[mirror.Cur].Hand
			gi := -1
			for r := 1; r <= 5; r++ {
				if hand[r] > 0 {
					gi = r
					break
				}
			}
			if gi != -1 {
				var give, want engine.Hand
				give[gi] = 1
				want[gi%5+1] = 1
				data, _ := json.Marshal(engine.TradeOfferedData{Give: give, Want: want})
				offer = engine.Command{Player: mirror.Cur, Type: engine.CmdOfferTrade, Data: data}
				found = true
				break
			}
		}
		cmd, ok := engine.AutoCommand(mirror)
		if !ok {
			break
		}
		events, err := engine.Decide(mirror, cmd)
		if err != nil {
			t.Fatalf("mirror decide %s: %v", cmd.Type, err)
		}
		for _, e := range events {
			engine.Apply(mirror, e)
		}
		if err := a.Do(cmd); err != nil {
			t.Fatalf("actor.Do(%s): %v", cmd.Type, err)
		}
	}
	if !found {
		t.Fatal("never reached an offerable play-phase state")
	}
	if err := a.Do(offer); err != nil {
		t.Fatalf("offer_trade: %v", err)
	}
	if actorState(a).ActiveOffer == nil {
		t.Fatal("offer was not registered")
	}

	// Suspend (stops the offer timer) then Resume (must re-arm it).
	a.Suspend()
	a.Resume()

	// With the timer re-armed, firing the clock auto-cancels the offer.
	clock.Fire()
	if after := actorState(a); after.ActiveOffer != nil {
		t.Errorf("offer still active after Resume: %+v", after.ActiveOffer)
	}
}

// TestTradeNegotiationKeepsTurnTimer: posting and withdrawing an offer leave
// the turn countdown alone. Trade negotiation has its own offer timer and must
// not grant the decider a fresh turn budget.
func TestTradeNegotiationKeepsTurnTimer(t *testing.T) {
	st := openStore(t)
	clock := &fakeClock{}
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3, TurnTimerSec: 60})
	m := NewManager(st, clock)
	defer m.StopAll()

	a, _ := m.Get("g1")

	// Drive deterministically (mirror + actor replay the same seeded events) to a
	// play-phase turn where the current player has rolled and holds something to
	// offer. We never fire the clock, so the turn timer only re-arms on the
	// commands we issue.
	mirror := mirrorState(t, st, "g1")
	var offer engine.Command
	found := false
	for i := 0; i < 5000 && !found; i++ {
		if mirror.Phase == engine.PhasePlay && mirror.Rolled && !mirror.RobberPending && len(mirror.PendingDiscards) == 0 {
			hand := mirror.Players[mirror.Cur].Hand
			gi := -1
			for r := 1; r <= 5; r++ {
				if hand[r] > 0 {
					gi = r
					break
				}
			}
			if gi != -1 {
				var give, want engine.Hand
				give[gi] = 1
				want[gi%5+1] = 1 // any resource other than gi
				data, _ := json.Marshal(engine.TradeOfferedData{Give: give, Want: want})
				offer = engine.Command{Player: mirror.Cur, Type: engine.CmdOfferTrade, Data: data}
				found = true
				break
			}
		}
		cmd, ok := engine.AutoCommand(mirror)
		if !ok {
			break
		}
		events, err := engine.Decide(mirror, cmd)
		if err != nil {
			t.Fatalf("mirror decide %s: %v", cmd.Type, err)
		}
		for _, e := range events {
			engine.Apply(mirror, e)
		}
		if err := a.Do(cmd); err != nil {
			t.Fatalf("actor.Do(%s): %v", cmd.Type, err)
		}
	}
	if !found {
		t.Fatal("never reached an offerable play-phase state")
	}

	// Deadline armed by the last real turn action (the dice roll) before any
	// trade negotiation. It must survive both the offer and the cancel.
	deadline := turnDeadlineOf(a)
	if deadline.IsZero() {
		t.Fatal("expected an armed turn timer for the decider")
	}

	// Posting the offer is not a turn action.
	clock.Advance(3 * time.Second)
	if err := a.Do(offer); err != nil {
		t.Fatalf("offer_trade: %v", err)
	}
	if got := turnDeadlineOf(a); !got.Equal(deadline) {
		t.Errorf("offer moved the turn deadline %v -> %v (+%s)",
			deadline, got, got.Sub(deadline))
	}

	// An opponent responding (here declining, which needs no resources) must
	// not refresh the decider's clock either.
	clock.Advance(2 * time.Second)
	responder := (offer.Player + 1) % 3
	if err := a.Do(engine.Command{Player: responder, Type: engine.CmdRespondTrade,
		Data: mustJSONb(engine.TradeRespondedData{Accept: false})}); err != nil {
		t.Fatalf("respond_trade: %v", err)
	}
	if got := turnDeadlineOf(a); !got.Equal(deadline) {
		t.Errorf("a response moved the turn deadline %v -> %v (+%s)",
			deadline, got, got.Sub(deadline))
	}

	// Time passes, then the owner withdraws the offer: also not a turn action.
	clock.Advance(5 * time.Second)
	cancel := engine.Command{Player: offer.Player, Type: engine.CmdCancelTrade}
	if err := a.Do(cancel); err != nil {
		t.Fatalf("cancel_trade: %v", err)
	}
	if s := actorState(a); s.ActiveOffer != nil {
		t.Fatal("offer should be gone after cancel")
	}
	if got := turnDeadlineOf(a); !got.Equal(deadline) {
		t.Errorf("cancel moved the turn deadline %v -> %v (+%s)",
			deadline, got, got.Sub(deadline))
	}
}

// counterBot counters any standing offer it hasn't responded to, giving one
// card it actually holds and asking for a distinct resource. It abstains on its
// own turn and when holding nothing.
type counterBot struct{}

func (counterBot) Act(s *engine.State, seat engine.PlayerID) (engine.Command, bool) {
	o := s.ActiveOffer
	if o == nil || o.By == seat || o.Responded(seat) {
		return engine.Command{}, false
	}
	hand := s.Players[seat].Hand
	gi := -1
	for r := 1; r <= 5; r++ {
		if hand[r] > 0 {
			gi = r
			break
		}
	}
	if gi == -1 {
		return engine.Command{}, false
	}
	var give, want engine.Hand
	give[gi] = 1
	want[gi%5+1] = 1 // a distinct resource (no same-resource churn)
	data, _ := json.Marshal(engine.TradeCounteredData{Give: give, Want: want})
	return engine.Command{Player: seat, Type: engine.CmdCounterTrade, Data: data}, true
}

// TestOfferResponsePassDrivesBotCounter: when a human posts an offer,
// non-active bot seats are driven to respond (here both counter).
func TestOfferResponsePassDrivesBotCounter(t *testing.T) {
	st := openStore(t)
	clock := &fakeClock{}
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3, TurnTimerSec: 0})
	m := NewManager(st, clock)
	defer m.StopAll()
	a, _ := m.Get("g1")

	// Drive (all-human, no timer) until seat 0 is up in the play phase, has
	// rolled, and holds a resource to offer. Mirror + actor stay in lockstep.
	mirror := mirrorState(t, st, "g1")
	var offer engine.Command
	found := false
	for i := 0; i < 5000 && !found; i++ {
		if mirror.Phase == engine.PhasePlay && mirror.Cur == 0 && mirror.Rolled &&
			!mirror.RobberPending && len(mirror.PendingDiscards) == 0 {
			hand := mirror.Players[0].Hand
			for r := 1; r <= 5; r++ {
				if hand[r] > 0 {
					var give, want engine.Hand
					give[r] = 1
					want[r%5+1] = 1
					data, _ := json.Marshal(engine.TradeOfferedData{Give: give, Want: want})
					offer = engine.Command{Player: 0, Type: engine.CmdOfferTrade, Data: data}
					found = true
					break
				}
			}
		}
		if found {
			break
		}
		cmd, ok := engine.AutoCommand(mirror)
		if !ok {
			break
		}
		evs, err := engine.Decide(mirror, cmd)
		if err != nil {
			t.Fatalf("mirror decide %s: %v", cmd.Type, err)
		}
		for _, e := range evs {
			engine.Apply(mirror, e)
		}
		if err := a.Do(cmd); err != nil {
			t.Fatalf("actor.Do(%s): %v", cmd.Type, err)
		}
	}
	if !found {
		t.Fatal("never reached a seat-0 offerable state")
	}

	// Install countering bots on the two responder seats (they won't act
	// until asked, since it's seat 0's turn), then post the offer.
	a.SetSeatBot(1, counterBot{})
	a.SetSeatBot(2, counterBot{})
	if err := a.Do(offer); err != nil {
		t.Fatalf("offer: %v", err)
	}

	// The offer-response pass drives both bots to counter via ticks. Read the
	// count on the actor loop; actorState's shallow clone would share the
	// Counters slice and race the loop's appends.
	deadline := time.Now().Add(2 * time.Second)
	for {
		if n := activeCounters(a); n == 2 {
			break
		} else if time.Now().After(deadline) {
			t.Fatalf("want 2 bot counters from the offer-response pass, got %d", n)
		}
		time.Sleep(time.Millisecond)
	}
}

// offeringBot posts one trade offer per turn when it can afford to, and
// otherwise plays the minimal legal move. It is the offerer half of
// TestUnpacedBotOfferStillGetsAnswered.
type offeringBot struct{}

func (offeringBot) Act(s *engine.State, seat engine.PlayerID) (engine.Command, bool) {
	if s.Phase == engine.PhasePlay && s.Cur == seat && s.Rolled && s.ActiveOffer == nil &&
		!s.RobberPending && len(s.PendingDiscards) == 0 {
		hand := s.Players[seat].Hand
		for r := 1; r <= 5; r++ {
			if hand[r] > 0 {
				var give, want engine.Hand
				give[r] = 1
				want[r%5+1] = 1
				data, _ := json.Marshal(engine.TradeOfferedData{Give: give, Want: want})
				return engine.Command{Player: seat, Type: engine.CmdOfferTrade, Data: data}, true
			}
		}
	}
	return autoBot{}.Act(s, seat)
}

// TestUnpacedBotOfferStillGetsAnswered: an offer posted by an unpaced bot gets
// answered. runAutoSeats plays up to 64 bot actions without returning to the
// select, so the response tick would arrive after the offer was gone. Every
// seat here counters everything, so offers with no counters mean the response
// pass never ran. TestOfferResponsePassDrivesBotCounter covers a human
// offerer.
func TestUnpacedBotOfferStillGetsAnswered(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})
	m := NewManager(st, &fakeClock{}) // no bot delay: nothing yields mid-batch
	defer m.StopAll()
	a, err := m.Get("g1")
	if err != nil {
		t.Fatal(err)
	}
	a.SetSeatBot(0, offeringBot{})
	a.SetSeatBot(1, counterBot{})
	a.SetSeatBot(2, counterBot{})

	var offers, answers int
	deadline := time.Now().Add(10 * time.Second)
	for answers == 0 && time.Now().Before(deadline) {
		time.Sleep(2 * time.Millisecond)
		events, err := st.LoadEvents("g1", 0)
		if err != nil {
			t.Fatal(err)
		}
		offers, answers = 0, 0
		for _, e := range events {
			switch e.Type {
			case engine.EvTradeOffered:
				offers++
			case engine.EvTradeCountered, engine.EvTradeResponded:
				answers++
			default:
				// Every other event. This only counts two types, so default is
				// accurate (see default-signifies-exhaustive in .golangci.yml).
			}
		}
	}
	if offers == 0 {
		t.Fatal("the offering bot never made an offer")
	}
	if answers == 0 {
		t.Errorf("%d offers, 0 answers", offers)
	}
}

// activeCounters reads the standing offer's counter count on the actor loop.
func activeCounters(a *Actor) int {
	var n int
	a.call(func() {
		if a.state.ActiveOffer != nil {
			n = len(a.state.ActiveOffer.Counters)
		}
	})
	return n
}

// totalCards sums every hand plus the bank, read on the actor loop.
func totalCards(a *Actor) int {
	var n int
	a.call(func() {
		for i := range a.state.Players {
			n += a.state.Players[i].Hand.Count()
		}
		n += a.state.Bank.Count()
	})
	return n
}

// TestExecuteCounterConservesCards drives offer, counter and execute through
// the actor and asserts the total card count across hands and bank is
// conserved.
func TestExecuteCounterConservesCards(t *testing.T) {
	st := openStore(t)
	clock := &fakeClock{}
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3, TurnTimerSec: 0})
	m := NewManager(st, clock)
	defer m.StopAll()
	a, _ := m.Get("g1")

	// Drive (all-human) until seat 0 is up in play with a resource to offer and
	// seat 1 holds a *different* resource to counter with.
	mirror := mirrorState(t, st, "g1")
	var r0, r1 int
	found := false
	for i := 0; i < 8000 && !found; i++ {
		if mirror.Phase == engine.PhasePlay && mirror.Cur == 0 && mirror.Rolled &&
			!mirror.RobberPending && len(mirror.PendingDiscards) == 0 {
			r0 = firstHeld(mirror.Players[0].Hand, 0)
			r1 = firstHeld(mirror.Players[1].Hand, r0)
			if r0 != 0 && r1 != 0 {
				found = true
				break
			}
		}
		cmd, ok := engine.AutoCommand(mirror)
		if !ok {
			break
		}
		evs, err := engine.Decide(mirror, cmd)
		if err != nil {
			t.Fatalf("mirror decide %s: %v", cmd.Type, err)
		}
		for _, e := range evs {
			engine.Apply(mirror, e)
		}
		if err := a.Do(cmd); err != nil {
			t.Fatalf("actor.Do(%s): %v", cmd.Type, err)
		}
	}
	if !found {
		t.Fatal("seats 0 and 1 never held distinct resources")
	}

	before := totalCards(a)

	// Seat 0 offers r0 (for some other card); seat 1 counters with r1, asking
	// for r0 (which seat 0 holds); seat 0 executes against the counter.
	var give, want engine.Hand
	give[r0] = 1
	want[r0%5+1] = 1
	if err := a.Do(engine.Command{Player: 0, Type: engine.CmdOfferTrade,
		Data: mustJSONb(engine.TradeOfferedData{Give: give, Want: want})}); err != nil {
		t.Fatalf("offer: %v", err)
	}
	var cgive, cwant engine.Hand
	cgive[r1] = 1
	cwant[r0] = 1
	if err := a.Do(engine.Command{Player: 1, Type: engine.CmdCounterTrade,
		Data: mustJSONb(engine.TradeCounteredData{Give: cgive, Want: cwant})}); err != nil {
		t.Fatalf("counter: %v", err)
	}
	if err := a.Do(engine.Command{Player: 0, Type: engine.CmdExecuteTrade,
		Data: mustJSONb(map[string]any{"with": 1})}); err != nil {
		t.Fatalf("execute against counter: %v", err)
	}

	if s := actorState(a); s.ActiveOffer != nil {
		t.Error("offer should clear after executing the counter")
	}
	if after := totalCards(a); after != before {
		t.Errorf("card count changed across a counter trade: before %d, after %d", before, after)
	}
}

// firstHeld returns the lowest resource index (1..5) the hand holds in a
// positive amount other than `skip`, or 0 if none.
func firstHeld(h engine.Hand, skip int) int {
	for r := 1; r <= 5; r++ {
		if r != skip && h[r] > 0 {
			return r
		}
	}
	return 0
}

// mustJSONb marshals v to JSON for a command payload.
func mustJSONb(v any) json.RawMessage {
	b, _ := json.Marshal(v)
	return b
}

func TestAutoSeatActsImmediately(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})
	m := NewManager(st, &fakeClock{})
	defer m.StopAll()

	a, _ := m.Get("g1")
	a.SetSeatAuto(0, true) // host disconnected before placing anything

	s := actorState(a)
	if s.Cur != 1 {
		t.Errorf("auto seat 0 should have placed; cur = %d", s.Cur)
	}
	a.SetSeatAuto(0, false)
}

// forfeitCounter is a concurrency-safe per-seat tally for OnForfeit, which
// fires on the actor goroutine.
type forfeitCounter struct {
	mu     sync.Mutex
	counts map[engine.PlayerID]int
}

func newForfeitCounter() *forfeitCounter {
	return &forfeitCounter{counts: map[engine.PlayerID]int{}}
}

func (fc *forfeitCounter) record(seat engine.PlayerID) {
	fc.mu.Lock()
	defer fc.mu.Unlock()
	fc.counts[seat]++
}

func (fc *forfeitCounter) count(seat engine.PlayerID) int {
	fc.mu.Lock()
	defer fc.mu.Unlock()
	return fc.counts[seat]
}

func (fc *forfeitCounter) total() int {
	fc.mu.Lock()
	defer fc.mu.Unlock()
	n := 0
	for _, c := range fc.counts {
		n += c
	}
	return n
}

// pollSeqGrows waits until the actor's sequence number advances past prev,
// returning the new sequence, or false on timeout. For the instant
// (BotDelay==0) actor, which reschedules itself via the tick channel.
func pollSeqGrows(a *Actor, prev int) (int, bool) {
	for range 100000 {
		if got := actorState(a).NextSeq; got > prev {
			return got, true
		}
	}
	return prev, false
}

// TestForfeitFiresOnFirstBotMove asserts the forfeit fires when a bot first
// commits a move on a human-owned seat (not when the bot is installed), and
// stays at exactly one no matter how many further moves the bot makes.
func TestForfeitFiresOnFirstBotMove(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})

	fc := newForfeitCounter()
	a, err := Load("g1", st, Options{
		Clock:     &fakeClock{},
		OnForfeit: fc.record,
		Bots:      func(engine.PlayerID) CommandSource { return autoBot{} },
		Humans:    []engine.PlayerID{0, 1, 2},
	})
	if err != nil {
		t.Fatal(err)
	}
	defer a.Stop()

	// Installing the bot drives seat 0 (it is up at game start). The forfeit
	// lands on the bot's first committed move, not on install.
	a.SetSeatBot(0, autoBot{})
	for i := 0; i < 100000 && fc.count(0) == 0; i++ {
		actorState(a) // round-trips the loop, letting queued ticks run
	}
	if got := fc.count(0); got != 1 {
		t.Fatalf("seat 0 forfeit count = %d, want 1 after first bot move", got)
	}

	// Hand control back to the human, then take it over again; the forfeit must
	// not re-fire on subsequent bot moves.
	a.MarkPresent(0)
	a.SetSeatBot(0, autoBot{})
	// Drive several more bot moves on seat 0 by auto-passing the other seats so
	// play loops back to seat 0 repeatedly.
	a.SetSeatBot(1, autoBot{})
	a.SetSeatBot(2, autoBot{})
	seq := actorState(a).NextSeq
	for range 30 {
		next, ok := pollSeqGrows(a, seq)
		if !ok || actorState(a).Phase == engine.PhaseFinished {
			break
		}
		seq = next
	}
	if got := fc.count(0); got != 1 {
		t.Errorf("seat 0 forfeit count = %d, want exactly 1 across repeated bot moves", got)
	}
}

// TestOriginalBotDoesNotForfeit asserts a seat that was never human-owned
// (Humans omits it) never fires a forfeit even though a bot moves for it.
func TestOriginalBotDoesNotForfeit(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})

	fc := newForfeitCounter()
	// No humans: all seats are original bots.
	a, err := Load("g1", st, Options{
		Clock:     &fakeClock{},
		OnForfeit: fc.record,
		Bots:      func(engine.PlayerID) CommandSource { return autoBot{} },
		Humans:    nil,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer a.Stop()

	a.SetSeatBot(0, autoBot{})
	a.SetSeatBot(1, autoBot{})
	a.SetSeatBot(2, autoBot{})
	// Let the bots play many moves; none should ever forfeit.
	seq := actorState(a).NextSeq
	for range 50 {
		next, ok := pollSeqGrows(a, seq)
		if !ok || actorState(a).Phase == engine.PhaseFinished {
			break
		}
		seq = next
	}
	if got := fc.total(); got != 0 {
		t.Errorf("original bots forfeited %d times, want 0", got)
	}
}

// TestSuspendHaltsProgress asserts Suspend freezes autonomous progress (no
// bot/auto moves) and Resume lifts it.
func TestSuspendHaltsProgress(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})

	a, err := Load("g1", st, Options{
		Clock:  &fakeClock{},
		Bots:   func(engine.PlayerID) CommandSource { return autoBot{} },
		Humans: []engine.PlayerID{0, 1, 2},
	})
	if err != nil {
		t.Fatal(err)
	}
	defer a.Stop()

	a.Suspend()

	// Installing a bot while suspended must not drive any move.
	seq0 := actorState(a).NextSeq
	a.SetSeatBot(0, autoBot{})
	for range 2000 {
		if got := actorState(a).NextSeq; got != seq0 {
			t.Fatalf("game advanced while suspended: seq %d -> %d", seq0, got)
		}
	}

	// Resume lifts the suspension and nudges the owed bot seat back into play.
	a.Resume()
	advanced := false
	for i := 0; i < 100000 && !advanced; i++ {
		advanced = actorState(a).NextSeq > seq0
	}
	if !advanced {
		t.Fatalf("game did not advance after Resume (seq stuck at %d)", seq0)
	}
}

func TestFinishUpdatesGameRowAndStats(t *testing.T) {
	st := openStore(t)
	// Target 3: two setup settlements (2 VP) + first city upgrade wins.
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3, TargetVP: 3})
	m := NewManager(st, &fakeClock{})
	defer m.StopAll()

	a, _ := m.Get("g1")
	mirror := mirrorState(t, st, "g1")

	do := func(cmd engine.Command) {
		t.Helper()
		evs, err := engine.Decide(mirror, cmd)
		if err != nil {
			t.Fatalf("mirror %s: %v", cmd.Type, err)
		}
		for _, e := range evs {
			engine.Apply(mirror, e)
		}
		if err := a.Do(cmd); err != nil {
			t.Fatalf("actor %s: %v", cmd.Type, err)
		}
	}

	for i := 0; i < 20000 && mirror.Phase != engine.PhaseFinished; i++ {
		// Prefer a winning city upgrade when affordable.
		if mirror.Phase == engine.PhasePlay && mirror.Rolled && !mirror.RobberPending &&
			len(mirror.PendingDiscards) == 0 && mirror.Players[mirror.Cur].Hand.Has(engine.CostCity) {
			var spot json.RawMessage
			for v, b := range mirror.Buildings {
				if b.Owner == mirror.Cur && !b.City {
					spot, _ = json.Marshal(map[string]any{"v": v})
					break
				}
			}
			if spot != nil {
				do(engine.Command{Player: mirror.Cur, Type: engine.CmdBuildCity, Data: spot})
				continue
			}
		}
		cmd, ok := engine.AutoCommand(mirror)
		if !ok {
			break
		}
		do(cmd)
	}
	if mirror.Phase != engine.PhaseFinished {
		t.Fatalf("mirror game never finished (phase=%v)", mirror.Phase)
	}

	game, err := st.GameByID("g1")
	if err != nil {
		t.Fatal(err)
	}
	if game.Status != "finished" || game.Winner == nil {
		t.Fatalf("game row = %+v", game)
	}
	seats, _ := st.Seats("g1")
	var winnerUser int64
	for _, s := range seats {
		if engine.PlayerID(s.No) == mirror.Winner {
			winnerUser = s.UserID
		}
	}
	if *game.Winner != winnerUser {
		t.Errorf("winner user = %d, want %d", *game.Winner, winnerUser)
	}
	stats, _ := st.StatsFor(winnerUser)
	if len(stats) != 1 || stats[0].Wins != 1 || stats[0].Games != 1 {
		t.Errorf("winner stats = %+v", stats)
	}
}

func TestFinishSkipsForfeitedPlayers(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3, TargetVP: 3})
	m := NewManager(st, &fakeClock{})
	defer m.StopAll()

	seats, _ := st.Seats("g1")
	var userBySeat = map[engine.PlayerID]int64{}
	for _, s := range seats {
		userBySeat[engine.PlayerID(s.No)] = s.UserID
	}
	winnerUser := userBySeat[0]
	forfeitUser := userBySeat[2] // a non-winner forfeits
	loserUser := userBySeat[1]

	// Seat 2's user forfeited (a bot moved for them): no ranking credit.
	if err := st.RecordForfeit("g1", forfeitUser); err != nil {
		t.Fatal(err)
	}
	rBefore, _ := st.RatingRow(forfeitUser, "base")
	eloBefore := rBefore.Display

	// Drive the finish path directly with seat 0 as winner.
	m.finish("g1", 0)

	// Winner and the non-forfeited loser get a game played.
	if stats, _ := st.StatsFor(winnerUser); len(stats) != 1 || stats[0].Games != 1 || stats[0].Wins != 1 {
		t.Errorf("winner stats = %+v", stats)
	}
	if stats, _ := st.StatsFor(loserUser); len(stats) != 1 || stats[0].Games != 1 || stats[0].Wins != 0 {
		t.Errorf("loser stats = %+v", stats)
	}
	// Forfeited user is excluded from stats entirely (0 games played).
	if stats, _ := st.StatsFor(forfeitUser); len(stats) != 0 {
		t.Errorf("forfeited stats = %+v, want none", stats)
	}
	// Forfeited user's rating is untouched.
	if rAfter, _ := st.RatingRow(forfeitUser, "base"); rAfter.Display != eloBefore {
		t.Errorf("forfeited elo = %v, want unchanged %v", rAfter.Display, eloBefore)
	}
}

// TestActorEvictable checks evictability:
//  1. A fresh actor with no subscribers is not evictable (idle window not elapsed).
//  2. After the idle window with no commits or subscribers, it is evictable.
//  3. A live subscriber blocks eviction regardless of idle time.
func TestActorEvictable(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})
	clock := &fakeClock{}
	a, err := Load("g1", st, Options{Clock: clock})
	if err != nil {
		t.Fatal(err)
	}
	defer a.Stop()

	// Fresh actor: lastActivity == clock.Now() (both zero), so elapsed == 0 < idle.
	if a.Evictable(clock.Now(), time.Minute) {
		t.Fatal("fresh actor should not be evictable: idle window not elapsed")
	}

	// Advance past the idle window with no commits and no subscribers.
	clock.Advance(2 * time.Minute)
	if !a.Evictable(clock.Now(), time.Minute) {
		t.Fatal("idle, unsubscribed actor should be evictable")
	}

	// A live subscriber blocks eviction.
	sub, _ := a.Subscribe(Spectator)
	if a.Evictable(clock.Now(), time.Minute) {
		t.Fatal("subscribed actor must never be evicted")
	}
	sub.Close()
}

// TestActorForceFinishAtEventCap: once the live NextSeq exceeds EventCap the
// actor must force-finish the game via engine.ForceFinish, setting Phase to
// PhaseFinished with a deterministic winner.
func TestActorForceFinishAtEventCap(t *testing.T) {
	st := openStore(t)
	// seedGame seeds a 3-player game; engine.New produces exactly 2 initial
	// events (game_created + game_seeded), so NextSeq starts at 2.
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})

	// EventCap: 2 means NextSeq > 2 triggers the cap check. The first Do
	// command commits at least one event, pushing NextSeq past the cap.
	a, err := Load("g1", st, Options{
		Clock:    &fakeClock{},
		EventCap: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer a.Stop()

	// Confirm we start at or below the cap.
	if s := actorState(a); s.NextSeq > 2 {
		t.Fatalf("unexpected initial NextSeq=%d, want <=2", s.NextSeq)
	}

	// Drive the first legal auto-command through the actor. This commits at
	// least one event, crossing the EventCap threshold.
	mirror := mirrorState(t, st, "g1")
	cmd, ok := engine.AutoCommand(mirror)
	if !ok {
		t.Fatal("no auto command available at game start")
	}
	if err := a.Do(cmd); err != nil {
		t.Fatalf("Do(%s): %v", cmd.Type, err)
	}

	// The actor must have force-finished: Phase == PhaseFinished with a winner.
	var phase engine.Phase
	var winner engine.PlayerID
	a.call(func() {
		phase = a.state.Phase
		winner = a.state.Winner
	})
	if phase != engine.PhaseFinished {
		t.Fatalf("phase=%v after exceeding EventCap, want PhaseFinished", phase)
	}
	if winner == engine.NoPlayer {
		t.Errorf("winner=%v after force-finish, want a valid player", winner)
	}

	// The force-finish event must be durable: reload from the store and confirm.
	events, err := st.LoadEvents("g1", 0)
	if err != nil {
		t.Fatal(err)
	}
	var foundFinish bool
	for _, e := range events {
		if e.Type == engine.EvGameFinished {
			foundFinish = true
			break
		}
	}
	if !foundFinish {
		t.Error("game_finished event not persisted to the store after EventCap trigger")
	}
}
