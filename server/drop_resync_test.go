package server

import "testing"

// TestTrySendSignalsResyncOnDrop: when the per-connection send buffer is full,
// trySend signals the write pump (via the dropped channel) to send a resync, so
// the client refetches state instead of rendering stale data.
func TestTrySendSignalsResyncOnDrop(t *testing.T) {
	c := &Conn{
		send:    make(chan []byte, 1),
		dropped: make(chan struct{}, 1),
	}
	c.trySend([]byte("a")) // fits
	c.trySend([]byte("b")) // buffer full -> dropped

	select {
	case <-c.dropped:
		// good: a drop was signaled
	default:
		t.Fatal("a dropped frame did not signal a resync")
	}
}

// TestTrySendNoResyncWhenRoom: a frame that fits must not raise a drop signal.
func TestTrySendNoResyncWhenRoom(t *testing.T) {
	c := &Conn{
		send:    make(chan []byte, 4),
		dropped: make(chan struct{}, 1),
	}
	c.trySend([]byte("a"))
	c.trySend([]byte("b"))

	select {
	case <-c.dropped:
		t.Fatal("a frame that fit the buffer must not signal a resync")
	default:
		// good
	}
}
