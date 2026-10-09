package store

import (
	"database/sql"

	"github.com/ftqo/costan.io/rating"
)

// RefreshLeaderboardSnapshot rebuilds the leaderboard snapshot from the current
// live ratings (+ per-ruleset stats). The public leaderboard reads this snapshot
// rather than live ratings, so standings only move when this runs (a daily
// background job). `now` stamps the capture time for the due check.
func (s *Store) RefreshLeaderboardSnapshot(now int64) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`DELETE FROM leaderboard_snapshot`); err != nil {
		return err
	}
	if _, err := tx.Exec(`
		INSERT INTO leaderboard_snapshot (ruleset, user_id, elo, sigma, games, wins, captured_at)
		SELECT r.ruleset, r.user_id, r.elo, r.sigma,
		       COALESCE(st.ranked_games, 0), COALESCE(st.ranked_wins, 0), ?
		FROM ratings r
		LEFT JOIN stats st ON st.user_id = r.user_id AND st.ruleset = r.ruleset`, now); err != nil {
		return err
	}
	return tx.Commit()
}

// RefreshLeaderboardSnapshotIfDue refreshes the snapshot only if it has never
// been captured or the most recent capture is at least `interval` seconds old.
// Reports whether a refresh happened. The daily job calls this on a tighter
// ticker so a restart never forces an early refresh. The due check stays on
// the write handle because it decides the write.
func (s *Store) RefreshLeaderboardSnapshotIfDue(now, interval int64) (bool, error) {
	var captured sql.NullInt64
	if err := s.db.QueryRow(`SELECT MAX(captured_at) FROM leaderboard_snapshot`).Scan(&captured); err != nil {
		return false, err
	}
	if captured.Valid && now-captured.Int64 < interval {
		return false, nil
	}
	if err := s.RefreshLeaderboardSnapshot(now); err != nil {
		return false, err
	}
	return true, nil
}

// LeaderboardSnapshot returns the top-rated accounts for a ruleset from the daily
// snapshot, highest ELO first. Like Leaderboard it excludes guests (bots are
// guests) and is empty until the first RefreshLeaderboardSnapshot.
func (s *Store) LeaderboardSnapshot(ruleset string, limit int) ([]LeaderboardEntry, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rows, err := s.rdb.Query(`
		SELECT ls.user_id, u.name, u.avatar, ls.elo, ls.games, ls.wins,
		       COALESCE(ld_dec.item_id, ''), ls.sigma
		FROM leaderboard_snapshot ls
		JOIN users u ON u.id = ls.user_id
		LEFT JOIN loadout ld_dec ON ld_dec.user_id = ls.user_id AND ld_dec.slot = 'decoration'
		WHERE ls.ruleset = ? AND u.is_guest = 0
		ORDER BY ls.elo DESC LIMIT ?`, ruleset, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []LeaderboardEntry
	for rows.Next() {
		var e LeaderboardEntry
		var sigma float64
		if err := rows.Scan(&e.UserID, &e.Name, &e.Avatar, &e.Elo, &e.Games, &e.Wins, &e.Decoration, &sigma); err != nil {
			return nil, err
		}
		e.Provisional = sigma > rating.ProvisionalSigma
		out = append(out, e)
	}
	return out, rows.Err()
}
