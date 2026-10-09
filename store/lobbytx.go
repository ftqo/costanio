package store

import "encoding/json"

// SeatPlacement is one seat exactly as it should exist after a rebuild: who
// sits there, in what state, wearing what. The zero Status means the schema
// default ('active'); an empty Color or DisplayName leaves the column empty,
// which readers resolve to the seat-order default and the account name.
type SeatPlacement struct {
	No          int
	UserID      int64
	Status      string
	Color       string
	DisplayName string
}

// ReplaceSeatsInput is a whole-table rebuild for one game: the seat set it
// should have afterwards, plus the game-row fields that must move with it.
//
// Config, PreShuffleSeats and Status are optional; each is written only when
// non-nil / non-empty. They are written together with the seats so a crash
// cannot leave a player count that disagrees with the seat set.
type ReplaceSeatsInput struct {
	GameID string
	Seats  []SeatPlacement
	// Config replaces games.config (nil leaves it alone).
	Config json.RawMessage
	// Ruleset replaces games.ruleset ("" leaves it alone). Written with Config
	// so the two cannot disagree.
	Ruleset string
	// PreShuffleSeats records the roster the seating permutation was applied to
	// (nil leaves it alone). See SetPreShuffleSeats.
	PreShuffleSeats []int64
	// Status replaces games.status ("" leaves it alone).
	Status string
}

// ReplaceSeats atomically swaps a game's entire seat set, optionally rewriting
// the game row's config, ruleset, pre-shuffle roster and status in the same
// transaction. Used by every lobby seat rebuild (start, close, reset, rematch,
// ranked match creation). An empty Seats tears the table down (Close).
func (s *Store) ReplaceSeats(in ReplaceSeatsInput) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if in.Config != nil {
		if _, err := tx.Exec(`UPDATE games SET config = ? WHERE id = ?`, string(in.Config), in.GameID); err != nil {
			return err
		}
	}
	if in.Ruleset != "" {
		if _, err := tx.Exec(`UPDATE games SET ruleset = ? WHERE id = ?`, in.Ruleset, in.GameID); err != nil {
			return err
		}
	}
	if in.PreShuffleSeats != nil {
		b, err := json.Marshal(in.PreShuffleSeats)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(`UPDATE games SET pre_shuffle_seats = ? WHERE id = ?`, string(b), in.GameID); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(`DELETE FROM seats WHERE game_id = ?`, in.GameID); err != nil {
		return err
	}
	for _, p := range in.Seats {
		if err := insertSeat(tx, in.GameID, p); err != nil {
			return err
		}
	}
	if in.Status != "" {
		if _, err := tx.Exec(`UPDATE games SET status = ? WHERE id = ?`, in.Status, in.GameID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// AddSeatFull seats one player with their status and color in a single
// transaction (the AddBot path).
//
// It keeps AddSeat's ErrSeatTaken disambiguation: a (game_id, user_id) collision
// means this user already holds a seat here and the caller should stop, while a
// (game_id, seat_no) collision means someone took this seat and the caller
// should retry against the next free one.
func (s *Store) AddSeatFull(gameID string, p SeatPlacement) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := insertSeat(tx, gameID, p); err != nil {
		if isUniqueViolation(err) {
			var x int
			if qerr := tx.QueryRow(`SELECT 1 FROM seats WHERE game_id = ? AND user_id = ?`,
				gameID, p.UserID).Scan(&x); qerr == nil {
				return ErrSeatTaken
			}
		}
		return err
	}
	return tx.Commit()
}

// insertSeat writes one placement inside a caller-owned transaction. The
// optional columns are set in the INSERT rather than by follow-up UPDATEs so
// there is one statement per seat instead of four.
func insertSeat(q execQuerier, gameID string, p SeatPlacement) error {
	status := p.Status
	if status == "" {
		status = "active"
	}
	_, err := q.Exec(`INSERT INTO seats (game_id, seat_no, user_id, status, color, display_name) VALUES (?, ?, ?, ?, ?, ?)`,
		gameID, p.No, p.UserID, status, p.Color, p.DisplayName)
	return err
}
