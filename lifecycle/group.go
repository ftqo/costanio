// Package lifecycle provides Group, the owner for goroutines that touch a
// shared resource (the store) and must have exited before it is closed.
// Signalling a goroutine to stop is not the same as waiting for it: store
// Close runs on main's deferred stack, and anything still inside a store call
// then is a use-after-close.
//
// A Group combines:
//
//   - a stop channel, so a long-running goroutine can notice shutdown;
//   - a WaitGroup, so shutdown joins what it signalled;
//   - a gate between them, so nothing can register after the join has begun
//     (Add racing Wait).
package lifecycle

import (
	"sync"
	"time"
)

// Group tracks the goroutines that must not still be running when a shared
// resource (the SQLite store) is closed.
//
// A Group runs, then stops, and never runs again. After Stop, Go and Enter
// refuse, so the tracked set can only shrink and Wait makes progress.
//
// The zero value is ready to use.
type Group struct {
	mu      sync.Mutex
	wg      sync.WaitGroup
	stopped bool
	ch      chan struct{}
}

// Stopping returns a channel closed by Stop. Long-running members select on
// it to leave promptly; it does not mean anyone has finished. Never nil.
func (g *Group) Stopping() <-chan struct{} {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.chanLocked()
}

func (g *Group) chanLocked() chan struct{} {
	if g.ch == nil {
		g.ch = make(chan struct{})
		if g.stopped {
			close(g.ch)
		}
	}
	return g.ch
}

// IsStopping reports whether Stop has been called.
func (g *Group) IsStopping() bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.stopped
}

// Enter registers one goroutine (or one bounded span of work on an existing
// goroutine) with the group, returning false if shutdown has begun. On true
// the caller must call Leave exactly once.
//
// Registration and the stopping check are one atomic step under g.mu, and
// Stop takes the same mutex before Wait can run. A caller that sees true has
// incremented the WaitGroup before any Wait observed the count; a caller that
// races Stop sees false and never starts.
func (g *Group) Enter() bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.stopped {
		return false
	}
	g.wg.Add(1)
	return true
}

// Leave marks one Enter as finished.
func (g *Group) Leave() { g.wg.Done() }

// Go runs fn in a new goroutine tracked by the group, or returns false without
// running it if shutdown has begun.
func (g *Group) Go(fn func()) bool {
	if !g.Enter() {
		return false
	}
	go func() {
		defer g.Leave()
		fn()
	}()
	return true
}

// Stop closes the stopping channel and refuses further registration. Idempotent
// and safe from any goroutine. It does not wait: pair it with Wait.
func (g *Group) Stop() {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.stopped {
		return
	}
	g.stopped = true
	if g.ch != nil {
		close(g.ch)
	}
}

// Wait joins every member, reporting false if the budget ran out first. It
// does not call Stop; callers Stop first.
//
// The budget keeps a wedged member from hanging shutdown. A false return is a
// degraded shutdown the caller should log, since the resource is about to be
// closed under a live user. A zero or negative budget waits without bound.
func (g *Group) Wait(budget time.Duration) bool {
	if budget <= 0 {
		g.wg.Wait()
		return true
	}
	done := make(chan struct{})
	go func() { defer close(done); g.wg.Wait() }()
	t := time.NewTimer(budget)
	defer t.Stop()
	select {
	case <-done:
		return true
	case <-t.C:
		return false
	}
}

// StopAndWait is Stop followed by Wait.
func (g *Group) StopAndWait(budget time.Duration) bool {
	g.Stop()
	return g.Wait(budget)
}
