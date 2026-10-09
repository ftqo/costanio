package store

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"time"
)

// sessionHashMigration is the migration (0034_session_token_hash.sql) that
// renamed sessions.token to token_hash; its Go step rehashes the rows.
const sessionHashMigration = 34

// hashSessionToken is what the sessions table stores for a token: hex
// SHA-256. The token is 32 random bytes, so an unsalted hash is enough and
// keeps the lookup a primary-key probe. The raw token exists only on the
// client and in CreateSession's return value.
func hashSessionToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// rawSessionTokens reads the whole token column before migration 0034 rewrites
// it, so the rewrite never updates a row a live cursor is walking.
func rawSessionTokens(db migrationExec) ([]string, error) {
	rows, err := db.Query(`SELECT token_hash FROM sessions`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var raw []string
	for rows.Next() {
		var tok string
		if err := rows.Scan(&tok); err != nil {
			return nil, err
		}
		raw = append(raw, tok)
	}
	return raw, rows.Err()
}

// rehashSessionTokens is migration 0034's data step: every row's token_hash
// still holds the raw token, so replace it with its hash. It reads the whole
// column first and writes afterwards, so it never updates a row it is
// iterating, and it runs inside the migration's transaction (goMigrations).
func rehashSessionTokens(db migrationExec) error {
	raw, err := rawSessionTokens(db)
	if err != nil {
		return err
	}
	for _, tok := range raw {
		if _, err := db.Exec(`UPDATE sessions SET token_hash = ? WHERE token_hash = ?`, hashSessionToken(tok), tok); err != nil {
			return err
		}
	}
	return nil
}

const (
	// sessionTTL is the sliding inactivity window: each use extends expiry.
	sessionTTL = 30 * 24 * time.Hour
	// sessionMaxAge is the absolute lifetime cap, however often the session
	// is used, so a leaked token eventually dies.
	sessionMaxAge = 90 * 24 * time.Hour
	// sessionSlideThreshold is the minimum the sliding expiry must advance before
	// UserBySession persists it. Writing it on every request would take the
	// write lock and contend with game-event persistence; an hour of slack
	// keeps most requests read-only.
	sessionSlideThreshold = time.Hour
)

func (s *Store) CreateSession(userID int64) (token string, err error) {
	token = newToken()
	now := time.Now()
	_, err = s.db.Exec(`INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`,
		hashSessionToken(token), userID, now.Add(sessionTTL).Unix(), now.Unix())
	if err != nil {
		return "", err
	}
	return token, nil
}

// UserBySession resolves a session token, sliding its expiry forward. A token
// past its sliding expiry OR its absolute max-age is treated as not found and
// its row removed.
//
// The lookup uses the read handle although the arms below write: the decision
// is made against the clock, not a value written back, and a concurrent
// DeleteSession just leaves the UPDATE matching zero rows. Every authenticated
// request pays this, so it must not queue behind event commits.
func (s *Store) UserBySession(token string) (*User, error) {
	key := hashSessionToken(token)
	var userID, expiresAt, createdAt int64
	err := s.rdb.QueryRow(`SELECT user_id, expires_at, created_at FROM sessions WHERE token_hash = ?`, key).
		Scan(&userID, &expiresAt, &createdAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	now := time.Now()
	maxExpiry := createdAt + int64(sessionMaxAge.Seconds())
	if expiresAt < now.Unix() || now.Unix() >= maxExpiry {
		if _, derr := s.db.Exec(`DELETE FROM sessions WHERE token_hash = ?`, key); derr != nil {
			return nil, derr
		}
		return nil, ErrNotFound
	}
	// Slide the sliding window forward but never past the absolute cap.
	newExpiry := min(now.Add(sessionTTL).Unix(), maxExpiry)
	// Only write when the expiry would move materially (see
	// sessionSlideThreshold). The session is still valid either way.
	if newExpiry-expiresAt > int64(sessionSlideThreshold.Seconds()) {
		if _, err := s.db.Exec(`UPDATE sessions SET expires_at = ? WHERE token_hash = ?`, newExpiry, key); err != nil {
			return nil, err
		}
	}
	return s.UserByID(userID)
}

func (s *Store) DeleteSession(token string) error {
	_, err := s.db.Exec(`DELETE FROM sessions WHERE token_hash = ?`, hashSessionToken(token))
	return err
}

// SweepExpiredSessions deletes sessions past their (sliding) expiry and returns
// how many rows were removed. Intended to be called periodically by the server
// so expired rows don't accumulate (UserBySession only prunes the token it
// looks at).
//
// One predicate on expires_at, served by the sessions_expires_at index. No
// max-age arm is needed: UserBySession clamps expires_at to created_at +
// sessionMaxAge.
func (s *Store) SweepExpiredSessions() (int64, error) {
	now := time.Now().Unix()
	res, err := s.db.Exec(`DELETE FROM sessions WHERE expires_at < ?`, now)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}
