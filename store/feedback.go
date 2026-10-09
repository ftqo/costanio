package store

import (
	"database/sql"
	"errors"
	"time"
)

// Feedback is one message a player sent from the feedback form.
type Feedback struct {
	ID        int64
	UserID    int64
	Msg       string
	Page      string
	CreatedAt int64
}

// CreateFeedback stores a player's feedback and returns its id.
func (s *Store) CreateFeedback(userID int64, msg, page string) (int64, error) {
	res, err := s.db.Exec(
		`INSERT INTO feedback (user_id, msg, page, created_at) VALUES (?, ?, ?, ?)`,
		userID, msg, page, time.Now().Unix(),
	)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// FeedbackByID returns one feedback row, or ErrNotFound.
func (s *Store) FeedbackByID(id int64) (*Feedback, error) {
	f := &Feedback{}
	err := s.rdb.QueryRow(
		`SELECT id, user_id, msg, page, created_at FROM feedback WHERE id = ?`, id,
	).Scan(&f.ID, &f.UserID, &f.Msg, &f.Page, &f.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return f, err
}

// SetFeedbackMessageID records the Discord message a feedback row was posted
// as, for audit.
func (s *Store) SetFeedbackMessageID(id int64, msgID string) error {
	_, err := s.db.Exec(`UPDATE feedback SET discord_message_id = ? WHERE id = ?`, msgID, id)
	return err
}

const feedbackChannelKey = "feedback_channel"

// SetFeedbackChannel stores the Discord channel id where player feedback is
// posted. An empty id clears the setting: feedback is still stored, just not
// posted.
func (s *Store) SetFeedbackChannel(channelID string) error {
	_, err := s.db.Exec(`INSERT INTO mod_config (k, v) VALUES (?, ?)
		ON CONFLICT(k) DO UPDATE SET v = excluded.v`, feedbackChannelKey, channelID)
	return err
}

// FeedbackChannel returns the configured feedback channel id, or "" if unset.
func (s *Store) FeedbackChannel() (string, error) {
	var v string
	err := s.rdb.QueryRow(`SELECT v FROM mod_config WHERE k = ?`, feedbackChannelKey).Scan(&v)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return v, err
}
