package store

import (
	"encoding/json"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ftqo/costan.io/engine"
)

// mkGames creates a user and the given game rows, so the events foreign key is
// satisfiable.
func mkGames(t *testing.T, s *Store, ids ...string) {
	t.Helper()
	u, err := s.CreateGuest("appender")
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range ids {
		if err := s.CreateGame(&Game{ID: id, Ruleset: "base", Config: json.RawMessage("{}"), CreatedBy: u.ID}); err != nil {
			t.Fatal(err)
		}
	}
}

func evs(from, n int) []engine.Event {
	out := make([]engine.Event, n)
	for i := range out {
		out[i] = engine.Event{Seq: from + i, Type: "t", Data: json.RawMessage(`{}`)}
	}
	return out
}

// TestAppendEventsAfterCloseRefuses: after Close, AppendEvents returns an error
// instead of panicking on the closed request channel (the degraded shutdown in
// Manager.StopAll).
func TestAppendEventsAfterCloseRefuses(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "closed.db"))
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	// Without the guard this panics with "send on closed channel".
	err = s.AppendEvents("g1", evs(0, 1))
	if !errors.Is(err, ErrStoreClosed) {
		t.Fatalf("AppendEvents after Close = %v, want ErrStoreClosed", err)
	}
	// Idempotent Close must still not panic on the second pass.
	if err := s.Close(); err != nil {
		t.Fatalf("second Close: %v", err)
	}
}

// TestAppendEventsRejectsGapBeforeEnqueue: a non-contiguous slice is refused
// before it reaches the group-commit writer, and the error names the game.
func TestAppendEventsRejectsGapBeforeEnqueue(t *testing.T) {
	s := openTest(t)
	gapped := []engine.Event{
		{Seq: 0, Type: "t", Data: json.RawMessage(`{}`)},
		{Seq: 2, Type: "t", Data: json.RawMessage(`{}`)},
	}
	err := s.AppendEvents("poisoner", gapped)
	if !errors.Is(err, ErrSeqGap) {
		t.Fatalf("AppendEvents(gapped) = %v, want ErrSeqGap", err)
	}
	if !strings.Contains(err.Error(), "poisoner") {
		t.Errorf("error does not name the game: %v", err)
	}
	if n, err := s.CountEvents("poisoner"); err != nil || n != 0 {
		t.Fatalf("rejected batch left %d rows behind (err %v), want 0", n, err)
	}
}

// TestWriteBatchIsolatesGameGaps: the writer shares one
// transaction and result across a batch, so one bad request must not fail the
// others. A hand-built batch with one bad request; the good one must land.
func TestWriteBatchIsolatesGameGaps(t *testing.T) {
	s := openTest(t)
	mkGames(t, s, "innocent", "poisoner")
	batch := []appendReq{
		{gameID: "innocent", events: evs(0, 3), done: make(chan error, 1)},
		{gameID: "poisoner", events: []engine.Event{
			{Seq: 0, Type: "t", Data: json.RawMessage(`{}`)},
			{Seq: 7, Type: "t", Data: json.RawMessage(`{}`)},
		}, done: make(chan error, 1)},
	}
	if err := s.writeBatch(batch); err != nil {
		t.Fatalf("writeBatch = %v, want nil", err)
	}
	if n, err := s.CountEvents("innocent"); err != nil || n != 3 {
		t.Fatalf("innocent game has %d events (err %v), want 3", n, err)
	}
}

// TestSeqConflictNamesTheGames: the multi-row INSERT does not say which row
// collided, so the error names the games in the batch.
func TestSeqConflictNamesTheGames(t *testing.T) {
	s := openTest(t)
	mkGames(t, s, "clashing-table-x9")
	if err := s.AppendEvents("clashing-table-x9", evs(0, 3)); err != nil {
		t.Fatal(err)
	}
	err := s.AppendEvents("clashing-table-x9", evs(2, 2)) // seq 2 already logged
	if !errors.Is(err, ErrSeqConflict) {
		t.Fatalf("re-appending a logged seq = %v, want ErrSeqConflict", err)
	}
	if !strings.Contains(err.Error(), "clashing-table-x9") {
		t.Errorf("conflict error does not name the game: %v", err)
	}
}
