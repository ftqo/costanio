package server

import (
	"encoding/json"
	"testing"

	"github.com/ftqo/costan.io/game"
)

// drainHasType reports whether any queued frame has the given "t".
func drainHasType(send chan []byte, typ string) bool {
	for {
		select {
		case raw := <-send:
			var m map[string]any
			json.Unmarshal(raw, &m)
			if m["t"] == typ {
				return true
			}
		default:
			return false
		}
	}
}

// TestForwardResyncOnInvoluntaryDrop: when the actor closes the shared ring out
// from under a still-attached conn (game stopped / slow-consumer eviction), the
// forward loop hints the client to resync.
func TestForwardResyncOnInvoluntaryDrop(t *testing.T) {
	e := newEnv(t)
	host, _ := e.discordUser(t, "d1", "host")
	id := startActiveSolo(t, e, host)
	a, err := e.srv.mgr.Get(id)
	if err != nil {
		t.Fatal(err)
	}
	sub, view := a.Subscribe(game.Spectator)
	if view == nil {
		t.Fatal("subscribe returned no view")
	}

	// Conn still points at this sub (c.sub == sub, c.gameID == id), so an
	// involuntary ring close must yield a resync hint.
	c := &Conn{srv: e.srv, send: make(chan []byte, 8), gameID: id, sub: sub}

	done := make(chan struct{})
	go func() { c.forward(id, sub, nil, view.Seq); close(done) }()
	a.Stop() // closes the ring -> Next() returns !ok
	<-done

	if !drainHasType(c.send, "resync") {
		t.Error("expected a resync hint after an involuntary drop")
	}
}

// TestForwardNoResyncAfterDetach: if the conn has already detached/re-subscribed
// (c.sub differs), closing this sub's ring is "voluntary" and must not resync.
func TestForwardNoResyncAfterDetach(t *testing.T) {
	e := newEnv(t)
	host, _ := e.discordUser(t, "d1", "host")
	id := startActiveSolo(t, e, host)
	a, err := e.srv.mgr.Get(id)
	if err != nil {
		t.Fatal(err)
	}
	sub, view := a.Subscribe(game.Spectator)
	if view == nil {
		t.Fatal("subscribe returned no view")
	}

	// Conn is not following this sub any more (c.sub differs), so a ring close is
	// voluntary and must not trigger a resync.
	c := &Conn{srv: e.srv, send: make(chan []byte, 8), gameID: id, sub: nil}

	done := make(chan struct{})
	go func() { c.forward(id, sub, nil, view.Seq); close(done) }()
	a.Stop()
	<-done

	if drainHasType(c.send, "resync") {
		t.Error("voluntary unsub/re-sub must not trigger a resync")
	}
}
