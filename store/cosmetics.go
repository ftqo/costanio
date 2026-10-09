package store

import (
	"database/sql"
	"errors"
	"time"
)

// GrantEntitlement records that a user owns item_id. Idempotent per (user,item):
// re-granting (even from a different source) keeps the original row.
func (s *Store) GrantEntitlement(userID int64, itemID, source string) error {
	_, err := s.db.Exec(`
		INSERT INTO entitlements (user_id, item_id, source, granted_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(user_id, item_id) DO NOTHING`,
		userID, itemID, source, time.Now().Unix())
	return err
}

// HasEntitlement reports whether the user owns item_id.
func (s *Store) HasEntitlement(userID int64, itemID string) (bool, error) {
	var one int
	err := s.rdb.QueryRow(`SELECT 1 FROM entitlements WHERE user_id = ? AND item_id = ?`, userID, itemID).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

// Entitlements returns the set of item_ids the user owns.
func (s *Store) Entitlements(userID int64) (map[string]bool, error) {
	rows, err := s.rdb.Query(`SELECT item_id FROM entitlements WHERE user_id = ?`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out[id] = true
	}
	return out, rows.Err()
}

// SetLoadoutSlot equips item_id in slot for the user (one row per slot).
func (s *Store) SetLoadoutSlot(userID int64, slot, itemID string) error {
	_, err := s.db.Exec(`
		INSERT INTO loadout (user_id, slot, item_id) VALUES (?, ?, ?)
		ON CONFLICT(user_id, slot) DO UPDATE SET item_id = excluded.item_id`,
		userID, slot, itemID)
	return err
}

// ClearLoadoutSlot unequips whatever is in slot for the user.
func (s *Store) ClearLoadoutSlot(userID int64, slot string) error {
	_, err := s.db.Exec(`DELETE FROM loadout WHERE user_id = ? AND slot = ?`, userID, slot)
	return err
}

// Loadout returns the user's equipped item per slot.
func (s *Store) Loadout(userID int64) (map[string]string, error) {
	rows, err := s.rdb.Query(`SELECT slot, item_id FROM loadout WHERE user_id = ?`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var slot, itemID string
		if err := rows.Scan(&slot, &itemID); err != nil {
			return nil, err
		}
		out[slot] = itemID
	}
	return out, rows.Err()
}

// Supporter is a user's supporter snapshot. The zero value means "not a
// supporter" (Active false, Since 0). UpdatedAt is when the snapshot was last
// synced, used by the pull-based refresher to decide if it is stale.
type Supporter struct {
	Active    bool  `json:"active"`
	Boosting  bool  `json:"boosting"` // currently boosting the server (subset of Active)
	Kofi      bool  `json:"kofi"`     // holds the Ko-fi role (green decoration)
	Staff     bool  `json:"staff"`    // holds the staff role (fire decoration)
	Gift      bool  `json:"gift"`     // holds the gift role (gates the gift-only decorations)
	Since     int64 `json:"since"`    // first-ever activation, never cleared
	Until     int64 `json:"until"`
	UpdatedAt int64 `json:"-"`
}

// Supporter returns the user's supporter snapshot (zero value if none).
func (s *Store) Supporter(userID int64) (Supporter, error) {
	var sup Supporter
	var active, boosting, kofi, staff, gift int
	var since, until sql.NullInt64
	err := s.rdb.QueryRow(
		`SELECT active, boosting, kofi, staff, gift, since, until, updated_at FROM supporter_status WHERE user_id = ?`, userID).
		Scan(&active, &boosting, &kofi, &staff, &gift, &since, &until, &sup.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Supporter{}, nil
	}
	if err != nil {
		return Supporter{}, err
	}
	sup.Active = active != 0
	sup.Boosting = boosting != 0
	sup.Kofi = kofi != 0
	sup.Staff = staff != 0
	sup.Gift = gift != 0
	sup.Since = since.Int64
	sup.Until = until.Int64
	return sup, nil
}

// ActiveSupporters returns the user ids of every currently-active supporter.
// The monthly-stipend job iterates these and grants each their (idempotent)
// supporter stipend.
func (s *Store) ActiveSupporters() ([]int64, error) {
	rows, err := s.rdb.Query(`SELECT user_id FROM supporter_status WHERE active = 1`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// StaleSupporters returns user ids whose supporter snapshot was last synced
// before `before` (unix). The background refresh sweep uses this to re-pull
// roles for users who have not been checked recently, catching lapses for
// people who do not trigger a point-of-use check.
//
// It covers anyone holding any flag (active supporter, staff, kofi). Rows with
// no flags are excluded to avoid a Discord pull per user per cycle; they pick
// up new roles at login or point of use.
func (s *Store) StaleSupporters(before int64, limit int) ([]int64, error) {
	if limit <= 0 || limit > 1000 {
		limit = 200
	}
	rows, err := s.rdb.Query(
		`SELECT user_id FROM supporter_status
		 WHERE (active = 1 OR boosting = 1 OR kofi = 1 OR staff = 1) AND updated_at < ?
		 ORDER BY updated_at LIMIT ?`,
		before, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// SetSupporter writes the user's supporter snapshot. Activating stamps `since`
// on first activation only (it is never cleared afterwards), so the tenure badge
// survives a lapse. boosting/kofi/staff are role-derived perk flags (each a subset
// of "holds the role"). periodEnd (unix, 0 if unknown) is stored as `until`.
func (s *Store) SetSupporter(userID int64, active, boosting, kofi, staff, gift bool, periodEnd int64) error {
	now := time.Now().Unix()
	b2i := func(v bool) int {
		if v {
			return 1
		}
		return 0
	}
	var sinceSeed sql.NullInt64
	if active {
		sinceSeed = sql.NullInt64{Int64: now, Valid: true}
	}
	var until sql.NullInt64
	if periodEnd > 0 {
		until = sql.NullInt64{Int64: periodEnd, Valid: true}
	}
	_, err := s.db.Exec(`
		INSERT INTO supporter_status (user_id, active, boosting, kofi, staff, gift, since, until, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(user_id) DO UPDATE SET
			active   = excluded.active,
			boosting = excluded.boosting,
			kofi     = excluded.kofi,
			staff    = excluded.staff,
			gift     = excluded.gift,
			since    = COALESCE(supporter_status.since, excluded.since),
			until    = COALESCE(excluded.until, supporter_status.until),
			updated_at = excluded.updated_at`,
		userID, b2i(active), b2i(boosting), b2i(kofi), b2i(staff), b2i(gift), sinceSeed, until, now)
	return err
}
