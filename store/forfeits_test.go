package store

import "testing"

func TestForfeits(t *testing.T) {
	s := openTest(t)
	u, _ := s.UpsertDiscordUser("d1", "U", "")
	// forfeits now FK-references games(id)/users(id); the game must exist first.
	if err := s.CreateGame(&Game{ID: "g1", Ruleset: "base", Config: []byte("{}"), CreatedBy: u.ID}); err != nil {
		t.Fatal(err)
	}

	if got, _ := s.Forfeited("g1", u.ID); got {
		t.Fatal("forfeited before any record")
	}
	if err := s.RecordForfeit("g1", u.ID); err != nil {
		t.Fatal(err)
	}
	// Idempotent: recording again is a no-op, not an error.
	if err := s.RecordForfeit("g1", u.ID); err != nil {
		t.Fatalf("second RecordForfeit: %v", err)
	}
	if got, _ := s.Forfeited("g1", u.ID); !got {
		t.Error("forfeited not reported after record")
	}
	// Scoped to the game.
	if got, _ := s.Forfeited("g2", u.ID); got {
		t.Error("forfeit leaked to another game")
	}
}
