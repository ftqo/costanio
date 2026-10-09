package server

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// TestCloseWaitsForConnGoroutines: http.Server.Shutdown leaves hijacked
// websockets alone, and Hub.CloseAll only waits for close frames to be
// written, not for the read loops (which call mgr.Get, actor.Do and
// store.LoadEvents) to exit. Close must join them before main calls StopAll
// and store.Close.
//
// With a live connection parked in ws.Read, Close must not return; DrainConns
// then tears the socket down, the read loop exits, and Close returns. This
// also pins the documented shutdown order.
func TestCloseWaitsForConnGoroutines(t *testing.T) {
	e := newEnv(t)
	u, c := e.discordUser(t, "d1", "alice")
	dialWS(t, e.ts, c) // parks a handler goroutine in ws.Read

	// Wait until the server has actually registered the connection, so the
	// assertion below is about a live conn and not a dial still in flight.
	deadline := time.Now().Add(5 * time.Second)
	for !e.srv.hub.Online(u.ID) {
		if time.Now().After(deadline) {
			t.Fatal("connection never reached the hub")
		}
		time.Sleep(time.Millisecond)
	}

	closed := make(chan struct{})
	go func() { e.srv.Close(); close(closed) }()
	select {
	case <-closed:
		t.Fatal("Server.Close returned with a websocket read loop still live")
	case <-time.After(300 * time.Millisecond):
	}

	e.srv.DrainConns() // what actually unblocks a parked read loop
	select {
	case <-closed:
	case <-time.After(20 * time.Second):
		t.Fatal("Server.Close did not return after the sockets were drained")
	}
}

// TestUpgradeRefusedDuringShutdown: no connection may be created once shutdown
// has begun; refusing the upgrade is the cheapest place to stop it.
func TestUpgradeRefusedDuringShutdown(t *testing.T) {
	e := newEnv(t)
	_, c := e.discordUser(t, "d1", "alice")
	e.srv.DrainConns()
	e.srv.Close()

	url := "ws" + strings.TrimPrefix(e.ts.URL, "http") + "/ws"
	hdr := http.Header{"Cookie": {c.Name + "=" + c.Value}}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	conn, resp, err := websocket.Dial(ctx, url, &websocket.DialOptions{HTTPHeader: hdr})
	if err == nil {
		_ = conn.CloseNow()
		t.Fatal("websocket upgrade succeeded after Server.Close")
	}
	if resp == nil {
		t.Fatalf("dial failed without a response: %v", err)
	}
	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Errorf("upgrade during shutdown = %d, want %d", resp.StatusCode, http.StatusServiceUnavailable)
	}
}
