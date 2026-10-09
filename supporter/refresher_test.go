package supporter

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/ftqo/costan.io/discord"
	"github.com/ftqo/costan.io/store"
)

type fakeFetcher struct {
	roles []string
	err   error
	calls int
}

func (f *fakeFetcher) GuildMemberRoles(_ context.Context, _ string) ([]string, error) {
	f.calls++
	return f.roles, f.err
}

func newRefresher(t *testing.T, fetch RolesFetcher, maxAge time.Duration) (*Refresher, *store.Store, int64) {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { st.Close() })
	u, err := st.UpsertDiscordUser("disc123", "ann", "")
	if err != nil {
		t.Fatal(err)
	}
	r := NewRefresher(cfg(t, "boost1:boost"), fetch, st, maxAge)
	return r, st, u.ID
}

func TestRefreshActivatesAndDeactivates(t *testing.T) {
	f := &fakeFetcher{roles: []string{"boost1"}}
	r, st, uid := newRefresher(t, f, time.Minute)

	if err := r.Refresh(context.Background(), uid); err != nil {
		t.Fatal(err)
	}
	if sup, _ := st.Supporter(uid); !sup.Active {
		t.Fatal("should be active after pulling a granting role")
	}
	// Role removed on Discord's side: next pull deactivates.
	f.roles = []string{"plain"}
	if err := r.Refresh(context.Background(), uid); err != nil {
		t.Fatal(err)
	}
	if sup, _ := st.Supporter(uid); sup.Active {
		t.Fatal("should be inactive after the role is gone")
	}
}

// OnChange fires only when a Refresh actually changes the user's status, so
// no-op refreshes push nothing.
func TestRefreshOnChangeFiresOnlyOnChange(t *testing.T) {
	f := &fakeFetcher{roles: []string{"boost1"}}
	r, _, uid := newRefresher(t, f, time.Minute)

	var fired []int64
	r.SetOnChange(func(id int64) { fired = append(fired, id) })

	// inactive -> active: status changed, fire once.
	if err := r.Refresh(context.Background(), uid); err != nil {
		t.Fatal(err)
	}
	if len(fired) != 1 || fired[0] != uid {
		t.Fatalf("OnChange = %v; want [%d] after activation", fired, uid)
	}

	// same roles again: no change, must not fire.
	if err := r.Refresh(context.Background(), uid); err != nil {
		t.Fatal(err)
	}
	if len(fired) != 1 {
		t.Fatalf("OnChange fired %d times; a no-op refresh must not fire", len(fired))
	}

	// role removed -> inactive: status changed, fire again.
	f.roles = []string{"plain"}
	if err := r.Refresh(context.Background(), uid); err != nil {
		t.Fatal(err)
	}
	if len(fired) != 2 || fired[1] != uid {
		t.Fatalf("OnChange = %v; want a second fire on deactivation", fired)
	}
}

func TestRefreshNotMemberIsInactive(t *testing.T) {
	f := &fakeFetcher{err: discord.ErrNotMember}
	r, st, uid := newRefresher(t, f, time.Minute)
	if err := r.Refresh(context.Background(), uid); err != nil {
		t.Fatalf("not-member should not error: %v", err)
	}
	if sup, _ := st.Supporter(uid); sup.Active {
		t.Fatal("non-member must be inactive")
	}
}

func TestRefreshTransientErrorKeepsCache(t *testing.T) {
	f := &fakeFetcher{roles: []string{"boost1"}}
	r, st, uid := newRefresher(t, f, time.Minute)
	r.Refresh(context.Background(), uid) // active

	f.err = errors.New("discord 500")
	if err := r.Refresh(context.Background(), uid); err == nil {
		t.Fatal("transient error should propagate")
	}
	if sup, _ := st.Supporter(uid); !sup.Active {
		t.Fatal("transient error deactivated an active supporter")
	}
}

func TestEnsureFreshCaches(t *testing.T) {
	f := &fakeFetcher{roles: []string{"boost1"}}
	r, _, uid := newRefresher(t, f, time.Hour)
	base := time.Now().Unix()
	r.now = func() int64 { return base }

	// First call: no snapshot yet, so it pulls.
	r.EnsureFresh(context.Background(), uid)
	if f.calls != 1 {
		t.Fatalf("first EnsureFresh calls = %d; want 1", f.calls)
	}
	// Within maxAge: no pull.
	r.EnsureFresh(context.Background(), uid)
	if f.calls != 1 {
		t.Fatalf("cached EnsureFresh calls = %d; want still 1", f.calls)
	}
	// Past maxAge: pulls again.
	r.now = func() int64 { return base + 7200 }
	r.EnsureFresh(context.Background(), uid)
	if f.calls != 2 {
		t.Fatalf("stale EnsureFresh calls = %d; want 2", f.calls)
	}
}

func TestSweepCatchesLapse(t *testing.T) {
	f := &fakeFetcher{roles: []string{"boost1"}}
	r, st, uid := newRefresher(t, f, time.Minute)
	r.Refresh(context.Background(), uid) // active now

	// Simulate time passing so the snapshot is stale, and the role being gone.
	r.now = func() int64 { return time.Now().Unix() + 7200 }
	f.roles = nil
	n, err := r.Sweep(context.Background(), time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("swept %d; want 1", n)
	}
	if sup, _ := st.Supporter(uid); sup.Active {
		t.Fatal("sweep should have deactivated the lapsed supporter")
	}
}

func TestGuestSkipped(t *testing.T) {
	f := &fakeFetcher{roles: []string{"boost1"}}
	st, err := store.Open(filepath.Join(t.TempDir(), "g.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	g, _ := st.CreateGuest("guest")
	r := NewRefresher(cfg(t, "boost1:boost"), f, st, time.Minute)
	if err := r.Refresh(context.Background(), g.ID); err != nil {
		t.Fatal(err)
	}
	if f.calls != 0 {
		t.Fatal("guests (no discord id) should not hit Discord")
	}
}
