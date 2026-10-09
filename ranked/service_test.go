package ranked

import (
	"errors"
	"sync"
	"testing"

	"github.com/ftqo/costan.io/store"
)

type fakeMatcher struct{ made [][]int64 }

func (f *fakeMatcher) CreateRankedMatch(_ string, ids []int64) (string, error) {
	f.made = append(f.made, ids)
	return "game-x", nil
}

type fakeNotifier struct{ notified map[int64]string }

func (f *fakeNotifier) MatchFound(u int64, g string) { f.notified[u] = g }

type fakeRatings struct{ cooldown map[int64]int64 }

func (f *fakeRatings) RatingRow(u int64, _ string) (store.Rating, error) {
	return store.Rating{Mu: 25, Sigma: 6, Display: 1000}, nil
}
func (f *fakeRatings) RankedCooldownUntil(u int64) (int64, error) { return f.cooldown[u], nil }

func TestServiceFormsAndNotifies(t *testing.T) {
	m := &fakeMatcher{}
	n := &fakeNotifier{notified: map[int64]string{}}
	r := &fakeRatings{cooldown: map[int64]int64{}}
	now := int64(0)
	svc := NewService(m, n, r, func() int64 { return now })
	for _, id := range []int64{1, 2, 3, 4} {
		if err := svc.Join(id, "base"); err != nil {
			t.Fatal(err)
		}
	}
	svc.Tick()
	if len(m.made) != 1 || len(m.made[0]) != 4 {
		t.Fatalf("expected one 4-player match, got %v", m.made)
	}
	for _, id := range []int64{1, 2, 3, 4} {
		if n.notified[id] != "game-x" {
			t.Fatalf("user %d not notified", id)
		}
		if _, q, _ := svc.Status(id); q {
			t.Fatalf("user %d should be dequeued after match", id)
		}
	}
}

func TestServiceRejectsCooldown(t *testing.T) {
	r := &fakeRatings{cooldown: map[int64]int64{9: 5000}}
	svc := NewService(&fakeMatcher{}, &fakeNotifier{notified: map[int64]string{}}, r, func() int64 { return 1000 })
	if err := svc.Join(9, "base"); err == nil {
		t.Fatal("join under active cooldown must be rejected")
	}
}

// TestServiceReenqueuesOnMatchFailure verifies that when CreateRankedMatch returns
// an error, all matched players are re-inserted into the queue (with their original
// joinedTick) rather than silently dropped, and that a subsequent Tick retries.
func TestServiceReenqueuesOnMatchFailure(t *testing.T) {
	var matcher struct {
		calls int
	}
	matcherImpl := matcherFunc(func(_ string, ids []int64) (string, error) {
		matcher.calls++
		return "", errors.New("boom")
	})

	n := &fakeNotifier{notified: map[int64]string{}}
	r := &fakeRatings{cooldown: map[int64]int64{}}
	now := int64(0)
	svc := NewService(matcherImpl, n, r, func() int64 { return now })

	for _, id := range []int64{1, 2, 3, 4} {
		if err := svc.Join(id, "base"); err != nil {
			t.Fatal(err)
		}
	}

	svc.Tick()

	// Matcher must have been called.
	if matcher.calls == 0 {
		t.Fatal("expected matcher to be called, calls == 0")
	}
	// No MatchFound notifications must have been delivered.
	if len(n.notified) != 0 {
		t.Fatalf("expected no MatchFound notifications, got %v", n.notified)
	}
	// All 4 users must still be queued.
	for _, id := range []int64{1, 2, 3, 4} {
		if _, q, _ := svc.Status(id); !q {
			t.Fatalf("user %d should still be queued after match failure", id)
		}
	}

	// A second Tick must retry the matcher (calls increases).
	prevCalls := matcher.calls
	svc.Tick()
	if matcher.calls <= prevCalls {
		t.Fatalf("expected matcher retried on second Tick, calls did not increase (%d -> %d)", prevCalls, matcher.calls)
	}
}

// matcherFunc is an adapter so a plain function satisfies Matcher.
type matcherFunc func(queueKey string, ids []int64) (string, error)

func (f matcherFunc) CreateRankedMatch(queueKey string, ids []int64) (string, error) {
	return f(queueKey, ids)
}

// TestServiceConcurrentJoinLeaveTick exercises the service's mutex under -race:
// multiple goroutines call Join/Leave concurrently while another goroutine ticks,
// then asserts the service is in a consistent state (no user is in inQueue without
// being in a pool).
func TestServiceConcurrentJoinLeaveTick(t *testing.T) {
	m := &fakeMatcher{}
	n := &fakeNotifier{notified: map[int64]string{}}
	r := &fakeRatings{cooldown: map[int64]int64{}}
	svc := NewService(m, n, r, func() int64 { return 0 })

	const (
		numUsers   = 20
		iterations = 50
	)
	var wg sync.WaitGroup

	// Ticker goroutine.
	wg.Go(func() {
		for range iterations {
			svc.Tick()
		}
	})

	// Join/Leave goroutines: one per user, interleaved to maximize lock contention.
	for uid := int64(100); uid < 100+numUsers; uid++ {

		wg.Go(func() {
			for range iterations {
				_ = svc.Join(uid, "base")
				svc.Leave(uid)
			}
		})
	}

	wg.Wait()

	// After everything settles, run one final Tick and check consistency:
	// every user tracked in inQueue must appear in their pool.
	svc.Tick()
	svc.mu.Lock()
	defer svc.mu.Unlock()
	for uid, qk := range svc.inQueue {
		found := false
		for _, e := range svc.pools[qk] {
			if e.userID == uid {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("user %d is in inQueue[%q] but not in its pool", uid, qk)
		}
	}
}
