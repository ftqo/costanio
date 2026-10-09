package game

import (
	"encoding/json"
	"sync"
	"testing"
	"time"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// TestEncodeFramePublicSharedBytes: a public event (Visible == nil) is encoded
// once and every viewer reads the same shared []byte.
func TestEncodeFramePublicSharedBytes(t *testing.T) {
	e := engine.Event{Seq: 42, Type: engine.EvTurnEnded, Data: json.RawMessage(`{"by":1}`)}
	f := encodeFrame("g1", e)
	if f.visible != nil {
		t.Fatalf("public event should have nil visible, got %v", f.visible)
	}
	if f.redacted != nil {
		t.Errorf("public event must not allocate a redacted variant")
	}

	// Every viewer resolves to the same backing array.
	var first []byte
	for _, v := range []engine.PlayerID{Spectator, 0, 1, 2, 3, 4} {
		raw := f.bytesFor(v)
		if first == nil {
			first = raw
			continue
		}
		if &raw[0] != &first[0] {
			t.Errorf("viewer %d got a different backing array", v)
		}
	}

	// And the bytes match the canonical single-event encoding.
	want := encodeEvFrame("g1", e)
	if string(first) != string(want) {
		t.Errorf("public frame bytes = %s, want %s", first, want)
	}
}

// TestEncodeFrameHiddenRedaction: a hidden event yields at most two byte
// variants (full for the Visible seats, redacted for everyone else), and a
// non-owner never reads the hidden payload.
func TestEncodeFrameHiddenRedaction(t *testing.T) {
	// A steal: thief=0, victim=1 may see the resource; everyone else must not.
	data, _ := json.Marshal(engine.CardStolenData{Thief: 0, Victim: 1, Res: board.Ore})
	e := engine.Event{
		Seq:     7,
		Type:    engine.EvCardStolen,
		Data:    data,
		Visible: []engine.PlayerID{0, 1},
	}
	f := encodeFrame("g1", e)
	if f.redacted == nil {
		t.Fatal("hidden event must encode a redacted variant")
	}

	ownerBytes := f.bytesFor(0)
	if string(f.bytesFor(0)) != string(f.bytesFor(1)) {
		t.Error("both Visible seats should read identical full bytes")
	}

	// The owners' bytes carry the hidden resource; non-owners' bytes must not.
	if !containsRes(t, ownerBytes) {
		t.Fatal("owner frame should include the stolen resource")
	}
	for _, v := range []engine.PlayerID{Spectator, 2, 3, 4, 5} {
		raw := f.bytesFor(v)
		// Non-owners share one redacted encoding.
		if &raw[0] != &f.redacted[0] {
			t.Errorf("non-owner %d did not get the shared redacted bytes", v)
		}
		if containsRes(t, raw) {
			t.Errorf("REDACTION LEAK: non-owner %d received the hidden resource: %s", v, raw)
		}
		// The bytes a non-owner gets must equal RedactEvent(e, v) in a wire
		// frame.
		want := encodeEvFrame("g1", RedactEvent(e, v))
		if string(raw) != string(want) {
			t.Errorf("non-owner %d frame diverged from RedactEvent:\n got:  %s\n want: %s", v, raw, want)
		}
	}
}

// containsRes reports whether the encoded frame's embedded event payload still
// carries the hidden stolen resource (the "res" key, which the redactor drops).
func containsRes(t *testing.T, raw []byte) bool {
	t.Helper()
	var f EvFrame
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatalf("decode frame: %v", err)
	}
	var d map[string]any
	json.Unmarshal(f.Ev.Data, &d)
	_, ok := d["res"]
	return ok
}

// BenchmarkFanOutSharedVsPerConn compares the shared single-encode fan-out
// with a per-connection marshal for a public event watched by N viewers.
// Run: go test ./game -bench FanOut -benchmem
func BenchmarkFanOutSharedVsPerConn(b *testing.B) {
	const viewers = 50
	e := engine.Event{Seq: 99, Type: engine.EvTurnEnded, Data: json.RawMessage(`{"by":2}`)}

	b.Run("shared_single_encode", func(b *testing.B) {
		b.ReportAllocs()
		for range b.N {
			f := encodeFrame("g1", e) // one marshal
			for v := range viewers {
				_ = f.bytesFor(engine.PlayerID(v)) // shared []byte, no marshal
			}
		}
	})

	b.Run("per_conn_marshal", func(b *testing.B) {
		b.ReportAllocs()
		for range b.N {
			for v := range viewers {
				// Per-connection: marshal a fresh frame per viewer.
				_, _ = json.Marshal(map[string]any{"t": "ev", "game": "g1", "seq": e.Seq, "ev": RedactEvent(e, engine.PlayerID(v))})
			}
		}
	})
}

// TestFrameRingFanOutSingleEncode: the ring fans one pushed frame out to many
// concurrent readers as the same bytes, and a reader past the retained window
// is told to resync.
func TestFrameRingFanOutSingleEncode(t *testing.T) {
	r := newFrameRing(4)
	const readers = 16

	// Register all readers at cursor 0 before any push.
	rds := make([]*ringReader, readers)
	for i := range rds {
		rds[i] = r.reader(Spectator, 0)
	}

	e := engine.Event{Seq: 0, Type: engine.EvTurnEnded, Data: json.RawMessage(`{}`)}
	shared := encodeFrame("g1", e)
	r.push(shared)

	var wg sync.WaitGroup
	got := make([][]byte, readers)
	for i := range rds {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			raw, seq, behind, ok := rds[i].next()
			if !ok || behind || seq != 0 {
				t.Errorf("reader %d: ok=%v behind=%v seq=%d", i, ok, behind, seq)
				return
			}
			got[i] = raw
		}(i)
	}
	wg.Wait()

	// Every reader saw the same backing array.
	for i := 1; i < readers; i++ {
		if got[i] == nil || got[0] == nil {
			continue
		}
		if &got[i][0] != &got[0][0] {
			t.Errorf("reader %d got a re-encoded frame instead of the shared bytes", i)
		}
	}

	// Overflow the window so seq 0 is evicted; a new reader at seq 0 must be
	// told it is behind.
	for s := 1; s <= 5; s++ {
		r.push(encodeFrame("g1", engine.Event{Seq: s, Type: engine.EvTurnEnded, Data: json.RawMessage(`{}`)}))
	}
	slow := r.reader(Spectator, 0)
	if _, _, behind, ok := slow.next(); !behind || ok {
		t.Errorf("evicted slow reader: behind=%v ok=%v, want behind=true ok=false", behind, ok)
	}
}

// TestFrameRingKeepsShortTail: the ring is a delivery buffer, not a history (the
// log is in SQLite and clients keep what they received). A subscriber that
// keeps up misses nothing however far the game runs past the cap, and one that
// stops reading is told to resync rather than served stale frames.
func TestFrameRingKeepsShortTail(t *testing.T) {
	if frameRingCap > 128 {
		t.Errorf("frameRingCap = %d, want a small delivery buffer", frameRingCap)
	}

	r := newFrameRing(frameRingCap)
	live := r.reader(Spectator, 0)
	parked := r.reader(Spectator, 0)

	// Run several ring-lengths of events past the window, reading as they land.
	total := frameRingCap * 3
	for s := range total {
		r.push(encodeFrame("g1", engine.Event{Seq: s, Type: engine.EvTurnEnded, Data: json.RawMessage(`{}`)}))
		_, seq, behind, ok := live.next()
		if !ok || behind {
			t.Fatalf("keeping-up reader stalled at seq %d: behind=%v ok=%v", s, behind, ok)
		}
		if seq != s {
			t.Fatalf("keeping-up reader got seq %d, want %d", seq, s)
		}
	}

	// The window is bounded.
	r.mu.Lock()
	held, first := len(r.buf), r.first
	r.mu.Unlock()
	if held > frameRingCap {
		t.Errorf("ring holds %d frames, cap is %d", held, frameRingCap)
	}
	if first == 0 {
		t.Errorf("ring still holds seq 0 after %d events", total)
	}

	// The reader that never read is resynced.
	if _, _, behind, ok := parked.next(); !behind || ok {
		t.Errorf("parked reader: behind=%v ok=%v, want behind=true ok=false", behind, ok)
	}
}

// TestFullLogSurvivesShortRing: after a game has run far past the ring's
// window, a client can still get the whole redacted log from seq 0, because
// EventsSince reads the store, not the ring.
func TestFullLogSurvivesShortRing(t *testing.T) {
	st := openStore(t)
	seedGame(t, st, "g1", 3, engine.GameConfig{Players: 3})
	for i := range 3 {
		if err := st.SetSeatStatus("g1", i, "bot"); err != nil {
			t.Fatal(err)
		}
	}
	m := NewManager(st, &fakeClock{})
	m.SetBotFactory(func(engine.PlayerID) CommandSource { return autoBot{} })
	// Bound the run: minimal-move bots may never win, so use the production
	// force-finish cap.
	m.SetEventCap(frameRingCap * 3)
	defer m.StopAll()

	a, err := m.Get("g1")
	if err != nil {
		t.Fatal(err)
	}

	// The bots play unpaced, so the log runs well past the ring's window.
	deadline := time.Now().Add(10 * time.Second)
	for actorState(a).NextSeq <= frameRingCap*2 {
		if time.Now().After(deadline) {
			t.Fatalf("game only reached seq %d, want more than %d", actorState(a).NextSeq, frameRingCap*2)
		}
	}
	live := actorState(a).NextSeq

	// In memory the server holds only a short tail.
	a.ring.mu.Lock()
	held, first := len(a.ring.buf), a.ring.first
	a.ring.mu.Unlock()
	if held > frameRingCap {
		t.Errorf("ring holds %d frames at seq %d, cap is %d", held, live, frameRingCap)
	}
	if first == 0 {
		t.Fatalf("ring never rolled over at seq %d", live)
	}

	// On disk, and so to a client, the whole game is there.
	log, err := a.EventsSince(Spectator, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(log) < first {
		t.Fatalf("store returned %d events, want at least %d", len(log), first)
	}
	for i, e := range log {
		if e.Seq != i {
			t.Fatalf("log not contiguous from 0: log[%d].Seq = %d", i, e.Seq)
		}
	}

	// A client holding a prefix gets exactly the rest (reconnect gap-fill).
	tail, err := a.EventsSince(Spectator, first)
	if err != nil {
		t.Fatal(err)
	}
	if len(tail) == 0 || tail[0].Seq != first {
		t.Fatalf("EventsSince(%d) started at %v, want %d", first, tail, first)
	}
}

// TestFrameRingCanResume pins the window check SubscribeFrom trusts: a resume
// point is honoured only while every frame from it up to the view is still
// retained, and anything else falls back to the view's own seq.
func TestFrameRingCanResume(t *testing.T) {
	r := newFrameRing(4)
	if !r.canResume(0, 0) {
		t.Error("nothing owed is always resumable")
	}
	if r.canResume(0, 1) {
		t.Error("an empty ring cannot serve an owed frame")
	}
	for s := range 6 { // retains 2..5
		r.push(frame{seq: s})
	}
	cases := []struct {
		from, upto int
		want       bool
	}{
		{2, 6, true},
		{5, 6, true},
		{6, 6, true},
		{1, 6, false},  // evicted
		{-1, 6, false}, // no predecessor
		{7, 6, false},  // ahead of the actor
		{3, 7, false},  // view past the window
	}
	for _, c := range cases {
		if got := r.canResume(c.from, c.upto); got != c.want {
			t.Errorf("canResume(%d, %d) = %v, want %v", c.from, c.upto, got, c.want)
		}
	}
	rd := r.reader(Spectator, 3)
	if _, seq, _, ok := rd.next(); !ok || seq != 3 || rd.position() != 4 {
		t.Errorf("after one read: seq %d ok %v position %d, want 3 true 4", seq, ok, rd.position())
	}
}
