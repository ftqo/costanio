package store

import (
	"database/sql"
	"errors"
	"time"
)

// refreshDisplayAvatar recomputes the denormalized users.avatar for userID,
// preferring the account's Discord identity avatar and otherwise falling back to
// any other linked identity. An empty avatar never wins, so a good picture is
// never blanked. Call inside a tx once the account's identity rows are current
// (after a login/link/unlink/merge), so the displayed picture tracks Discord.
func refreshDisplayAvatar(tx *sql.Tx, userID int64) error {
	_, err := tx.Exec(`UPDATE users SET avatar = COALESCE(
		(SELECT avatar FROM identities WHERE user_id = ? AND provider = 'discord' AND avatar != ''),
		(SELECT avatar FROM identities WHERE user_id = ? AND avatar != '' ORDER BY linked_at ASC, provider ASC LIMIT 1),
		avatar) WHERE id = ?`, userID, userID, userID)
	return err
}

// Identity is one external login attached to a user.
type Identity struct {
	Provider   string
	ProviderID string
	Name       string
	Avatar     string
	Email      string
	LinkedAt   int64
}

// ErrIdentityTaken is returned when a (provider, provider_id) already belongs to
// a different user. ErrLastIdentity is returned when unlinking would leave a
// registered user with no way to log in. ErrMergeSharedGame is returned when
// two accounts cannot be merged because they are seated in the same game.
var (
	ErrIdentityTaken   = errors.New("store: identity already linked to another account")
	ErrLastIdentity    = errors.New("store: cannot unlink the last identity")
	ErrMergeSharedGame = errors.New("store: accounts share a game")
)

// UserByProvider resolves the user that owns a provider identity.
func (s *Store) UserByProvider(provider, providerID string) (*User, error) {
	var uid int64
	err := s.rdb.QueryRow(
		`SELECT user_id FROM identities WHERE provider = ? AND provider_id = ?`,
		provider, providerID).Scan(&uid)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	return s.UserByID(uid)
}

// IdentitiesForUser lists a user's linked identities, oldest first.
func (s *Store) IdentitiesForUser(userID int64) ([]Identity, error) {
	rows, err := s.rdb.Query(
		`SELECT provider, provider_id, name, avatar, email, linked_at
		 FROM identities WHERE user_id = ? ORDER BY linked_at`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Identity
	for rows.Next() {
		var id Identity
		if err := rows.Scan(&id.Provider, &id.ProviderID, &id.Name, &id.Avatar, &id.Email, &id.LinkedAt); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// LinkIdentity attaches a provider identity to userID. If the identity already
// belongs to a different user it returns ErrIdentityTaken. Re-linking the
// caller's own identity refreshes its display fields.
func (s *Store) LinkIdentity(userID int64, id Identity) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var owner int64
	err = tx.QueryRow(`SELECT user_id FROM identities WHERE provider = ? AND provider_id = ?`,
		id.Provider, id.ProviderID).Scan(&owner)
	switch {
	case err == nil:
		if owner != userID {
			return ErrIdentityTaken
		}
		if _, err := tx.Exec(`UPDATE identities SET name = ?, avatar = ?, email = ? WHERE provider = ? AND provider_id = ?`,
			id.Name, id.Avatar, id.Email, id.Provider, id.ProviderID); err != nil {
			return err
		}
	case errors.Is(err, sql.ErrNoRows):
		// UNIQUE(user_id, provider) guarantees one identity per provider per user;
		// a second provider of the same type surfaces as a constraint error.
		if _, err := tx.Exec(`INSERT INTO identities (user_id, provider, provider_id, name, avatar, email, linked_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)`, userID, id.Provider, id.ProviderID, id.Name, id.Avatar, id.Email, time.Now().Unix()); err != nil {
			return err
		}
	default:
		return err
	}
	if id.Provider == "discord" {
		if _, err := tx.Exec(`UPDATE users SET discord_id = ? WHERE id = ?`, id.ProviderID, userID); err != nil {
			return err
		}
	}
	if err := refreshDisplayAvatar(tx, userID); err != nil {
		return err
	}
	return tx.Commit()
}

// UnlinkIdentity removes a user's identity for a provider, refusing to remove
// the last one. Clears the discord mirror when unlinking discord.
func (s *Store) UnlinkIdentity(userID int64, provider string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var count int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM identities WHERE user_id = ?`, userID).Scan(&count); err != nil {
		return err
	}
	var exists int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM identities WHERE user_id = ? AND provider = ?`, userID, provider).Scan(&exists); err != nil {
		return err
	}
	if exists == 0 {
		return ErrNotFound
	}
	if count <= 1 {
		return ErrLastIdentity
	}
	if _, err := tx.Exec(`DELETE FROM identities WHERE user_id = ? AND provider = ?`, userID, provider); err != nil {
		return err
	}
	if provider == "discord" {
		if _, err := tx.Exec(`UPDATE users SET discord_id = NULL WHERE id = ?`, userID); err != nil {
			return err
		}
	}
	if err := refreshDisplayAvatar(tx, userID); err != nil {
		return err
	}
	return tx.Commit()
}

// UpsertUser logs in an existing provider identity or creates a new registered
// user for it. New users seed users.name/avatar from the provider; re-logins
// refresh only the identity row (not the editable account name). The discord
// mirror column is kept in sync. All writes are one transaction.
func (s *Store) UpsertUser(provider, providerID, name, avatar, email string) (*User, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var uid int64
	err = tx.QueryRow(`SELECT user_id FROM identities WHERE provider = ? AND provider_id = ?`,
		provider, providerID).Scan(&uid)
	switch {
	case err == nil:
		// Existing identity: refresh the identity row (not users.name).
		if _, err := tx.Exec(`UPDATE identities SET name = ?, avatar = ?, email = ? WHERE provider = ? AND provider_id = ?`,
			name, avatar, email, provider, providerID); err != nil {
			return nil, err
		}
		if provider == "discord" {
			if _, err := tx.Exec(`UPDATE users SET discord_id = ? WHERE id = ?`, providerID, uid); err != nil {
				return nil, err
			}
		}
	case errors.Is(err, sql.ErrNoRows):
		// New registered user + identity.
		now := time.Now().Unix()
		var discordCol any
		if provider == "discord" {
			discordCol = providerID
		}
		// users.name is the publicly displayed account name; screen the provider's
		// name so an offensive third-party username never surfaces. The identity row
		// keeps the raw provider name for the audit/merge record.
		res, err := tx.Exec(`INSERT INTO users (discord_id, is_guest, name, avatar, created_at) VALUES (?, 0, ?, ?, ?)`,
			discordCol, safeImportName(name), avatar, now)
		if err != nil {
			return nil, err
		}
		uid, err = res.LastInsertId()
		if err != nil {
			return nil, err
		}
		if _, err := tx.Exec(`INSERT INTO identities (user_id, provider, provider_id, name, avatar, email, linked_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)`, uid, provider, providerID, name, avatar, email, now); err != nil {
			return nil, err
		}
	default:
		return nil, err
	}
	if err := refreshDisplayAvatar(tx, uid); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.UserByID(uid)
}
