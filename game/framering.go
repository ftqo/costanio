package game

import (
	"slices"
	"sync"

	"github.com/ftqo/costan.io/engine"
)

// frame is one broadcast event pre-encoded into wire bytes at most twice: once
// for viewers allowed the full payload (public events, plus the owning seats of
// a hidden event) and once for everyone else (the redacted variant). Encoding
// happens once per event in the actor, not once per subscriber.
type frame struct {
	seq int
	// visible mirrors the source event's Visible list: nil means fully public;
	// otherwise only listed seats read full and the rest read redacted. It is
	// the only thing that selects a viewer's bytes.
	visible  []engine.PlayerID
	full     []byte // payload as the owner/public sees it
	redacted []byte // payload for non-owners (nil when visible == nil)
}

// bytesFor returns the wire frame a viewer is entitled to: a viewer not in a
// hidden event's Visible list only ever gets the redacted bytes.
func (f *frame) bytesFor(viewer engine.PlayerID) []byte {
	if f.visible == nil || slices.Contains(f.visible, viewer) {
		return f.full
	}
	return f.redacted
}

// frameRing is a bounded, append-only, seq-tagged buffer of encoded broadcast
// frames shared by every subscriber of one game. Subscribers hold a cursor (the
// next seq they want) and read shared []byte frames at it; a subscriber that
// falls behind the retained window is told to resync (full view + EventsSince,
// then re-subscribe at the live seq).
//
// Only the actor goroutine writes it (push, closeRing), but many subscriber
// goroutines read it, so it has its own mutex and cond.
type frameRing struct {
	mu     sync.Mutex
	cond   *sync.Cond
	buf    []frame // retained window, ascending seq
	cap    int     // max retained frames before the oldest is evicted
	first  int     // seq of buf[0] (or next seq when empty)
	closed bool
}

func newFrameRing(capacity int) *frameRing {
	r := &frameRing{cap: capacity}
	r.cond = sync.NewCond(&r.mu)
	return r
}

// push appends an encoded frame and wakes every waiting reader. Called only
// from the actor goroutine, after persist (commit orders the two).
func (r *frameRing) push(f frame) {
	r.mu.Lock()
	if len(r.buf) == 0 {
		r.first = f.seq
	}
	r.buf = append(r.buf, f)
	if len(r.buf) > r.cap {
		drop := len(r.buf) - r.cap
		r.buf = r.buf[drop:]
		r.first = r.buf[0].seq
	}
	r.cond.Broadcast()
	r.mu.Unlock()
}

// closeRing wakes all readers so they exit (the game stopped). Idempotent.
func (r *frameRing) closeRing() {
	r.mu.Lock()
	r.closed = true
	r.cond.Broadcast()
	r.mu.Unlock()
}

// ringReader is one subscriber's cursor into the shared ring, read by a single
// goroutine (the connection's forwarder). It returns the shared []byte for the
// viewer's variant without copying.
type ringReader struct {
	r      *frameRing
	viewer engine.PlayerID
	cursor int
	closed bool // set under r.mu by stop(); unblocks a waiting next()
}

// reader returns a cursor positioned at `since` (the first seq the subscriber
// still needs). A reader starting before the retained window resyncs on its
// first next.
func (r *frameRing) reader(viewer engine.PlayerID, since int) *ringReader {
	return &ringReader{r: r, viewer: viewer, cursor: since}
}

// canResume reports whether a reader starting at `from` could read every frame
// up to (not including) `upto`: the window still holds `from`, or `from` is
// already `upto`. Called on the actor loop, the only writer, so the answer
// cannot go stale before the reader is created.
func (r *frameRing) canResume(from, upto int) bool {
	if from == upto {
		return true
	}
	if from > upto || from < 0 {
		return false
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.buf) > 0 && from >= r.first && upto <= r.first+len(r.buf)
}

// position is the seq this reader will return next: every frame before it has
// been handed out. Safe from any goroutine.
func (rd *ringReader) position() int {
	rd.r.mu.Lock()
	defer rd.r.mu.Unlock()
	return rd.cursor
}

// stop unblocks a reader parked in next() so its forwarder can exit. The
// ring's single cond wakes every reader and each re-checks its own closed
// flag; that costs O(readers) wakeups, but only on unsubscribe.
func (rd *ringReader) stop() {
	r := rd.r
	r.mu.Lock()
	rd.closed = true
	r.cond.Broadcast()
	r.mu.Unlock()
}

// next blocks until the next frame at the reader's cursor is available, then
// returns its viewer-appropriate bytes and the frame's seq.
//
//   - ok==true: bytes are valid; the cursor advanced.
//   - behind==true: the cursor fell off the back of the window (slow consumer);
//     the caller must resync via a fresh full view.
//   - ok==false && behind==false: the ring closed; stop.
func (rd *ringReader) next() (raw []byte, seq int, behind, ok bool) {
	r := rd.r
	r.mu.Lock()
	defer r.mu.Unlock()
	for {
		if rd.closed {
			return nil, rd.cursor, false, false
		}
		// Slow consumer: the frame we want was evicted before we read it.
		if len(r.buf) > 0 && rd.cursor < r.first {
			return nil, rd.cursor, true, false
		}
		if rd.cursor >= r.first && rd.cursor < r.first+len(r.buf) {
			f := &r.buf[rd.cursor-r.first]
			raw = f.bytesFor(rd.viewer)
			seq = f.seq
			rd.cursor++
			return raw, seq, false, true
		}
		if r.closed {
			return nil, rd.cursor, false, false
		}
		r.cond.Wait()
	}
}
