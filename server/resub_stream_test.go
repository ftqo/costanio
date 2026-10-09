package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/game"
)

// streamFrame is one game frame as the client saw it, in arrival order.
type streamFrame struct {
	t   string // "ev" or "state"
	seq int
}

// resubRecorder is a client that behaves like the stock one under a burst: it
// re-subscribes the moment an event lands (the stock client does the same after
// an 80ms debounce, to pick up the phase flags only a snapshot carries). It
// records every ev and state frame in arrival order.
type resubRecorder struct {
	conn *websocket.Conn
	game string

	mu      sync.Mutex
	frames  []streamFrame
	resyncs int
	resubs  int
}

func dialRecorder(t *testing.T, e *testEnv, cookie *http.Cookie, game string) *resubRecorder {
	t.Helper()
	url := "ws" + strings.TrimPrefix(e.ts.URL, "http") + "/ws"
	hdr := http.Header{"Cookie": {cookie.Name + "=" + cookie.Value}}
	conn, _, err := websocket.Dial(context.Background(), url, &websocket.DialOptions{HTTPHeader: hdr})
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	conn.SetReadLimit(-1)
	t.Cleanup(func() { _ = conn.CloseNow() })
	r := &resubRecorder{conn: conn, game: game}
	go r.loop()
	r.sub()
	return r
}

func (r *resubRecorder) sub() {
	r.mu.Lock()
	r.resubs++
	r.mu.Unlock()
	_ = wsjson.Write(context.Background(), r.conn, map[string]any{"t": "sub", "game": r.game})
}

func (r *resubRecorder) loop() {
	for {
		_, raw, err := r.conn.Read(context.Background())
		if err != nil {
			return
		}
		var f struct {
			T   string `json:"t"`
			Seq int    `json:"seq"`
		}
		if json.Unmarshal(raw, &f) != nil {
			continue
		}
		switch f.T {
		case "ev", "state":
			r.mu.Lock()
			r.frames = append(r.frames, streamFrame{f.T, f.Seq})
			r.mu.Unlock()
			if f.T == "ev" {
				r.sub()
			}
		case "resync":
			r.mu.Lock()
			r.resyncs++
			r.mu.Unlock()
		}
	}
}

// lastEv is the highest ev seq received so far, or -1.
func (r *resubRecorder) lastEv() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	last := -1
	for _, f := range r.frames {
		if f.t == "ev" && f.seq > last {
			last = f.seq
		}
	}
	return last
}

// checkResubStream asserts the invariant a client is entitled to across any
// number of re-subscribes: every event after the first snapshot arrives as an
// `ev` frame, exactly once, in seq order, and every snapshot lands exactly
// where the stream is (state.seq == the next ev seq), so a state frame never
// skips events the log has not seen and never precedes one it already covers.
func checkResubStream(frames []streamFrame) error {
	if len(frames) == 0 || frames[0].t != "state" {
		return fmt.Errorf("stream does not open with a state frame: %v", frames)
	}
	next := frames[0].seq // the seq the next ev frame must carry
	for i, f := range frames[1:] {
		switch f.t {
		case "ev":
			if f.seq != next {
				return fmt.Errorf("frame %d: ev seq %d, want %d (gap or duplicate)", i+1, f.seq, next)
			}
			next++
		case "state":
			if f.seq != next {
				return fmt.Errorf("frame %d: state seq %d, but the stream is at %d (events %s)",
					i+1, f.seq, next, missing(next, f.seq))
			}
		}
	}
	return nil
}

func missing(have, state int) string {
	if state > have {
		return fmt.Sprintf("%d..%d never arrived as ev frames", have, state-1)
	}
	return fmt.Sprintf("%d..%d arrive after a snapshot that covers them", state, have-1)
}

// TestResubscribeLosesNoEvents drives a live game command after command while
// the host's client re-subscribes on every event. Every event must still
// arrive as an ev frame, none lost between the old subscription and the new.
func TestResubscribeLosesNoEvents(t *testing.T) {
	e := newEnv(t)
	e.srv.wsMsgRate, e.srv.wsMsgBurst = 1e6, 1e6
	host, hostC := e.discordUser(t, "d1", "host")
	id := startActiveSolo(t, e, host)
	a, err := e.srv.mgr.Get(id)
	if err != nil {
		t.Fatal(err)
	}
	r := dialRecorder(t, e, hostC, id)
	waitFor(t, func() bool {
		r.mu.Lock()
		defer r.mu.Unlock()
		return len(r.frames) > 0
	}, "first state frame")

	// Play until the log is well past the opening and the ring has wrapped.
	const target = 160
	deadline := time.Now().Add(60 * time.Second)
	for {
		m := mirror(t, e.st, id)
		if m.NextSeq >= target || m.Phase == engine.PhaseFinished {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("game stalled at seq %d", m.NextSeq)
		}
		cmd, ok := engine.AutoCommand(m)
		if !ok {
			t.Fatalf("no command at seq %d", m.NextSeq)
		}
		// Every seat is driven from here, back to back, which is the burst: a
		// command lands while the client is still re-subscribing after the last.
		// A bot seat may beat us to it; the next pass re-reads the log.
		_ = a.Do(cmd)
	}

	// Every event persisted must reach the client. The wait is soft: a lost
	// tail never arrives, and the stream check below says which seqs it was.
	final := mirror(t, e.st, id).NextSeq
	for end := time.Now().Add(10 * time.Second); r.lastEv() < final-1 && time.Now().Before(end); {
		time.Sleep(10 * time.Millisecond)
	}

	r.mu.Lock()
	frames := append([]streamFrame(nil), r.frames...)
	resyncs, resubs := r.resyncs, r.resubs
	r.mu.Unlock()
	if resyncs > 0 {
		// A resync is the slow-consumer path (send buffer or ring overflow),
		// lossy by design and recovered over REST, so it invalidates this test.
		t.Fatalf("%d resync hints, want 0", resyncs)
	}
	if err := checkResubStream(frames); err != nil {
		t.Fatalf("%v\n(%d frames, %d subs, final seq %d)", err, len(frames), resubs, final)
	}
	if got := r.lastEv(); got != final-1 {
		t.Fatalf("last ev frame is seq %d, want %d", got, final-1)
	}
	t.Logf("%d frames over %d subs, no event lost", len(frames), resubs)
}

// drainFrames empties a hand-built Conn's send queue into ordered frames.
func drainFrames(t *testing.T, send chan []byte) []streamFrame {
	t.Helper()
	var out []streamFrame
	for {
		select {
		case raw := <-send:
			var f struct {
				T   string `json:"t"`
				Seq int    `json:"seq"`
			}
			if err := json.Unmarshal(raw, &f); err != nil {
				t.Fatal(err)
			}
			if f.T == "ev" || f.T == "state" {
				out = append(out, streamFrame{f.T, f.Seq})
			}
		default:
			return out
		}
	}
}

// TestResubscribeFinishedGameSendsOwedEvents is the one re-subscribe
// the ring cannot serve: the winning command commits the status flip with its
// events, so a re-subscribe that races it lands on the finished-game path,
// which starts no subscription. Frames the old one still owed must come from
// the store, ahead of the final snapshot.
func TestResubscribeFinishedGameSendsOwedEvents(t *testing.T) {
	e := newEnv(t)
	host, _ := e.discordUser(t, "d1", "host")
	id := startActiveSolo(t, e, host)
	a, err := e.srv.mgr.Get(id)
	if err != nil {
		t.Fatal(err)
	}
	seat, err := e.st.SeatForUser(id, host.ID)
	if err != nil {
		t.Fatal(err)
	}
	viewer := engine.PlayerID(seat.No)
	sub, view := a.Subscribe(viewer)
	if view == nil {
		t.Fatal("no view")
	}
	// Commit a few batches the (absent) forwarder never reads: they are what
	// the old subscription owes when the re-subscribe arrives.
	for range 4 {
		cmd, ok := engine.AutoCommand(mirror(t, e.st, id))
		if !ok {
			t.Fatal("no command")
		}
		if err := a.Do(cmd); err != nil {
			t.Fatal(err)
		}
	}
	e.srv.mgr.StopAll()
	if err := e.st.FinishGame(id, host.ID); err != nil {
		t.Fatal(err)
	}
	final := mirror(t, e.st, id).NextSeq
	if final <= view.Seq {
		t.Fatal("no events owed")
	}

	c := &Conn{srv: e.srv, send: make(chan []byte, 64), userID: host.ID, gameID: id, sub: sub}
	c.handleSub(clientFrame{T: "sub", Game: id})
	got := drainFrames(t, c.send)

	var want []streamFrame
	for s := view.Seq; s < final; s++ {
		want = append(want, streamFrame{"ev", s})
	}
	want = append(want, streamFrame{"state", final})
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("frames = %v\nwant     %v", got, want)
	}
}

// resumedPair subscribes a viewer, commits `batches` commands its forwarder
// never reads, and returns the actor, the viewer and that first subscription.
func resumedPair(t *testing.T, e *testEnv, batches int) (*game.Actor, engine.PlayerID, *game.Subscription, int) {
	t.Helper()
	host, _ := e.discordUser(t, "d1", "host")
	id := startActiveSolo(t, e, host)
	a, err := e.srv.mgr.Get(id)
	if err != nil {
		t.Fatal(err)
	}
	seat, err := e.st.SeatForUser(id, host.ID)
	if err != nil {
		t.Fatal(err)
	}
	viewer := engine.PlayerID(seat.No)
	sub, view := a.Subscribe(viewer)
	if view == nil {
		t.Fatal("no view")
	}
	for range batches {
		cmd, ok := engine.AutoCommand(mirror(t, e.st, id))
		if !ok {
			t.Fatal("no command")
		}
		if err := a.Do(cmd); err != nil {
			t.Fatal(err)
		}
	}
	return a, viewer, sub, view.Seq
}

// TestResumedForwardSendsOwedThenState: a resumed subscription with nothing
// new behind it still has to deliver its snapshot, right after the owed
// frames, not wait for the next event to push it out.
func TestResumedForwardSendsOwedThenState(t *testing.T) {
	e := newEnv(t)
	a, viewer, old, from := resumedPair(t, e, 3)
	old.Close()
	sub, view := a.SubscribeFrom(viewer, from)
	if view == nil || view.Seq <= from {
		t.Fatalf("nothing owed (from %d, view %v)", from, view)
	}
	if got := sub.Position(); got != from {
		t.Fatalf("resumed at %d, want %d", got, from)
	}
	c := &Conn{srv: e.srv, send: make(chan []byte, 64), gameID: a.ID, sub: sub}
	state, _ := json.Marshal(stateFrame{T: "state", Game: a.ID, Seq: view.Seq, Full: view})
	go c.forward(a.ID, sub, state, view.Seq)

	var got []streamFrame
	for end := time.Now().Add(10 * time.Second); time.Now().Before(end); {
		got = append(got, drainFrames(t, c.send)...)
		if n := len(got); n > 0 && got[n-1].t == "state" {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	var want []streamFrame
	for s := from; s < view.Seq; s++ {
		want = append(want, streamFrame{"ev", s})
	}
	want = append(want, streamFrame{"state", view.Seq})
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("frames = %v\nwant     %v", got, want)
	}
	sub.Close()
}

// TestReleaseWaitsForTheForwarder: release reports where the old stream
// stopped, and that is only true once its forwarder has queued the frame it
// already took off the ring. Returning earlier would let the successor's
// frames overtake it.
func TestReleaseWaitsForTheForwarder(t *testing.T) {
	e := newEnv(t)
	a, _, sub, from := resumedPair(t, e, 1)
	taken := make(chan struct{})
	unblock := make(chan struct{})
	var once sync.Once
	forwardTaken = func() {
		once.Do(func() {
			close(taken)
			<-unblock
		})
	}
	t.Cleanup(func() { forwardTaken = nil })

	c := &Conn{srv: e.srv, send: make(chan []byte, 64), gameID: a.ID}
	done := make(chan struct{})
	c.attach(a.ID, sub, done)
	go func() { defer close(done); c.forward(a.ID, sub, nil, from) }()
	<-taken // parked with frame `from` off the ring and not yet queued

	released := make(chan int, 1)
	go func() { _, _, pos := c.release(); released <- pos }()
	select {
	case pos := <-released:
		t.Fatalf("release returned (position %d) while the forwarder still held a frame", pos)
	case <-time.After(100 * time.Millisecond):
	}
	close(unblock)
	pos := <-released
	got := drainFrames(t, c.send)
	if len(got) == 0 || got[0] != (streamFrame{"ev", from}) {
		t.Fatalf("the taken frame was not queued before release returned: %v", got)
	}
	if last := got[len(got)-1].seq; pos != last+1 {
		t.Fatalf("release position %d, but the last frame queued was %d", pos, last)
	}
}
