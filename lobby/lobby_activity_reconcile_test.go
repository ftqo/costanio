package lobby

import (
	"errors"
	"testing"
)

// TestReconcileActivityParticipants verifies that the host-authoritative
// reconcile drops seated humans whose Discord account has left the activity,
// while never touching the host or bot seats.
func TestReconcileActivityParticipants(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "d1", "host")
	alice := discordUser(t, st, "d2", "alice")
	bob := discordUser(t, st, "d3", "bob")

	sum, _, err := l.ActivityLobby(host, "inst-1")
	if err != nil {
		t.Fatal(err)
	}
	gid := sum.Game.ID
	if _, _, err := l.ActivityLobby(alice, "inst-1"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := l.ActivityLobby(bob, "inst-1"); err != nil {
		t.Fatal(err)
	}
	// Fill the last seat with a bot so we can prove bots survive reconcile.
	if _, err := l.AddBot(host, gid); err != nil {
		t.Fatal(err)
	}

	seatedUser := func(s *Summary, uid int64) bool {
		for _, st := range s.Seats {
			if st.UserID == uid {
				return true
			}
		}
		return false
	}

	// alice (d2) has left the activity; host (d1) and bob (d3) remain present.
	got, err := l.ReconcileActivityParticipants(host, "inst-1", []string{"d1", "d3"})
	if err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if seatedUser(got, alice.ID) {
		t.Errorf("alice should have been removed after leaving the activity")
	}
	if !seatedUser(got, host.ID) {
		t.Errorf("host must never be removed")
	}
	if !seatedUser(got, bob.ID) {
		t.Errorf("bob is still present and must keep his seat")
	}
	// The bot seat must survive; bots are not activity participants.
	bots := 0
	for _, s := range got.Seats {
		if s.Status == "bot" {
			bots++
		}
	}
	if bots != 1 {
		t.Errorf("bot seat count = %d, want 1 (bots are never reconciled away)", bots)
	}
}

// TestReconcileActivityParticipantsHostOnly verifies only the host may reconcile
// and that the host survives even when omitted from the present set (defensive).
func TestReconcileActivityParticipantsHostOnly(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "d1", "host")
	alice := discordUser(t, st, "d2", "alice")

	sum, _, err := l.ActivityLobby(host, "inst-2")
	if err != nil {
		t.Fatal(err)
	}
	gid := sum.Game.ID
	if _, _, err := l.ActivityLobby(alice, "inst-2"); err != nil {
		t.Fatal(err)
	}

	// A non-host caller is rejected and changes nothing.
	if _, err := l.ReconcileActivityParticipants(alice, "inst-2", []string{"d2"}); !errors.Is(err, ErrNotHost) {
		t.Fatalf("non-host reconcile err = %v, want ErrNotHost", err)
	}
	if s, err := st.Seats(gid); err != nil || len(s) != 2 {
		t.Fatalf("seats after rejected reconcile = %d (err %v), want 2", len(s), err)
	}

	// Host reconciling with an empty present set still keeps its own seat but
	// drops everyone else.
	got, err := l.ReconcileActivityParticipants(host, "inst-2", nil)
	if err != nil {
		t.Fatalf("host reconcile: %v", err)
	}
	if len(got.Seats) != 1 || got.Seats[0].UserID != host.ID {
		t.Errorf("after empty reconcile seats = %+v, want host only", got.Seats)
	}
}
