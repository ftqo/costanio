package store

import (
	"database/sql"
	"errors"
	"time"
)

// ErrInsufficientFunds is returned by LedgerSpend when a debit would drive the
// balance negative.
var ErrInsufficientFunds = errors.New("store: insufficient funds")

// LedgerEntry is one append-only row of the currency ledger.
type LedgerEntry struct {
	Amount    int    `json:"amount"`
	Reason    string `json:"reason"`
	CreatedAt int64  `json:"at"`
}

// Balance returns the user's current Pip balance. It reads the cached
// wallet_balance snapshot (O(1)), not a SUM over the journal. The cache is kept
// in lockstep with wallet_ledger inside the same transaction as every append, so
// it is exact; wallet_ledger remains the source of truth.
func (s *Store) Balance(userID int64) (int, error) {
	var bal int
	err := s.rdb.QueryRow(`SELECT balance FROM wallet_balance WHERE user_id = ?`, userID).Scan(&bal)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	return bal, err
}

// LedgerCredit appends a credit (amount>0) under idemKey and returns the new
// balance. Re-using an idemKey is a successful no-op that returns the current
// balance, which makes faucets and purchases safe to retry. The
// ledger append and the cached-balance bump happen in one transaction.
func (s *Store) LedgerCredit(userID int64, amount int, reason, idemKey string) (int, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	if err := creditLedger(tx, userID, amount, reason, idemKey, time.Now().Unix()); err != nil {
		return 0, err
	}
	bal, err := txBalance(tx, userID)
	if err != nil {
		return 0, err
	}
	return bal, tx.Commit()
}

// creditLedger appends one credit and bumps the cached balance inside a
// caller-owned transaction.
//
// Shared by LedgerCredit and FinalizeGame (which credits the match faucet in the
// same transaction as stats and ratings). Takes an execQuerier so a test can
// inject the RowsAffected failure below.
func creditLedger(q execQuerier, userID int64, amount int, reason, idemKey string, now int64) error {
	if amount <= 0 {
		return errors.New("store: credit amount must be positive")
	}
	res, err := q.Exec(`
		INSERT INTO wallet_ledger (user_id, amount, reason, idem_key, created_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(idem_key) DO NOTHING`,
		userID, amount, reason, idemKey, now)
	if err != nil {
		return err
	}
	// Only bump the cached balance when the append happened; a duplicate
	// idem_key is a no-op. A RowsAffected error must roll back: read as 0 it
	// would commit the ledger row without the balance, and no retry could fix
	// it. wallet_balance must equal SUM(wallet_ledger).
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n > 0 {
		if _, err := q.Exec(`
			INSERT INTO wallet_balance (user_id, balance, updated_at) VALUES (?, ?, ?)
			ON CONFLICT(user_id) DO UPDATE SET balance = balance + ?, updated_at = excluded.updated_at`,
			userID, amount, now, amount); err != nil {
			return err
		}
	}
	return nil
}

// txBalance reads the cached balance within a transaction (0 if no row yet).
func txBalance(tx *sql.Tx, userID int64) (int, error) {
	var bal int
	err := tx.QueryRow(`SELECT balance FROM wallet_balance WHERE user_id = ?`, userID).Scan(&bal)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, nil
	}
	return bal, err
}

// LedgerSpend appends a debit of amount>0 under idemKey, rejecting the spend if
// it would overdraw the balance. The check-then-insert runs in one transaction
// so concurrent spends can't both pass the balance check. Re-using an idemKey is
// a successful no-op (returns the current balance).
func (s *Store) LedgerSpend(userID int64, amount int, reason, idemKey string) (int, error) {
	if amount <= 0 {
		return 0, errors.New("store: spend amount must be positive")
	}
	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	// Idempotency: a prior spend under this key already happened; return the
	// current balance unchanged.
	var seen int
	if err := tx.QueryRow(`SELECT COUNT(*) FROM wallet_ledger WHERE idem_key = ?`, idemKey).Scan(&seen); err != nil {
		return 0, err
	}
	bal, err := txBalance(tx, userID)
	if err != nil {
		return 0, err
	}
	if seen > 0 {
		return bal, tx.Commit()
	}
	if bal < amount {
		return bal, ErrInsufficientFunds
	}
	now := time.Now().Unix()
	if _, err := tx.Exec(`
		INSERT INTO wallet_ledger (user_id, amount, reason, idem_key, created_at)
		VALUES (?, ?, ?, ?, ?)`,
		userID, -amount, reason, idemKey, now); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(`
		INSERT INTO wallet_balance (user_id, balance, updated_at) VALUES (?, ?, ?)
		ON CONFLICT(user_id) DO UPDATE SET balance = balance - ?, updated_at = excluded.updated_at`,
		userID, -amount, now, amount); err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return bal - amount, nil
}

// CountCredits returns how many credit rows the user has with the given reason
// since the given unix time (inclusive). Used to enforce per-day faucet caps.
func (s *Store) CountCredits(userID int64, reason string, since int64) (int, error) {
	var n int
	err := s.rdb.QueryRow(
		`SELECT COUNT(*) FROM wallet_ledger WHERE user_id = ? AND reason = ? AND amount > 0 AND created_at >= ?`,
		userID, reason, since).Scan(&n)
	return n, err
}

// CreditDays returns the distinct UTC days (as "2006-01-02") on which the user
// took a credit of the given reason, newest first, back to `since`.
//
// Streaks are counted from this, so they need no table of their own. Dates are
// computed in SQLite so the day boundary matches the idempotency keys' UTC one.
func (s *Store) CreditDays(userID int64, reason string, since int64) ([]string, error) {
	rows, err := s.rdb.Query(
		`SELECT DISTINCT date(created_at, 'unixepoch') AS day
		 FROM wallet_ledger
		 WHERE user_id = ? AND reason = ? AND amount > 0 AND created_at >= ?
		 ORDER BY day DESC`,
		userID, reason, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var day string
		if err := rows.Scan(&day); err != nil {
			return nil, err
		}
		out = append(out, day)
	}
	return out, rows.Err()
}

// RecentLedger returns the user's most recent ledger entries, newest first.
func (s *Store) RecentLedger(userID int64, limit int) ([]LedgerEntry, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	rows, err := s.rdb.Query(
		`SELECT amount, reason, created_at FROM wallet_ledger WHERE user_id = ? ORDER BY id DESC LIMIT ?`,
		userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []LedgerEntry
	for rows.Next() {
		var e LedgerEntry
		if err := rows.Scan(&e.Amount, &e.Reason, &e.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}
