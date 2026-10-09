// Package econ is the earned-currency ("Pips") layer. It is the only writer to
// the wallet ledger and is imported by cosmetics for purchases. The engine and
// game actor never import it. See docs/cosmetics.md §3.
package econ

import "github.com/ftqo/costan.io/store"

// ErrInsufficientFunds is re-exported so callers depend on econ, not store.
var ErrInsufficientFunds = store.ErrInsufficientFunds

type Ledger struct {
	st *store.Store
}

func New(st *store.Store) *Ledger { return &Ledger{st: st} }

// Balance returns the user's current Pip balance.
func (l *Ledger) Balance(userID int64) (int, error) {
	return l.st.Balance(userID)
}

// Grant credits amount (>0) under idemKey and returns the new balance. Reusing
// an idemKey is a successful no-op.
func (l *Ledger) Grant(userID int64, amount int, reason, idemKey string) (int, error) {
	return l.st.LedgerCredit(userID, amount, reason, idemKey)
}

// Spend debits amount (>0) under idemKey, returning ErrInsufficientFunds if it
// would overdraw. Reusing an idemKey is a successful no-op.
func (l *Ledger) Spend(userID int64, amount int, reason, idemKey string) (int, error) {
	return l.st.LedgerSpend(userID, amount, reason, idemKey)
}

// Recent returns the user's latest ledger entries (newest first).
func (l *Ledger) Recent(userID int64, limit int) ([]store.LedgerEntry, error) {
	return l.st.RecentLedger(userID, limit)
}
