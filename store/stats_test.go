package store

import (
	"encoding/json"
	"testing"
)

func TestFinishGameOnceIdempotent(t *testing.T) {
	s := openTest(t)
	host, _ := s.CreateGuest("host")
	g := &Game{ID: "g1", Ruleset: "base", Config: json.RawMessage(`{}`), CreatedBy: host.ID}
	if err := s.CreateGame(g); err != nil {
		t.Fatal(err)
	}

	// First finish wins the transition.
	won, err := s.FinishGameOnce("g1", host.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !won {
		t.Fatal("first FinishGameOnce did not win the transition")
	}

	// Simulate the caller that won doing the finalization once.
	if won {
		if err := s.BumpStats(host.ID, "base", true, false, true, false); err != nil {
			t.Fatal(err)
		}
	}

	// Second finish must not win: game already finished.
	won2, err := s.FinishGameOnce("g1", host.ID)
	if err != nil {
		t.Fatal(err)
	}
	if won2 {
		t.Error("second FinishGameOnce won the transition; finish is not idempotent")
	}

	// Stats counted exactly once.
	var games, wins int
	s.db.QueryRow(`SELECT games, wins FROM stats WHERE user_id = ? AND ruleset = 'base'`, host.ID).Scan(&games, &wins)
	if games != 1 || wins != 1 {
		t.Errorf("stats = %d/%d, want 1/1 (double-counted)", games, wins)
	}

	// Game row reflects winner/status/finished_at.
	got, _ := s.GameByID("g1")
	if got.Status != "finished" || got.Winner == nil || *got.Winner != host.ID || got.FinishedAt == nil {
		t.Errorf("finished game = %+v", got)
	}
}
