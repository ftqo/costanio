package store

import (
	"database/sql"
	"errors"
	"time"
)

// RecordForfeit marks that a user forfeited a game (idempotent). Sticky: a
// reconnecting player who plays the rest of the game still counts as having
// forfeited.
func (s *Store) RecordForfeit(gameID string, userID int64) error {
	_, err := s.db.Exec(`
		INSERT INTO forfeits (game_id, user_id, ts) VALUES (?, ?, ?)
		ON CONFLICT(game_id, user_id) DO NOTHING`,
		gameID, userID, time.Now().Unix())
	return err
}

// Forfeited reports whether the user forfeited the given game. Intended for the
// (future) ranked system; unused otherwise.
func (s *Store) Forfeited(gameID string, userID int64) (bool, error) {
	var one int
	err := s.rdb.QueryRow(
		`SELECT 1 FROM forfeits WHERE game_id = ? AND user_id = ?`, gameID, userID).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}
