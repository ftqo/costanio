package store

import (
	"database/sql"
	"errors"
	"fmt"
	"path/filepath"
	"testing"
	"time"
)

// sessionsHold reports whether any cell of the sessions table equals v, so it
// does not depend on column names.
func sessionsHold(t *testing.T, db *sql.DB, v string) bool {
	t.Helper()
	rows, err := db.Query(`SELECT * FROM sessions`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	cols, _ := rows.Columns()
	for rows.Next() {
		cells := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range cells {
			ptrs[i] = &cells[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			t.Fatal(err)
		}
		for _, c := range cells {
			if fmt.Sprint(c) == v {
				return true
			}
			if b, ok := c.([]byte); ok && string(b) == v {
				return true
			}
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return false
}

// TestSessionTokenNotStoredRaw: a session token is a bearer credential, so the
// database stores only its SHA-256; lookups hash what the client presents.
func TestSessionTokenNotStoredRaw(t *testing.T) {
	s := openTest(t)
	u, _ := s.CreateGuest("ann")
	tok, err := s.CreateSession(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if sessionsHold(t, s.db, tok) {
		t.Fatal("the raw session token is stored in the sessions table")
	}
	if got, err := s.UserBySession(tok); err != nil || got.ID != u.ID {
		t.Fatalf("UserBySession(raw) = %v, %v", got, err)
	}
	// The stored value itself is not a credential.
	var stored string
	if err := s.db.QueryRow(`SELECT token_hash FROM sessions`).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if _, err := s.UserBySession(stored); !errors.Is(err, ErrNotFound) {
		t.Fatalf("the stored hash authenticated as a token: %v", err)
	}
	if err := s.DeleteSession(tok); err != nil {
		t.Fatal(err)
	}
	if _, err := s.UserBySession(tok); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted session still resolves: %v", err)
	}
}

// TestMigrateHashesExistingSessions: a session minted before the migration
// keeps working afterwards, and the raw value is gone from disk.
func TestMigrateHashesExistingSessions(t *testing.T) {
	path := filepath.Join(t.TempDir(), "pre.db")
	db := migrateTo(t, path, sessionHashMigration-1)
	now := time.Now().Unix()
	if _, err := db.Exec(`INSERT INTO users (id, is_guest, name, created_at) VALUES (1, 1, 'a', 0), (2, 1, 'b', 0)`); err != nil {
		t.Fatal(err)
	}
	live, live2, dead := newToken(), newToken(), newToken()
	if _, err := db.Exec(`INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, 1, ?, ?), (?, 2, ?, ?), (?, 1, ?, ?)`,
		live, now+3600, now, live2, now+3600, now, dead, now-10, now-100); err != nil {
		t.Fatal(err)
	}
	db.Close()

	s, err := Open(path)
	if err != nil {
		t.Fatalf("open (migrate) over pre-hash sessions: %v", err)
	}
	defer s.Close()
	for _, tok := range []string{live, live2, dead} {
		if sessionsHold(t, s.db, tok) {
			t.Fatalf("raw token %s… survived the migration", tok[:8])
		}
	}
	if u, err := s.UserBySession(live); err != nil || u.ID != 1 {
		t.Fatalf("pre-migration session for user 1 = %v, %v", u, err)
	}
	if u, err := s.UserBySession(live2); err != nil || u.ID != 2 {
		t.Fatalf("pre-migration session for user 2 = %v, %v", u, err)
	}
	if _, err := s.UserBySession(dead); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expired pre-migration session resolved: %v", err)
	}
	var n int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM sessions`).Scan(&n); err != nil || n != 2 {
		t.Fatalf("sessions after migrate+expiry = %d (%v), want 2", n, err)
	}
	s.Close()

	// Idempotent: reopening does not hash the hashes.
	s2, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer s2.Close()
	if u, err := s2.UserBySession(live); err != nil || u.ID != 1 {
		t.Fatalf("after reopen = %v, %v", u, err)
	}
}
