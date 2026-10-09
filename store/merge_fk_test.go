package store

import (
	"fmt"
	"testing"
)

// schemaUserRefs reads every column in the live schema that references users(id),
// keyed "table.column", valued with the FK's ON DELETE action.
func schemaUserRefs(t *testing.T, s *Store) map[string]string {
	t.Helper()
	found := map[string]string{}
	for _, tbl := range schemaTables(t, s) {
		for col, onDelete := range tableUserFKs(t, s, tbl) {
			found[tbl+"."+col] = onDelete
		}
	}
	return found
}

func schemaTables(t *testing.T, s *Store) []string {
	t.Helper()
	rows, err := s.rdb.Query(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
	if err != nil {
		t.Fatalf("list tables: %v", err)
	}
	defer rows.Close()
	var tables []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatalf("scan table: %v", err)
		}
		tables = append(tables, name)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("list tables: %v", err)
	}
	return tables
}

// tableUserFKs returns the table's columns that reference users(id), each mapped
// to its ON DELETE action.
func tableUserFKs(t *testing.T, s *Store, table string) map[string]string {
	t.Helper()
	rows, err := s.rdb.Query(fmt.Sprintf("PRAGMA foreign_key_list(%q)", table))
	if err != nil {
		t.Fatalf("foreign_key_list(%s): %v", table, err)
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var id, seq int
		var target, from, to, onUpdate, onDelete, match string
		if err := rows.Scan(&id, &seq, &target, &from, &to, &onUpdate, &onDelete, &match); err != nil {
			t.Fatalf("scan fk of %s: %v", table, err)
		}
		if target == "users" {
			out[from] = onDelete
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("foreign_key_list(%s): %v", table, err)
	}
	return out
}

// TestUserForeignKeysAreHandledByMerge checks userRefs against the schema.
// Both merge paths delete the absorbed account with foreign keys on, so an
// unhandled users(id) reference fails the delete and the whole merge. Every
// reference must appear in userRefs, and no entry may name a missing column.
func TestUserForeignKeysAreHandledByMerge(t *testing.T) {
	s := openTest(t)
	schema := schemaUserRefs(t, s)

	declared := map[string]bool{}
	for _, ref := range userRefs {
		key := ref.table + "." + ref.column
		if declared[key] {
			t.Errorf("userRefs lists %s twice", key)
		}
		declared[key] = true
		if _, ok := schema[key]; !ok {
			t.Errorf("userRefs names %s, which is not a users(id) reference in the schema", key)
		}
	}

	for key, onDelete := range schema {
		if declared[key] {
			continue
		}
		if onDelete == "CASCADE" {
			// A cascade cannot break the delete but can still destroy state,
			// so cascading references are listed too.
			t.Errorf("%s references users(id) ON DELETE CASCADE but is not in userRefs", key)
			continue
		}
		t.Errorf("%s references users(id) ON DELETE %s but is not in userRefs", key, onDelete)
	}
}

// assertNoRowsReferenceUser checks the merge left nothing at all pointing at the
// absorbed account. Driven by userRefs, so it covers whatever the schema grows.
func assertNoRowsReferenceUser(t *testing.T, s *Store, userID int64) {
	t.Helper()
	for _, ref := range userRefs {
		var n int
		q := fmt.Sprintf("SELECT COUNT(*) FROM %q WHERE %q = ?", ref.table, ref.column)
		if err := s.rdb.QueryRow(q, userID).Scan(&n); err != nil {
			t.Fatalf("count %s.%s: %v", ref.table, ref.column, err)
		}
		if n != 0 {
			t.Errorf("%s.%s still has %d row(s) pointing at the absorbed account %d", ref.table, ref.column, n, userID)
		}
	}
}

// assertBalanceMatchesLedger asserts the documented wallet invariant: the cached
// wallet_balance equals SUM(wallet_ledger) for the user.
func assertBalanceMatchesLedger(t *testing.T, s *Store, userID int64) int {
	t.Helper()
	var cached, summed int
	if err := s.rdb.QueryRow(`SELECT COALESCE(balance, 0) FROM wallet_balance WHERE user_id = ?`, userID).Scan(&cached); err != nil {
		t.Fatalf("wallet_balance: %v", err)
	}
	if err := s.rdb.QueryRow(`SELECT COALESCE(SUM(amount), 0) FROM wallet_ledger WHERE user_id = ?`, userID).Scan(&summed); err != nil {
		t.Fatalf("SUM(wallet_ledger): %v", err)
	}
	if cached != summed {
		t.Errorf("wallet_balance %d != SUM(wallet_ledger) %d for user %d", cached, summed, userID)
	}
	return summed
}
