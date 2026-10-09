package store

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"
)

// Map is a user-created board layout in the reusable library.
type Map struct {
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Board     json.RawMessage `json:"board"`
	CreatedBy int64           `json:"created_by"`
	CreatedAt int64           `json:"created_at"`
}

func randomMapID() string {
	b := make([]byte, 8)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

func (s *Store) CreateMap(m *Map) error {
	if m.ID == "" {
		m.ID = randomMapID()
	}
	m.CreatedAt = time.Now().Unix()
	_, err := s.db.Exec(
		`INSERT INTO maps (id, name, board, created_by, created_at) VALUES (?, ?, ?, ?, ?)`,
		m.ID, m.Name, string(m.Board), m.CreatedBy, m.CreatedAt,
	)
	return err
}

func (s *Store) MapByID(id string) (*Map, error) {
	m := &Map{}
	var board string
	err := s.rdb.QueryRow(
		`SELECT id, name, board, created_by, created_at FROM maps WHERE id = ?`, id,
	).Scan(&m.ID, &m.Name, &board, &m.CreatedBy, &m.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	m.Board = json.RawMessage(board)
	return m, nil
}

// DeleteMap removes a map the user owns. It returns ErrNotFound when no row
// matched, whether the id does not exist or belongs to another user, so
// existence does not leak across owners.
func (s *Store) DeleteMap(id string, userID int64) error {
	res, err := s.db.Exec(
		`DELETE FROM maps WHERE id = ? AND created_by = ?`, id, userID,
	)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// ListMapsByUser returns the maps owned by one user, newest first. Distinct
// from ListMaps (which returns the global recent set for sharing) so a user's
// own library is never truncated by other users' maps filling the window.
func (s *Store) ListMapsByUser(userID int64) ([]*Map, error) {
	rows, err := s.rdb.Query(
		`SELECT id, name, board, created_by, created_at FROM maps WHERE created_by = ? ORDER BY created_at DESC LIMIT 200`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*Map{}
	for rows.Next() {
		m := &Map{}
		var board string
		if err := rows.Scan(&m.ID, &m.Name, &board, &m.CreatedBy, &m.CreatedAt); err != nil {
			return nil, err
		}
		m.Board = json.RawMessage(board)
		out = append(out, m)
	}
	return out, rows.Err()
}

func (s *Store) ListMaps() ([]*Map, error) {
	rows, err := s.rdb.Query(
		`SELECT id, name, board, created_by, created_at FROM maps ORDER BY created_at DESC LIMIT 200`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []*Map{}
	for rows.Next() {
		m := &Map{}
		var board string
		if err := rows.Scan(&m.ID, &m.Name, &board, &m.CreatedBy, &m.CreatedAt); err != nil {
			return nil, err
		}
		m.Board = json.RawMessage(board)
		out = append(out, m)
	}
	return out, rows.Err()
}
