package store

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/ftqo/costan.io/engine"
)

// These use openTest, which is file-backed, so the whole store suite already
// exercises the two-handle topology. Only OpenMem aliases rdb onto db.

// The read handle must be a distinct pool for a file-backed store and must
// alias the writer for the in-memory one: a second connection to
// "file::memory:" would open a different, empty database.
func TestReadHandleIdentity(t *testing.T) {
	if s := openTest(t); s.rdb == s.db {
		t.Error("file-backed store: rdb aliases db, want a separate read pool")
	}
	mem, err := OpenMem()
	if err != nil {
		t.Fatalf("OpenMem: %v", err)
	}
	defer mem.Close()
	if mem.rdb != mem.db {
		t.Error("in-memory store: rdb is a separate handle, want it to alias db")
	}
}

// Reopening an already-migrated database is the production restart path. A
// clean shutdown may have removed -wal and -shm and migrate() may write
// nothing, so the read-only connection must bring the WAL index up itself
// (SQLite allows it with write permission on the directory).
func TestReadHandleOnReopenedDatabase(t *testing.T) {
	path := t.TempDir() + "/reopen.db"

	first, err := Open(path)
	if err != nil {
		t.Fatalf("first Open: %v", err)
	}
	u, err := first.CreateGuest("persisted")
	if err != nil {
		t.Fatal(err)
	}
	if err := first.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	// Reopen: schema_version is current, so migrate applies nothing.
	second, err := Open(path)
	if err != nil {
		t.Fatalf("reopen an already-migrated database: %v", err)
	}
	defer second.Close()
	if second.rdb == second.db {
		t.Fatal("reopened store has no separate read handle")
	}
	got, err := second.UserByID(u.ID)
	if err != nil {
		t.Fatalf("read through the read handle after reopen: %v", err)
	}
	if got.Name != "persisted" {
		t.Errorf("name = %q, want %q", got.Name, "persisted")
	}
	// And the reopened writer must still work alongside it.
	if err := second.CreateGame(&Game{ID: "g1", Ruleset: "base", Config: json.RawMessage("{}"), CreatedBy: u.ID}); err != nil {
		t.Fatalf("write after reopen: %v", err)
	}
	if _, err := second.GameByID("g1"); err != nil {
		t.Fatalf("read back after reopen: %v", err)
	}
}

// mode=ro makes a write routed to rdb by mistake fail.
func TestReadHandleRejectsWrites(t *testing.T) {
	s := openTest(t)
	if _, err := s.rdb.Exec(`INSERT INTO schema_version (version) VALUES (9999)`); err == nil {
		t.Fatal("write through the read handle succeeded, want a read-only error")
	}
}

// A write that has returned must be visible to the next read, even though the
// read runs on a different connection: a WAL reader opens its read transaction
// at the latest commit.
func TestReadHandleSeesCommittedWrites(t *testing.T) {
	s := openTest(t)
	u, err := s.CreateGuest("visible")
	if err != nil {
		t.Fatal(err)
	}
	// CreateGuest wrote on db; UserByID reads on rdb.
	got, err := s.UserByID(u.ID)
	if err != nil {
		t.Fatalf("UserByID right after CreateGuest: %v", err)
	}
	if got.Name != "visible" {
		t.Errorf("name = %q, want %q", got.Name, "visible")
	}

	if err := s.CreateGame(&Game{ID: "g1", Ruleset: "base", Config: json.RawMessage("{}"), CreatedBy: u.ID}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GameByID("g1"); err != nil {
		t.Fatalf("GameByID right after CreateGame: %v", err)
	}

	// And through the group-commit writer: AppendEvents blocks until durable,
	// so the read must see it.
	if err := s.AppendEvents("g1", []engine.Event{{Seq: 0, Type: "t", Data: json.RawMessage(`{}`)}}); err != nil {
		t.Fatal(err)
	}
	if n, err := s.CountEvents("g1"); err != nil || n != 1 {
		t.Fatalf("CountEvents right after AppendEvents = %d, %v; want 1, nil", n, err)
	}
}

// A read must not queue behind a write: with an open write transaction holding
// the single writer connection, a read still completes.
func TestReadsDoNotQueueBehindAWrite(t *testing.T) {
	s := openTest(t)
	u, err := s.CreateGuest("holder")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.CreateGame(&Game{ID: "g1", Ruleset: "base", Config: json.RawMessage("{}"), CreatedBy: u.ID}); err != nil {
		t.Fatal(err)
	}

	// Take the writer connection and hold it, mid-transaction.
	tx, err := s.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`UPDATE games SET status = 'active' WHERE id = ?`, "g1"); err != nil {
		t.Fatal(err)
	}

	done := make(chan error, 1)
	go func() {
		_, err := s.ListGames("lobby", true)
		done <- err
	}()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("ListGames while a write tx is open: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("ListGames blocked behind an open write transaction")
	}
}
