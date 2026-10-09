package store

import (
	"database/sql"
	"errors"
	"time"
)

// MatchHistoryRow is one finished game's persisted scoreboard blob plus the
// index columns used for listing. Record is opaque JSON (a game.MatchRecord);
// store does not depend on game/, so it is handled as a string here.
type MatchHistoryRow struct {
	GameID       string
	Ruleset      string
	Ranked       bool
	WinnerUserID *int64
	FinishedAt   int64
	Record       string
}

func scanMatchRow(rows interface{ Scan(...any) error }) (MatchHistoryRow, error) {
	var r MatchHistoryRow
	var winner sql.NullInt64
	if err := rows.Scan(&r.GameID, &r.Ruleset, &r.Ranked, &winner, &r.FinishedAt, &r.Record); err != nil {
		return r, err
	}
	if winner.Valid {
		w := winner.Int64
		r.WinnerUserID = &w
	}
	return r, nil
}

// MatchHistoryForUser returns finished matches the user played (a non-bot seat),
// newest first. before==0 starts from newest; otherwise only finished_at<before.
func (s *Store) MatchHistoryForUser(userID, before int64, limit int) ([]MatchHistoryRow, error) {
	if limit <= 0 {
		limit = 20
	} else if limit > 50 {
		limit = 50
	}
	rows, err := s.rdb.Query(`
		SELECT mh.game_id, mh.ruleset, mh.ranked, mh.winner_user_id, mh.finished_at, mh.record
		FROM match_history mh
		JOIN seats s ON s.game_id = mh.game_id
		WHERE s.user_id = ? AND s.status != 'bot'
		  AND (? = 0 OR mh.finished_at < ?)
		ORDER BY mh.finished_at DESC, mh.game_id DESC
		LIMIT ?`,
		userID, before, before, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []MatchHistoryRow
	for rows.Next() {
		r, err := scanMatchRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// MatchHistoryByGame returns one game's stored blob, or ErrNotFound.
func (s *Store) MatchHistoryByGame(gameID string) (*MatchHistoryRow, error) {
	row := s.rdb.QueryRow(`
		SELECT game_id, ruleset, ranked, winner_user_id, finished_at, record
		FROM match_history WHERE game_id = ?`, gameID)
	r, err := scanMatchRow(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

// FinishedGamesWithoutMatchHistory returns the IDs of finished games that have
// no match_history row yet and have at least one human (non-bot) seat.
// Bot-only games are excluded here so callers avoid a wasted BuildScoreboard.
func (s *Store) FinishedGamesWithoutMatchHistory() ([]string, error) {
	rows, err := s.rdb.Query(`
		SELECT g.id FROM games g
		WHERE g.status = 'finished'
		  AND NOT EXISTS (
		    SELECT 1 FROM match_history mh WHERE mh.game_id = g.id
		  )
		  AND EXISTS (
		    SELECT 1 FROM seats s WHERE s.game_id = g.id AND s.status != 'bot'
		  )`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// SaveMatchHistory inserts a finished game's blob. It is idempotent: a second
// insert for the same game_id is a no-op (ON CONFLICT DO NOTHING), so replays
// or duplicate finalization never overwrite or error.
func (s *Store) SaveMatchHistory(row MatchHistoryRow) error {
	return saveMatchHistory(s.db, row, time.Now().Unix())
}

// saveMatchHistory is the tx-aware core, shared by SaveMatchHistory
// (auto-commit) and FinalizeGame (inside the finalize transaction). The insert
// is idempotent (ON CONFLICT DO NOTHING), and its presence is the marker that
// FinishedGamesWithoutMatchHistory / recoverFinalization key off.
func saveMatchHistory(q execQuerier, row MatchHistoryRow, createdAt int64) error {
	_, err := q.Exec(`
		INSERT INTO match_history (game_id, ruleset, ranked, winner_user_id, finished_at, record, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(game_id) DO NOTHING`,
		row.GameID, row.Ruleset, row.Ranked, row.WinnerUserID, row.FinishedAt, row.Record, createdAt)
	return err
}
