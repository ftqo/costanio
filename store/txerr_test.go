package store

import (
	"encoding/json"
	"testing"

	"github.com/ftqo/costan.io/engine"
)

// These tests trigger genuine mid-transaction constraint failures (FK
// violations) so the intermediate `tx.Exec` error guards run; a closed-DB test
// cannot reach them because they fail after a successful Begin.

func TestLedgerNonPositiveAmounts(t *testing.T) {
	s := openTest(t)
	u, _ := s.CreateGuest("ann")
	if _, err := s.LedgerCredit(u.ID, 0, "r", "k"); err == nil {
		t.Error("LedgerCredit(0) returned nil, want error")
	}
	if _, err := s.LedgerCredit(u.ID, -5, "r", "k"); err == nil {
		t.Error("LedgerCredit(-5) returned nil, want error")
	}
	if _, err := s.LedgerSpend(u.ID, 0, "r", "k"); err == nil {
		t.Error("LedgerSpend(0) returned nil, want error")
	}
	if _, err := s.LedgerSpend(u.ID, -5, "r", "k"); err == nil {
		t.Error("LedgerSpend(-5) returned nil, want error")
	}
}

func TestLedgerCreditFKError(t *testing.T) {
	s := openTest(t)
	// user_id has an FK to users; crediting a nonexistent user fails the ledger
	// INSERT inside the tx (after Begin succeeds).
	if _, err := s.LedgerCredit(99999, 10, "grant", "k"); err == nil {
		t.Error("LedgerCredit for missing user returned nil, want FK error")
	}
}

func TestSaveSnapshotFKError(t *testing.T) {
	s := openTest(t)
	// snapshots.game_id FK -> games; a missing game fails the first tx.Exec.
	if err := s.SaveSnapshot("no-such-game", 1, []byte("s")); err == nil {
		t.Error("SaveSnapshot for missing game returned nil, want FK error")
	}
}

func TestReplaceFriendsFKError(t *testing.T) {
	s := openTest(t)
	// discord_friends.user_id FK -> users; the DELETE succeeds (no rows) but the
	// INSERT for a nonexistent user fails inside the loop.
	if err := s.ReplaceFriends(99999, []string{"someone"}); err == nil {
		t.Error("ReplaceFriends for missing user returned nil, want FK error")
	}
}

func TestAppendEventsFKError(t *testing.T) {
	s := openTest(t)
	// events.game_id FK -> games; seq 0 passes the contiguity check, then the
	// INSERT fails FK -> isUniqueViolation(false) -> returns the raw driver error.
	err := s.AppendEvents("no-such-game", []engine.Event{
		{Seq: 0, Type: "t", Data: json.RawMessage(`{}`)},
	})
	if err == nil {
		t.Error("AppendEvents for missing game returned nil, want FK error")
	}
}
