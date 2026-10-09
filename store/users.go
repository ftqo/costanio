package store

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"time"

	"github.com/ftqo/costan.io/namefilter"
)

type User struct {
	ID        int64
	DiscordID string // empty for guests
	IsGuest   bool
	Name      string
	Avatar    string
}

var ErrNotFound = errors.New("store: not found")

func (s *Store) CreateGuest(name string) (*User, error) {
	res, err := s.db.Exec(`INSERT INTO users (is_guest, name, created_at) VALUES (1, ?, ?)`,
		name, time.Now().Unix())
	if err != nil {
		return nil, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return nil, err
	}
	return &User{ID: id, IsGuest: true, Name: name}, nil
}

// UpsertDiscordUser creates or refreshes the user row for a Discord identity.
func (s *Store) UpsertDiscordUser(discordID, name, avatar string) (*User, error) {
	return s.UpsertUser("discord", discordID, name, avatar, "")
}

func (s *Store) UserByID(id int64) (*User, error) {
	return s.userBy(`id = ?`, id)
}

// SetUserName updates a user's account display name (the settings default).
func (s *Store) SetUserName(id int64, name string) error {
	_, err := s.db.Exec(`UPDATE users SET name = ? WHERE id = ?`, name, id)
	return err
}

func (s *Store) userBy(where string, arg any) (*User, error) {
	u := &User{}
	var discordID sql.NullString
	err := s.rdb.QueryRow(`SELECT id, discord_id, is_guest, name, avatar FROM users WHERE `+where, arg).
		Scan(&u.ID, &discordID, &u.IsGuest, &u.Name, &u.Avatar)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	u.DiscordID = discordID.String
	return u, nil
}

// MergeGuestIntoProvider links a guest's history to a provider identity.
//
// The "does this provider user already exist?" decision is made inside the
// transaction, so a concurrently created row cannot make the promote branch
// fail on the UNIQUE constraint.
//
//   - Promote: no existing provider row -> the guest row becomes the registered user.
//   - Merge:   an existing provider row -> the guest's rows are folded into the
//     survivor by mergeUserRows (shared with MergeAccounts) and the guest deleted.
//
// The guest's sessions are deleted, so the caller must mint a fresh session
// (auth.setSession does). Returns the surviving user.
func (s *Store) MergeGuestIntoProvider(guestID int64, id Identity) (*User, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	var isGuest bool
	err = tx.QueryRow(`SELECT is_guest FROM users WHERE id = ?`, guestID).Scan(&isGuest)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if !isGuest {
		return nil, errors.New("store: user is not a guest")
	}

	now := time.Now().Unix()
	var existingID int64
	err = tx.QueryRow(`SELECT user_id FROM identities WHERE provider = ? AND provider_id = ?`,
		id.Provider, id.ProviderID).Scan(&existingID)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		// Promote: the guest row becomes the registered user.
		var discordCol any
		if id.Provider == "discord" {
			discordCol = id.ProviderID
		}
		if _, err := tx.Exec(`UPDATE users SET discord_id = ?, is_guest = 0, name = ?, avatar = ? WHERE id = ?`,
			discordCol, safeImportName(id.Name), id.Avatar, guestID); err != nil {
			return nil, err
		}
		if _, err := tx.Exec(`INSERT INTO identities (user_id, provider, provider_id, name, avatar, email, linked_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)`, guestID, id.Provider, id.ProviderID, id.Name, id.Avatar, id.Email, now); err != nil {
			return nil, err
		}
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		return s.UserByID(guestID)
	case err != nil:
		return nil, err
	}

	// If the identity already belongs to the guest, the merge would delete the
	// guest's only account. The link flow rejects guests, but guard anyway:
	// treat it as a no-op promote.
	if existingID == guestID {
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		return s.UserByID(guestID)
	}

	// Merge: fold the guest's rows onto the survivor.
	if err := mergeUserRows(tx, existingID, guestID, now); err != nil {
		return nil, err
	}

	if _, err := tx.Exec(`DELETE FROM users WHERE id = ?`, guestID); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(`UPDATE identities SET name = ?, avatar = ?, email = ? WHERE provider = ? AND provider_id = ?`,
		id.Name, id.Avatar, id.Email, id.Provider, id.ProviderID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.UserByID(existingID)
}

// MergeGuestIntoDiscord is the Discord-specific wrapper kept for existing callers.
func (s *Store) MergeGuestIntoDiscord(guestID int64, discordID, name, avatar string) (*User, error) {
	return s.MergeGuestIntoProvider(guestID, Identity{Provider: "discord", ProviderID: discordID, Name: name, Avatar: avatar})
}

// AccountSummary is a redacted snapshot of an account, used to preview a merge.
type AccountSummary struct {
	Name        string
	Avatar      string
	CreatedAt   int64
	Games       int
	IsSupporter bool
}

// AccountSummary returns display + scale info for a user. Used to show the user
// what a merge would absorb.
func (s *Store) AccountSummary(userID int64) (AccountSummary, error) {
	var a AccountSummary
	err := s.rdb.QueryRow(`SELECT name, COALESCE(avatar,''), created_at FROM users WHERE id = ?`, userID).
		Scan(&a.Name, &a.Avatar, &a.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return a, ErrNotFound
	}
	if err != nil {
		return a, err
	}
	if err := s.rdb.QueryRow(`SELECT COALESCE(SUM(games),0) FROM stats WHERE user_id = ?`, userID).Scan(&a.Games); err != nil {
		return a, err
	}
	var active int
	switch err := s.rdb.QueryRow(`SELECT active FROM supporter_status WHERE user_id = ?`, userID).Scan(&active); {
	case err == nil:
		a.IsSupporter = active != 0
	case errors.Is(err, sql.ErrNoRows):
	default:
		return a, err
	}
	return a, nil
}

// UsersShareGame reports whether two users occupy seats in the same game.
func (s *Store) UsersShareGame(a, b int64) (bool, error) {
	var n int
	err := s.rdb.QueryRow(`SELECT COUNT(*) FROM seats x JOIN seats y ON x.game_id = y.game_id
		WHERE x.user_id = ? AND y.user_id = ?`, a, b).Scan(&n)
	return n > 0, err
}

// MergeAccounts folds the victim account into the survivor (the account the
// caller is logged into) in a single transaction, then deletes the victim.
// Content rows are repointed; per-user aggregates are folded with explicit
// policies (see mergeUserRows, which MergeGuestIntoProvider shares); the
// survivor's identity wins on a same-provider collision. Returns
// ErrMergeSharedGame if both accounts are seated in one game (which would make a
// single user two players), and ErrNotFound if either account is missing.
func (s *Store) MergeAccounts(survivorID, victimID int64) error {
	if survivorID == victimID {
		return errors.New("store: cannot merge an account into itself")
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for _, id := range []int64{survivorID, victimID} {
		var x int
		if err := tx.QueryRow(`SELECT 1 FROM users WHERE id = ?`, id).Scan(&x); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ErrNotFound
			}
			return err
		}
	}

	var shared int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM seats x JOIN seats y ON x.game_id = y.game_id
		WHERE x.user_id = ? AND y.user_id = ?`, survivorID, victimID).Scan(&shared); err != nil {
		return err
	}
	if shared > 0 {
		return ErrMergeSharedGame
	}

	now := time.Now().Unix()

	// Every row the victim owns, repointed or folded by policy.
	if err := mergeUserRows(tx, survivorID, victimID, now); err != nil {
		return err
	}

	// Discord mirror: clear the victim's first (users.discord_id is UNIQUE), then
	// resync the survivor's from whatever discord identity it now holds.
	if _, err := tx.Exec(`UPDATE users SET discord_id = NULL WHERE id = ?`, victimID); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE users SET discord_id =
		(SELECT provider_id FROM identities WHERE user_id = ? AND provider = 'discord')
		WHERE id = ?`, survivorID, survivorID); err != nil {
		return err
	}

	// Prefer the (now possibly absorbed) Discord avatar for the survivor's display
	// picture, so the merge result is correct immediately, not just after a relogin.
	if err := refreshDisplayAvatar(tx, survivorID); err != nil {
		return err
	}

	// Delete the victim. mergeUserRows has already carried or cleared everything
	// that points at it, so nothing here is left to a cascade.
	if _, err := tx.Exec(`DELETE FROM users WHERE id = ?`, victimID); err != nil {
		return err
	}
	return tx.Commit()
}

// safeImportName screens a display name imported from an external identity
// provider, returning a value safe to store as users.name: the sanitized name when
// clean, or a neutral "Player######" placeholder when it is empty, reserved, or
// contains a slur. Unlike a user's own attempt to set a bad name, an import is
// not locked; the account may pick a clean name afterward.
func safeImportName(name string) string {
	if clean, v, _ := namefilter.Screen(name); v == namefilter.NameOK {
		return clean
	}
	return placeholderName()
}

// placeholderName returns a neutral "Player######" name with a random suffix. The
// suffix is random rather than the user id, which is not yet assigned when a new
// account is inserted.
func placeholderName() string {
	b := make([]byte, 3)
	if _, err := rand.Read(b); err != nil {
		panic(err) // crypto/rand failure is unrecoverable
	}
	return "Player" + hex.EncodeToString(b)
}

func newToken() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err) // crypto/rand failure is unrecoverable
	}
	return hex.EncodeToString(b)
}
