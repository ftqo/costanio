package lifecycle

import (
	"runtime"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// TestWaitJoinsMembers: Wait must not return while a member is still running.
// A Group that only signalled would fail this.
func TestWaitJoinsMembers(t *testing.T) {
	var g Group
	inside := make(chan struct{})
	release := make(chan struct{})
	var left atomic.Bool
	if !g.Go(func() {
		close(inside)
		<-release
		left.Store(true)
	}) {
		t.Fatal("Go refused on a fresh group")
	}
	<-inside
	g.Stop()

	returned := make(chan bool, 1)
	go func() { returned <- g.Wait(time.Second) }()
	select {
	case <-returned:
		t.Fatal("Wait returned while a member was still running")
	case <-time.After(50 * time.Millisecond):
	}
	close(release)
	if ok := <-returned; !ok {
		t.Fatal("Wait reported a timeout for a member that finished")
	}
	if !left.Load() {
		t.Fatal("member had not finished when Wait returned")
	}
}

// TestStopRefusesNewMembers: after Stop, Enter and Go must refuse, so the set of
// tracked goroutines can only shrink and Wait is guaranteed to terminate.
func TestStopRefusesNewMembers(t *testing.T) {
	var g Group
	g.Stop()
	if g.Enter() {
		t.Error("Enter succeeded after Stop")
	}
	ran := false
	if g.Go(func() { ran = true }) {
		t.Error("Go succeeded after Stop")
	}
	time.Sleep(20 * time.Millisecond)
	if ran {
		t.Error("Go ran fn after Stop")
	}
	if !g.IsStopping() {
		t.Error("IsStopping false after Stop")
	}
	select {
	case <-g.Stopping():
	default:
		t.Error("Stopping channel not closed after Stop")
	}
}

// TestStoppingClosedWhenRequestedAfterStop: Stopping is lazily created, so a
// caller that asks for the channel only after Stop must still get a closed one.
func TestStoppingClosedWhenRequestedAfterStop(t *testing.T) {
	var g Group
	g.Stop()
	select {
	case <-g.Stopping():
	case <-time.After(time.Second):
		t.Fatal("Stopping channel obtained after Stop was not closed")
	}
}

// TestWaitBudget: a wedged member must not hang shutdown forever.
func TestWaitBudget(t *testing.T) {
	var g Group
	release := make(chan struct{})
	g.Go(func() { <-release })
	g.Stop()
	if g.Wait(20 * time.Millisecond) {
		t.Error("Wait reported success with a wedged member")
	}
	close(release)
	if !g.Wait(time.Second) {
		t.Error("Wait failed after the member was released")
	}
}

// TestEnterStopRace: Enter must not register a member concurrently with, or
// after, the Wait meant to cover it. Under -race (and Go's own WaitGroup
// misuse panic) this fails if it does.
func TestEnterStopRace(t *testing.T) {
	for range 500 {
		var g Group
		var entered, refused, finished atomic.Int64
		var callers sync.WaitGroup
		for range 8 {
			callers.Go(func() {
				if !g.Enter() {
					refused.Add(1)
					return
				}
				entered.Add(1)
				// A member does work between Enter and Leave; without it the
				// window is too narrow to observe and an ungated Enter passes.
				for range 50 {
					runtime.Gosched()
				}
				finished.Add(1)
				g.Leave()
			})
		}
		g.Stop()
		if !g.Wait(5 * time.Second) {
			t.Fatal("Wait timed out")
		}
		// Everything that got in must have finished before Wait returned.
		if e, f := entered.Load(), finished.Load(); e != f {
			t.Fatalf("Wait returned with %d of %d members still running", e-f, e)
		}
		callers.Wait()
		if got := entered.Load() + refused.Load(); got != 8 {
			t.Fatalf("accounted for %d of 8 callers", got)
		}
	}
}

// TestStopAndWaitIdempotent: shutdown paths call Stop from more than one place
// (a signal handler and a deferred Close), and a second call must be harmless.
func TestStopAndWaitIdempotent(t *testing.T) {
	var g Group
	g.Go(func() {})
	if !g.StopAndWait(time.Second) {
		t.Fatal("first StopAndWait timed out")
	}
	if !g.StopAndWait(time.Second) {
		t.Fatal("second StopAndWait timed out")
	}
}
