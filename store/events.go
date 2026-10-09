package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	sqlite "modernc.org/sqlite"
	sqlite3 "modernc.org/sqlite/lib"

	"github.com/ftqo/costan.io/engine"
)

var ErrSeqConflict = errors.New("store: event sequence conflict")

// ErrSeqGap means a batch of events would not be strictly contiguous with the
// game's existing event log (or within itself). Appending it would create a
// hole that breaks engine replay, so the whole batch is rejected.
var ErrSeqGap = errors.New("store: event sequence gap")

// AppendEvents writes a command's events atomically. It hands the batch to the
// group-commit writer and blocks until those events are durable, returning the
// same errors a direct write would (ErrSeqConflict/ErrSeqGap). When it returns
// the events are persisted, so an actor's persist, apply, broadcast order holds.
//
// The unique (game, seq) key doubles as optimistic concurrency control: a
// conflict means another writer got there first, which is a bug given the
// one-actor-per-game rule.
//
// Contiguity is checked here rather than in the writer, because the writer
// shares one transaction (and one error) across many games' appends; a bad
// slice is refused before it can fail anyone else's.
func (s *Store) AppendEvents(gameID string, events []engine.Event) error {
	if len(events) == 0 {
		return nil
	}
	if err := checkContiguous(gameID, events); err != nil {
		return err
	}
	return s.w.submit(appendReq{gameID: gameID, events: events, done: make(chan error, 1)})
}

// checkContiguous rejects a batch whose seqs are not strictly increasing by one.
// The (game_id, seq) primary key cannot catch a hole within a batch. Contiguity
// against the existing log is not checked: the caller assigns Seq monotonically
// and the primary key rejects overlap at INSERT time.
func checkContiguous(gameID string, events []engine.Event) error {
	for i, e := range events {
		if e.Seq != events[0].Seq+i {
			return fmt.Errorf("%w: game %s non-contiguous batch at index %d: expected seq %d, got %d",
				ErrSeqGap, gameID, i, events[0].Seq+i, e.Seq)
		}
	}
	return nil
}

// maxInsertRows is the largest number of event rows a single multi-row INSERT
// may carry. SQLite's default bound-variable limit is 999; with insertParamsPerRow
// columns per row that allows 142 rows, so larger writer batches are chunked.
const (
	insertParamsPerRow = 7
	maxInsertRows      = 999 / insertParamsPerRow // 142
)

// appendEventsTx appends one game's event batch as column binds to args for a
// later multi-row INSERT. Split out of AppendEvents so the group-commit writer
// can pack several games' appends into one transaction (and, via batchedInsert,
// one INSERT parsed once per chunk rather than once per event).
//
// There is no SELECT MAX(seq) check (it was expensive on the write path): the
// (game_id, seq) primary key rejects overlap with the existing log as
// ErrSeqConflict, and AppendEvents checks contiguity within the batch.
func appendEventsTx(args []any, gameID string, events []engine.Event, now int64) ([]any, error) {
	for _, e := range events {
		var visible any
		if e.Visible != nil {
			raw, err := json.Marshal(e.Visible)
			if err != nil {
				return nil, err
			}
			visible = string(raw)
		}
		// Bind e.Data as []byte (it is already json.RawMessage) to avoid the
		// string(e.Data) copy on the hot path.
		args = append(args, gameID, e.Seq, string(e.Type), []byte(e.Data), visible, now, int64(e.Src))
	}
	return args, nil
}

// batchedInsert inserts every row in args (insertParamsPerRow binds per row) using as few
// multi-row INSERT statements as the variable limit allows. SQLite parses each
// statement once and binds all its rows, so an E-event batch is parsed
// ceil(E/maxInsertRows) times instead of E times. modernc re-parses on every
// Exec, so caching a *sql.Stmt would not help.
func batchedInsert(tx *sql.Tx, gameIDs []string, args []any) error {
	rows := len(args) / insertParamsPerRow
	for start := 0; start < rows; start += maxInsertRows {
		n := min(rows-start, maxInsertRows)
		chunk := args[start*insertParamsPerRow : (start+n)*insertParamsPerRow]
		if _, err := tx.Exec(insertSQL(n), chunk...); err != nil {
			if isUniqueViolation(err) {
				// The multi-row INSERT does not say which row conflicted, so
				// name every game in the batch. The whole tx rolls back.
				return fmt.Errorf("%w: duplicate (game_id, seq) in batch of %d: games %s",
					ErrSeqConflict, len(gameIDs), strings.Join(gameIDs, ","))
			}
			return err
		}
	}
	return nil
}

// insertSQL builds an INSERT with rows placeholder groups, e.g.
// "INSERT INTO events (...) VALUES (?,?,?,?,?,?,?),(?,?,?,?,?,?,?)" for rows == 2.
func insertSQL(rows int) string {
	var b strings.Builder
	b.WriteString(`INSERT INTO events (game_id, seq, type, data, visible_to, ts, src) VALUES `)
	for i := range rows {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(`(?, ?, ?, ?, ?, ?, ?)`)
	}
	return b.String()
}

// isUniqueViolation reports whether err is a sqlite PRIMARY KEY / UNIQUE
// constraint violation specifically (not FK or NOT NULL). It matches the
// driver's extended result code rather than the free-form message text.
func isUniqueViolation(err error) bool {
	var se *sqlite.Error
	if !errors.As(err, &se) {
		return false
	}
	code := se.Code()
	return code == sqlite3.SQLITE_CONSTRAINT_PRIMARYKEY || code == sqlite3.SQLITE_CONSTRAINT_UNIQUE
}

// CountEvents returns how many events a game has logged: a cheap progress
// gauge (the chat/events index makes it indexed) used to detect a runaway game.
func (s *Store) CountEvents(gameID string) (int, error) {
	var n int
	err := s.rdb.QueryRow(`SELECT COUNT(*) FROM events WHERE game_id = ?`, gameID).Scan(&n)
	return n, err
}

// CountEventsOfType returns how many events of one type a game logged. Typed by
// string so the store stays out of the engine's vocabulary. Used to measure a
// finished game's length in turns without replaying it.
func (s *Store) CountEventsOfType(gameID, typ string) (int, error) {
	var n int
	err := s.rdb.QueryRow(`SELECT COUNT(*) FROM events WHERE game_id = ? AND type = ?`, gameID, typ).Scan(&n)
	return n, err
}

// MaxEventSeq returns a game's highest logged seq, or -1 when it has no events.
// It is an index seek on the (game_id, seq) primary key, constant in log size,
// which makes it usable as a replay cache validator.
func (s *Store) MaxEventSeq(gameID string) (int, error) {
	var seq sql.NullInt64
	if err := s.rdb.QueryRow(`SELECT MAX(seq) FROM events WHERE game_id = ?`, gameID).Scan(&seq); err != nil {
		return 0, err
	}
	if !seq.Valid {
		return -1, nil
	}
	return int(seq.Int64), nil
}

// LoadEvents returns events with seq >= since, in order.
func (s *Store) LoadEvents(gameID string, since int) ([]engine.Event, error) {
	rows, err := s.rdb.Query(`SELECT seq, type, data, visible_to, src FROM events WHERE game_id = ? AND seq >= ? ORDER BY seq`,
		gameID, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []engine.Event
	for rows.Next() {
		var e engine.Event
		var typ, data string
		var visible sql.NullString
		var src int64
		if err := rows.Scan(&e.Seq, &typ, &data, &visible, &src); err != nil {
			return nil, err
		}
		e.Src = engine.Source(src)
		e.Type = engine.EventType(typ)
		e.Data = json.RawMessage(data)
		if visible.Valid {
			if err := json.Unmarshal([]byte(visible.String), &e.Visible); err != nil {
				return nil, err
			}
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// LastEventOfType returns the newest event of typ for a game, or ErrNotFound
// when the game never emitted one.
//
// Loading a game replays only what came after its latest snapshot, so state
// the game layer derives from watching events (such as which seat last moved
// the robber) needs this to look further back. Typed by string so the store
// stays out of the engine's vocabulary; the caller decodes the payload.
func (s *Store) LastEventOfType(gameID, typ string) (engine.Event, error) {
	var e engine.Event
	var typeName, data string
	var visible sql.NullString
	var src int64
	err := s.rdb.QueryRow(
		`SELECT seq, type, data, visible_to, src FROM events WHERE game_id = ? AND type = ? ORDER BY seq DESC LIMIT 1`,
		gameID, typ).Scan(&e.Seq, &typeName, &data, &visible, &src)
	if errors.Is(err, sql.ErrNoRows) {
		return engine.Event{}, ErrNotFound
	}
	if err != nil {
		return engine.Event{}, err
	}
	e.Src = engine.Source(src)
	e.Type = engine.EventType(typeName)
	e.Data = json.RawMessage(data)
	if visible.Valid {
		if err := json.Unmarshal([]byte(visible.String), &e.Visible); err != nil {
			return engine.Event{}, err
		}
	}
	return e, nil
}

func (s *Store) SaveSnapshot(gameID string, seq int, state []byte) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`INSERT OR REPLACE INTO snapshots (game_id, seq, state) VALUES (?, ?, ?)`,
		gameID, seq, state); err != nil {
		return err
	}
	// Keep exactly one row. Deleting every other seq (not just lower ones)
	// holds even if seq ever moves backward.
	if _, err := tx.Exec(`DELETE FROM snapshots WHERE game_id = ? AND seq <> ?`, gameID, seq); err != nil {
		return err
	}
	return tx.Commit()
}

// LoadLatestSnapshot returns the newest snapshot, or ErrNotFound.
func (s *Store) LoadLatestSnapshot(gameID string) (seq int, state []byte, err error) {
	err = s.rdb.QueryRow(`SELECT seq, state FROM snapshots WHERE game_id = ? ORDER BY seq DESC LIMIT 1`, gameID).
		Scan(&seq, &state)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil, ErrNotFound
	}
	return seq, state, err
}
