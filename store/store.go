// Package store is the only package that touches SQLite.
package store

import (
	"database/sql"
	"embed"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"

	_ "modernc.org/sqlite" // register the SQLite database/sql driver
)

// migrationVersion parses the leading integer from a migration filename, e.g.
// "0007_add_index.sql" -> 7. The numeric prefix, not file order, is the version.
func migrationVersion(name string) (int, error) {
	i := 0
	for i < len(name) && name[i] >= '0' && name[i] <= '9' {
		i++
	}
	if i == 0 {
		return 0, fmt.Errorf("migration %q: missing numeric version prefix", name)
	}
	v, err := strconv.Atoi(name[:i])
	if err != nil {
		return 0, fmt.Errorf("migration %q: %w", name, err)
	}
	return v, nil
}

//go:embed migrations/*.sql
var migrationFS embed.FS

// Store owns two handles onto the same SQLite database:
//
//   - db is the writer, capped at one connection (see open), which serializes
//     every writer in the process. Only it may Begin or Exec.
//   - rdb is a small mode=ro pool for queries that only SELECT. Under WAL they
//     run concurrently with the writer.
//
// rdb is never used inside a write transaction, and never to read a value the
// same method then writes back; read-modify-writes take an execQuerier inside
// a caller-owned *sql.Tx. A WAL reader starts at the latest commit, so a
// returned write is visible to any later read. A read method called while
// holding a db transaction sees pre-transaction state, so reads inside a
// transaction must go through it.
type Store struct {
	db        *sql.DB
	rdb       *sql.DB // read-only pool; aliases db for the in-memory store (see OpenMem)
	w         *writer // group-commit event-append writer (see writer.go)
	closeOnce sync.Once
}

// readPoolConns sizes the read-only pool (see TestReadPoolSizeProbe). Readers
// compete with the writer for CPU and each connection has its own page cache,
// so a wider pool trades commit throughput for read latency. 4 keeps cheap
// reads fast and is wide enough that one long scan (a game load can take
// 100ms+) cannot block every cheap read behind it.
const readPoolConns = 4

func Open(path string) (*Store, error) {
	// synchronous=NORMAL: in WAL mode this drops the per-commit fsync (fsync
	// happens at checkpoint instead). Durable across process crashes; a hard
	// power-loss can lose the last not-yet-checkpointed transactions, which is
	// acceptable for in-progress games (clients resync on reconnect).
	//
	// The reader's DSN omits journal_mode, synchronous and foreign_keys: they
	// govern writes only, and WAL is persisted in the file header. mode=ro
	// enforces read-only in the driver.
	return open(
		fmt.Sprintf("file:%s?_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)&_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)", path),
		fmt.Sprintf("file:%s?_pragma=busy_timeout(5000)&mode=ro", path),
	)
}

// OpenMem opens a private in-memory store for tests and bot simulations: no file
// IO and no fsync, so it runs much faster than a temp-file DB. Not durable: the
// data lives only as long as the Store's single connection. Production uses Open.
//
// rdb aliases db, because a second connection to "file::memory:" would open a
// fresh, empty database.
func OpenMem() (*Store, error) {
	return open("file::memory:?_pragma=foreign_keys(1)&_pragma=journal_mode(MEMORY)&_pragma=synchronous(0)", "")
}

// open builds the Store from a writer DSN and an optional reader DSN. An empty
// roDSN aliases rdb onto db (the in-memory case).
func open(dsn, roDSN string) (*Store, error) {
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	// One connection: serializing every writer avoids SQLITE_BUSY and keeps
	// concurrent finalizations from interleaving. For the in-memory DSN it also
	// keeps the single database alive. Pin the idle conn so it is never reaped.
	// Reads through this pool queue behind writes; concurrent reads come from
	// rdb below.
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	db.SetConnMaxIdleTime(0)
	db.SetConnMaxLifetime(0)
	s := &Store{db: db, rdb: db}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	// Opened after migrate: mode=ro cannot create the file, and the reader must
	// not see a half-migrated schema.
	if roDSN != "" {
		rdb, err := sql.Open("sqlite", roDSN)
		if err != nil {
			db.Close()
			return nil, err
		}
		rdb.SetMaxOpenConns(readPoolConns)
		rdb.SetMaxIdleConns(readPoolConns)
		rdb.SetConnMaxIdleTime(0)
		rdb.SetConnMaxLifetime(0)
		// Ping now so a reader that cannot open the file fails at startup rather
		// than on the first lobby query.
		if err := rdb.Ping(); err != nil {
			rdb.Close()
			db.Close()
			return nil, fmt.Errorf("store: open read-only handle: %w", err)
		}
		s.rdb = rdb
	}
	s.startWriter()
	return s, nil
}

// Close is idempotent: stopWriter closes a channel, so a second call must not
// re-run it (closing a closed channel panics).
func (s *Store) Close() error {
	var err error
	s.closeOnce.Do(func() {
		s.stopWriter() // flush + stop the append writer before closing the DB
		// Close the reader first, then the writer, and keep both errors: a
		// failure on one handle must not hide a failure on the other.
		if s.rdb != s.db {
			err = s.rdb.Close()
		}
		err = errors.Join(err, s.db.Close())
	})
	return err
}

// migrationExec is what a Go data step runs against: the migration's own
// transaction in migrate(), or the bare handle in the populated-database test
// ladder (migrateTo).
type migrationExec interface {
	Exec(query string, args ...any) (sql.Result, error)
	Query(query string, args ...any) (*sql.Rows, error)
}

// goMigrations are data steps SQL cannot express, keyed by the migration
// version whose .sql file they complete. Each runs inside that migration's
// transaction, after its SQL and before its schema_version row, so it commits
// or rolls back with it and runs exactly once per database.
var goMigrations = map[int]func(migrationExec) error{
	sessionHashMigration: rehashSessionTokens,
}

func (s *Store) migrate() error {
	if _, err := s.db.Exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)`); err != nil {
		return err
	}
	var version int
	err := s.db.QueryRow(`SELECT COALESCE(MAX(version), 0) FROM schema_version`).Scan(&version)
	if err != nil {
		return err
	}
	entries, err := migrationFS.ReadDir("migrations")
	if err != nil {
		return err
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if !strings.HasSuffix(e.Name(), ".sql") {
			continue
		}
		names = append(names, e.Name())
	}
	sort.Strings(names)
	// Derive the version from each filename's numeric prefix and verify the set
	// is strictly increasing and contiguous (1,2,3,...), so a missing or
	// duplicated prefix is caught loudly instead of silently renumbering.
	prev := 0
	for _, name := range names {
		v, err := migrationVersion(name)
		if err != nil {
			return err
		}
		if v != prev+1 {
			return fmt.Errorf("migration %q: version %d not contiguous after %d", name, v, prev)
		}
		prev = v
	}
	for _, name := range names {
		v, err := migrationVersion(name)
		if err != nil {
			return err
		}
		if v <= version {
			continue
		}
		sqlBytes, err := migrationFS.ReadFile("migrations/" + name)
		if err != nil {
			return err
		}
		tx, err := s.db.Begin()
		if err != nil {
			return err
		}
		if _, err := tx.Exec(string(sqlBytes)); err != nil {
			tx.Rollback()
			return fmt.Errorf("migration %s: %w", name, err)
		}
		if step := goMigrations[v]; step != nil {
			if err := step(tx); err != nil {
				tx.Rollback()
				return fmt.Errorf("migration %s (data step): %w", name, err)
			}
		}
		if _, err := tx.Exec(`INSERT INTO schema_version (version) VALUES (?)`, v); err != nil {
			tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}
