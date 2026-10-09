package store

import (
	"encoding/json"
	"testing"
)

func snapshotCount(t *testing.T, s *Store, gameID string) int {
	t.Helper()
	var n int
	if err := s.rdb.QueryRow(`SELECT COUNT(*) FROM snapshots WHERE game_id = ?`, gameID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// TestFinishDropsTheSnapshot: a finished game is never reloaded into an actor,
// so its snapshot is dropped. The event log is untouched.
func TestFinishDropsTheSnapshot(t *testing.T) {
	s := openTest(t)
	u, err := s.CreateGuest("host")
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"g-once", "g-plain", "g-live"} {
		if err := s.CreateGame(&Game{ID: id, Ruleset: "base", Config: json.RawMessage("{}"), CreatedBy: u.ID}); err != nil {
			t.Fatal(err)
		}
		if err := s.SaveSnapshot(id, 40, []byte("state")); err != nil {
			t.Fatal(err)
		}
	}

	won, err := s.FinishGameOnce("g-once", u.ID)
	if err != nil || !won {
		t.Fatalf("FinishGameOnce = %v, %v", won, err)
	}
	if n := snapshotCount(t, s, "g-once"); n != 0 {
		t.Errorf("finished game keeps %d snapshot rows, want 0", n)
	}
	if err := s.FinishGame("g-plain", 0); err != nil {
		t.Fatal(err)
	}
	if n := snapshotCount(t, s, "g-plain"); n != 0 {
		t.Errorf("FinishGame keeps %d snapshot rows, want 0", n)
	}
	// A game still in progress keeps its snapshot.
	if n := snapshotCount(t, s, "g-live"); n != 1 {
		t.Errorf("live game lost its snapshot (%d rows), want 1", n)
	}

	// The event log is never pruned.
	if err := s.AppendEvents("g-once", evs(0, 5)); err != nil {
		t.Fatal(err)
	}
	if err := s.FinishGame("g-once", u.ID); err != nil {
		t.Fatal(err)
	}
	if n, err := s.CountEvents("g-once"); err != nil || n != 5 {
		t.Fatalf("events after finish = %d (err %v), want 5", n, err)
	}
}

// TestPruneFinishedSnapshotsBacklog covers the catch-up sweep,
// including a snapshot the async worker wrote back after the finish. It is
// limited and re-runnable.
func TestPruneFinishedSnapshotsBacklog(t *testing.T) {
	s := openTest(t)
	u, err := s.CreateGuest("host")
	if err != nil {
		t.Fatal(err)
	}
	ids := []string{"a", "b", "c", "d"}
	for _, id := range ids {
		if err := s.CreateGame(&Game{ID: id, Ruleset: "base", Config: json.RawMessage("{}"), CreatedBy: u.ID}); err != nil {
			t.Fatal(err)
		}
	}
	for _, id := range ids[:3] {
		if err := s.FinishGame(id, 0); err != nil {
			t.Fatal(err)
		}
		// Written back after the finish, as the async snapshot worker can.
		if err := s.SaveSnapshot(id, 9, []byte("late")); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.SaveSnapshot("d", 9, []byte("live")); err != nil {
		t.Fatal(err)
	}

	n, err := s.PruneFinishedSnapshots(2)
	if err != nil || n != 2 {
		t.Fatalf("PruneFinishedSnapshots(2) = %d, %v; want 2, nil", n, err)
	}
	n, err = s.PruneFinishedSnapshots(100)
	if err != nil || n != 1 {
		t.Fatalf("second sweep = %d, %v; want the last 1, nil", n, err)
	}
	if n, err := s.PruneFinishedSnapshots(100); err != nil || n != 0 {
		t.Fatalf("third sweep = %d, %v; want 0, nil (idempotent)", n, err)
	}
	if n := snapshotCount(t, s, "d"); n != 1 {
		t.Errorf("live game snapshots = %d rows, want 1", n)
	}
}

// TestSizesReportsGrowth: the metric moves when the database grows.
func TestSizesReportsGrowth(t *testing.T) {
	s := openTest(t)
	before, err := s.Sizes()
	if err != nil {
		t.Fatalf("Sizes: %v", err)
	}
	if before.Bytes <= 0 {
		t.Fatalf("Sizes reports %d bytes for a migrated database", before.Bytes)
	}
	u, err := s.CreateGuest("host")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.CreateGame(&Game{ID: "g1", Ruleset: "base", Config: json.RawMessage("{}"), CreatedBy: u.ID}); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveSnapshot("g1", 1, make([]byte, 4096)); err != nil {
		t.Fatal(err)
	}
	mid, err := s.Sizes()
	if err != nil {
		t.Fatal(err)
	}
	if mid.Games != before.Games+1 || mid.FinishedGames != 0 {
		t.Errorf("games = %d (finished %d), want %d and 0", mid.Games, mid.FinishedGames, before.Games+1)
	}
	if mid.Snapshots != 1 || mid.SnapshotBytes < 4096 {
		t.Errorf("snapshots = %d rows / %d bytes, want 1 / >=4096", mid.Snapshots, mid.SnapshotBytes)
	}

	if err := s.FinishGame("g1", u.ID); err != nil {
		t.Fatal(err)
	}
	after, err := s.Sizes()
	if err != nil {
		t.Fatal(err)
	}
	if after.FinishedGames != 1 {
		t.Errorf("finished games = %d, want 1", after.FinishedGames)
	}
	if after.Snapshots != 0 || after.SnapshotBytes != 0 {
		t.Errorf("snapshots after finish = %d rows / %d bytes, want 0 / 0", after.Snapshots, after.SnapshotBytes)
	}
}
