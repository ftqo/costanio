package store

import (
	"testing"

	"github.com/ftqo/costan.io/rating"
)

const day = int64(24 * 60 * 60)

func TestLeaderboardSnapshotUsesRefresh(t *testing.T) {
	s := openTest(t)
	hi := mustDiscord(t, s, "hi", "Hi")
	lo := mustDiscord(t, s, "lo", "Lo")
	settled := rating.ProvisionalSigma - 1
	must(t, s.SetRatingRow(hi.ID, "base", rating.MuForDisplay(1500, settled), settled, 1000))
	must(t, s.SetRatingRow(lo.ID, "base", rating.MuForDisplay(1100, settled), settled, 1000))

	// Before any refresh the snapshot is empty (live ratings are not read).
	if got, err := s.LeaderboardSnapshot("base", 10); err != nil || len(got) != 0 {
		t.Fatalf("pre-refresh snapshot = %v (err %v); want empty", got, err)
	}

	must(t, s.RefreshLeaderboardSnapshot(1000))
	board, err := s.LeaderboardSnapshot("base", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(board) != 2 || board[0].UserID != hi.ID || board[1].UserID != lo.ID {
		t.Fatalf("snapshot = %+v; want [hi, lo] by elo desc", board)
	}

	// A live rating change is not reflected until the next refresh.
	must(t, s.SetRatingRow(lo.ID, "base", rating.MuForDisplay(9999, settled), settled, 2000))
	board, _ = s.LeaderboardSnapshot("base", 10)
	if board[0].UserID != hi.ID {
		t.Fatalf("snapshot changed without refresh: %+v", board)
	}

	// After a refresh, the new standings take effect.
	must(t, s.RefreshLeaderboardSnapshot(2000))
	board, _ = s.LeaderboardSnapshot("base", 10)
	if board[0].UserID != lo.ID {
		t.Fatalf("post-refresh leader = %d; want lo (%d)", board[0].UserID, lo.ID)
	}
}

func TestRefreshLeaderboardSnapshotIfDue(t *testing.T) {
	s := openTest(t)
	u := mustDiscord(t, s, "u", "U")
	must(t, s.SetRatingRow(u.ID, "base", rating.Mu0, rating.Sigma0, 1000))

	// Never captured: due.
	did, err := s.RefreshLeaderboardSnapshotIfDue(1000, day)
	if err != nil || !did {
		t.Fatalf("first IfDue = (%v, %v); want (true, nil)", did, err)
	}
	// Just captured: not due within the interval.
	if did, _ := s.RefreshLeaderboardSnapshotIfDue(1000+day-1, day); did {
		t.Fatalf("IfDue before interval elapsed should be false")
	}
	// A full interval later: due again.
	if did, _ := s.RefreshLeaderboardSnapshotIfDue(1000+day, day); !did {
		t.Fatalf("IfDue after interval elapsed should be true")
	}
}

func TestLeaderboardSnapshotExcludesGuests(t *testing.T) {
	s := openTest(t)
	g, err := s.CreateGuest("guesty")
	if err != nil {
		t.Fatal(err)
	}
	must(t, s.SetRatingRow(g.ID, "base", rating.Mu0, rating.Sigma0, 1000))
	must(t, s.RefreshLeaderboardSnapshot(1000))

	board, _ := s.LeaderboardSnapshot("base", 10)
	if len(board) != 0 {
		t.Fatalf("guest must not appear on the leaderboard snapshot; got %+v", board)
	}
}

func mustDiscord(t *testing.T, s *Store, id, name string) *User {
	t.Helper()
	u, err := s.UpsertDiscordUser(id, name, "")
	if err != nil {
		t.Fatal(err)
	}
	return u
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}
