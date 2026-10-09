package store

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/ftqo/costan.io/engine"
)

// TestIsUniqueViolation exercises the driver-error classifier directly. A real
// sqlite PRIMARY KEY collision must be recognized; an ordinary error must not.
func TestIsUniqueViolation(t *testing.T) {
	s := openTest(t)

	// Provoke a genuine UNIQUE/PRIMARY KEY violation: events has PK (game_id, seq).
	host, _ := s.CreateGuest("host")
	g := &Game{ID: "g1", Ruleset: "base", Config: json.RawMessage(`{}`), CreatedBy: host.ID}
	if err := s.CreateGame(g); err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(
		`INSERT INTO events (game_id, seq, type, data, ts) VALUES ('g1', 0, 't', '{}', 0)`); err != nil {
		t.Fatal(err)
	}
	_, dupErr := s.db.Exec(
		`INSERT INTO events (game_id, seq, type, data, ts) VALUES ('g1', 0, 't', '{}', 0)`)
	if dupErr == nil {
		t.Fatal("expected a PK violation on duplicate (game_id, seq)")
	}
	if !isUniqueViolation(dupErr) {
		t.Errorf("isUniqueViolation(pk dup) = false, want true (err=%v)", dupErr)
	}

	// A non-constraint error (e.g. a plain sentinel) must classify as false.
	if isUniqueViolation(errors.New("some other error")) {
		t.Error("isUniqueViolation(plain error) = true, want false")
	}
	// A FK violation is a constraint but not a uniqueness one.
	_, fkErr := s.db.Exec(
		`INSERT INTO events (game_id, seq, type, data, ts) VALUES ('no-such-game', 5, 't', '{}', 0)`)
	if fkErr == nil {
		t.Fatal("expected an FK violation for unknown game_id")
	}
	if isUniqueViolation(fkErr) {
		t.Errorf("isUniqueViolation(fk) = true, want false (err=%v)", fkErr)
	}
}

// TestAppendEventsEmptyIsNoOp covers the early return in AppendEvents.
func TestAppendEventsEmptyIsNoOp(t *testing.T) {
	s := openTest(t)
	id := createTestGame(t, s)
	if err := s.AppendEvents(id, nil); err != nil {
		t.Errorf("AppendEvents(nil) = %v, want nil no-op", err)
	}
	got, _ := s.LoadEvents(id, 0)
	if len(got) != 0 {
		t.Errorf("empty append wrote %d events", len(got))
	}
}

// TestAppendEventsVisibleRoundTrip covers the visible-marshal branch and the
// load-time unmarshal of the visible_to column.
func TestAppendEventsVisibleRoundTrip(t *testing.T) {
	s := openTest(t)
	id := createTestGame(t, s)
	in := []engine.Event{
		{Seq: 0, Type: "secret", Data: json.RawMessage(`{"x":1}`), Visible: []engine.PlayerID{1, 3, 5}},
	}
	if err := s.AppendEvents(id, in); err != nil {
		t.Fatal(err)
	}
	got, err := s.LoadEvents(id, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || len(got[0].Visible) != 3 || got[0].Visible[2] != 5 {
		t.Errorf("visible round-trip = %+v", got)
	}
}

// TestLoadEventsEmpty covers LoadEvents on a game with no events.
func TestLoadEventsEmpty(t *testing.T) {
	s := openTest(t)
	id := createTestGame(t, s)
	got, err := s.LoadEvents(id, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 {
		t.Errorf("LoadEvents(empty) = %+v", got)
	}
}
