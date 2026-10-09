package store

import (
	"database/sql"
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

// These tests run migrations over populated databases. Every other test starts
// from an empty schema, and a migration that fails on real data stops the
// server from starting.

// migrateTo applies migrations 1..version to a fresh database at path and hands
// back a raw handle to it, so a test can seed the data the next migration will
// meet. It re-implements migrate()'s loop so it can stop partway.
func migrateTo(t *testing.T, path string, version int) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", fmt.Sprintf("file:%s?_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)", path))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)`); err != nil {
		t.Fatal(err)
	}
	entries, err := migrationFS.ReadDir("migrations")
	if err != nil {
		t.Fatal(err)
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".sql") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	applied := 0
	for _, name := range names {
		v, err := migrationVersion(name)
		if err != nil {
			t.Fatal(err)
		}
		if v > version {
			break
		}
		body, err := migrationFS.ReadFile("migrations/" + name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(string(body)); err != nil {
			t.Fatalf("seed migration %s: %v", name, err)
		}
		if step := goMigrations[v]; step != nil {
			if err := step(db); err != nil {
				t.Fatalf("seed migration %s (data step): %v", name, err)
			}
		}
		if _, err := db.Exec(`INSERT INTO schema_version (version) VALUES (?)`, v); err != nil {
			t.Fatal(err)
		}
		applied = v
	}
	if applied != version {
		t.Fatalf("stopped at version %d, want %d", applied, version)
	}
	return db
}

// TestMigrate0025DedupesDoubleSeatedUsers: 0025 adds a unique index on
// seats(game_id, user_id), which cannot be created over duplicate rows left by
// a concurrent-join race. The migration drops the surplus seats, keeping the
// lowest seat_no, first.
func TestMigrate0025DedupesDoubleSeatedUsers(t *testing.T) {
	path := filepath.Join(t.TempDir(), "old.db")
	db := migrateTo(t, path, 24)

	if _, err := db.Exec(`INSERT INTO users (id, is_guest, name, created_at) VALUES (1, 1, 'racer', 0), (2, 1, 'other', 0)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO games (id, status, ruleset, config, created_by, created_at)
		VALUES ('g1', 'lobby', 'base', '{}', 1, 0), ('g2', 'lobby', 'base', '{}', 1, 0)`); err != nil {
		t.Fatal(err)
	}
	// The race's leftovers: user 1 holds seats 0 and 2 in g1.
	if _, err := db.Exec(`INSERT INTO seats (game_id, seat_no, user_id) VALUES
		('g1', 0, 1), ('g1', 1, 2), ('g1', 2, 1), ('g2', 0, 1)`); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	// The startup path, on the populated database.
	s, err := Open(path)
	if err != nil {
		t.Fatalf("Open on a database with a double-seated user: %v", err)
	}
	defer s.Close()

	var seats []int
	rows, err := s.rdb.Query(`SELECT seat_no FROM seats WHERE game_id = 'g1' AND user_id = 1 ORDER BY seat_no`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var n int
		if err := rows.Scan(&n); err != nil {
			t.Fatal(err)
		}
		seats = append(seats, n)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if len(seats) != 1 || seats[0] != 0 {
		t.Errorf("user 1 holds seats %v in g1, want [0]", seats)
	}
	// The other player keeps their seat, and the same user's seat at a
	// different table is untouched.
	for _, c := range []struct {
		game string
		user int64
		want int
	}{{"g1", 2, 1}, {"g2", 1, 1}} {
		var n int
		if err := s.rdb.QueryRow(`SELECT COUNT(*) FROM seats WHERE game_id = ? AND user_id = ?`, c.game, c.user).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n != c.want {
			t.Errorf("seats for user %d in %s = %d, want %d", c.user, c.game, n, c.want)
		}
	}
}

// TestMigrateFromEveryVersionOverPopulatedData seeds at each version, then runs
// the remaining migrations over the data.
func TestMigrateFromEveryVersionOverPopulatedData(t *testing.T) {
	// The tables present from 0001, which every version can be seeded with:
	// users, games, seats and events.
	latest := latestMigrationVersion(t)
	for v := 1; v < latest; v++ {
		t.Run(fmt.Sprintf("from%04d", v), func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "old.db")
			db := migrateTo(t, path, v)
			if _, err := db.Exec(`INSERT INTO users (id, is_guest, name, created_at) VALUES (1, 1, 'a', 0), (2, 1, 'b', 0)`); err != nil {
				t.Fatal(err)
			}
			if _, err := db.Exec(`INSERT INTO games (id, status, ruleset, config, created_by, created_at, finished_at, winner_user_id)
				VALUES ('g1', 'finished', 'base', '{}', 1, 10, 20, 1), ('g2', 'lobby', 'base+cak', '{}', 2, 30, NULL, NULL)`); err != nil {
				t.Fatal(err)
			}
			if _, err := db.Exec(`INSERT INTO seats (game_id, seat_no, user_id) VALUES ('g1', 0, 1), ('g1', 1, 2), ('g2', 0, 2)`); err != nil {
				t.Fatal(err)
			}
			if _, err := db.Exec(`INSERT INTO events (game_id, seq, type, data, ts) VALUES ('g1', 0, 'game_created', '{}', 10), ('g1', 1, 'roll', '{}', 11)`); err != nil {
				t.Fatal(err)
			}
			if _, err := db.Exec(`INSERT INTO stats (user_id, ruleset, games, wins) VALUES (1, 'base', 1, 1)`); err != nil {
				t.Fatal(err)
			}
			if _, err := db.Exec(`INSERT INTO chat (scope, user_id, msg, ts) VALUES ('game:g1', 1, 'gg', 12)`); err != nil {
				t.Fatal(err)
			}
			if err := db.Close(); err != nil {
				t.Fatal(err)
			}

			s, err := Open(path)
			if err != nil {
				t.Fatalf("migrating a populated v%d database to head: %v", v, err)
			}
			defer s.Close()
			// The data must survive the migration.
			if g, err := s.GameByID("g1"); err != nil || g.Ruleset != "base" {
				t.Fatalf("GameByID after migrating from v%d: %v, %v", v, g, err)
			}
			if n, err := s.CountEvents("g1"); err != nil || n != 2 {
				t.Fatalf("events after migrating from v%d = %d, %v; want 2", v, n, err)
			}
		})
	}
}

func latestMigrationVersion(t *testing.T) int {
	t.Helper()
	entries, err := migrationFS.ReadDir("migrations")
	if err != nil {
		t.Fatal(err)
	}
	high := 0
	for _, e := range entries {
		if !strings.HasSuffix(e.Name(), ".sql") {
			continue
		}
		v, err := migrationVersion(e.Name())
		if err != nil {
			t.Fatal(err)
		}
		if v > high {
			high = v
		}
	}
	return high
}
