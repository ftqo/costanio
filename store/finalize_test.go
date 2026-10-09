package store

import (
	"encoding/json"
	"testing"
)

// finalizeFixture creates two users and one finished game, returning their IDs.
func finalizeFixture(t *testing.T, s *Store) (u1, u2 int64, gameID string) {
	t.Helper()
	a, _ := s.CreateGuest("alice")
	b, _ := s.CreateGuest("bob")
	g := &Game{ID: "g1", Ruleset: "base", Config: json.RawMessage(`{}`), CreatedBy: a.ID}
	if err := s.CreateGame(g); err != nil {
		t.Fatalf("CreateGame: %v", err)
	}
	return a.ID, b.ID, g.ID
}

func countRows(t *testing.T, s *Store, q string, args ...any) int {
	t.Helper()
	var n int
	if err := s.db.QueryRow(q, args...).Scan(&n); err != nil {
		t.Fatalf("count (%s): %v", q, err)
	}
	return n
}

// TestFinalizeGameAtomicCommit: a valid input applies stats, ranked strike,
// ratings, and the match-history row.
func TestFinalizeGameAtomicCommit(t *testing.T) {
	s := openTest(t)
	u1, u2, gameID := finalizeFixture(t, s)

	in := FinalizeInput{
		Now:     1000,
		Ruleset: "base",
		Stats: []StatBump{
			{UserID: u1, Ruleset: "base", Won: true},
			{UserID: u2, Ruleset: "base", Won: false},
		},
		Strikes:       []int64{u2},
		RatingUserIDs: []int64{u1, u2},
		RatingRanks:   []int{1, 2},
		Match: &MatchHistoryRow{
			GameID: gameID, Ruleset: "base", Ranked: true,
			WinnerUserID: &u1, FinishedAt: 1000, Record: `{"version":1}`,
		},
	}
	if err := s.FinalizeGame(in); err != nil {
		t.Fatalf("FinalizeGame: %v", err)
	}

	if n := countRows(t, s, `SELECT COUNT(*) FROM stats WHERE ruleset='base'`); n != 2 {
		t.Errorf("stats rows = %d, want 2", n)
	}
	if n := countRows(t, s, `SELECT COUNT(*) FROM ranked_penalties WHERE user_id=?`, u2); n != 1 {
		t.Errorf("ranked_penalties rows = %d, want 1", n)
	}
	if n := countRows(t, s, `SELECT COUNT(*) FROM ratings WHERE ruleset='base'`); n != 2 {
		t.Errorf("ratings rows = %d, want 2", n)
	}
	if n := countRows(t, s, `SELECT COUNT(*) FROM match_history WHERE game_id=?`, gameID); n != 1 {
		t.Errorf("match_history rows = %d, want 1", n)
	}
	// Winner's display rating must end above the loser's.
	r1, _ := s.RatingRow(u1, "base")
	r2, _ := s.RatingRow(u2, "base")
	if r1.Display <= r2.Display {
		t.Errorf("winner display %d <= loser display %d", r1.Display, r2.Display)
	}
}

// TestFinalizeGameAtomicRollback: a failing write (the Match references a
// nonexistent game -> FK violation) rolls back the entire transaction, so
// recoverFinalization can retry without double-counting.
func TestFinalizeGameAtomicRollback(t *testing.T) {
	s := openTest(t)
	u1, u2, _ := finalizeFixture(t, s)

	in := FinalizeInput{
		Now:     1000,
		Ruleset: "base",
		Stats: []StatBump{
			{UserID: u1, Ruleset: "base", Won: true},
			{UserID: u2, Ruleset: "base", Won: false},
		},
		Strikes:       []int64{u2},
		RatingUserIDs: []int64{u1, u2},
		RatingRanks:   []int{1, 2},
		Match: &MatchHistoryRow{
			// game_id REFERENCES games(id); this one does not exist, so the
			// match insert fails and must roll back everything before it.
			GameID: "does-not-exist", Ruleset: "base", Ranked: true,
			WinnerUserID: &u1, FinishedAt: 1000, Record: `{"version":1}`,
		},
	}
	if err := s.FinalizeGame(in); err == nil {
		t.Fatal("FinalizeGame: expected FK error, got nil")
	}

	if n := countRows(t, s, `SELECT COUNT(*) FROM stats`); n != 0 {
		t.Errorf("stats rows after rollback = %d, want 0", n)
	}
	if n := countRows(t, s, `SELECT COUNT(*) FROM ranked_penalties`); n != 0 {
		t.Errorf("ranked_penalties rows after rollback = %d, want 0", n)
	}
	if n := countRows(t, s, `SELECT COUNT(*) FROM ratings`); n != 0 {
		t.Errorf("ratings rows after rollback = %d, want 0", n)
	}
	if n := countRows(t, s, `SELECT COUNT(*) FROM match_history`); n != 0 {
		t.Errorf("match_history rows after rollback = %d, want 0", n)
	}
}

// TestFinalizeGameAppliesCredits: the match faucet rides the finalize
// transaction, and the recovery sweep re-running it cannot pay twice.
func TestFinalizeGameAppliesCredits(t *testing.T) {
	s := openTest(t)
	u1, u2, gameID := finalizeFixture(t, s)

	in := FinalizeInput{
		Now:     1000,
		Ruleset: "base",
		Credits: []LedgerCreditInput{
			{UserID: u1, Amount: 10, Reason: "match", IdemKey: "match:" + gameID + ":1"},
			{UserID: u2, Amount: 10, Reason: "match", IdemKey: "match:" + gameID + ":2"},
		},
	}
	if err := s.FinalizeGame(in); err != nil {
		t.Fatalf("FinalizeGame: %v", err)
	}
	for _, uid := range []int64{u1, u2} {
		if bal, err := s.Balance(uid); err != nil || bal != 10 {
			t.Fatalf("balance(%d) = %d, %v; want 10", uid, bal, err)
		}
	}

	// The recovery sweep re-applies a finalize whose match row never landed.
	// The idem keys are what make that safe.
	if err := s.FinalizeGame(in); err != nil {
		t.Fatalf("re-finalize: %v", err)
	}
	for _, uid := range []int64{u1, u2} {
		if bal, _ := s.Balance(uid); bal != 10 {
			t.Fatalf("balance(%d) after replay = %d; want 10 (idempotent)", uid, bal)
		}
	}
}

// TestFinalizeGameCreditsRollBack: a finalize that fails after the
// credits must leave no Pips behind.
func TestFinalizeGameCreditsRollBack(t *testing.T) {
	s := openTest(t)
	u1, _, gameID := finalizeFixture(t, s)

	// A match row referencing a game that does not exist fails the insert, and
	// the insert is last, so the credits before it must roll back.
	in := FinalizeInput{
		Now: 1000, Ruleset: "base",
		Credits: []LedgerCreditInput{{UserID: u1, Amount: 10, Reason: "match", IdemKey: "match:x:1"}},
		Match: &MatchHistoryRow{
			GameID: "no-such-game", Ruleset: "base", FinishedAt: 1000, Record: `{"version":1}`,
		},
	}
	if err := s.FinalizeGame(in); err == nil {
		t.Fatal("FinalizeGame with a dangling match row: want error, got nil")
	}
	if bal, _ := s.Balance(u1); bal != 0 {
		t.Fatalf("balance after failed finalize = %d; want 0 (rolled back)", bal)
	}
	_ = gameID
}
