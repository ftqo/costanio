package store

import (
	"encoding/json"
	"testing"
)

func TestActivityMapping(t *testing.T) {
	s := openTest(t)
	host, _ := s.CreateGuest("host")
	// activity_instances.game_id has an FK to games(id); seed two real games.
	for _, id := range []string{"game-a", "game-b"} {
		g := &Game{ID: id, Ruleset: "base", Config: json.RawMessage(`{}`), CreatedBy: host.ID}
		if err := s.CreateGame(g); err != nil {
			t.Fatal(err)
		}
	}

	// No mapping yet: empty string, no error.
	gid, err := s.ActivityGame("inst1")
	if err != nil {
		t.Fatal(err)
	}
	if gid != "" {
		t.Errorf("ActivityGame before map = %q, want empty", gid)
	}

	// First MapActivity creates the mapping and reports created.
	created, err := s.MapActivity("inst1", "game-a")
	if err != nil {
		t.Fatal(err)
	}
	if !created {
		t.Error("first MapActivity reported not-created")
	}

	got, err := s.ActivityGame("inst1")
	if err != nil {
		t.Fatal(err)
	}
	if got != "game-a" {
		t.Errorf("ActivityGame = %q, want game-a", got)
	}

	// A second MapActivity for the same instance loses the race: not created,
	// and the original mapping is preserved.
	created, err = s.MapActivity("inst1", "game-b")
	if err != nil {
		t.Fatal(err)
	}
	if created {
		t.Error("second MapActivity for same instance reported created")
	}
	got, _ = s.ActivityGame("inst1")
	if got != "game-a" {
		t.Errorf("mapping changed after lost race = %q, want game-a", got)
	}
}
