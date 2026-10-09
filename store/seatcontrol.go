package store

import "time"

// SeatControl is one transition in who was holding a seat, anchored to the log
// position it took effect at. See migration 0028 for why this is a side table
// and not an event type, and why it records control rather than connectivity.
type SeatControl struct {
	AtSeq   int    `json:"at_seq"`
	Seat    int    `json:"seat"`
	Control string `json:"control"` // human | auto | bot | bot_takeover
	TS      int64  `json:"ts"`
}

// RecordSeatControl appends a seat-control transition. Two rows for one seat
// at the same at_seq mean it changed twice between moves; both are kept.
func (s *Store) RecordSeatControl(gameID string, atSeq, seat int, control string) error {
	_, err := s.db.Exec(
		`INSERT INTO seat_control (game_id, at_seq, seat, control, ts) VALUES (?, ?, ?, ?, ?)`,
		gameID, atSeq, seat, control, time.Now().Unix())
	return err
}

// SeatControlLog returns a game's seat-control transitions in the order they
// happened. Empty for every game played before provenance existed, and for a
// game nobody ever left.
//
// On rdb: it decides no write, and its caller is the replay-log endpoint,
// which must not queue in front of live games on the writer.
func (s *Store) SeatControlLog(gameID string) ([]SeatControl, error) {
	rows, err := s.rdb.Query(
		`SELECT at_seq, seat, control, ts FROM seat_control WHERE game_id = ? ORDER BY id`, gameID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SeatControl
	for rows.Next() {
		var c SeatControl
		if err := rows.Scan(&c.AtSeq, &c.Seat, &c.Control, &c.TS); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}
