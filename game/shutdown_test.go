package game

import (
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ftqo/costan.io/engine"
)

// TestStopJoinsSnapshotWorker: Actor.Stop must not return while the snapshot
// worker (a store writer with its own transaction) is on its way into
// SaveSnapshot, or store.Close could run under it. The test parks the worker
// in that window and asserts Stop is blocked; "the snapshot eventually lands"
// would pass either way.
func TestStopJoinsSnapshotWorker(t *testing.T) {
	inside := make(chan struct{})
	release := make(chan struct{})
	var wrote atomic.Bool
	// Set before the actor exists and never mutated after, so the worker's read
	// is ordered by the goroutine that starts it.
	beforeSnapshotSave = func() {
		close(inside)
		<-release
		wrote.Store(true)
	}
	t.Cleanup(func() { beforeSnapshotSave = nil })

	st := openStore(t)
	seedGame(t, st, "g-snap", 3, engine.GameConfig{Players: 3})
	a, err := Load("g-snap", st, Options{})
	if err != nil {
		t.Fatal(err)
	}
	// Queue a snapshot the way a commit crossing snapshotEvery does.
	a.queueSnapshot(snapPending{seq: 1, blob: []byte{snapshotVersion}})
	select {
	case <-inside:
	case <-time.After(5 * time.Second):
		t.Fatal("snapshot worker never reached the store write")
	}

	stopped := make(chan struct{})
	go func() { a.Stop(); close(stopped) }()
	select {
	case <-stopped:
		t.Fatal("Stop returned while the snapshot worker was still writing")
	case <-time.After(200 * time.Millisecond):
	}
	close(release)
	select {
	case <-stopped:
	case <-time.After(5 * time.Second):
		t.Fatal("Stop did not return after the snapshot worker was released")
	}
	if !wrote.Load() {
		t.Fatal("Stop returned before the snapshot write completed")
	}
}

// TestDoOnStoppedActorReportsRefusal: a command sent to a stopped actor
// (reaped, evicted, shutting down) must get the specific ErrGameStopped
// refusal, not a nil error that tells the player their move landed.
func TestDoOnStoppedActorReportsRefusal(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g-do", 3, engine.GameConfig{Players: 3})
	a, err := Load("g-do", st, Options{})
	if err != nil {
		t.Fatal(err)
	}
	a.Stop()

	before, err := st.LoadEvents("g-do", 0)
	if err != nil {
		t.Fatal(err)
	}
	cmd, ok := engine.AutoCommand(a.state)
	if !ok {
		t.Fatal("no auto command available for the seeded game")
	}
	got := a.Do(cmd)
	if got == nil {
		t.Fatal("Do returned nil for a stopped actor")
	}
	if !errors.Is(got, ErrGameStopped) {
		t.Fatalf("Do = %v, want ErrGameStopped", got)
	}
	// The refusal must be a refusal, not a partial write.
	after, err := st.LoadEvents("g-do", 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(after) != len(before) {
		t.Fatalf("stopped actor persisted %d events", len(after)-len(before))
	}
	// It must have player-facing copy; otherwise the client would show the
	// generic "that move isn't allowed".
	if code := engine.ErrorCode(ErrGameStopped); code != "GAME_STOPPED" {
		t.Errorf("ErrorCode = %q, want GAME_STOPPED", code)
	}
}

// TestCallReportsWhetherItRan pins the primitive under
// TestDoOnStoppedActorReportsRefusal: call() must report when it did not run
// the function.
func TestCallReportsWhetherItRan(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g-call", 3, engine.GameConfig{Players: 3})
	a, err := Load("g-call", st, Options{})
	if err != nil {
		t.Fatal(err)
	}
	ran := false
	if !a.call(func() { ran = true }) || !ran {
		t.Fatal("call on a live actor reported false or did not run fn")
	}
	a.Stop()
	ran = false
	if a.call(func() { ran = true }) {
		t.Fatal("call reported success on a stopped actor")
	}
	if ran {
		t.Fatal("call ran fn on a stopped actor")
	}
}

// TestStopAllJoinsInFlightLoad: by the post-load re-check, load has already
// started the actor's loop (which can AppendEvents) and snapshot worker, so
// refusing to install the actor is not enough; StopAll must wait for the
// refusing Stop. The test parks a load mid-replay, runs StopAll, and asserts
// StopAll blocks until the load has finished refusing.
func TestStopAllJoinsInFlightLoad(t *testing.T) {
	inLoad := make(chan struct{})
	release := make(chan struct{})
	beforeLoad = func() {
		close(inLoad)
		<-release
	}
	t.Cleanup(func() { beforeLoad = nil })

	st := openStore(t)
	seedGame(t, st, "g-load", 3, engine.GameConfig{Players: 3})
	m := NewManager(st, nil)

	var getErr atomic.Value
	getDone := make(chan struct{})
	go func() {
		defer close(getDone)
		_, err := m.Get("g-load")
		if err != nil {
			getErr.Store(err)
		}
	}()
	select {
	case <-inLoad:
	case <-time.After(5 * time.Second):
		t.Fatal("load never started")
	}

	stopped := make(chan struct{})
	go func() { m.StopAll(); close(stopped) }()
	select {
	case <-stopped:
		t.Fatal("StopAll returned with a load still in flight")
	case <-time.After(200 * time.Millisecond):
	}
	close(release)
	select {
	case <-stopped:
	case <-time.After(20 * time.Second):
		t.Fatal("StopAll did not return after the load was released")
	}
	// The Get's Leave happens just before its return; a short grace keeps the
	// assertion about store work rather than goroutine scheduling.
	select {
	case <-getDone:
	case <-time.After(2 * time.Second):
		t.Fatal("StopAll returned before the refusing Get had finished")
	}
	if err, _ := getErr.Load().(error); !errors.Is(err, ErrShuttingDown) {
		t.Fatalf("Get = %v, want ErrShuttingDown", err)
	}
}

// TestGetAfterStopAllNeverLoads: once shutdown has begun, a Get must refuse
// before registering anything.
func TestGetAfterStopAllNeverLoads(t *testing.T) {
	var loaded atomic.Bool
	beforeLoad = func() { loaded.Store(true) }
	t.Cleanup(func() { beforeLoad = nil })

	st := openStore(t)
	seedGame(t, st, "g-late", 3, engine.GameConfig{Players: 3})
	m := NewManager(st, nil)
	m.StopAll()
	if _, err := m.Get("g-late"); !errors.Is(err, ErrShuttingDown) {
		t.Fatalf("Get after StopAll = %v, want ErrShuttingDown", err)
	}
	if loaded.Load() {
		t.Fatal("Get loaded a game after StopAll")
	}
}

// TestStopAllJoinsIdleSweep: a sweep that starts just before StopAll must be
// joined, since it calls Release, Actor.Stop and so the store. The reaper
// fires on m.clock, so the test drives the same entry point the timer
// callback uses.
func TestStopAllJoinsIdleSweep(t *testing.T) {
	st := openStore(t)
	m := NewManager(st, nil)

	inSweep := make(chan struct{})
	release := make(chan struct{})
	var swept atomic.Bool
	// recoverSweep is the seam for a background pass with test-controlled
	// timing; the idle sweep has the same shape.
	m.recoverSweep = func() {
		close(inSweep)
		<-release
		swept.Store(true)
	}
	m.StartReaper()
	select {
	case <-inSweep:
	case <-time.After(5 * time.Second):
		t.Fatal("background sweep never started")
	}

	stopped := make(chan struct{})
	go func() { m.StopAll(); close(stopped) }()
	select {
	case <-stopped:
		t.Fatal("StopAll returned while a background sweep was still running")
	case <-time.After(200 * time.Millisecond):
	}
	close(release)
	select {
	case <-stopped:
	case <-time.After(20 * time.Second):
		t.Fatal("StopAll did not return after the sweep was released")
	}
	if !swept.Load() {
		t.Fatal("StopAll returned before the sweep finished")
	}
}

// TestReaperRefusesToStartAfterStopAll: the reaper callback must not begin a
// sweep once shutdown has started, and must not reschedule itself.
func TestReaperRefusesToStartAfterStopAll(t *testing.T) {
	st := openStore(t)
	m := NewManager(st, nil)
	m.StopAll()
	// Enter is the callback's gate; after StopAll it refuses, so neither the
	// sweep nor the reschedule runs.
	if m.bg.Enter() {
		m.bg.Leave()
		t.Fatal("Manager background work could still be registered after StopAll")
	}
	if !m.stopping() {
		t.Fatal("stopping() false after StopAll")
	}
}

// TestStopAllJoinsIdleReaperCallback drives the idle-sweep race through the
// real entry point, startReaper's self-rescheduling timer callback, with the
// sweep parked inside Release, Actor.Stop and the snapshot worker's store
// write.
func TestStopAllJoinsIdleReaperCallback(t *testing.T) {
	inSave := make(chan struct{})
	release := make(chan struct{})
	beforeSnapshotSave = func() {
		close(inSave)
		<-release
	}
	t.Cleanup(func() { beforeSnapshotSave = nil })

	st := openStore(t)
	seedGame(t, st, "g-reap", 3, engine.GameConfig{Players: 3})
	clock := &fakeClock{now: time.Unix(1700000000, 0)}
	m := NewManager(st, clock)
	m.SetIdleEvict(time.Millisecond)

	a, err := m.Get("g-reap")
	if err != nil {
		t.Fatal(err)
	}
	// Idle long enough to be evictable, and with a snapshot queued so the
	// eviction's Actor.Stop has a store write to wait for.
	clock.Advance(time.Hour)
	a.queueSnapshot(snapPending{seq: 1, blob: []byte{snapshotVersion}})
	select {
	case <-inSave:
	case <-time.After(5 * time.Second):
		t.Fatal("snapshot worker never reached the store write")
	}

	m.startReaper()
	sweepDone := make(chan struct{})
	go func() { defer close(sweepDone); clock.Fire() }() // runs the reaper callback

	stopped := make(chan struct{})
	go func() { m.StopAll(); close(stopped) }()
	select {
	case <-stopped:
		t.Fatal("StopAll returned while the idle reaper was mid-eviction")
	case <-time.After(300 * time.Millisecond):
	}
	close(release)
	select {
	case <-stopped:
	case <-time.After(30 * time.Second):
		t.Fatal("StopAll did not return after the reaper was released")
	}
	select {
	case <-sweepDone:
	default:
		t.Fatal("StopAll returned before the idle sweep had finished")
	}
}
