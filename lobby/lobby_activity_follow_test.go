package lobby

import (
	"testing"
)

// A Discord Activity instance points at one table, which changes over a call:
// the host rematches after a game, resets a live game, or the table is torn
// down. Each test checks the pointer follows, so the next opener doesn't land
// in a room that will never start.

// TestActivityLobbyFollowsRematch verifies a late opener gets the rematch table,
// not the finished one.
func TestActivityLobbyFollowsRematch(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "d1", "host")
	sum, _, err := l.ActivityLobby(host, "inst-rematch")
	if err != nil {
		t.Fatal(err)
	}
	oldID := sum.Game.ID
	alice := discordUser(t, st, "d2", "alice")
	if _, _, err := l.ActivityLobby(alice, "inst-rematch"); err != nil {
		t.Fatal(err)
	}
	if err := l.Start(host, oldID); err != nil {
		t.Fatal(err)
	}
	if err := l.st.SetGameStatus(oldID, "finished"); err != nil {
		t.Fatal(err)
	}
	next, err := l.Rematch(host, oldID, map[int64]bool{host.ID: true, alice.ID: true})
	if err != nil {
		t.Fatal(err)
	}

	late := discordUser(t, st, "d3", "late")
	lsum, role, err := l.ActivityLobby(late, "inst-rematch")
	if err != nil {
		t.Fatal(err)
	}
	if lsum.Game.ID != next.Game.ID {
		t.Errorf("late opener joined %q, want the rematch table %q", lsum.Game.ID, next.Game.ID)
	}
	// A fresh waiting room, which is where the Activity routes a "lobby" status.
	// (The role is spectator here only because Start filled the old table's spare
	// seats with bots and the rematch carried them over.)
	if lsum.Game.Status != "lobby" {
		t.Errorf("rematch table status = %q, want lobby (role was %q)", lsum.Game.Status, role)
	}
}

// TestActivityLobbyFollowsReset verifies the same for a host resetting a live
// game back to a lobby, which abandons the old row.
func TestActivityLobbyFollowsReset(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "d1", "host")
	sum, _, err := l.ActivityLobby(host, "inst-reset")
	if err != nil {
		t.Fatal(err)
	}
	oldID := sum.Game.ID
	alice := discordUser(t, st, "d2", "alice")
	if _, _, err := l.ActivityLobby(alice, "inst-reset"); err != nil {
		t.Fatal(err)
	}
	if err := l.Start(host, oldID); err != nil {
		t.Fatal(err)
	}
	next, err := l.ResetToLobby(host, oldID, map[int64]bool{host.ID: true, alice.ID: true})
	if err != nil {
		t.Fatal(err)
	}

	late := discordUser(t, st, "d3", "late")
	lsum, _, err := l.ActivityLobby(late, "inst-reset")
	if err != nil {
		t.Fatal(err)
	}
	if lsum.Game.ID != next.Game.ID {
		t.Errorf("late opener joined %q, want the reset table %q", lsum.Game.ID, next.Game.ID)
	}
}

// TestActivityLobbyReplacesDeadTable: when the orphan-lobby sweep (or the
// deserted-game teardown) marks the table abandoned, the next opener gets a
// fresh table they can host.
func TestActivityLobbyReplacesDeadTable(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "d1", "host")
	sum, _, err := l.ActivityLobby(host, "inst-dead")
	if err != nil {
		t.Fatal(err)
	}
	deadID := sum.Game.ID
	// Everyone left; the sweep reclaimed the deserted lobby.
	if err := l.Close(deadID); err != nil {
		t.Fatal(err)
	}

	late := discordUser(t, st, "d2", "late")
	lsum, role, err := l.ActivityLobby(late, "inst-dead")
	if err != nil {
		t.Fatal(err)
	}
	if lsum.Game.ID == deadID {
		t.Fatalf("late opener was handed the abandoned table %q", deadID)
	}
	if role != "host" || lsum.Game.Status != "lobby" {
		t.Errorf("replacement table role=%q status=%q, want host/lobby", role, lsum.Game.Status)
	}
	// The instance now points at the replacement, so the next opener joins it
	// rather than making a third.
	other := discordUser(t, st, "d3", "other")
	osum, orole, err := l.ActivityLobby(other, "inst-dead")
	if err != nil {
		t.Fatal(err)
	}
	if osum.Game.ID != lsum.Game.ID {
		t.Errorf("next opener joined %q, want the replacement %q", osum.Game.ID, lsum.Game.ID)
	}
	if orole != "player" {
		t.Errorf("next opener role = %q, want player", orole)
	}
}

// TestActivityLobbyStartedGameSpectatesLive: when the call's game is under way,
// a newcomer must be told it is active (with the invite), which routes them to
// the board instead of a waiting room.
func TestActivityLobbyStartedGameSpectatesLive(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "d1", "host")
	sum, _, err := l.ActivityLobby(host, "inst-live3")
	if err != nil {
		t.Fatal(err)
	}
	gid := sum.Game.ID
	for _, d := range []string{"d2", "d3"} {
		if _, _, err := l.ActivityLobby(discordUser(t, st, d, d), "inst-live3"); err != nil {
			t.Fatal(err)
		}
	}
	if err := l.Start(host, gid); err != nil {
		t.Fatal(err)
	}

	late := discordUser(t, st, "d4", "late")
	lsum, role, err := l.ActivityLobby(late, "inst-live3")
	if err != nil {
		t.Fatal(err)
	}
	if role != "spectator" || lsum.Game.Status != "active" || lsum.Game.ID != gid {
		t.Errorf("late opener role=%q status=%q id=%q, want spectator/active/%q",
			role, lsum.Game.Status, lsum.Game.ID, gid)
	}
	// The activity's table is private, so a spectator can only subscribe with the
	// invite the response carries.
	if lsum.Game.InviteCode == "" {
		t.Error("activity summary dropped the invite")
	}
}
