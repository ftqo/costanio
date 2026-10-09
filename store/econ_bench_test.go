package store

import (
	"strconv"
	"testing"
	"time"
)

// seedLedger bulk-inserts n credit rows for a fresh user in one transaction (no
// per-row balance read), so benchmark setup is O(n), not O(n^2).
func seedLedger(b *testing.B, s *Store, n int) int64 {
	b.Helper()
	u, _ := s.CreateGuest("bench")
	tx, err := s.db.Begin()
	if err != nil {
		b.Fatal(err)
	}
	stmt, err := tx.Prepare(`INSERT INTO wallet_ledger (user_id, amount, reason, idem_key, created_at) VALUES (?, 1, 'match', ?, ?)`)
	if err != nil {
		b.Fatal(err)
	}
	defer stmt.Close()
	now := time.Now().Unix()
	for i := range n {
		if _, err := stmt.Exec(u.ID, "k:"+strconv.Itoa(i), now); err != nil {
			b.Fatal(err)
		}
	}
	// Keep the cached balance consistent with the journal we just bulk-inserted.
	if _, err := tx.Exec(`INSERT INTO wallet_balance (user_id, balance, updated_at) VALUES (?, ?, ?)`, u.ID, n, now); err != nil {
		b.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		b.Fatal(err)
	}
	return u.ID
}

// BenchmarkBalance times a cached balance read across per-user row counts. With
// the wallet_balance snapshot the read is O(1), so the time should be flat
// regardless of journal size.
func BenchmarkBalance(b *testing.B) {
	for _, n := range []int{100, 2_000, 50_000} {
		b.Run(strconv.Itoa(n)+"rows", func(b *testing.B) {
			s := openBench(b)
			uid := seedLedger(b, s, n)
			b.ResetTimer()
			for range b.N {
				if _, err := s.Balance(uid); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}

// BenchmarkSpend times the transactional debit (which sums the balance inside
// the tx) against a user who already has 50k rows.
func BenchmarkSpend(b *testing.B) {
	s := openBench(b)
	uid := seedLedger(b, s, 50_000)
	b.ResetTimer()
	for i := range b.N {
		if _, err := s.LedgerSpend(uid, 1, "purchase", "spend:"+strconv.Itoa(i)); err != nil {
			b.Fatal(err)
		}
	}
}

func openBench(b *testing.B) *Store {
	b.Helper()
	s, err := Open(b.TempDir() + "/bench.db")
	if err != nil {
		b.Fatal(err)
	}
	b.Cleanup(func() { s.Close() })
	return s
}
