package game

import (
	"bytes"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/store"
)

// pauseActor freezes a loaded game the way an engine invariant violation does,
// on the loop, so the store row moves to "paused-error" exactly as it would in
// production.
func pauseActor(t *testing.T, a *Actor) {
	t.Helper()
	if !a.call(func() { a.pause("test-induced invariant violation") }) {
		t.Fatal("actor already stopped")
	}
}

// syncBuffer is an io.Writer safe to read from the test goroutine while the
// actor loop logs into it (for -race).
type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

// captureLogs redirects the default slog logger for one test.
func captureLogs(t *testing.T) *syncBuffer {
	t.Helper()
	prev := slog.Default()
	buf := &syncBuffer{}
	slog.SetDefault(slog.New(slog.NewTextHandler(buf, nil)))
	t.Cleanup(func() { slog.SetDefault(prev) })
	return buf
}

// TestRebuildFoldFailurePauses: a rebuild whose fold fails must pause
// the game visibly, not return an error that callers drop while the row stays
// "active" and the client sees an empty game.
func TestRebuildFoldFailurePauses(t *testing.T) {
	st := openStore(t)
	cfg := engine.GameConfig{Players: 2}
	seedGame(t, st, "g1", 2, cfg)

	// A hole in the log. AppendEvents only checks contiguity within a batch,
	// so the store accepts it and the fold fails.
	s := mirrorState(t, st, "g1")
	gap := engine.Event{Seq: s.NextSeq + 5, Type: engine.EvTurnEnded, Data: []byte(`{}`)}
	if err := st.AppendEvents("g1", []engine.Event{gap}); err != nil {
		t.Fatalf("append gap event: %v", err)
	}

	m := NewManager(st, &fakeClock{})
	defer m.StopAll()
	if _, err := m.Get("g1"); !errors.Is(err, ErrRebuildFailed) {
		t.Fatalf("Get err = %v, want ErrRebuildFailed", err)
	}
	g, err := st.GameByID("g1")
	if err != nil {
		t.Fatal(err)
	}
	if g.Status != statusPausedError {
		t.Errorf("status = %q, want %q", g.Status, statusPausedError)
	}
}

// TestRebuildStoreFailureDoesNotPause: only a fold failure means the
// game is broken. A failed read is transient and must leave the row alone.
func TestRebuildStoreFailureDoesNotPause(t *testing.T) {
	st := openStore(t)
	// No events at all: rebuild fails on "no events", which is not a fold
	// failure and must not touch the row.
	host, err := st.CreateGuest("host")
	if err != nil {
		t.Fatal(err)
	}
	g2 := &store.Game{ID: "g2", Ruleset: "base", Config: json.RawMessage(`{"players":2}`), CreatedBy: host.ID}
	if err := st.CreateGame(g2); err != nil {
		t.Fatal(err)
	}
	if err := st.SetGameStatus("g2", statusActive); err != nil {
		t.Fatal(err)
	}
	m := NewManager(st, &fakeClock{})
	defer m.StopAll()
	if _, err := m.Get("g2"); err == nil {
		t.Fatal("Get on an eventless game should fail")
	}
	g, err := st.GameByID("g2")
	if err != nil {
		t.Fatal(err)
	}
	if g.Status == statusPausedError {
		t.Error("eventless game was marked paused-error")
	}
}

// TestLoadFinalizesUnrecordedFinish: the winning event
// reached the log but FinishGameOnce did not run. On reload the row is still
// "active", commands return ErrGameFinished, the actor is not evictable, and
// recoverFinalization only sees 'finished' rows, so Load must finalize it.
func TestLoadFinalizesUnrecordedFinish(t *testing.T) {
	st := openStore(t)
	cfg := engine.GameConfig{Players: 2}
	seedGame(t, st, "g1", 2, cfg)

	s := mirrorState(t, st, "g1")
	fin, err := engine.ForceFinish(s)
	if err != nil {
		t.Fatal(err)
	}
	engine.StampSource(fin, engine.SourceServer)
	if err := st.AppendEvents("g1", fin); err != nil {
		t.Fatal(err)
	}
	// The row is left "active" on purpose: that is the case under test.
	if g, err := st.GameByID("g1"); err != nil || g.Status != statusActive {
		t.Fatalf("precondition: status = %v (err %v), want active", g, err)
	}

	m := NewManager(st, &fakeClock{})
	defer m.StopAll()
	if _, err := m.Get("g1"); err != nil {
		t.Fatalf("Get: %v", err)
	}

	g, err := st.GameByID("g1")
	if err != nil {
		t.Fatal(err)
	}
	if g.Status != "finished" {
		t.Errorf("status = %q, want finished", g.Status)
	}
	unfinalized, err := st.FinishedGamesWithoutMatchHistory()
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range unfinalized {
		if id == "g1" {
			t.Error("no match-history row was written")
		}
	}
}

// TestPausedActorIsEvictable: nothing unpauses a game and scheduleReap only
// runs from finish, so a paused actor must be evictable or it is pinned for
// the life of the process.
func TestPausedActorIsEvictable(t *testing.T) {
	st := openStore(t)
	clock := &fakeClock{}
	seedGame(t, st, "g1", 2, engine.GameConfig{Players: 2})
	m := NewManager(st, clock)
	defer m.StopAll()
	a, err := m.Get("g1")
	if err != nil {
		t.Fatal(err)
	}
	pauseActor(t, a)
	if !a.Evictable(clock.Now().Add(time.Hour), time.Minute) {
		t.Error("paused, unwatched, idle actor is not evictable")
	}
}

// TestForceFinishPausedFinalizes: recovery gives the seats a result:
// ratings, Pips, match history and a post-game screen.
func TestForceFinishPausedFinalizes(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 2, engine.GameConfig{Players: 2})
	m := NewManager(st, &fakeClock{})
	defer m.StopAll()
	a, err := m.Get("g1")
	if err != nil {
		t.Fatal(err)
	}
	pauseActor(t, a)

	if err := m.ForceFinishPaused("g1"); err != nil {
		t.Fatalf("ForceFinishPaused: %v", err)
	}
	g, err := st.GameByID("g1")
	if err != nil {
		t.Fatal(err)
	}
	if g.Status != "finished" {
		t.Fatalf("status = %q, want finished", g.Status)
	}
	if m.running("g1") {
		t.Error("the paused actor was left loaded")
	}
	unfinalized, err := st.FinishedGamesWithoutMatchHistory()
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range unfinalized {
		if id == "g1" {
			t.Error("force-finish did not run the normal finalize path")
		}
	}
	// The log must still show the server ended the game, not a win.
	events, err := st.LoadEvents("g1", 0)
	if err != nil {
		t.Fatal(err)
	}
	last := events[len(events)-1]
	if last.Type != engine.EvGameFinished {
		t.Fatalf("last event = %s, want %s", last.Type, engine.EvGameFinished)
	}
	if last.Src != engine.SourceServer {
		t.Errorf("finish provenance = %v, want SourceServer", last.Src)
	}
}

// TestAbandonPausedReleasesTable: no result and no rating movement, but the
// table is closed and the seats are free.
func TestAbandonPausedReleasesTable(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 2, engine.GameConfig{Players: 2})
	m := NewManager(st, &fakeClock{})
	defer m.StopAll()
	a, err := m.Get("g1")
	if err != nil {
		t.Fatal(err)
	}
	pauseActor(t, a)

	if err := m.AbandonPaused("g1"); err != nil {
		t.Fatalf("AbandonPaused: %v", err)
	}
	g, err := st.GameByID("g1")
	if err != nil {
		t.Fatal(err)
	}
	if g.Status != statusAbandoned {
		t.Errorf("status = %q, want %q", g.Status, statusAbandoned)
	}
	if m.running("g1") {
		t.Error("the abandoned game's actor was left loaded")
	}
}

// TestRecoveryRejectsUnpausedGame: both recoveries check the game is
// paused rather than trusting the id.
func TestRecoveryRejectsUnpausedGame(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 2, engine.GameConfig{Players: 2})
	m := NewManager(st, &fakeClock{})
	defer m.StopAll()
	if err := m.ForceFinishPaused("g1"); !errors.Is(err, ErrGameNotPaused) {
		t.Errorf("ForceFinishPaused on an active game = %v, want ErrGameNotPaused", err)
	}
	if err := m.AbandonPaused("g1"); !errors.Is(err, ErrGameNotPaused) {
		t.Errorf("AbandonPaused on an active game = %v, want ErrGameNotPaused", err)
	}
}

// TestPausedGamesAreListable: the recovery tools need to find paused games.
func TestPausedGamesAreListable(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 2, engine.GameConfig{Players: 2})
	m := NewManager(st, &fakeClock{})
	defer m.StopAll()
	a, err := m.Get("g1")
	if err != nil {
		t.Fatal(err)
	}
	pauseActor(t, a)
	ids, err := m.PausedGames()
	if err != nil {
		t.Fatal(err)
	}
	if len(ids) != 1 || ids[0] != "g1" {
		t.Errorf("PausedGames() = %v, want [g1]", ids)
	}
}

// TestDroppedCommitIsLogged: a commit that fails to persist must be logged, or
// the table freezes with nothing server-side saying why.
func TestDroppedCommitIsLogged(t *testing.T) {
	st := openStore(t)
	clock := &fakeClock{}
	seedGame(t, st, "g1", 2, engine.GameConfig{Players: 2, TurnTimerSec: 30})
	m := NewManager(st, clock)
	defer m.StopAll()
	a, err := m.Get("g1")
	if err != nil {
		t.Fatal(err)
	}
	// Take the seq the actor's next write wants. The (game_id, seq) primary
	// key turns its append into ErrSeqConflict, standing in for any store
	// failure (SQLITE_BUSY, a full disk).
	next := actorState(a).NextSeq
	blocker := engine.Event{Seq: next, Type: engine.EvTurnEnded, Data: []byte(`{}`)}
	if err := st.AppendEvents("g1", []engine.Event{blocker}); err != nil {
		t.Fatalf("append blocker: %v", err)
	}

	logs := captureLogs(t)
	clock.Fire() // the turn timer: autoTimeoutDecision -> commit -> store failure
	// Fire returns once the loop has accepted the timer's closure, not once it
	// has run, so sync on the loop before reading the log.
	actorState(a)

	out := logs.String()
	if !strings.Contains(out, "commit failed") || !strings.Contains(out, "auto-timeout decision") {
		t.Errorf("dropped commit was not logged; logs:\n%s", out)
	}
}

// TestStaleTurnTimerSkipsRefreshedSeat: a timer callback that
// fired while the loop was handling the seat's own command (which re-armed a
// fresh budget) must not auto-play the seat.
func TestStaleTurnTimerSkipsRefreshedSeat(t *testing.T) {
	st := openStore(t)
	clock := &fakeClock{}
	seedGame(t, st, "g1", 2, engine.GameConfig{Players: 2, TurnTimerSec: 30})
	m := NewManager(st, clock)
	defer m.StopAll()
	a, err := m.Get("g1")
	if err != nil {
		t.Fatal(err)
	}
	// Sync on the loop first: Load returns before the loop's opening armTimer
	// has necessarily run.
	s := actorState(a)
	// With no bot factory nothing schedules a tick, so that opening armTimer is
	// the only timer the clock holds: it is the one whose firing goes stale.
	stale := clock.timerFuncs()
	if len(stale) != 1 {
		t.Fatalf("expected exactly the turn timer to be armed, got %d timers", len(stale))
	}

	// The player acts, in time. commit -> armTimer -> a fresh budget.
	cmd, ok := engine.AutoCommand(s)
	if !ok {
		t.Fatal("no legal opening command")
	}
	if err := a.Do(cmd); err != nil {
		t.Fatalf("Do(%s): %v", cmd.Type, err)
	}
	before := actorState(a).NextSeq

	// The already-fired timer lands now. Calling the callback directly makes it
	// stale: Fire() would skip it because re-arming stopped it.
	stale[0]()
	if after := actorState(a).NextSeq; after != before {
		t.Errorf("stale timer played %d event(s) for a seat that had just acted", after-before)
	}

	// And the guard must not have disabled timeouts: the live timer still fires.
	clock.Fire()
	if after := actorState(a).NextSeq; after == before {
		t.Error("current turn timer did not auto-play")
	}
}

// timerFuncs snapshots the callbacks the fake clock holds, armed or not.
// Fire() runs only the armed ones.
func (c *fakeClock) timerFuncs() []func() {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([]func(), len(c.timers))
	for i, t := range c.timers {
		out[i] = t.f
	}
	return out
}
