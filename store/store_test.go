package store

import (
	"path/filepath"
	"testing"
)

func TestMigrationVersion(t *testing.T) {
	cases := []struct {
		name    string
		want    int
		wantErr bool
	}{
		{"0001_init.sql", 1, false},
		{"0002_discord_friends.sql", 2, false},
		{"42_thing.sql", 42, false},
		{"no_number.sql", 0, true},
		{".sql", 0, true},
	}
	for _, c := range cases {
		got, err := migrationVersion(c.name)
		if (err != nil) != c.wantErr {
			t.Errorf("migrationVersion(%q) err = %v, wantErr %v", c.name, err, c.wantErr)
		}
		if !c.wantErr && got != c.want {
			t.Errorf("migrationVersion(%q) = %d, want %d", c.name, got, c.want)
		}
	}
}

func openTest(t *testing.T) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func TestOpenMigrates(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.db")
	s, err := Open(path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}

	var mode string
	if err := s.db.QueryRow(`PRAGMA journal_mode`).Scan(&mode); err != nil {
		t.Fatal(err)
	}
	if mode != "wal" {
		t.Errorf("journal_mode = %q, want wal", mode)
	}

	var version int
	if err := s.db.QueryRow(`SELECT MAX(version) FROM schema_version`).Scan(&version); err != nil {
		t.Fatal(err)
	}
	if version < 1 {
		t.Fatalf("schema version = %d, want >= 1", version)
	}
	migrated := version

	for _, table := range []string{"users", "sessions", "games", "seats", "events", "snapshots", "chat", "stats", "ratings"} {
		var name string
		err := s.db.QueryRow(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, table).Scan(&name)
		if err != nil {
			t.Errorf("table %s missing: %v", table, err)
		}
	}
	s.Close()

	// Reopen must be idempotent.
	s2, err := Open(path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer s2.Close()
	var count int
	if err := s2.db.QueryRow(`SELECT COUNT(*) FROM schema_version`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != migrated {
		t.Errorf("schema_version rows = %d, want %d", count, migrated)
	}
}
