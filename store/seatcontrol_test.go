package store

import (
	"encoding/json"
	"testing"

	"github.com/ftqo/costan.io/engine"
)

func TestSeatControlLogKeepsEveryTransition(t *testing.T) {
	st := openTest(t)
	// Two transitions at the same log position: a player drops and comes back
	// between two moves. Both must be kept.
	for _, c := range []struct {
		seq     int
		seat    int
		control string
	}{
		{10, 0, "human"},
		{10, 1, "human"},
		{42, 1, "auto"},
		{42, 1, "bot_takeover"},
		{60, 1, "human"},
	} {
		if err := st.RecordSeatControl("g1", c.seq, c.seat, c.control); err != nil {
			t.Fatal(err)
		}
	}

	log, err := st.SeatControlLog("g1")
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"human", "human", "auto", "bot_takeover", "human"}
	if len(log) != len(want) {
		t.Fatalf("got %d rows, want %d: %+v", len(log), len(want), log)
	}
	for i, w := range want {
		if log[i].Control != w {
			t.Errorf("row %d control = %q, want %q", i, log[i].Control, w)
		}
	}
}

func TestSeatControlLogEmptyForOldGames(t *testing.T) {
	st := openTest(t)
	log, err := st.SeatControlLog("never-played")
	if err != nil {
		t.Fatal(err)
	}
	if len(log) != 0 {
		t.Fatalf("got %d rows for a game with no history", len(log))
	}
}

// TestEventSourceRoundTrips: the event source the actor stamps survives
// SQLite. An unstamped event (pre-0028) reads back as SourceUnrecorded.
func TestEventSourceRoundTrips(t *testing.T) {
	s := openTest(t)
	id := createTestGame(t, s)
	if err := s.AppendEvents(id, []engine.Event{
		{Seq: 0, Type: "game_created", Data: json.RawMessage(`{}`), Src: engine.SourceServer},
		{Seq: 1, Type: "cards_discarded", Data: json.RawMessage(`{}`), Src: engine.SourceTimeout},
		{Seq: 2, Type: "turn_ended", Data: json.RawMessage(`{}`), Src: engine.SourceHuman},
		{Seq: 3, Type: "turn_ended", Data: json.RawMessage(`{}`)}, // an old-style write
	}); err != nil {
		t.Fatal(err)
	}
	got, err := s.LoadEvents(id, 0)
	if err != nil {
		t.Fatal(err)
	}
	want := []engine.Source{
		engine.SourceServer, engine.SourceTimeout, engine.SourceHuman, engine.SourceUnrecorded,
	}
	if len(got) != len(want) {
		t.Fatalf("loaded %d events, want %d", len(got), len(want))
	}
	for i, w := range want {
		if got[i].Src != w {
			t.Errorf("seq %d: src = %s, want %s", got[i].Seq, got[i].Src, w)
		}
	}
	// And the same on the single-event read path.
	last, err := s.LastEventOfType(id, "cards_discarded")
	if err != nil {
		t.Fatal(err)
	}
	if last.Src != engine.SourceTimeout {
		t.Errorf("LastEventOfType dropped provenance: got %s", last.Src)
	}
}
