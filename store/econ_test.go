package store

import (
	"errors"
	"strconv"
	"testing"
	"time"
)

func itoa(n int64) string { return strconv.FormatInt(n, 10) }

func TestLedgerCreditAndBalance(t *testing.T) {
	s := openTest(t)
	u, _ := s.CreateGuest("ann")

	if bal, err := s.Balance(u.ID); err != nil || bal != 0 {
		t.Fatalf("empty balance = %d, %v; want 0", bal, err)
	}
	bal, err := s.LedgerCredit(u.ID, 10, "match", "match:g1:"+itoa(u.ID))
	if err != nil || bal != 10 {
		t.Fatalf("credit = %d, %v; want 10", bal, err)
	}
	// Same idem key: no-op, balance unchanged.
	bal, err = s.LedgerCredit(u.ID, 10, "match", "match:g1:"+itoa(u.ID))
	if err != nil || bal != 10 {
		t.Fatalf("duplicate credit = %d, %v; want 10 (idempotent)", bal, err)
	}
	// Different key: stacks.
	bal, _ = s.LedgerCredit(u.ID, 15, "daily", "daily:"+itoa(u.ID)+":2026-06-13")
	if bal != 25 {
		t.Fatalf("balance after second credit = %d; want 25", bal)
	}
}

func TestLedgerSpend(t *testing.T) {
	s := openTest(t)
	u, _ := s.CreateGuest("bob")
	s.LedgerCredit(u.ID, 100, "grant", "seed")

	bal, err := s.LedgerSpend(u.ID, 30, "purchase", "purchase:1:frame.laurel")
	if err != nil || bal != 70 {
		t.Fatalf("spend = %d, %v; want 70", bal, err)
	}
	// Idempotent: same purchase key does not double-charge.
	bal, err = s.LedgerSpend(u.ID, 30, "purchase", "purchase:1:frame.laurel")
	if err != nil || bal != 70 {
		t.Fatalf("duplicate spend = %d, %v; want 70 (idempotent)", bal, err)
	}
	// Overdraw rejected, balance untouched.
	bal, err = s.LedgerSpend(u.ID, 1000, "purchase", "purchase:1:board.aurora")
	if !errors.Is(err, ErrInsufficientFunds) {
		t.Fatalf("overdraw err = %v; want ErrInsufficientFunds", err)
	}
	if bal != 70 {
		t.Fatalf("balance after rejected spend = %d; want 70", bal)
	}
}

// TestBalanceCacheMatchesJournal is the core invariant: the cached wallet_balance
// must always equal the SUM of the immutable journal, through a mix of credits,
// spends, and idempotent retries.
func TestBalanceCacheMatchesJournal(t *testing.T) {
	s := openTest(t)
	u, _ := s.CreateGuest("inv")

	s.LedgerCredit(u.ID, 100, "grant", "a")
	s.LedgerCredit(u.ID, 100, "grant", "a") // dup: no-op
	s.LedgerCredit(u.ID, 50, "match", "b")
	s.LedgerSpend(u.ID, 30, "purchase", "c")
	s.LedgerSpend(u.ID, 30, "purchase", "c")   // dup: no-op
	s.LedgerSpend(u.ID, 9999, "purchase", "d") // rejected: no-op
	s.LedgerSpend(u.ID, 20, "purchase", "e")

	cached, err := s.Balance(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	var journal int
	if err := s.db.QueryRow(`SELECT COALESCE(SUM(amount),0) FROM wallet_ledger WHERE user_id = ?`, u.ID).Scan(&journal); err != nil {
		t.Fatal(err)
	}
	if cached != journal {
		t.Fatalf("cache %d != journal %d", cached, journal)
	}
	if cached != 100+50-30-20 {
		t.Fatalf("balance = %d; want 100", cached)
	}
}

func TestCountCredits(t *testing.T) {
	s := openTest(t)
	u, _ := s.CreateGuest("cara")
	today := time.Now().Unix() - 3600
	s.LedgerCredit(u.ID, 10, "match", "match:g1")
	s.LedgerCredit(u.ID, 10, "match", "match:g2")
	s.LedgerCredit(u.ID, 15, "daily", "daily:x")
	n, err := s.CountCredits(u.ID, "match", today)
	if err != nil || n != 2 {
		t.Fatalf("match credits today = %d, %v; want 2", n, err)
	}
}

// CreditDays is what a streak is counted from: the distinct UTC days a player
// was paid, newest first. Two credits on one day count once.
func TestCreditDays(t *testing.T) {
	s := openTest(t)
	u, _ := s.CreateGuest("streaker")

	day := func(iso string) int64 {
		t.Helper()
		when, err := time.Parse(time.RFC3339, iso)
		if err != nil {
			t.Fatal(err)
		}
		return when.Unix()
	}
	// Insert directly: the ledger API stamps credits with now.
	seed := func(at int64, key string) {
		t.Helper()
		if _, err := s.db.Exec(
			`INSERT INTO wallet_ledger (user_id, amount, reason, idem_key, created_at)
			 VALUES (?, 15, 'daily', ?, ?)`, u.ID, key, at); err != nil {
			t.Fatal(err)
		}
	}
	seed(day("2026-08-11T09:00:00Z"), "a")
	seed(day("2026-08-11T21:00:00Z"), "b") // same day, second credit
	seed(day("2026-08-10T09:00:00Z"), "c")
	seed(day("2026-07-01T09:00:00Z"), "old")

	days, err := s.CreditDays(u.ID, "daily", day("2026-08-01T00:00:00Z"))
	if err != nil {
		t.Fatalf("CreditDays: %v", err)
	}
	want := []string{"2026-08-11", "2026-08-10"}
	if len(days) != len(want) {
		t.Fatalf("days = %v; want %v (distinct, and inside the window)", days, want)
	}
	for i, d := range want {
		if days[i] != d {
			t.Errorf("day %d = %q; want %q", i, days[i], d)
		}
	}

	// Another reason's credits are not this streak.
	if days, _ := s.CreditDays(u.ID, "match", 0); len(days) != 0 {
		t.Errorf("match days = %v; want none", days)
	}
}
