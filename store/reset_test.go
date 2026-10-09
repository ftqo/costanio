package store

import (
	"errors"
	"testing"
)

func TestUserByDiscordID(t *testing.T) {
	s := openTest(t)
	created, err := s.UpsertDiscordUser("disc-777", "Cara", "av")
	if err != nil {
		t.Fatal(err)
	}

	got, err := s.UserByDiscordID("disc-777")
	if err != nil {
		t.Fatalf("UserByDiscordID: %v", err)
	}
	if got.ID != created.ID || got.DiscordID != "disc-777" {
		t.Fatalf("got %+v; want id %d / disc-777", got, created.ID)
	}

	if _, err := s.UserByDiscordID("nobody"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown discord id: err = %v; want ErrNotFound", err)
	}
}

// rowCount is a test-only helper to assert a table was (or wasn't) cleared.
func rowCount(t *testing.T, s *Store, table string, userID int64) int {
	t.Helper()
	var n int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM `+table+` WHERE user_id = ?`, userID).Scan(&n); err != nil {
		t.Fatalf("count %s: %v", table, err)
	}
	return n
}

func TestSoftResetKeepsEconomy(t *testing.T) {
	s := openTest(t)
	u, err := s.UpsertDiscordUser("disc-1", "Dee", "av")
	if err != nil {
		t.Fatal(err)
	}
	const now = 1_700_000_000

	// Competitive record (should be cleared).
	if err := s.SetRatingRow(u.ID, "base", 30, 5, now); err != nil {
		t.Fatal(err)
	}
	if err := s.BumpStats(u.ID, "base", true, false, true, false); err != nil {
		t.Fatal(err)
	}
	// forfeits now FK-references games(id); create the game before forfeiting.
	if err := s.CreateGame(&Game{ID: "game-1", Ruleset: "base", Config: []byte("{}"), CreatedBy: u.ID}); err != nil {
		t.Fatal(err)
	}
	if err := s.RecordForfeit("game-1", u.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.BumpRankedStrike(u.ID, now); err != nil {
		t.Fatal(err)
	}
	// Economy (should be preserved).
	if _, err := s.LedgerCredit(u.ID, 100, "test", "idem-1"); err != nil {
		t.Fatal(err)
	}

	if err := s.SoftResetUser(u.ID); err != nil {
		t.Fatalf("SoftResetUser: %v", err)
	}

	// Cleared.
	if n := rowCount(t, s, "ratings", u.ID); n != 0 {
		t.Errorf("ratings rows = %d; want 0", n)
	}
	if n := rowCount(t, s, "stats", u.ID); n != 0 {
		t.Errorf("stats rows = %d; want 0", n)
	}
	if n := rowCount(t, s, "forfeits", u.ID); n != 0 {
		t.Errorf("forfeits rows = %d; want 0", n)
	}
	if n := rowCount(t, s, "ranked_penalties", u.ID); n != 0 {
		t.Errorf("ranked_penalties rows = %d; want 0", n)
	}
	// Preserved.
	bal, err := s.Balance(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if bal != 100 {
		t.Errorf("wallet balance = %d; want 100 (preserved)", bal)
	}
	// Account + identity preserved (stable re-login).
	if _, err := s.UserByDiscordID("disc-1"); err != nil {
		t.Errorf("account/identity should survive reset: %v", err)
	}
}

func TestSoftResetUserRefusesWhenInActiveGame(t *testing.T) {
	s := openTest(t)
	u, err := s.UpsertDiscordUser("disc-2", "Eve", "av")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.CreateGame(&Game{ID: "g-active", Ruleset: "base", Config: []byte("{}"), CreatedBy: u.ID}); err != nil {
		t.Fatal(err)
	}
	if err := s.AddSeat("g-active", 0, u.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.SetGameStatus("g-active", "active"); err != nil {
		t.Fatal(err)
	}

	err = s.SoftResetUser(u.ID)
	if !errors.Is(err, ErrUserInActiveGame) {
		t.Fatalf("reset while in active game: err = %v; want ErrUserInActiveGame", err)
	}

	// A user only in a *lobby* game can still be reset.
	if err := s.SetGameStatus("g-active", "lobby"); err != nil {
		t.Fatal(err)
	}
	if err := s.SoftResetUser(u.ID); err != nil {
		t.Fatalf("reset while only in lobby: %v", err)
	}
}
