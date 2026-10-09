package server

import (
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/store"
)

// tightenLogLimits swaps in log limiters with the given budget so a test can
// exhaust one in a few requests. Units are events, as in production.
func tightenLogLimits(e *testEnv, rate, burst float64) {
	e.srv.logLimit = newKeyedLimiter(rate, burst)
	e.srv.logIPLimit = newKeyedLimiter(rate, burst)
}

// rewindBuckets ages every bucket in a limiter by d, standing in for real
// refill time.
func rewindBuckets(l *keyedLimiter, d time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	for _, b := range l.buckets {
		b.mu.Lock()
		b.last = b.last.Add(-d)
		b.mu.Unlock()
	}
}

// startActivePair creates and starts a public 3-player game with two seated
// humans (host + guest) and one bot, so a test can tell "seated" apart from
// "host" when checking who the limiter exempts.
func startActivePair(t *testing.T, e *testEnv, host, other *store.User) string {
	t.Helper()
	sum, err := e.srv.lobby.Create(host, engine.GameConfig{Players: 3}, false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.srv.lobby.Join(other, sum.Game.ID, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := e.srv.lobby.AddBot(host, sum.Game.ID); err != nil {
		t.Fatal(err)
	}
	if err := e.srv.lobby.Start(host, sum.Game.ID); err != nil {
		t.Fatal(err)
	}
	return sum.Game.ID
}

// driveEvents plays the game forward with the engine's auto-command until the
// log holds at least `want` events (or the game ends), so the cost tests run
// against a realistically sized log.
func driveEvents(t *testing.T, e *testEnv, id string, want int) int {
	t.Helper()
	a, err := e.srv.mgr.Get(id)
	if err != nil {
		t.Fatal(err)
	}
	for range 5000 {
		events, err := e.st.LoadEvents(id, 0)
		if err != nil {
			t.Fatal(err)
		}
		if len(events) >= want {
			return len(events)
		}
		st, err := engine.Replay(events)
		if err != nil {
			t.Fatal(err)
		}
		cmd, ok := engine.AutoCommand(st)
		if !ok {
			break
		}
		if err := a.Do(cmd); err != nil {
			break
		}
	}
	n, err := e.st.LoadEvents(id, 0)
	if err != nil {
		t.Fatal(err)
	}
	return len(n)
}

// getGameStatus is a status-only GET, for loops that only care whether the
// request was served or throttled.
func getGameStatus(t *testing.T, e *testEnv, path string, c *http.Cookie) (int, map[string]any) {
	t.Helper()
	resp, out := e.req(t, "GET", path, c, nil)
	return resp.StatusCode, out
}

// TestGetGameLogLimitExemptsPlayersAtTheTable: people in the game are never
// throttled. A failed getGame sends the game screen back to the lobby, so a
// limit that reached a seated player could eject them on any refetch, or when
// a housemate on the same address used up the budget.
func TestGetGameLogLimitExemptsPlayersAtTheTable(t *testing.T) {
	e := newEnv(t)
	host, hostC := e.discordUser(t, "d1", "host")
	other, otherC := e.discordUser(t, "d2", "seated")
	id := startActivePair(t, e, host, other)

	// A budget so small that a single charged request would sink it.
	tightenLogLimits(e, 0, 1)

	for i := range 60 {
		for who, c := range map[string]*http.Cookie{"host": hostC, "seated": otherC} {
			code, out := getGameStatus(t, e, "/api/games/"+id, c)
			if code != http.StatusOK {
				t.Fatalf("%s request %d = %d, want 200 (participants are exempt)", who, i, code)
			}
			if out["log"] == nil {
				t.Fatalf("%s request %d served no log", who, i)
			}
		}
	}
}

// TestGetGameLogLimitThrottlesOutsider: a caller not in the game gets their
// cold load and is then cut off.
func TestGetGameLogLimitThrottlesOutsider(t *testing.T) {
	e := newEnv(t)
	host, _ := e.discordUser(t, "d1", "host")
	_, outC := e.discordUser(t, "d2", "outsider")
	id := startActiveSolo(t, e, host)
	tightenLogLimits(e, 0, 4)

	code, out := getGameStatus(t, e, "/api/games/"+id, outC)
	if code != http.StatusOK {
		t.Fatalf("first outsider fetch = %d, want 200", code)
	}
	if out["log"] == nil {
		t.Fatal("first outsider fetch served no log")
	}

	throttledAt := -1
	for i := 1; i < 20; i++ {
		code, out := getGameStatus(t, e, "/api/games/"+id, outC)
		if code == http.StatusTooManyRequests {
			throttledAt = i
			if out["code"] != "LOG_RATE_LIMITED" {
				t.Errorf("429 body code = %v, want LOG_RATE_LIMITED", out["code"])
			}
			// A refusal hands back nothing at all: no partial log, no view.
			if out["log"] != nil || out["view"] != nil {
				t.Errorf("throttled response leaked fields: %v", out)
			}
			break
		}
		if code != http.StatusOK {
			t.Fatalf("request %d = %d, want 200 or 429", i, code)
		}
	}
	if throttledAt < 0 {
		t.Fatal("outsider hammered the full log 20 times without ever being throttled")
	}
}

// TestGetGameLogLimitRecovers: once the bucket refills the same caller is served
// again, so retry-with-backoff is the right client response to a 429.
func TestGetGameLogLimitRecovers(t *testing.T) {
	e := newEnv(t)
	host, _ := e.discordUser(t, "d1", "host")
	_, outC := e.discordUser(t, "d2", "outsider")
	id := startActiveSolo(t, e, host)
	tightenLogLimits(e, 10, 20) // 20 events of burst, 10 events/sec back

	hitLimit := false
	for range 60 {
		if code, _ := getGameStatus(t, e, "/api/games/"+id, outC); code == http.StatusTooManyRequests {
			hitLimit = true
			break
		}
	}
	if !hitLimit {
		t.Fatal("never reached the limit")
	}

	// Still throttled a moment later; the refill has to actually happen.
	if code, _ := getGameStatus(t, e, "/api/games/"+id, outC); code != http.StatusTooManyRequests {
		t.Fatalf("immediately after the limit = %d, want 429", code)
	}

	rewindBuckets(e.srv.logLimit, time.Minute)
	rewindBuckets(e.srv.logIPLimit, time.Minute)
	if code, out := getGameStatus(t, e, "/api/games/"+id, outC); code != http.StatusOK {
		t.Fatalf("after the bucket refilled = %d, want 200 (%v)", code, out)
	}
}

// TestGetGameLogCostScalesWithEvents: the meter is events, not
// requests, so a reconnect (`?since=<first missing seq>`, a few events) is
// nearly free while repeatedly pulling the whole game is not.
func TestGetGameLogCostScalesWithEvents(t *testing.T) {
	e := newEnv(t)
	host, _ := e.discordUser(t, "d1", "host")
	_, outC := e.discordUser(t, "d2", "outsider")
	id := startActiveSolo(t, e, host)
	total := driveEvents(t, e, id, 150)
	if total < 100 {
		t.Fatalf("only drove the log to %d events", total)
	}

	const budget = 600
	count := func(path string) int {
		tightenLogLimits(e, 0, budget) // no refill: count what one budget buys
		served := 0
		for range 300 {
			if code, _ := getGameStatus(t, e, path, outC); code != http.StatusOK {
				break
			}
			served++
		}
		return served
	}

	full := count("/api/games/" + id)
	gap := count(fmt.Sprintf("/api/games/%s?since=%d", id, total+1000))
	if full == 0 {
		t.Fatal("first full pull was refused")
	}
	if gap <= full*4 {
		t.Fatalf("gap refetches allowed %d vs %d full pulls, want more than 4x", gap, full)
	}
}

// TestGetGameJunkCursorCostsLikeTheFullLog: junk `?since=` falls back to the
// whole log, so it must be billed like the whole log. Billing what was served,
// not the cursor sent, is what makes that work.
func TestGetGameJunkCursorCostsLikeTheFullLog(t *testing.T) {
	e := newEnv(t)
	host, _ := e.discordUser(t, "d1", "host")
	_, outC := e.discordUser(t, "d2", "outsider")
	id := startActiveSolo(t, e, host)
	total := driveEvents(t, e, id, 150)

	for _, q := range []string{"?since=abc", "?since=-5", "?since=", "?since=99999999999999999999"} {
		tightenLogLimits(e, 0, float64(total)/2)
		code, out := getGameStatus(t, e, "/api/games/"+id+q, outC)
		if code != http.StatusOK {
			t.Fatalf("%q = %d, want 200 (a junk cursor is answered, not rejected)", q, code)
		}
		seqs := logSeqs(t, out)
		if len(seqs) == 0 || seqs[0] != 0 {
			t.Fatalf("%q did not fall back to the whole log: %v", q, seqs[:min(len(seqs), 3)])
		}
		// Serving the whole log on half a log's budget must leave the caller
		// overdrawn.
		if code, _ := getGameStatus(t, e, "/api/games/"+id+q, outC); code != http.StatusTooManyRequests {
			t.Fatalf("%q was billed as cheap: follow-up = %d, want 429", q, code)
		}
	}
}

// TestGetGameThrottlingNeverWidensRedaction: whatever the limiter does, an
// outsider's log stays the spectator view.
func TestGetGameThrottlingNeverWidensRedaction(t *testing.T) {
	e := newEnv(t)
	host, _ := e.discordUser(t, "d1", "host")
	_, outC := e.discordUser(t, "d2", "outsider")
	id := startActiveSolo(t, e, host)
	tightenLogLimits(e, 0, 2)

	for i := range 10 {
		code, out := getGameStatus(t, e, "/api/games/"+id, outC)
		if code == http.StatusTooManyRequests {
			if out["log"] != nil {
				t.Fatalf("throttled response %d carried a log", i)
			}
			continue
		}
		for _, raw := range out["log"].([]any) {
			ev := raw.(map[string]any)
			data, _ := ev["data"].(map[string]any)
			if ev["type"] == "game_created" {
				if _, leaked := data["seed"]; leaked {
					t.Fatalf("outsider received the hidden seed: %v", data)
				}
			}
		}
	}
}

// TestReplayLogLimit: /replay gets the same meter, and unlike the live-game read
// it meters everyone. The game is over, so a 429 only delays a replay; there is
// no seat to be ejected from.
func TestReplayLogLimit(t *testing.T) {
	e := newEnv(t)
	host, hostC := e.discordUser(t, "d1", "host")
	_, outC := e.discordUser(t, "d2", "outsider")
	id := startActiveSolo(t, e, host)
	driveEvents(t, e, id, 150)
	// Replays are only served for a finished game.
	if err := e.st.SetGameStatus(id, "finished"); err != nil {
		t.Fatal(err)
	}
	// Per-user budget tiny, per-IP backstop roomy. Both callers share the
	// loopback address, so a small IP bucket would make the outsider's 429
	// below prove nothing about the per-user meter.
	e.srv.logLimit = newKeyedLimiter(0, 50)
	e.srv.logIPLimit = newKeyedLimiter(0, 100000)

	// A player pays for their own replay too. The first pull lands (the
	// charge is settled after serving); the next is refused because the log
	// cost more than the whole budget.
	if code, _ := getGameStatus(t, e, "/api/games/"+id+"/replay", hostC); code != http.StatusOK {
		t.Fatalf("first participant replay = %d, want 200", code)
	}
	if code, out := getGameStatus(t, e, "/api/games/"+id+"/replay", hostC); code != http.StatusTooManyRequests {
		t.Fatalf("second participant replay = %d, want 429 (%v)", code, out)
	}

	if code, _ := getGameStatus(t, e, "/api/games/"+id+"/replay", outC); code != http.StatusOK {
		t.Fatalf("first outsider replay = %d, want 200", code)
	}
	if code, out := getGameStatus(t, e, "/api/games/"+id+"/replay", outC); code != http.StatusTooManyRequests {
		t.Fatalf("second outsider replay = %d, want 429 (%v)", code, out)
	}
}

// TestReplayLimitDoesNotEvictFromLiveGame: spending the whole event budget on
// replays leaves the player's own live table readable, because getGame never
// meters someone seated at it.
func TestReplayLimitDoesNotEvictFromLiveGame(t *testing.T) {
	e := newEnv(t)
	host, hostC := e.discordUser(t, "d1", "host")

	// A finished game to burn the budget on, and a live one to still be let into.
	done := startActiveSolo(t, e, host)
	driveEvents(t, e, done, 150)
	if err := e.st.SetGameStatus(done, "finished"); err != nil {
		t.Fatal(err)
	}
	live := startActiveSolo(t, e, host)
	driveEvents(t, e, live, 20)

	tightenLogLimits(e, 0, 50)

	// Burn it: the first replay lands, the second is refused.
	getGameStatus(t, e, "/api/games/"+done+"/replay", hostC)
	if code, _ := getGameStatus(t, e, "/api/games/"+done+"/replay", hostC); code != http.StatusTooManyRequests {
		t.Fatalf("replay budget not spent (= %d)", code)
	}

	// The live table they are seated at is still theirs, meter or no meter.
	if code, out := getGameStatus(t, e, "/api/games/"+live, hostC); code != http.StatusOK {
		t.Fatalf("own live game = %d, want 200 (%v)", code, out)
	}
}

// TestLogLimitPerUserNotShared: two people behind one address (a household, a
// campus, a Discord Activity) get two budgets.
func TestLogLimitPerUserNotShared(t *testing.T) {
	e := newEnv(t)
	host, _ := e.discordUser(t, "d1", "host")
	_, aC := e.discordUser(t, "d2", "watcher-a")
	_, bC := e.discordUser(t, "d3", "watcher-b")
	id := startActiveSolo(t, e, host)
	// Per-user budget tiny, per-IP budget roomy: the two callers share the test
	// server's loopback address, so anything they can both do is per-user.
	e.srv.logLimit = newKeyedLimiter(0, 4)
	e.srv.logIPLimit = newKeyedLimiter(0, 1000)

	for range 4 {
		if code, _ := getGameStatus(t, e, "/api/games/"+id, aC); code != http.StatusOK {
			break
		}
	}
	if code, _ := getGameStatus(t, e, "/api/games/"+id, aC); code != http.StatusTooManyRequests {
		t.Fatalf("watcher A = %d, want 429 after spending their budget", code)
	}
	if code, _ := getGameStatus(t, e, "/api/games/"+id, bC); code != http.StatusOK {
		t.Fatalf("watcher B = %d, want 200", code)
	}
}
