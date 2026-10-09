package server

import (
	"net/http"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/store"
)

// finishGame starts a solo game (host + 2 bots), stops the live actor, and marks
// the game finished in the store with the host as winner. The setup events are
// enough for BuildScoreboard, so this drives the finished/postgame ws paths
// without playing a full game.
func finishGame(t *testing.T, e *testEnv, host *store.User) string {
	t.Helper()
	id := startActiveSolo(t, e, host)
	// Stop the in-memory actor so handleSub takes the finished branch from the
	// store status (it never calls mgr.Get for a finished game anyway).
	e.srv.mgr.StopAll()
	if err := e.st.FinishGame(id, host.ID); err != nil {
		t.Fatal(err)
	}
	return id
}

func TestWSAuthFramePromotesConnection(t *testing.T) {
	e := newEnv(t)
	host, hostC := e.discordUser(t, "d1", "host")
	sum, err := e.srv.lobby.Create(host, engine.GameConfig{Players: 4}, false)
	if err != nil {
		t.Fatal(err)
	}

	// Dial without a cookie (mimics the Discord Activity browser socket), then
	// authenticate with a first auth frame carrying the session token.
	c := dialWS(t, e.ts, &http.Cookie{Name: "irrelevant", Value: "x"})

	// A bad token is rejected but keeps the socket open.
	c.send(map[string]any{"t": "auth", "id": "a0", "token": "not-a-session"})
	f := c.waitFrame(func(f map[string]any) bool { return f["t"] == "err" && f["ref"] == "a0" }, "bad-token err")
	if f["code"] != "INVALID_SESSION" {
		t.Errorf("bad token code = %v, want INVALID_SESSION", f["code"])
	}

	// The valid session token promotes the connection; a sub now works.
	c.send(map[string]any{"t": "auth", "token": hostC.Value})
	c.send(map[string]any{"t": "sub", "game": sum.Game.ID})
	c.waitFrame(func(f map[string]any) bool { return f["t"] == "lobby" }, "lobby after auth frame")
}

func TestWSSubLobby(t *testing.T) {
	e := newEnv(t)
	host, hostC := e.discordUser(t, "d1", "host")
	sum, err := e.srv.lobby.Create(host, engine.GameConfig{Players: 4}, false)
	if err != nil {
		t.Fatal(err)
	}

	c := dialWS(t, e.ts, hostC)
	c.send(map[string]any{"t": "sub", "game": sum.Game.ID})
	f := c.waitFrame(func(f map[string]any) bool { return f["t"] == "lobby" }, "lobby frame")
	if f["game"] != sum.Game.ID || f["summary"] == nil {
		t.Errorf("lobby frame = %v", f)
	}
}

// A (re)subscribe to an already-active game must resend `started` with the
// state frame, so a client that missed the one-shot start broadcast still
// leaves the waiting room.
func TestWSSubActiveRedeliversStarted(t *testing.T) {
	e := newEnv(t)
	host, hostC := e.discordUser(t, "d1", "host")
	id := startActiveSolo(t, e, host)

	c := dialWS(t, e.ts, hostC)
	c.send(map[string]any{"t": "sub", "game": id})
	f := c.waitFrame(func(f map[string]any) bool { return f["t"] == "lobby" && f["started"] == true }, "started frame on active sub")
	if f["game"] != id {
		t.Errorf("started frame game = %v, want %v", f["game"], id)
	}
}

func TestWSSubUnknownGame(t *testing.T) {
	e := newEnv(t)
	_, c := e.discordUser(t, "d1", "me")
	w := dialWS(t, e.ts, c)
	w.send(map[string]any{"t": "sub", "id": "ref1", "game": "nonexistent"})
	f := w.waitFrame(func(f map[string]any) bool { return f["t"] == "err" }, "err frame")
	if f["code"] != "GAME_NOT_FOUND" {
		t.Errorf("err code = %v, want GAME_NOT_FOUND", f["code"])
	}
}

func TestWSBadFrames(t *testing.T) {
	e := newEnv(t)
	_, c := e.discordUser(t, "d1", "me")
	w := dialWS(t, e.ts, c)

	// Unknown frame type.
	w.send(map[string]any{"t": "bogus", "id": "r1"})
	f := w.waitFrame(func(f map[string]any) bool { return f["t"] == "err" && f["ref"] == "r1" }, "unknown-type err")
	if f["code"] != "BAD_FRAME_TYPE" {
		t.Errorf("unknown frame code = %v, want BAD_FRAME_TYPE", f["code"])
	}

	// cmd before subscribing to a game.
	w.send(map[string]any{"t": "cmd", "id": "r2", "game": "g", "cmd": map[string]any{"type": "roll_dice"}})
	f = w.waitFrame(func(f map[string]any) bool { return f["t"] == "err" && f["ref"] == "r2" }, "not-subscribed err")
	if f["code"] != "NOT_SUBSCRIBED" {
		t.Errorf("cmd code = %v, want NOT_SUBSCRIBED", f["code"])
	}

	// cmd with a nil payload.
	w.send(map[string]any{"t": "cmd", "id": "r3", "game": "g"})
	f = w.waitFrame(func(f map[string]any) bool { return f["t"] == "err" && f["ref"] == "r3" }, "missing-cmd err")
	if f["code"] != "BAD_FRAME_MISSING_CMD" {
		t.Errorf("missing cmd code = %v, want BAD_FRAME_MISSING_CMD", f["code"])
	}
}

func TestWSUnsub(t *testing.T) {
	e := newEnv(t)
	host, hostC := e.discordUser(t, "d1", "host")
	sum, err := e.srv.lobby.Create(host, engine.GameConfig{Players: 4}, false)
	if err != nil {
		t.Fatal(err)
	}
	c := dialWS(t, e.ts, hostC)
	c.send(map[string]any{"t": "sub", "game": sum.Game.ID})
	c.waitFrame(func(f map[string]any) bool { return f["t"] == "lobby" }, "lobby")
	// Unsub then re-sub: the second sub still works, proving detach left the conn usable.
	c.send(map[string]any{"t": "unsub"})
	c.send(map[string]any{"t": "sub", "game": sum.Game.ID})
	// Two lobby frames total expected; just confirm we can still get one after the cycle.
	c.waitFrame(func(f map[string]any) bool { return f["t"] == "lobby" }, "lobby after re-sub")
}

func TestWSSubFinishedPostgame(t *testing.T) {
	e := newEnv(t)
	host, hostC := e.discordUser(t, "d1", "host")
	id := finishGame(t, e, host)

	c := dialWS(t, e.ts, hostC)
	c.send(map[string]any{"t": "sub", "game": id})
	// Finished games stream a lobby summary plus a postgame frame.
	c.waitFrame(func(f map[string]any) bool { return f["t"] == "lobby" }, "finished lobby frame")
	pg := c.waitFrame(func(f map[string]any) bool { return f["t"] == "postgame" }, "postgame frame")
	if pg["scoreboard"] == nil {
		t.Errorf("postgame missing scoreboard: %v", pg)
	}
	rematch, ok := pg["rematch"].(map[string]any)
	if !ok {
		t.Fatalf("postgame missing rematch: %v", pg)
	}
	if int(rematch["eligible"].(float64)) != 1 {
		t.Errorf("eligible = %v, want 1 (the host)", rematch["eligible"])
	}
}

// A finished game still answers a sub with one last state frame for the
// subscriber's own seat. The resync after game_finished lands on the finished
// branch, so without this the HUD would stay on the pre-win state.
func TestWSSubFinishedSendsFinalStateFrame(t *testing.T) {
	e := newEnv(t)
	host, hostC := e.discordUser(t, "d1", "host")
	id := finishGame(t, e, host)

	c := dialWS(t, e.ts, hostC)
	c.send(map[string]any{"t": "sub", "game": id})
	f := c.waitFrame(func(f map[string]any) bool { return f["t"] == "state" }, "final state frame")
	full, ok := f["full"].(map[string]any)
	if !ok {
		t.Fatalf("state frame missing full view: %v", f)
	}
	// Seat 0's own view, not the spectator-redacted post-game board: the host
	// must still see their own hand on the last frame.
	if v, _ := full["viewer"].(float64); int(v) != 0 {
		t.Errorf("viewer = %v, want 0 (the host's seat)", full["viewer"])
	}
	players, ok := full["players"].([]any)
	if !ok || len(players) == 0 {
		t.Fatalf("state frame missing players: %v", full)
	}
	if p, _ := players[0].(map[string]any); p["hand"] == nil {
		t.Errorf("host's own hand redacted out of the final view: %v", players[0])
	}
	// Lobby metadata the actor normally stamps must survive the replay, or the
	// last frame would swap every name back to "Seat N".
	names, ok := full["seat_names"].(map[string]any)
	if !ok || names["0"] != "host" {
		t.Errorf("seat_names = %v, want seat 0 -> host", full["seat_names"])
	}
}

func TestWSRematchHostStartsNewLobby(t *testing.T) {
	e := newEnv(t)
	host, hostC := e.discordUser(t, "d1", "host")
	id := finishGame(t, e, host)

	c := dialWS(t, e.ts, hostC)
	c.send(map[string]any{"t": "sub", "game": id})
	c.waitFrame(func(f map[string]any) bool { return f["t"] == "postgame" }, "postgame")

	// Host triggers a rematch -> a postgame frame announcing the new lobby id.
	c.send(map[string]any{"t": "rematch", "game": id})
	f := c.waitFrame(func(f map[string]any) bool {
		r, ok := f["rematch"].(map[string]any)
		return f["t"] == "postgame" && ok && r["next"] != nil
	}, "rematch next frame")
	next := f["rematch"].(map[string]any)["next"].(string)
	if next == "" || next == id {
		t.Errorf("rematch next = %q, want a fresh lobby id", next)
	}
	if g, err := e.st.GameByID(next); err != nil || g.Status != "lobby" {
		t.Errorf("rematch target = %+v err=%v, want a lobby", g, err)
	}
}

func TestWSRematchOnLiveGameRejected(t *testing.T) {
	e := newEnv(t)
	host, hostC := e.discordUser(t, "d1", "host")
	id := startActiveSolo(t, e, host)

	c := dialWS(t, e.ts, hostC)
	c.send(map[string]any{"t": "sub", "game": id})
	c.waitFrame(func(f map[string]any) bool { return f["t"] == "state" }, "state")

	c.send(map[string]any{"t": "rematch", "id": "rm", "game": id})
	f := c.waitFrame(func(f map[string]any) bool { return f["t"] == "err" && f["ref"] == "rm" }, "rematch err")
	if f["code"] != "GAME_NOT_FINISHED" {
		t.Errorf("rematch on live game code = %v, want GAME_NOT_FINISHED", f["code"])
	}
}

func TestWSRematchWithoutSubRejected(t *testing.T) {
	e := newEnv(t)
	_, c := e.discordUser(t, "d1", "me")
	w := dialWS(t, e.ts, c)
	w.send(map[string]any{"t": "rematch", "id": "rm"})
	f := w.waitFrame(func(f map[string]any) bool { return f["t"] == "err" && f["ref"] == "rm" }, "rematch err")
	if f["code"] != "NOT_SUBSCRIBED" {
		t.Errorf("rematch w/o sub code = %v, want NOT_SUBSCRIBED", f["code"])
	}
}

func TestWSSubAbandonedGame(t *testing.T) {
	e := newEnv(t)
	host, hostC := e.discordUser(t, "d1", "host")
	sum, err := e.srv.lobby.Create(host, engine.GameConfig{Players: 4}, false)
	if err != nil {
		t.Fatal(err)
	}
	id := sum.Game.ID
	// Host leaving the lobby abandons the table.
	if _, err := e.srv.lobby.Leave(host, id); err != nil {
		t.Fatal(err)
	}
	if g, _ := e.st.GameByID(id); g.Status != "abandoned" {
		t.Fatalf("status = %s, want abandoned", g.Status)
	}

	c := dialWS(t, e.ts, hostC)
	c.send(map[string]any{"t": "sub", "game": id})
	f := c.waitFrame(func(f map[string]any) bool { return f["t"] == "lobby" }, "abandoned lobby frame")
	if f["closed"] != true {
		t.Errorf("abandoned sub frame = %v, want closed:true", f)
	}
}
