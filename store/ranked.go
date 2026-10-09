package store

import (
	"database/sql"
	"errors"
)

// rankedCooldowns is the escalating queue lockout for repeat ranked forfeiters,
// indexed by strike count minus one: 5 min, 15 min, 1 h, 3 h, 12 h. A sixth
// and later forfeit stays at 12 h. It is a queue penalty only; the rating
// already moved by placing the leaver last.
var rankedCooldowns = []int64{5 * 60, 15 * 60, 60 * 60, 3 * 60 * 60, 12 * 60 * 60}

// rankedCleanWindow is how long a player must go without a ranked forfeit
// before the ladder resets to the bottom. Fourteen days is generous on purpose:
// the ladder deters repeated leaving within one evening.
const rankedCleanWindow = int64(14 * 24 * 60 * 60)

// RankedCooldownUntil returns the Unix timestamp until which the user is
// locked out of ranked queues, or 0 if no penalty row exists.
func (s *Store) RankedCooldownUntil(userID int64) (int64, error) {
	var until int64
	err := s.rdb.QueryRow(`SELECT cooldown_until FROM ranked_penalties WHERE user_id = ?`, userID).Scan(&until)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0, nil
		}
		return 0, err
	}
	return until, nil
}

// BumpRankedStrike increments the user's strike count and returns the
// escalating cooldown deadline it earns (see rankedCooldowns). A strike landing
// more than rankedCleanWindow after the previous one starts the ladder over.
func (s *Store) BumpRankedStrike(userID, now int64) (int64, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	until, err := bumpRankedStrike(tx, userID, now)
	if err != nil {
		return 0, err
	}
	return until, tx.Commit()
}

// bumpRankedStrike is the tx-aware core (a read-modify-write, so it must run
// inside a transaction the caller owns). Shared by BumpRankedStrike
// (own tx) and FinalizeGame (shared finalize tx).
func bumpRankedStrike(q execQuerier, userID, now int64) (int64, error) {
	var strikes int
	var updatedAt int64
	// Only "no row yet" means zero strikes. Any other error must abort, or the
	// UPSERT below would overwrite the real count with 1. Inside the finalize
	// transaction an abort is retried by the recovery sweep.
	err := q.QueryRow(`SELECT strikes, updated_at FROM ranked_penalties WHERE user_id = ?`, userID).Scan(&strikes, &updatedAt)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return 0, err
	}
	// A clean window since the last strike makes this a first offence again.
	// Measured from updated_at (the last forfeit), not cooldown_until.
	if strikes > 0 && now-updatedAt >= rankedCleanWindow {
		strikes = 0
	}
	strikes++

	until := now + rankedCooldowns[min(strikes, len(rankedCooldowns))-1]

	if _, err := q.Exec(`
		INSERT INTO ranked_penalties (user_id, strikes, cooldown_until, updated_at) VALUES (?, ?, ?, ?)
		ON CONFLICT(user_id) DO UPDATE SET strikes=excluded.strikes, cooldown_until=excluded.cooldown_until, updated_at=excluded.updated_at`,
		userID, strikes, until, now); err != nil {
		return 0, err
	}
	return until, nil
}
