package store

import (
	"database/sql"
	"errors"
	"testing"
)

// rowsAffectedFails wraps an execQuerier and hands back a Result whose
// RowsAffected reports an error, which modernc's driver never produces.
type rowsAffectedFails struct {
	execQuerier
	armed bool // fail only the first Exec (the ledger insert)
}

type brokenResult struct{ sql.Result }

func (brokenResult) RowsAffected() (int64, error) {
	return 0, errors.New("driver: rows affected unavailable")
}

func (f *rowsAffectedFails) Exec(query string, args ...any) (sql.Result, error) {
	res, err := f.execQuerier.Exec(query, args...)
	if err != nil || f.armed {
		return res, err
	}
	f.armed = true
	return brokenResult{res}, nil
}

// TestCreditLedgerAbortsWhenRowsAffectedFails: RowsAffected returns 0 alongside
// an error, which must abort rather than read as a duplicate idem_key, or the
// ledger row commits without the balance. Asserts balance == SUM(ledger).
func TestCreditLedgerAbortsWhenRowsAffectedFails(t *testing.T) {
	s := openTest(t)
	u, err := s.CreateGuest("payee")
	if err != nil {
		t.Fatal(err)
	}
	tx, err := s.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()

	err = creditLedger(&rowsAffectedFails{execQuerier: tx}, u.ID, 250, "match", "idem-1", 1)
	if err == nil {
		t.Fatal("creditLedger ignored the RowsAffected error")
	}
	// The abort has to be total, so the caller's rollback leaves nothing behind.
	if rerr := tx.Rollback(); rerr != nil && !errors.Is(rerr, sql.ErrTxDone) {
		t.Fatal(rerr)
	}
	var ledger, balance int
	if err := s.db.QueryRow(`SELECT COALESCE(SUM(amount),0) FROM wallet_ledger WHERE user_id = ?`, u.ID).Scan(&ledger); err != nil {
		t.Fatal(err)
	}
	if err := s.db.QueryRow(`SELECT COALESCE(SUM(balance),0) FROM wallet_balance WHERE user_id = ?`, u.ID).Scan(&balance); err != nil {
		t.Fatal(err)
	}
	if ledger != balance {
		t.Fatalf("wallet_balance %d != SUM(wallet_ledger) %d", balance, ledger)
	}
}

// TestBumpRankedStrikeAbortsOnUnreadableCount: a failed strike read must abort
// rather than be treated as "no row yet", which would overwrite the real count
// with 1. A strikes column holding text gives a Scan error that is not
// ErrNoRows.
func TestBumpRankedStrikeAbortsOnUnreadableCount(t *testing.T) {
	s := openTest(t)
	u, err := s.CreateGuest("forfeiter")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(`INSERT INTO ranked_penalties (user_id, strikes, cooldown_until, updated_at)
		VALUES (?, 'five', 0, 0)`, u.ID); err != nil {
		t.Fatal(err)
	}
	tx, err := s.db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	if _, err := bumpRankedStrike(tx, u.ID, 1000); err == nil {
		t.Fatal("bumpRankedStrike ignored the read error")
	}
	if err := tx.Rollback(); err != nil && !errors.Is(err, sql.ErrTxDone) {
		t.Fatal(err)
	}
	var strikes string
	if err := s.db.QueryRow(`SELECT strikes FROM ranked_penalties WHERE user_id = ?`, u.ID).Scan(&strikes); err != nil {
		t.Fatal(err)
	}
	if strikes != "five" {
		t.Errorf("strikes = %q, want unchanged", strikes)
	}
}

// A missing row still means zero strikes, the one error the read may absorb.
func TestBumpRankedStrikeFirstOffenceStillWorks(t *testing.T) {
	s := openTest(t)
	u, err := s.CreateGuest("first-timer")
	if err != nil {
		t.Fatal(err)
	}
	until, err := s.BumpRankedStrike(u.ID, 1000)
	if err != nil {
		t.Fatalf("first strike: %v", err)
	}
	if want := 1000 + rankedCooldowns[0]; until != want {
		t.Errorf("cooldown = %d, want %d", until, want)
	}
}
