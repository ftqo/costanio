package server

import (
	"encoding/json"
	"io"
	"net/http"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/store"
)

// getReplay issues a replay GET with an optional If-None-Match, returning the
// status, the ETag the server offered, and the raw body (raw, to check that a
// 304 has no body).
func getReplay(t *testing.T, e *testEnv, id string, c *http.Cookie, inm string) (int, string, []byte) {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, e.ts.URL+"/api/games/"+id+"/replay", nil)
	if err != nil {
		t.Fatal(err)
	}
	if c != nil {
		req.AddCookie(c)
	}
	if inm != "" {
		req.Header.Set("If-None-Match", inm)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	return resp.StatusCode, resp.Header.Get("ETag"), body
}

// seedLeaked reports whether a replay body carries the game seed (on the
// game_created event), which redaction strips for spectators.
func seedLeaked(t *testing.T, body []byte) bool {
	t.Helper()
	var out struct {
		Events []struct {
			Type string         `json:"type"`
			Data map[string]any `json:"data"`
		} `json:"events"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		t.Fatalf("decode replay body: %v", err)
	}
	if len(out.Events) == 0 {
		t.Fatal("replay body carried no events")
	}
	for _, ev := range out.Events {
		if ev.Type == "game_created" {
			if _, ok := ev.Data["seed"]; ok {
				return true
			}
		}
	}
	return false
}

// finishedSoloGame returns a terminal game with a log worth caching.
func finishedSoloGame(t *testing.T, e *testEnv, host *store.User) string {
	t.Helper()
	id := startActiveSolo(t, e, host)
	driveEvents(t, e, id, 150)
	if err := e.st.SetGameStatus(id, "finished"); err != nil {
		t.Fatal(err)
	}
	return id
}

// TestReplayETagRevalidates: a finished game's log never changes, so a second
// download should be a 304 with an empty body.
func TestReplayETagRevalidates(t *testing.T) {
	e := newEnv(t)
	host, hostC := e.discordUser(t, "d1", "host")
	id := finishedSoloGame(t, e, host)

	code, etag, body := getReplay(t, e, id, hostC, "")
	if code != http.StatusOK {
		t.Fatalf("first replay = %d, want 200", code)
	}
	if etag == "" {
		t.Fatal("no ETag offered")
	}
	if len(body) == 0 {
		t.Fatal("first replay had an empty body")
	}

	code, _, again := getReplay(t, e, id, hostC, etag)
	if code != http.StatusNotModified {
		t.Fatalf("revalidated replay = %d, want 304", code)
	}
	if len(again) != 0 {
		t.Fatalf("304 carried %d bytes, want none", len(again))
	}

	// A validator the caller does not hold must still produce the real thing.
	if code, _, full := getReplay(t, e, id, hostC, `"r1-p-nonsense-0"`); code != http.StatusOK || len(full) == 0 {
		t.Fatalf("stale validator = %d with %d bytes, want 200 with the log", code, len(full))
	}
}

// TestReplayETagIsPerViewer: the same URL serves the raw log (seed and hidden
// plays) to someone who played and a redacted one to everybody else. A
// validator keyed on the game alone would let a spectator present a
// participant's ETag and get a 304, keeping a copy redaction should have
// stripped.
func TestReplayETagIsPerViewer(t *testing.T) {
	e := newEnv(t)
	host, hostC := e.discordUser(t, "d1", "host")
	_, outC := e.discordUser(t, "d2", "outsider")
	id := finishedSoloGame(t, e, host)

	_, playerTag, playerBody := getReplay(t, e, id, hostC, "")
	_, outTag, outBody := getReplay(t, e, id, outC, "")

	if playerTag == outTag {
		t.Fatalf("participant and spectator share the ETag %s", playerTag)
	}
	if !seedLeaked(t, playerBody) {
		t.Fatal("participant replay had no seed")
	}
	if seedLeaked(t, outBody) {
		t.Fatal("spectator replay leaked the seed outright")
	}

	// The spectator presenting the participant's validator gets the redacted log,
	// not a 304.
	code, _, body := getReplay(t, e, id, outC, playerTag)
	if code != http.StatusOK {
		t.Fatalf("spectator with a participant ETag = %d, want 200", code)
	}
	if seedLeaked(t, body) {
		t.Fatal("spectator got the unredacted log by presenting a participant's ETag")
	}
}

// TestReplay304NotMetered: revalidation comes before the event meter, so a
// caller over budget can still confirm a copy they hold. A 304 serves zero
// events.
func TestReplay304NotMetered(t *testing.T) {
	e := newEnv(t)
	host, hostC := e.discordUser(t, "d1", "host")
	id := finishedSoloGame(t, e, host)

	code, etag, _ := getReplay(t, e, id, hostC, "")
	if code != http.StatusOK {
		t.Fatalf("first replay = %d, want 200", code)
	}

	// No budget left at all: a fresh pull is refused.
	tightenLogLimits(e, 0, 0)
	if code, _, _ := getReplay(t, e, id, hostC, ""); code != http.StatusTooManyRequests {
		t.Fatalf("uncached replay on an empty budget = %d, want 429", code)
	}
	// The same caller revalidating still gets an answer.
	if code, _, body := getReplay(t, e, id, hostC, etag); code != http.StatusNotModified {
		t.Fatalf("revalidation on an empty budget = %d, want 304 (%d bytes)", code, len(body))
	}
}

// TestReplayRefusalCarriesNoValidator: only the replay itself may carry the
// replay's ETag. A 429 with it could be stored and later revalidated into a 304,
// turning the error body into the replay.
func TestReplayRefusalCarriesNoValidator(t *testing.T) {
	e := newEnv(t)
	host, hostC := e.discordUser(t, "d1", "host")
	_, outC := e.discordUser(t, "d2", "outsider")
	id := finishedSoloGame(t, e, host)

	tightenLogLimits(e, 0, 0)
	code, etag, _ := getReplay(t, e, id, hostC, "")
	if code != http.StatusTooManyRequests {
		t.Fatalf("replay on an empty budget = %d, want 429", code)
	}
	if etag != "" {
		t.Errorf("429 advertised ETag %s, want none", etag)
	}

	// Same for the access refusal on a private game.
	priv, err := e.srv.lobby.Create(host, engine.GameConfig{Players: 3}, true)
	if err != nil {
		t.Fatal(err)
	}
	if err := e.st.SetGameStatus(priv.Game.ID, "finished"); err != nil {
		t.Fatal(err)
	}
	code, etag, _ = getReplay(t, e, priv.Game.ID, outC, "")
	if code != http.StatusForbidden {
		t.Fatalf("outsider on a private replay = %d, want 403", code)
	}
	if etag != "" {
		t.Errorf("403 advertised ETag %s", etag)
	}
}

func TestIfNoneMatch(t *testing.T) {
	const tag = `"r1-p-abc-42"`
	cases := []struct {
		name   string
		header string
		want   bool
	}{
		{"empty", "", false},
		{"exact", `"r1-p-abc-42"`, true},
		{"wildcard", "*", true},
		{"different game", `"r1-p-xyz-42"`, false},
		{"different viewer", `"r1-s-abc-42"`, false},
		{"different length", `"r1-p-abc-41"`, false},
		{"different version", `"r2-p-abc-42"`, false},
		{"in a list", `"other", "r1-p-abc-42"`, true},
		{"list without it", `"other", "another"`, false},
		{"weak on the wire", `W/"r1-p-abc-42"`, true},
		{"unquoted", `r1-p-abc-42`, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := ifNoneMatch(c.header, tag); got != c.want {
				t.Errorf("ifNoneMatch(%q, %q) = %v, want %v", c.header, tag, got, c.want)
			}
		})
	}
}

// TestReplayETagTracksLogLength: the validator doesn't rely on the status gate
// freezing the log. An append changes the ETag.
func TestReplayETagTracksLogLength(t *testing.T) {
	if a, b := replayETag("g", true, 10), replayETag("g", true, 11); a == b {
		t.Fatalf("ETag unchanged across a log append: %s", a)
	}
	if a, b := replayETag("g", true, 10), replayETag("g", false, 10); a == b {
		t.Fatalf("ETag unchanged across viewer class: %s", a)
	}
	if a, b := replayETag("g1", true, 10), replayETag("g2", true, 10); a == b {
		t.Fatalf("ETag unchanged across games: %s", a)
	}
}
