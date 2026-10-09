package store

import (
	"database/sql"
	"errors"

	"github.com/ftqo/costan.io/rating"
)

// Rating holds the OpenSkill parameters and the cached display value for a
// single (user, ruleset) pair.
type Rating struct {
	Mu        float64
	Sigma     float64
	Display   int
	UpdatedAt int64
}

// RatingRow returns the OpenSkill rating for a user/ruleset, or the unrated
// default (Mu0/Sigma0, display 1000) when no row exists.
func (s *Store) RatingRow(userID int64, ruleset string) (Rating, error) {
	var r Rating
	err := s.rdb.QueryRow(
		`SELECT mu, sigma, CAST(elo AS INTEGER), updated_at FROM ratings WHERE user_id = ? AND ruleset = ?`,
		userID, ruleset).Scan(&r.Mu, &r.Sigma, &r.Display, &r.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Rating{
			Mu:      rating.Mu0,
			Sigma:   rating.Sigma0,
			Display: rating.Display(rating.Player{Mu: rating.Mu0, Sigma: rating.Sigma0}),
		}, nil
	}
	if err != nil {
		return r, err
	}
	return r, nil
}

// ApplyGameRatings updates every player's rating for one finished game inside a
// single transaction (SetMaxOpenConns(1) plus the tx keep concurrent finishes
// from interleaving). Idle sigma decay is applied per player before the update.
func (s *Store) ApplyGameRatings(ruleset string, userIDs []int64, ranks []int, now int64) error {
	if len(userIDs) != len(ranks) || len(userIDs) < 2 {
		return nil
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := applyGameRatings(tx, ruleset, userIDs, ranks, now); err != nil {
		return err
	}
	return tx.Commit()
}

// applyGameRatings is the tx-aware core (a read-modify-write across all players,
// so it must run inside a transaction the caller owns). Shared by
// ApplyGameRatings (own tx) and FinalizeGame (shared finalize tx).
func applyGameRatings(q execQuerier, ruleset string, userIDs []int64, ranks []int, now int64) error {
	if len(userIDs) != len(ranks) || len(userIDs) < 2 {
		return nil
	}
	players := make([]rating.Player, len(userIDs))
	for i, uid := range userIDs {
		var p rating.Player
		var updated int64
		err := q.QueryRow(`SELECT mu, sigma, updated_at FROM ratings WHERE user_id = ? AND ruleset = ?`,
			uid, ruleset).Scan(&p.Mu, &p.Sigma, &updated)
		if errors.Is(err, sql.ErrNoRows) {
			p = rating.Player{Mu: rating.Mu0, Sigma: rating.Sigma0}
		} else if err != nil {
			return err
		} else if updated > 0 && now > updated {
			p = rating.Decayed(p, float64(now-updated)/86400.0)
		}
		players[i] = p
	}

	updated := rating.Update(players, ranks)
	for i, uid := range userIDs {
		np := updated[i]
		if _, err := q.Exec(`
			INSERT INTO ratings (user_id, ruleset, elo, mu, sigma, updated_at) VALUES (?, ?, ?, ?, ?, ?)
			ON CONFLICT(user_id, ruleset) DO UPDATE SET
				elo = excluded.elo, mu = excluded.mu, sigma = excluded.sigma, updated_at = excluded.updated_at`,
			uid, ruleset, rating.Display(np), np.Mu, np.Sigma, now); err != nil {
			return err
		}
	}
	return nil
}

type LeaderboardEntry struct {
	UserID      int64   `json:"user_id"`
	Name        string  `json:"name"`
	Avatar      string  `json:"avatar"` // profile-picture URL, or "" (UI falls back to a color disc)
	Elo         float64 `json:"elo"`
	Games       int     `json:"games"`
	Wins        int     `json:"wins"`
	Decoration  string  `json:"decoration"`  // equipped name-decoration item id, or ""
	Provisional bool    `json:"provisional"` // sigma > ProvisionalSigma
}

// Leaderboard returns the top-rated accounts for a ruleset, highest ELO first.
// Guests are excluded (u.is_guest = 0): bots are guest users, so this guarantees
// no bot ever appears on the board even if one somehow acquired a rating row.
func (s *Store) Leaderboard(ruleset string, limit int) ([]LeaderboardEntry, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rows, err := s.rdb.Query(`
		SELECT r.user_id, u.name, u.avatar, r.elo, COALESCE(st.ranked_games, 0), COALESCE(st.ranked_wins, 0),
		       COALESCE(ld_dec.item_id, ''), r.sigma
		FROM ratings r
		JOIN users u ON u.id = r.user_id
		LEFT JOIN stats st ON st.user_id = r.user_id AND st.ruleset = r.ruleset
		LEFT JOIN loadout ld_dec ON ld_dec.user_id = r.user_id AND ld_dec.slot = 'decoration'
		WHERE r.ruleset = ? AND u.is_guest = 0
		ORDER BY r.elo DESC LIMIT ?`, ruleset, limit)
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

// SetRatingRow overwrites a rating (test/seed helper).
func (s *Store) SetRatingRow(userID int64, ruleset string, mu, sigma float64, now int64) error {
	_, err := s.db.Exec(`
		INSERT INTO ratings (user_id, ruleset, elo, mu, sigma, updated_at) VALUES (?, ?, ?, ?, ?, ?)
		ON CONFLICT(user_id, ruleset) DO UPDATE SET elo=excluded.elo, mu=excluded.mu, sigma=excluded.sigma, updated_at=excluded.updated_at`,
		userID, ruleset, rating.Display(rating.Player{Mu: mu, Sigma: sigma}), mu, sigma, now)
	return err
}
