package store

import (
	"database/sql"
	"errors"
	"time"
)

// ActivityGame returns the game mapped to a Discord Activity instance, or "" if
// none exists yet.
func (s *Store) ActivityGame(instanceID string) (string, error) {
	var gid string
	err := s.rdb.QueryRow(`SELECT game_id FROM activity_instances WHERE instance_id = ?`, instanceID).Scan(&gid)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return gid, err
}

// MapActivity records the instance-to-game mapping. Returns true if this call
// created the mapping, false if one already existed (lost the create race).
func (s *Store) MapActivity(instanceID, gameID string) (bool, error) {
	res, err := s.db.Exec(
		`INSERT OR IGNORE INTO activity_instances (instance_id, game_id, created_at) VALUES (?, ?, ?)`,
		instanceID, gameID, time.Now().Unix(),
	)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// RepointActivity moves an instance from a dead table (abandoned, reaped,
// wedged) to a freshly created one. The update is guarded on the old game id, so
// two openers racing to replace the same dead table cannot fork the call: the
// first wins and the loser sees false and adopts the winner's game.
func (s *Store) RepointActivity(instanceID, oldGameID, newGameID string) (bool, error) {
	res, err := s.db.Exec(
		`UPDATE activity_instances SET game_id = ?, created_at = ? WHERE instance_id = ? AND game_id = ?`,
		newGameID, time.Now().Unix(), instanceID, oldGameID,
	)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// FollowActivityGame carries any activity instance from a table to the one that
// replaced it (a rematch, or a reset back to the lobby), so late joiners land on
// the current table. A no-op for a game no activity mapped.
func (s *Store) FollowActivityGame(oldGameID, newGameID string) error {
	_, err := s.db.Exec(
		`UPDATE activity_instances SET game_id = ? WHERE game_id = ?`,
		newGameID, oldGameID,
	)
	return err
}
