package econ

import (
	"errors"
	"path/filepath"
	"testing"

	"github.com/ftqo/costan.io/store"
)

func openLedger(t *testing.T) (*Ledger, *store.Store) {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "econ.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { st.Close() })
	return New(st), st
}

func TestBalanceEmpty(t *testing.T) {
	l, st := openLedger(t)
	u, err := st.CreateGuest("ann")
	if err != nil {
		t.Fatal(err)
	}
	bal, err := l.Balance(u.ID)
	if err != nil || bal != 0 {
		t.Fatalf("empty balance = %d, %v; want 0, nil", bal, err)
	}
}

func TestGrantAndBalance(t *testing.T) {
	l, st := openLedger(t)
	u, _ := st.CreateGuest("bob")

	bal, err := l.Grant(u.ID, 25, "grant", "seed:1")
	if err != nil || bal != 25 {
		t.Fatalf("grant = %d, %v; want 25, nil", bal, err)
	}
	if got, _ := l.Balance(u.ID); got != 25 {
		t.Fatalf("balance after grant = %d; want 25", got)
	}

	// Reusing an idem key is a successful no-op (returns current balance).
	bal, err = l.Grant(u.ID, 25, "grant", "seed:1")
	if err != nil || bal != 25 {
		t.Fatalf("duplicate grant = %d, %v; want 25 (idempotent)", bal, err)
	}

	// A fresh key stacks.
	bal, err = l.Grant(u.ID, 5, "grant", "seed:2")
	if err != nil || bal != 30 {
		t.Fatalf("stacked grant = %d, %v; want 30", bal, err)
	}
}

func TestSpendAndInsufficientFunds(t *testing.T) {
	l, st := openLedger(t)
	u, _ := st.CreateGuest("cara")
	l.Grant(u.ID, 100, "grant", "seed")

	bal, err := l.Spend(u.ID, 40, "purchase", "buy:frame.laurel")
	if err != nil || bal != 60 {
		t.Fatalf("spend = %d, %v; want 60, nil", bal, err)
	}

	// Idempotent spend: same key does not double-charge.
	bal, err = l.Spend(u.ID, 40, "purchase", "buy:frame.laurel")
	if err != nil || bal != 60 {
		t.Fatalf("duplicate spend = %d, %v; want 60 (idempotent)", bal, err)
	}

	// Overdraw is rejected with the re-exported sentinel; balance untouched.
	_, err = l.Spend(u.ID, 1000, "purchase", "buy:board.aurora")
	if !errors.Is(err, ErrInsufficientFunds) {
		t.Fatalf("overdraw err = %v; want ErrInsufficientFunds", err)
	}
	if got, _ := l.Balance(u.ID); got != 60 {
		t.Fatalf("balance after rejected spend = %d; want 60", got)
	}
}

func TestErrInsufficientFundsIsStoreSentinel(t *testing.T) {
	if !errors.Is(ErrInsufficientFunds, store.ErrInsufficientFunds) {
		t.Fatal("econ.ErrInsufficientFunds must wrap store.ErrInsufficientFunds")
	}
}

func TestRecent(t *testing.T) {
	l, st := openLedger(t)
	u, _ := st.CreateGuest("dan")

	if entries, err := l.Recent(u.ID, 10); err != nil || len(entries) != 0 {
		t.Fatalf("empty recent = %v, %v; want empty", entries, err)
	}

	l.Grant(u.ID, 10, "match", "m:1")
	l.Grant(u.ID, 15, "daily", "d:1")
	l.Spend(u.ID, 5, "purchase", "p:1")

	entries, err := l.Recent(u.ID, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 3 {
		t.Fatalf("recent len = %d; want 3", len(entries))
	}
	// Newest first: the spend is the last write.
	if entries[0].Reason != "purchase" || entries[0].Amount != -5 {
		t.Fatalf("newest entry = %+v; want purchase -5", entries[0])
	}

	// The limit is honored.
	limited, err := l.Recent(u.ID, 2)
	if err != nil || len(limited) != 2 {
		t.Fatalf("limited recent = %v (len %d), %v; want len 2", limited, len(limited), err)
	}
}
