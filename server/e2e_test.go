package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"

	"github.com/ftqo/costan.io/auth"
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/game"
	"github.com/ftqo/costan.io/lobby"
	"github.com/ftqo/costan.io/store"
)

type wsClient struct {
	t    *testing.T
	conn *websocket.Conn

	mu     sync.Mutex
	events []json.RawMessage // raw "ev" frames in arrival order
	frames []map[string]any  // everything else
	closed bool
}

func dialWS(t *testing.T, ts *httptest.Server, cookie *http.Cookie) *wsClient {
	t.Helper()
	url := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws"
	hdr := http.Header{"Cookie": {cookie.Name + "=" + cookie.Value}}
	conn, _, err := websocket.Dial(context.Background(), url, &websocket.DialOptions{HTTPHeader: hdr})
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	// State frames for a full game can exceed coder/websocket's 32 KiB default
	// read cap, which would close the client with StatusMessageTooBig.
	conn.SetReadLimit(-1)
	c := &wsClient{t: t, conn: conn}
	go c.recvLoop()
	t.Cleanup(func() { _ = conn.CloseNow() })
	return c
}

func (c *wsClient) recvLoop() {
	for {
		_, raw, err := c.conn.Read(context.Background())
		if err != nil {
			c.mu.Lock()
			c.closed = true
			c.mu.Unlock()
			return
		}
		var f map[string]any
		if err := json.Unmarshal(raw, &f); err != nil {
			continue
		}
		c.mu.Lock()
		if f["t"] == "ev" {
			ev, _ := json.Marshal(f["ev"])
			c.events = append(c.events, ev)
		} else {
			c.frames = append(c.frames, f)
		}
		c.mu.Unlock()
	}
}

func (c *wsClient) send(v any) {
	c.t.Helper()
	if err := wsjson.Write(context.Background(), c.conn, v); err != nil {
		c.t.Fatalf("ws send: %v", err)
	}
}

// waitFrame waits for a non-event frame matching pred.
func (c *wsClient) waitFrame(pred func(map[string]any) bool, what string) map[string]any {
	c.t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		c.mu.Lock()
		for _, f := range c.frames {
			if pred(f) {
				c.mu.Unlock()
				return f
			}
		}
		c.mu.Unlock()
		time.Sleep(5 * time.Millisecond)
	}
	c.t.Fatalf("timeout waiting for %s", what)
	return nil
}

// mirror rebuilds full state from the store (the test is omniscient).
func mirror(t *testing.T, st *store.Store, id string) *engine.State {
	t.Helper()
	events, err := st.LoadEvents(id, 0)
	if err != nil {
		t.Fatal(err)
	}
	s, err := engine.Replay(events)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

// nextCommand prefers a winning city build, else the minimal auto command.
func nextCommand(s *engine.State) (engine.Command, bool) {
	if s.Phase == engine.PhasePlay && s.Rolled && !s.RobberPending &&
		len(s.PendingDiscards) == 0 && s.Players[s.Cur].Hand.Has(engine.CostCity) {
		for v, b := range s.Buildings {
			if b.Owner == s.Cur && !b.City {
				data, _ := json.Marshal(map[string]any{"v": v})
				return engine.Command{Player: s.Cur, Type: engine.CmdBuildCity, Data: data}, true
			}
		}
	}
	return engine.AutoCommand(s)
}

func TestE2EFullGameWithRestart(t *testing.T) {
	st, err := store.Open(t.TempDir() + "/e2e.db")
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()

	boot := func() (*httptest.Server, *game.Manager) {
		mgr := game.NewManager(st, nil)
		srv := New(st, &auth.Service{Store: st}, lobby.New(st, mgr), mgr)
		// The driver fires commands far faster than a human; lift the WS
		// frame-rate cap so the test isn't throttled.
		srv.wsMsgRate, srv.wsMsgBurst = 1e6, 1e6
		return httptest.NewServer(srv.Handler()), mgr
	}
	ts, mgr := boot()

	e := &testEnv{st: st, srv: nil, ts: ts}
	users := make([]*store.User, 3)
	cookies := make([]*http.Cookie, 3)
	// Host must be a registered account (guests can't host); the other players
	// are guests who join via the invite link.
	users[0], cookies[0] = e.discordUser(t, "d0", "host")
	users[1], cookies[1] = e.guest(t, "p1")
	users[2], cookies[2] = e.guest(t, "p2")

	// Lobby flow over HTTP.
	resp, created := e.req(t, "POST", "/api/games", cookies[0], map[string]any{
		"config": map[string]any{"players": 3, "target_vp": 8}, "private": true,
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create = %d %v", resp.StatusCode, created)
	}
	g := created["game"].(map[string]any)
	id, invite := g["id"].(string), g["invite_code"].(string)
	for i := 1; i < 3; i++ {
		if resp, out := e.req(t, "POST", "/api/games/"+id+"/join", cookies[i], map[string]any{"invite": invite}); resp.StatusCode != http.StatusOK {
			t.Fatalf("join %d = %d %v", i, resp.StatusCode, out)
		}
	}
	if resp, _ := e.req(t, "POST", "/api/games/"+id+"/start", cookies[0], nil); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("start = %d", resp.StatusCode)
	}

	// Map seats to users (compacted at start).
	seats, _ := st.Seats(id)
	seatCookie := map[engine.PlayerID]*http.Cookie{}
	for _, s := range seats {
		for i, u := range users {
			if u.ID == s.UserID {
				seatCookie[engine.PlayerID(s.No)] = cookies[i]
			}
		}
	}

	// Connect all three players plus a spectator (via invite).
	clients := map[engine.PlayerID]*wsClient{}
	for seat, ck := range seatCookie {
		c := dialWS(t, ts, ck)
		c.send(map[string]any{"t": "sub", "game": id})
		c.waitFrame(func(f map[string]any) bool { return f["t"] == "state" }, "state")
		clients[seat] = c
	}
	specUser, specCookie := e.guest(t, "watcher")
	_ = specUser
	spec := dialWS(t, ts, specCookie)
	spec.send(map[string]any{"t": "sub", "game": id, "invite": invite})
	spec.waitFrame(func(f map[string]any) bool { return f["t"] == "state" }, "spectator state")

	// Drive the game from the omniscient mirror.
	drive := func(maxCmds int) bool {
		for range maxCmds {
			m := mirror(t, st, id)
			if m.Phase == engine.PhaseFinished {
				return true
			}
			cmd, ok := nextCommand(m)
			if !ok {
				return false
			}
			c := clients[cmd.Player]
			c.send(map[string]any{"t": "cmd", "id": "x", "game": id,
				"cmd": map[string]any{"type": cmd.Type, "data": orEmpty(cmd.Data)}})
			// Persist-before-broadcast: wait for the command's events to land in the
			// store (the next one has seq == m.NextSeq). Probe only new rows via
			// LoadEvents(since); replaying the whole log every 5ms is O(n^2) and starves
			// the actor under -race.
			target := m.NextSeq
			waitFor(t, func() bool { ev, err := st.LoadEvents(id, target); return err == nil && len(ev) > 0 }, "store to advance")
		}
		return false
	}
	drive(60)

	// Chat reaches everyone in the game.
	clients[0].send(map[string]any{"t": "chat", "scope": "game:" + id, "msg": "gg so far"})
	for _, c := range clients {
		c.waitFrame(func(f map[string]any) bool { return f["t"] == "chat" && f["msg"] == "gg so far" }, "chat")
	}

	// --- Restart mid-game ---
	before := mirror(t, st, id)
	if before.Phase == engine.PhaseFinished {
		t.Fatal("game finished before restart point; lower drive budget")
	}
	ts.Close()
	mgr.StopAll()
	ts2, mgr2 := boot()
	defer func() { ts2.Close(); mgr2.StopAll() }()
	e.ts = ts2

	// Reconnect with `since`; expect either gap events or nothing new, then play on.
	clients = map[engine.PlayerID]*wsClient{}
	for seat, ck := range seatCookie {
		c := dialWS(t, ts2, ck)
		c.send(map[string]any{"t": "sub", "game": id, "since": before.NextSeq})
		clients[seat] = c
	}
	// Prove the game still runs after the restart. A modest budget keeps the
	// test fast; reaching the (high) VP target is not the point here.
	finished := drive(300)

	after := mirror(t, st, id)
	if after.NextSeq <= before.NextSeq {
		t.Fatal("no progress after restart")
	}

	// Redaction on the wire: no client may see another's stolen card.
	for seat, c := range clients {
		c.mu.Lock()
		for _, raw := range c.events {
			var ev struct {
				Type engine.EventType `json:"type"`
				Data struct {
					Thief  *engine.PlayerID `json:"thief"`
					Victim *engine.PlayerID `json:"victim"`
					Res    any              `json:"res"`
				} `json:"data"`
			}
			json.Unmarshal(raw, &ev)
			if ev.Type == engine.EvCardStolen && ev.Data.Res != nil {
				if ev.Data.Thief == nil || (*ev.Data.Thief != seat && *ev.Data.Victim != seat) {
					t.Errorf("seat %d saw a stolen card it shouldn't: %s", seat, raw)
				}
			}
		}
		c.mu.Unlock()
	}

	if finished {
		gRow, _ := st.GameByID(id)
		if gRow.Status != "finished" || gRow.Winner == nil {
			t.Errorf("finished game row = %+v", gRow)
		}
		resp, replay := e.req(t, "GET", "/api/games/"+id+"/replay", cookies[0], nil)
		if resp.StatusCode != http.StatusOK {
			t.Errorf("replay = %d", resp.StatusCode)
		} else if events := replay["events"].([]any); len(events) != after.NextSeq {
			t.Errorf("replay has %d events, want %d", len(events), after.NextSeq)
		}
	} else {
		t.Log("game did not finish within budget")
	}
}

func orEmpty(d json.RawMessage) json.RawMessage {
	if len(d) == 0 {
		return json.RawMessage(`null`)
	}
	return d
}

func waitFor(t *testing.T, cond func() bool, what string) {
	t.Helper()
	// Generous ceiling: under `go test -race ./...` many test binaries share
	// CPU and disk, so one round-trip (ws -> actor -> SQLite) can take seconds.
	// The condition is cheap, so a long ceiling costs nothing when it passes.
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timeout waiting for %s", what)
}

func TestWSRejectsUnauthenticated(t *testing.T) {
	e := newEnv(t)
	url := "ws" + strings.TrimPrefix(e.ts.URL, "http") + "/ws"
	// The upgrade succeeds without a session (the Discord Activity can't set a
	// bearer header on a browser WebSocket), but any frame other than a valid
	// auth frame is rejected with UNAUTHENTICATED and closes the connection.
	conn, _, err := websocket.Dial(context.Background(), url, nil)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer func() { _ = conn.CloseNow() }()
	if err := wsjson.Write(context.Background(), conn, map[string]any{"t": "sub", "game": "whatever"}); err != nil {
		t.Fatalf("write: %v", err)
	}
	var f struct {
		T    string `json:"t"`
		Code string `json:"code"`
	}
	if err := wsjson.Read(context.Background(), conn, &f); err != nil {
		t.Fatalf("read: %v", err)
	}
	if f.T != "err" || f.Code != "AUTH_REQUIRED" {
		t.Errorf("got t=%q code=%q, want err/AUTH_REQUIRED", f.T, f.Code)
	}
}

func TestWSSpectatorCannotAct(t *testing.T) {
	e := newEnv(t)
	_, hostC := e.discordUser(t, "d1", "host")
	_, aliceC := e.discordUser(t, "d2", "alice")
	_, bobC := e.discordUser(t, "d3", "bob")
	_, watcherC := e.discordUser(t, "d4", "watcher")

	_, created := e.req(t, "POST", "/api/games", hostC, map[string]any{"config": map[string]any{"players": 3}})
	id := created["game"].(map[string]any)["id"].(string)
	e.req(t, "POST", "/api/games/"+id+"/join", aliceC, nil)
	e.req(t, "POST", "/api/games/"+id+"/join", bobC, nil)
	e.req(t, "POST", "/api/games/"+id+"/start", hostC, nil)

	w := dialWS(t, e.ts, watcherC)
	w.send(map[string]any{"t": "sub", "game": id})
	w.waitFrame(func(f map[string]any) bool { return f["t"] == "state" }, "state")

	w.send(map[string]any{"t": "cmd", "id": "c1", "game": id,
		"cmd": map[string]any{"type": "roll_dice"}})
	f := w.waitFrame(func(f map[string]any) bool { return f["t"] == "err" }, "err")
	if f["code"] != "SPECTATOR_CANNOT_ACT" {
		t.Errorf("err = %v", f)
	}
}

func TestWSPrivateGameNeedsInvite(t *testing.T) {
	e := newEnv(t)
	_, hostC := e.discordUser(t, "d1", "host")
	_, otherC := e.discordUser(t, "d2", "other")

	_, created := e.req(t, "POST", "/api/games", hostC, map[string]any{
		"config": map[string]any{"players": 3}, "private": true,
	})
	id := created["game"].(map[string]any)["id"].(string)

	c := dialWS(t, e.ts, otherC)
	c.send(map[string]any{"t": "sub", "game": id})
	f := c.waitFrame(func(f map[string]any) bool { return f["t"] == "err" }, "err")
	if f["code"] != "PRIVATE_GAME" {
		t.Errorf("err = %v", f)
	}
}
