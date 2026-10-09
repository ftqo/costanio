package store

// ReplaceFriends replaces the cached Discord friend list for a user.
func (s *Store) ReplaceFriends(userID int64, friendDiscordIDs []string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM discord_friends WHERE user_id = ?`, userID); err != nil {
		return err
	}
	for _, fid := range friendDiscordIDs {
		if _, err := tx.Exec(`INSERT OR IGNORE INTO discord_friends (user_id, friend_discord_id) VALUES (?, ?)`,
			userID, fid); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// FriendsWithAccounts returns the user's cached Discord friends that have costan
// accounts.
func (s *Store) FriendsWithAccounts(userID int64) ([]*User, error) {
	rows, err := s.rdb.Query(`
		SELECT u.id, u.discord_id, u.is_guest, u.name, u.avatar
		FROM discord_friends f
		JOIN users u ON u.discord_id = f.friend_discord_id
		WHERE f.user_id = ?
		ORDER BY u.name`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*User
	for rows.Next() {
		u := &User{}
		if err := rows.Scan(&u.ID, &u.DiscordID, &u.IsGuest, &u.Name, &u.Avatar); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}
