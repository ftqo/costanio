package store

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/ftqo/costan.io/engine"
)

func createTestGame(t *testing.T, s *Store) string {
	t.Helper()
	u, _ := s.CreateGuest("host")
	g := &Game{ID: "g1", Ruleset: "base", Config: json.RawMessage(`{}`), CreatedBy: u.ID}
	if err := s.CreateGame(g); err != nil {
		t.Fatal(err)
	}
	return g.ID
}

func TestAppendLoadEvents(t *testing.T) {
	s := openTest(t)
	id := createTestGame(t, s)

	events := []engine.Event{
		{Seq: 0, Type: "game_created", Data: json.RawMessage(`{"a":1}`)},
		{Seq: 1, Type: "card_stolen", Data: json.RawMessage(`{"res":3}`), Visible: []engine.PlayerID{0, 2}},
	}
	if err := s.AppendEvents(id, events); err != nil {
		t.Fatal(err)
	}

	got, err := s.LoadEvents(id, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("loaded %d events", len(got))
	}
	if got[0].Seq != 0 || got[0].Type != "game_created" || string(got[0].Data) != `{"a":1}` || got[0].Visible != nil {
		t.Errorf("event 0 = %+v", got[0])
	}
	if len(got[1].Visible) != 2 || got[1].Visible[0] != 0 || got[1].Visible[1] != 2 {
		t.Errorf("event 1 visible = %v", got[1].Visible)
	}

	// since filter
	tail, _ := s.LoadEvents(id, 1)
	if len(tail) != 1 || tail[0].Seq != 1 {
		t.Errorf("tail = %+v", tail)
	}
}

func TestAppendSeqConflict(t *testing.T) {
	s := openTest(t)
	id := createTestGame(t, s)

	e := []engine.Event{{Seq: 0, Type: "x", Data: json.RawMessage(`{}`)}}
	if err := s.AppendEvents(id, e); err != nil {
		t.Fatal(err)
	}
	err := s.AppendEvents(id, e)
	if !errors.Is(err, ErrSeqConflict) {
		t.Errorf("duplicate seq err = %v, want ErrSeqConflict", err)
	}
	// Conflicting batch must be fully rolled back.
	batch := []engine.Event{
		{Seq: 1, Type: "y", Data: json.RawMessage(`{}`)},
		{Seq: 0, Type: "dup", Data: json.RawMessage(`{}`)},
	}
	if err := s.AppendEvents(id, batch); err == nil {
		t.Fatal("conflicting batch should fail")
	}
	got, _ := s.LoadEvents(id, 0)
	if len(got) != 1 {
		t.Errorf("partial batch persisted: %d events", len(got))
	}
}

// TestAppendSeqGap covers what the append path validates: contiguity within a
// batch (ErrSeqGap) and overlap with the existing log (ErrSeqConflict via the
// primary key). A batch starting ahead of the log is not checked; the actor
// assigns Seq contiguously.
func TestAppendSeqGap(t *testing.T) {
	s := openTest(t)
	id := createTestGame(t, s)

	// Internal contiguity within a batch is enforced up front (a hole at index 1).
	if err := s.AppendEvents(id, []engine.Event{
		{Seq: 0, Type: "c", Data: json.RawMessage(`{}`)},
		{Seq: 2, Type: "d", Data: json.RawMessage(`{}`)},
	}); !errors.Is(err, ErrSeqGap) {
		t.Errorf("internal gap err = %v, want ErrSeqGap", err)
	}
	// The rejected batch must not have persisted anything.
	if got, _ := s.LoadEvents(id, 0); len(got) != 0 {
		t.Errorf("internal-gap batch persisted: %d events, want 0", len(got))
	}

	// Seed {0,1}.
	if err := s.AppendEvents(id, []engine.Event{
		{Seq: 0, Type: "a", Data: json.RawMessage(`{}`)},
		{Seq: 1, Type: "b", Data: json.RawMessage(`{}`)},
	}); err != nil {
		t.Fatal(err)
	}

	// Happy path: contiguous batch {2,3} appended after {0,1}.
	if err := s.AppendEvents(id, []engine.Event{
		{Seq: 2, Type: "c", Data: json.RawMessage(`{}`)},
		{Seq: 3, Type: "d", Data: json.RawMessage(`{}`)},
	}); err != nil {
		t.Fatalf("contiguous append failed: %v", err)
	}
	got, _ := s.LoadEvents(id, 0)
	if len(got) != 4 {
		t.Errorf("after contiguous append: %d events, want 4", len(got))
	}

	// A batch that overlaps the existing log (seq 3 already written) is rejected
	// by the PRIMARY KEY as a conflict, and rolls the whole batch back.
	if err := s.AppendEvents(id, []engine.Event{
		{Seq: 3, Type: "x", Data: json.RawMessage(`{}`)},
		{Seq: 4, Type: "y", Data: json.RawMessage(`{}`)},
	}); !errors.Is(err, ErrSeqConflict) {
		t.Errorf("overlapping batch err = %v, want ErrSeqConflict", err)
	}
	if got, _ := s.LoadEvents(id, 0); len(got) != 4 {
		t.Errorf("after rejected overlap: %d events, want 4", len(got))
	}
}

// TestAppendLargeBatchChunks appends a batch larger than maxInsertRows so the
// multi-row INSERT is split across multiple statements (chunking under SQLite's
// 999-variable limit). Every event must persist exactly once and in order.
func TestAppendLargeBatchChunks(t *testing.T) {
	s := openTest(t)
	id := createTestGame(t, s)

	const n = maxInsertRows*2 + 7 // spans three chunks
	events := make([]engine.Event, n)
	for i := range events {
		events[i] = engine.Event{Seq: i, Type: "e", Data: json.RawMessage(`{"i":` + itoa(int64(i)) + `}`)}
	}
	if err := s.AppendEvents(id, events); err != nil {
		t.Fatalf("large append failed: %v", err)
	}
	got, err := s.LoadEvents(id, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != n {
		t.Fatalf("loaded %d events, want %d", len(got), n)
	}
	for i, e := range got {
		if e.Seq != i {
			t.Fatalf("event %d has seq %d", i, e.Seq)
		}
	}
}

func TestSnapshots(t *testing.T) {
	s := openTest(t)
	id := createTestGame(t, s)

	if _, _, err := s.LoadLatestSnapshot(id); !errors.Is(err, ErrNotFound) {
		t.Errorf("empty snapshot err = %v", err)
	}
	if err := s.SaveSnapshot(id, 10, []byte("ten")); err != nil {
		t.Fatal(err)
	}
	if err := s.SaveSnapshot(id, 50, []byte("fifty")); err != nil {
		t.Fatal(err)
	}
	seq, blob, err := s.LoadLatestSnapshot(id)
	if err != nil || seq != 50 || string(blob) != "fifty" {
		t.Errorf("snapshot = %d %q %v", seq, blob, err)
	}
	// Older snapshot pruned.
	var count int
	s.db.QueryRow(`SELECT COUNT(*) FROM snapshots WHERE game_id = ?`, id).Scan(&count)
	if count != 1 {
		t.Errorf("snapshots kept = %d, want 1", count)
	}

	// A lower-seq snapshot must fully replace the higher one (single row).
	if err := s.SaveSnapshot(id, 20, []byte("twenty")); err != nil {
		t.Fatal(err)
	}
	seq, blob, err = s.LoadLatestSnapshot(id)
	if err != nil || seq != 20 || string(blob) != "twenty" {
		t.Errorf("after lower-seq save = %d %q %v, want 20 \"twenty\"", seq, blob, err)
	}
	s.db.QueryRow(`SELECT COUNT(*) FROM snapshots WHERE game_id = ?`, id).Scan(&count)
	if count != 1 {
		t.Errorf("snapshots after lower-seq save = %d, want 1", count)
	}
}

func TestGamesAndSeats(t *testing.T) {
	s := openTest(t)
	host, _ := s.CreateGuest("host")
	// `Public` is the listing flag; an invite code implies nothing about it.
	pub := &Game{ID: "pub", Ruleset: "base", Config: json.RawMessage(`{"players":3}`), Public: true, CreatedBy: host.ID}
	priv := &Game{ID: "priv", Ruleset: "base", Config: json.RawMessage(`{"players":4}`), InviteCode: "abc12345", CreatedBy: host.ID}
	for _, g := range []*Game{pub, priv} {
		if err := s.CreateGame(g); err != nil {
			t.Fatal(err)
		}
	}

	listed, _ := s.ListGames("lobby", false)
	if len(listed) != 1 || listed[0].ID != "pub" {
		t.Errorf("public list = %+v", listed)
	}
	byInvite, err := s.GameByInvite("abc12345")
	if err != nil || byInvite.ID != "priv" {
		t.Errorf("by invite = %+v %v", byInvite, err)
	}

	if err := s.AddSeat("pub", 0, host.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.AddSeat("pub", 0, host.ID); err == nil {
		t.Error("duplicate seat number should fail")
	}
	seats, _ := s.Seats("pub")
	if len(seats) != 1 || seats[0].UserName != "host" || seats[0].Status != "active" {
		t.Errorf("seats = %+v", seats[0])
	}

	gameID, _ := s.ActiveGameForUser(host.ID)
	if gameID != "pub" {
		t.Errorf("active game = %q", gameID)
	}

	if err := s.FinishGame("pub", host.ID); err != nil {
		t.Fatal(err)
	}
	g, _ := s.GameByID("pub")
	if g.Status != "finished" || g.Winner == nil || *g.Winner != host.ID {
		t.Errorf("finished game = %+v", g)
	}
	gameID, _ = s.ActiveGameForUser(host.ID)
	if gameID != "" {
		t.Errorf("active game after finish = %q", gameID)
	}
}

// LastEventOfType answers what folding from a snapshot cannot, such as who
// last moved the robber.
func TestLastEventOfType(t *testing.T) {
	s := openTest(t)
	id := createTestGame(t, s)

	events := []engine.Event{
		{Seq: 0, Type: engine.EvGameCreated, Data: json.RawMessage(`{}`)},
		{Seq: 1, Type: engine.EvRobberMoved, Data: json.RawMessage(`{"player":1}`)},
		{Seq: 2, Type: engine.EvTurnEnded, Data: json.RawMessage(`{}`)},
		{Seq: 3, Type: engine.EvRobberMoved, Data: json.RawMessage(`{"player":2}`)},
		{Seq: 4, Type: engine.EvTurnEnded, Data: json.RawMessage(`{}`)},
	}
	if err := s.AppendEvents(id, events); err != nil {
		t.Fatalf("AppendEvents: %v", err)
	}

	got, err := s.LastEventOfType(id, string(engine.EvRobberMoved))
	if err != nil {
		t.Fatalf("LastEventOfType: %v", err)
	}
	if got.Seq != 3 {
		t.Errorf("seq = %d, want 3 (the newest of that type)", got.Seq)
	}
	if string(got.Data) != `{"player":2}` {
		t.Errorf("data = %s, want the seq-3 payload", got.Data)
	}

	// A type the game never emitted is ErrNotFound, not an empty event.
	if _, err := s.LastEventOfType(id, string(engine.EvCardStolen)); !errors.Is(err, ErrNotFound) {
		t.Errorf("absent type = %v, want ErrNotFound", err)
	}
	// So is any type in a game that does not exist.
	if _, err := s.LastEventOfType("no-such-game", string(engine.EvRobberMoved)); !errors.Is(err, ErrNotFound) {
		t.Errorf("absent game = %v, want ErrNotFound", err)
	}
}

// TestMaxEventSeq covers the replay cache validator's input. A game with no
// events reports -1, distinct from one event at seq 0.
func TestMaxEventSeq(t *testing.T) {
	s := openTest(t)
	id := createTestGame(t, s)

	if got, err := s.MaxEventSeq(id); err != nil || got != -1 {
		t.Fatalf("MaxEventSeq(empty) = %d, %v; want -1, nil", got, err)
	}

	if err := s.AppendEvents(id, []engine.Event{
		{Seq: 0, Type: "game_created", Data: json.RawMessage(`{}`)},
	}); err != nil {
		t.Fatal(err)
	}
	if got, err := s.MaxEventSeq(id); err != nil || got != 0 {
		t.Fatalf("MaxEventSeq(one event) = %d, %v; want 0, nil", got, err)
	}

	if err := s.AppendEvents(id, []engine.Event{
		{Seq: 1, Type: "dice_rolled", Data: json.RawMessage(`{}`)},
		{Seq: 2, Type: "turn_ended", Data: json.RawMessage(`{}`)},
	}); err != nil {
		t.Fatal(err)
	}
	if got, err := s.MaxEventSeq(id); err != nil || got != 2 {
		t.Fatalf("MaxEventSeq after append = %d, %v; want 2, nil", got, err)
	}

	// Scoped to the game: another game's longer log must not bleed in.
	// createTestGame hardcodes one id, so the second game is built by hand.
	u, _ := s.CreateGuest("host2")
	const other = "g2"
	if err := s.CreateGame(&Game{ID: other, Ruleset: "base", Config: json.RawMessage(`{}`), CreatedBy: u.ID}); err != nil {
		t.Fatal(err)
	}
	if err := s.AppendEvents(other, []engine.Event{
		{Seq: 0, Type: "game_created", Data: json.RawMessage(`{}`)},
		{Seq: 1, Type: "dice_rolled", Data: json.RawMessage(`{}`)},
		{Seq: 2, Type: "dice_rolled", Data: json.RawMessage(`{}`)},
		{Seq: 3, Type: "dice_rolled", Data: json.RawMessage(`{}`)},
	}); err != nil {
		t.Fatal(err)
	}
	if got, _ := s.MaxEventSeq(id); got != 2 {
		t.Errorf("MaxEventSeq leaked another game's log: %d, want 2", got)
	}
}
