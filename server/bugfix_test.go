package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/store"
)

// finishedGameWithSeed creates a finished game owned by host, with one non-host
// participant, seeds a hidden game_created event (with a seed) and a hidden
// card_stolen event so we can assert reveal for participants / redaction for
// spectators. invite="" makes it a public game (open to spectators).
func finishedGameWithSeed(t *testing.T, e *testEnv, host, member *store.User, invite string) string {
	t.Helper()
	id := fmt.Sprintf("g-%d", host.ID)
	g := &store.Game{ID: id, Ruleset: "base", Config: json.RawMessage(`{"players":2}`),
		InviteCode: invite, Public: invite == "", CreatedBy: host.ID}
	if err := e.st.CreateGame(g); err != nil {
		t.Fatal(err)
	}
	if err := e.st.AddSeat(id, 0, host.ID); err != nil {
		t.Fatal(err)
	}
	if err := e.st.AddSeat(id, 1, member.ID); err != nil {
		t.Fatal(err)
	}
	// game_created carries the seed; Visible=[] means hidden from everyone.
	created, _ := json.Marshal(engine.GameCreatedData{
		Config: engine.GameConfig{}, Seed: 0xdeadbeef, SeedCommit: "commit"})
	stolen, _ := json.Marshal(map[string]any{"thief": 0, "victim": 1, "res": "wool"})
	evs := []engine.Event{
		{Seq: 0, Type: engine.EvGameCreated, Data: created, Visible: []engine.PlayerID{}},
		{Seq: 1, Type: engine.EvCardStolen, Data: stolen, Visible: []engine.PlayerID{0, 1}},
	}
	if err := e.st.AppendEvents(id, evs); err != nil {
		t.Fatal(err)
	}
	if err := e.st.FinishGame(id, host.ID); err != nil {
		t.Fatal(err)
	}
	return id
}

// Replay must require auth.
func TestReplayRequiresAuth(t *testing.T) {
	e := newEnv(t)
	host, _ := e.discordUser(t, "d1", "host")
	member, _ := e.discordUser(t, "d2", "member")
	id := finishedGameWithSeed(t, e, host, member, "secretcode")

	resp, _ := e.req(t, "GET", "/api/games/"+id+"/replay", nil, nil)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("unauth replay = %d, want 401", resp.StatusCode)
	}
}

// A non-participant of a private (had-invite) game cannot pull the log.
func TestReplayPrivateRejectsNonParticipant(t *testing.T) {
	e := newEnv(t)
	host, _ := e.discordUser(t, "d1", "host")
	member, _ := e.discordUser(t, "d2", "member")
	_, strangerC := e.discordUser(t, "d3", "stranger")
	id := finishedGameWithSeed(t, e, host, member, "secretcode")

	resp, _ := e.req(t, "GET", "/api/games/"+id+"/replay", strangerC, nil)
	if resp.StatusCode != http.StatusForbidden {
		t.Errorf("stranger replay = %d, want 403", resp.StatusCode)
	}
}

// A participant gets the full unredacted log post-game: the seed is
// revealed so they can verify dice fairness (documented transparency).
func TestReplayParticipantSeesFullLog(t *testing.T) {
	e := newEnv(t)
	host, hostC := e.discordUser(t, "d1", "host")
	member, _ := e.discordUser(t, "d2", "member")
	id := finishedGameWithSeed(t, e, host, member, "secretcode")

	resp, out := e.req(t, "GET", "/api/games/"+id+"/replay", hostC, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("host replay = %d: %v", resp.StatusCode, out)
	}
	raw, _ := json.Marshal(out["events"])
	if !bytes.Contains(raw, []byte("3735928559")) { // 0xdeadbeef revealed to a participant
		t.Errorf("seed not revealed to participant: %s", raw)
	}
	if events, ok := out["events"].([]any); !ok || len(events) != 2 {
		t.Errorf("replay events = %v, want 2", out["events"])
	}
}

// A replay needs the game to have stopped, not to have ended well. Abandoned
// games (reset to a lobby, so the log is all that remains) and paused-error
// ones (where the log is the bug report) must be readable.
func TestReplayCoversEveryTerminalStatus(t *testing.T) {
	for _, status := range []string{"finished", "abandoned", "paused-error"} {
		t.Run(status, func(t *testing.T) {
			e := newEnv(t)
			host, hostC := e.discordUser(t, "d1", "host")
			member, _ := e.discordUser(t, "d2", "member")
			id := finishedGameWithSeed(t, e, host, member, "")
			if err := e.st.SetGameStatus(id, status); err != nil {
				t.Fatal(err)
			}
			resp, out := e.req(t, "GET", "/api/games/"+id+"/replay", hostC, nil)
			if resp.StatusCode != http.StatusOK {
				t.Fatalf("%s replay = %d: %v", status, resp.StatusCode, out)
			}
			// Still the participant's full log with the seed: the rule turns on the
			// game being over, not on how it ended.
			raw, _ := json.Marshal(out["events"])
			if !bytes.Contains(raw, []byte("3735928559")) {
				t.Errorf("%s: seed not revealed to participant: %s", status, raw)
			}
		})
	}
}

// A game still in progress is still refused: its log is served by
// GET /api/games/{id}, which knows how to redact for a viewer who is mid-game.
func TestReplayStillRefusesALiveGame(t *testing.T) {
	e := newEnv(t)
	host, hostC := e.discordUser(t, "d1", "host")
	member, _ := e.discordUser(t, "d2", "member")
	id := finishedGameWithSeed(t, e, host, member, "")
	for _, status := range []string{"lobby", "active"} {
		if err := e.st.SetGameStatus(id, status); err != nil {
			t.Fatal(err)
		}
		resp, _ := e.req(t, "GET", "/api/games/"+id+"/replay", hostC, nil)
		if resp.StatusCode != http.StatusConflict {
			t.Errorf("%s replay = %d, want 409", status, resp.StatusCode)
		}
	}
}

// A non-participant of a public finished game gets a redacted log (no seed,
// no other players' hidden cards) but is not blocked.
func TestReplayPublicSpectatorRedacted(t *testing.T) {
	e := newEnv(t)
	host, _ := e.discordUser(t, "d1", "host")
	member, _ := e.discordUser(t, "d2", "member")
	_, strangerC := e.discordUser(t, "d3", "stranger")
	id := finishedGameWithSeed(t, e, host, member, "") // public game

	resp, out := e.req(t, "GET", "/api/games/"+id+"/replay", strangerC, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("spectator replay = %d: %v", resp.StatusCode, out)
	}
	raw, _ := json.Marshal(out["events"])
	if bytes.Contains(raw, []byte("deadbeef")) || bytes.Contains(raw, []byte("3735928559")) {
		t.Errorf("seed leaked to spectator: %s", raw)
	}
	if events, ok := out["events"].([]any); !ok || len(events) != 2 {
		t.Errorf("replay events = %v, want 2", out["events"])
	}
}

// A non-participant fetching a private game's summary must not see seats.
func TestGetGamePrivateHidesMetadata(t *testing.T) {
	e := newEnv(t)
	_, hostC := e.discordUser(t, "d1", "host")
	_, strangerC := e.discordUser(t, "d2", "stranger")

	_, created := e.req(t, "POST", "/api/games", hostC, map[string]any{
		"config": map[string]any{"players": 3}, "private": true,
	})
	id := created["game"].(map[string]any)["id"].(string)

	resp, out := e.req(t, "GET", "/api/games/"+id, strangerC, nil)
	if resp.StatusCode != http.StatusForbidden {
		t.Errorf("stranger get private = %d, want 403: %v", resp.StatusCode, out)
	}
	if out["seats"] != nil || out["game"] != nil {
		t.Errorf("private metadata leaked to non-participant: %v", out)
	}
}

// A guest may only read a game they're seated in. Public tables are part of the
// registered-users-only surface, so an unseated guest gets 403 (registered users
// still read public tables fine).
func TestGetGamePublicHiddenFromUnseatedGuest(t *testing.T) {
	e := newEnv(t)
	_, hostC := e.discordUser(t, "d1", "host")
	_, strangerC := e.discordUser(t, "d2", "stranger")
	_, guestC := e.guest(t, "guesty")

	_, created := e.req(t, "POST", "/api/games", hostC, map[string]any{
		"config": map[string]any{"players": 3}, "private": false,
	})
	id := created["game"].(map[string]any)["id"].(string)

	if resp, out := e.req(t, "GET", "/api/games/"+id, strangerC, nil); resp.StatusCode != http.StatusOK {
		t.Errorf("registered stranger get public = %d, want 200: %v", resp.StatusCode, out)
	}
	resp, out := e.req(t, "GET", "/api/games/"+id, guestC, nil)
	if resp.StatusCode != http.StatusForbidden {
		t.Errorf("unseated guest get public = %d, want 403: %v", resp.StatusCode, out)
	}
}

// An oversized JSON body is rejected (MaxBytesReader caps it).
func TestCreateGameBodyTooLarge(t *testing.T) {
	e := newEnv(t)
	_, hostC := e.discordUser(t, "d1", "host")

	big := strings.Repeat("a", 128<<10)
	body := map[string]any{"config": map[string]any{"players": 3}, "junk": big}
	resp, _ := e.req(t, "POST", "/api/games", hostC, body)
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("oversized create = %d, want 400", resp.StatusCode)
	}
}

// Overflowing the keyed limiter must not wipe existing buckets (rate
// limiting must stay enforced for an already-throttled, recently-active key).
func TestKeyedLimiterEvictsWithoutWipe(t *testing.T) {
	l := newKeyedLimiter(0, 1) // burst 1, no refill: 2nd call for a key fails.

	// Fill the map past the cap with stale buckets (backdated so they are
	// idle past the TTL and thus evictable).
	stale := time.Now().Add(-2 * limiterIdleTTL)
	for i := range maxLimiterKeys + 50 {
		b := newTokenBucket(l.rate, l.burst)
		b.last = stale
		l.buckets[fmt.Sprintf("flood-%d", i)] = b
	}

	// The victim is throttled and recently active (not stale).
	victim := "victim"
	if !l.allow(victim) {
		t.Fatal("first call should pass")
	}
	if l.allow(victim) {
		t.Fatal("second call should be throttled")
	}

	// A fresh key triggers eviction of the stale flood, shrinking the map...
	l.allow("trigger")
	if len(l.buckets) > maxLimiterKeys {
		t.Errorf("map not pruned after overflow: %d buckets", len(l.buckets))
	}
	// ...but the recently-active victim must survive (still throttled).
	if l.allow(victim) {
		t.Error("victim bucket was wiped by overflow eviction")
	}
}

// In production, the WS upgrade must reject http:// for the same host
// (downgrade) while accepting the configured https origin; dev keeps http.
func TestCheckOriginProductionRejectsHTTP(t *testing.T) {
	e := newEnv(t)
	// Production posture: Secure cookies + configured base URL.
	e.srv.auth.Secure = true
	e.srv.auth.Config.BaseURL = "https://costan.example"

	mk := func(origin, host string) *http.Request {
		r, _ := http.NewRequest(http.MethodGet, "http://"+host+"/ws", nil)
		r.Host = host
		if origin != "" {
			r.Header.Set("Origin", origin)
		}
		return r
	}

	if e.srv.checkOrigin(mk("http://costan.example", "costan.example")) {
		t.Error("production accepted http:// origin (downgrade)")
	}
	if !e.srv.checkOrigin(mk("https://costan.example", "costan.example")) {
		t.Error("production rejected the configured https origin")
	}
	if e.srv.checkOrigin(mk("https://evil.example", "costan.example")) {
		t.Error("production accepted a foreign origin")
	}

	// Dev posture: http for the same host is fine (localhost workflow).
	e.srv.auth.Secure = false
	e.srv.auth.Config.BaseURL = ""
	if !e.srv.checkOrigin(mk("http://localhost:8080", "localhost:8080")) {
		t.Error("dev rejected http://localhost")
	}
}

// A connection whose client vanishes must be dropped from the hub promptly.
// writePump tears the socket down on a write error via closeWS, which unblocks
// readPump and runs the hub cleanup.
func TestConnTorndownWhenClientGone(t *testing.T) {
	e := newEnv(t)
	_, c := e.discordUser(t, "d1", "user")

	ws := dialWS(t, e.ts, c)
	waitFor(t, func() bool { return onlineAny(e.srv.hub) }, "conn registered")

	_ = ws.conn.CloseNow()
	waitFor(t, func() bool { return !onlineAny(e.srv.hub) }, "hub to drop the conn")
}

// closeOnce makes teardown idempotent, so both pumps (the write-error path and
// close()) can call it.
func TestCloseWSIdempotent(t *testing.T) {
	c := &Conn{}
	n := 0
	closeFn := func() { n++ }
	c.closeOnce.Do(closeFn)
	c.closeOnce.Do(closeFn)
	c.closeOnce.Do(closeFn)
	if n != 1 {
		t.Errorf("closeOnce ran %d times, want 1", n)
	}
}

// onlineAny reports whether the hub holds any live connection.
func onlineAny(h *Hub) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	return len(h.conns) > 0
}
