package store

import "errors"

// ErrUserInActiveGame is returned by SoftResetUser when the target is currently
// seated in a game that is in progress (status 'active'). Resetting mid-game
// would corrupt the in-flight rating context, so the caller must wait for the
// game to finish (a user only in a 'lobby' game can still be reset).
var ErrUserInActiveGame = errors.New("store: user is seated in an active game")

// UserByDiscordID looks up the account linked to a Discord user id, using the
// UNIQUE discord_id mirror column on users. ErrNotFound if no account is linked.
func (s *Store) UserByDiscordID(discordID string) (*User, error) {
	return s.userBy(`discord_id = ?`, discordID)
}

// SoftResetUser clears a user's competitive record (per-ruleset ratings and
// win/loss stats, ranked penalties, and forfeit marks) while preserving
// everything else (wallet, cosmetics, maps, identities, sessions, friends, and
// the account's name/avatar). It is the action behind the /reset-user admin
// command: a "fresh start, same login".
//
// Refuses with ErrUserInActiveGame if the user is seated in an in-progress game.
func (s *Store) SoftResetUser(userID int64) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var inActive int
	if err := tx.QueryRow(`
		SELECT COUNT(*) FROM seats st JOIN games g ON g.id = st.game_id
		WHERE st.user_id = ? AND g.status = 'active'`, userID).Scan(&inActive); err != nil {
		return err
	}
	if inActive > 0 {
		return ErrUserInActiveGame
	}

	for _, table := range []string{"ratings", "stats", "ranked_penalties", "forfeits"} {
		if _, err := tx.Exec(`DELETE FROM `+table+` WHERE user_id = ?`, userID); err != nil { //nolint:gosec // G202: table comes from a hardcoded literal slice, not user input; user_id is parameterized
			return err
		}
	}
	return tx.Commit()
}
