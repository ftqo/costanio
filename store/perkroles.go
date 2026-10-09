package store

import "time"

// PerkRoles returns the runtime-configured Discord role-ID to kind mapping (set via
// the /setrole command). Unioned with the static env allowlist by the sync.
func (s *Store) PerkRoles() (map[string]string, error) {
	rows, err := s.rdb.Query(`SELECT role_id, kind FROM perk_roles`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var roleID, kind string
		if err := rows.Scan(&roleID, &kind); err != nil {
			return nil, err
		}
		out[roleID] = kind
	}
	return out, rows.Err()
}

// SetPerkRole maps a Discord role ID to a perk kind (upsert). Re-mapping a role to
// a new kind overwrites the old one.
func (s *Store) SetPerkRole(roleID, kind string) error {
	_, err := s.db.Exec(`
		INSERT INTO perk_roles (role_id, kind, updated_at) VALUES (?, ?, ?)
		ON CONFLICT(role_id) DO UPDATE SET kind = excluded.kind, updated_at = excluded.updated_at`,
		roleID, kind, time.Now().Unix())
	return err
}

// DeletePerkRole removes a role-ID mapping. Returns whether a row was deleted.
func (s *Store) DeletePerkRole(roleID string) (bool, error) {
	res, err := s.db.Exec(`DELETE FROM perk_roles WHERE role_id = ?`, roleID)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}
