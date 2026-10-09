package server

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/sim"
	"github.com/ftqo/costan.io/store"
)

// A real log: frames go through the engine, so they need a game the engine
// played (finishedGameWithSeed's synthetic events are enough for the log
// endpoints, not for this). Played in its own in-memory store and copied into
// this env's, so the test still controls host, seats and privacy.
func finishedRealGame(t *testing.T, e *testEnv, host, member *store.User, invite string) string {
	t.Helper()
	src, err := store.OpenMem()
	if err != nil {
		t.Fatal(err)
	}
	defer src.Close()
	res, err := sim.RunGame(src, sim.Options{Players: 2, Ruleset: "base", Seed: 4242})
	if err != nil {
		t.Fatal(err)
	}
	events, err := src.LoadEvents(res.GameID, 0)
	if err != nil {
		t.Fatal(err)
	}

	id := fmt.Sprintf("real-%d", host.ID)
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
	if err := e.st.AppendEvents(id, events); err != nil {
		t.Fatal(err)
	}
	if err := e.st.FinishGame(id, host.ID); err != nil {
		t.Fatal(err)
	}
	return id
}

// getFrames issues a frames GET, optionally asking for gzip, and returns the
// status and the decoded body whichever encoding came back.
func getFrames(t *testing.T, e *testEnv, path string, c *http.Cookie, gzipOK bool) (int, map[string]any, *http.Response) {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, e.ts.URL+path, nil)
	if err != nil {
		t.Fatal(err)
	}
	if c != nil {
		req.AddCookie(c)
	}
	// Go's transport adds gzip and decompresses transparently unless the header
	// is set by hand, which lets the test see the raw bytes.
	if gzipOK {
		req.Header.Set("Accept-Encoding", "gzip")
	} else {
		req.Header.Set("Accept-Encoding", "identity")
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	if resp.StatusCode != http.StatusOK {
		return resp.StatusCode, nil, resp
	}
	var r io.Reader = resp.Body
	if resp.Header.Get("Content-Encoding") == "gzip" {
		zr, err := gzip.NewReader(resp.Body)
		if err != nil {
			t.Fatalf("gzip reader: %v", err)
		}
		defer zr.Close()
		r = zr
	}
	var out map[string]any
	if err := json.NewDecoder(r).Decode(&out); err != nil {
		t.Fatalf("decode frames: %v", err)
	}
	return resp.StatusCode, out, resp
}

func framesOf(t *testing.T, body map[string]any) []any {
	t.Helper()
	frames, ok := body["frames"].([]any)
	if !ok {
		t.Fatalf("body has no frames array: %v", body)
	}
	return frames
}

func TestFramesServesAWatchableGame(t *testing.T) {
	e := newEnv(t)
	host, hostC := e.discordUser(t, "d1", "host")
	member, _ := e.discordUser(t, "d2", "member")
	id := finishedRealGame(t, e, host, member, "")

	code, body, _ := getFrames(t, e, "/api/games/"+id+"/frames", hostC, false)
	if code != http.StatusOK {
		t.Fatalf("frames = %d, want 200", code)
	}
	frames := framesOf(t, body)
	if len(frames) < 10 {
		t.Fatalf("only %d frames", len(frames))
	}
	// Every frame carries a board: the client only selects views, never
	// computes one.
	for i, f := range frames {
		if _, ok := f.(map[string]any)["view"].(map[string]any); !ok {
			t.Fatalf("frame %d has no view", i)
		}
	}
	meta, ok := body["meta"].(map[string]any)
	if !ok {
		t.Fatal("no meta")
	}
	if meta["ruleset"] != "base" {
		t.Errorf("meta ruleset = %v, want base", meta["ruleset"])
	}
}

// The frames endpoint must hold the seed line exactly where the log endpoint
// does: a player who sat at the table may see the seed, a stranger may not.
func TestFramesRevealTheSeedOnlyToPlayers(t *testing.T) {
	e := newEnv(t)
	host, hostC := e.discordUser(t, "d1", "host")
	member, _ := e.discordUser(t, "d2", "member")
	_, strangerC := e.discordUser(t, "d3", "stranger")
	id := finishedRealGame(t, e, host, member, "")

	_, mine, _ := getFrames(t, e, "/api/games/"+id+"/frames", hostC, false)
	_, theirs, _ := getFrames(t, e, "/api/games/"+id+"/frames", strangerC, false)

	if seed := mine["meta"].(map[string]any)["seed"]; seed == nil {
		t.Error("a player's own replay does not carry the seed")
	}
	if seed := theirs["meta"].(map[string]any)["seed"]; seed != nil {
		t.Errorf("a stranger's replay leaked the seed: %v", seed)
	}
	// The events inside the frames follow the same rule. Search the whole
	// marshalled body: the seed must not appear anywhere.
	raw, _ := json.Marshal(theirs)
	if bytes.Contains(raw, []byte(`"seed"`)) {
		t.Error("a stranger's frames carry a seed field somewhere in them")
	}
}

func TestFramesGateMatchesTheLogGate(t *testing.T) {
	e := newEnv(t)
	host, _ := e.discordUser(t, "d1", "host")
	member, _ := e.discordUser(t, "d2", "member")
	_, strangerC := e.discordUser(t, "d3", "stranger")

	t.Run("private game is closed to outsiders", func(t *testing.T) {
		id := finishedRealGame(t, e, host, member, "secretcode")
		code, _, _ := getFrames(t, e, "/api/games/"+id+"/frames", strangerC, false)
		if code != http.StatusForbidden {
			t.Errorf("outsider on a private replay = %d, want 403", code)
		}
	})

	t.Run("auth is required", func(t *testing.T) {
		code, _, _ := getFrames(t, e, "/api/games/anything/frames", nil, false)
		if code != http.StatusUnauthorized {
			t.Errorf("anonymous = %d, want 401", code)
		}
	})
}

func TestFramesRefuseAGameStillBeingPlayed(t *testing.T) {
	e := newEnv(t)
	host, hostC := e.discordUser(t, "d1", "host")
	id := "live-1"
	g := &store.Game{ID: id, Ruleset: "base", Config: json.RawMessage(`{"players":2}`), CreatedBy: host.ID}
	if err := e.st.CreateGame(g); err != nil {
		t.Fatal(err)
	}
	code, _, _ := getFrames(t, e, "/api/games/"+id+"/frames", hostC, false)
	if code != http.StatusConflict {
		t.Errorf("frames of a live game = %d, want 409", code)
	}
}

// A folded game is a whole board per event, megabytes of near-identical
// JSON, so this endpoint has to compress.
func TestFramesCompressWhenAsked(t *testing.T) {
	e := newEnv(t)
	host, hostC := e.discordUser(t, "d1", "host")
	member, _ := e.discordUser(t, "d2", "member")
	id := finishedRealGame(t, e, host, member, "")

	_, plainBody, plain := getFrames(t, e, "/api/games/"+id+"/frames", hostC, false)
	if enc := plain.Header.Get("Content-Encoding"); enc != "" {
		t.Errorf("a client that did not ask got %q", enc)
	}
	_, zipBody, zipped := getFrames(t, e, "/api/games/"+id+"/frames", hostC, true)
	if enc := zipped.Header.Get("Content-Encoding"); enc != "gzip" {
		t.Fatalf("Content-Encoding = %q, want gzip", enc)
	}
	if v := zipped.Header.Get("Vary"); v == "" {
		t.Error("compressed reply missing Vary: Accept-Encoding")
	}
	// Same answer either way.
	if len(framesOf(t, plainBody)) != len(framesOf(t, zipBody)) {
		t.Error("the compressed reply is not the same replay")
	}
}

// Revalidation is keyed per viewer: two seats get different answers at one
// URL, so one seat's validator must not match another's copy.
func TestFramesValidatorIsPerViewer(t *testing.T) {
	e := newEnv(t)
	host, hostC := e.discordUser(t, "d1", "host")
	member, _ := e.discordUser(t, "d2", "member")
	_, strangerC := e.discordUser(t, "d3", "stranger")
	id := finishedRealGame(t, e, host, member, "")

	_, _, first := getFrames(t, e, "/api/games/"+id+"/frames", hostC, false)
	etag := first.Header.Get("ETag")
	if etag == "" {
		t.Fatal("frames carry no validator")
	}

	ask := func(c *http.Cookie) int {
		req, _ := http.NewRequest(http.MethodGet, e.ts.URL+"/api/games/"+id+"/frames", nil)
		req.AddCookie(c)
		req.Header.Set("If-None-Match", etag)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		return resp.StatusCode
	}
	if got := ask(hostC); got != http.StatusNotModified {
		t.Errorf("the same viewer revalidating = %d, want 304", got)
	}
	if got := ask(strangerC); got != http.StatusOK {
		t.Errorf("stranger with a player's validator = %d, want 200", got)
	}
}

// The upload path: a file the server has never seen, folded on request, so a
// downloaded replay can be watched.
func TestUploadedLogFolds(t *testing.T) {
	e := newEnv(t)
	_, c := e.guest(t, "watcher")

	src, err := store.OpenMem()
	if err != nil {
		t.Fatal(err)
	}
	defer src.Close()
	res, err := sim.RunGame(src, sim.Options{Players: 2, Ruleset: "base", Seed: 5150})
	if err != nil {
		t.Fatal(err)
	}
	events, err := src.LoadEvents(res.GameID, 0)
	if err != nil {
		t.Fatal(err)
	}

	// A guest: someone who has never played may still be sent a file, and the
	// page mints a guest session rather than demanding a login.
	resp, body := e.req(t, "POST", "/api/replay/frames", c, map[string]any{
		"game": res.GameID, "events": events,
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("upload = %d, want 200 (%v)", resp.StatusCode, body)
	}
	if got := len(framesOf(t, body)); got != len(events) {
		t.Errorf("frames = %d, want one per event (%d)", got, len(events))
	}
}

func TestUploadedGarbageRefused(t *testing.T) {
	e := newEnv(t)
	_, c := e.guest(t, "watcher")

	for _, tc := range []struct {
		name string
		body any
		want int
		code string
	}{
		{"not a replay at all", map[string]any{"hello": "world"}, http.StatusBadRequest, "REPLAY_FILE_INVALID"},
		{"no events", map[string]any{"game": "g", "events": []any{}}, http.StatusBadRequest, "REPLAY_FILE_INVALID"},
		{
			// Events, but not a game: the log doesn't open with one. The
			// engine would fold it to an empty ocean, so we refuse it, with
			// an error distinct from "that is not JSON".
			"a list of events that is not a game",
			map[string]any{"game": "g", "events": []engine.Event{{Seq: 0, Type: engine.EvDiceRolled, Data: json.RawMessage(`{}`)}}},
			http.StatusUnprocessableEntity,
			"REPLAY_NOT_FOLDABLE",
		},
		{
			// A 110-byte body that would allocate 16 GB: one event passes the
			// body cap, non-empty check and event cap, and the seat count sizes
			// the state first. 100 seats rather than 1e8 so the test can't
			// allocate if the bound regresses.
			"a log claiming more seats than a game has",
			map[string]any{"game": "g", "events": []engine.Event{
				{Seq: 0, Type: engine.EvGameCreated, Data: json.RawMessage(`{"config":{"players":100}}`)},
			}},
			http.StatusUnprocessableEntity,
			"REPLAY_NOT_FOLDABLE",
		},
		{
			// A repeated module must not resolve; each spelling would take an
			// entry in a process-global cache.
			"a log whose ruleset repeats a module",
			map[string]any{"game": "g", "events": []engine.Event{
				{Seq: 0, Type: engine.EvGameCreated, Data: json.RawMessage(`{"config":{"players":2,"ruleset":"base+cak+cak"}}`)},
			}},
			http.StatusUnprocessableEntity,
			"REPLAY_NOT_FOLDABLE",
		},
		{
			// A truncated or hand-edited file: the engine refuses the first
			// event whose sequence does not follow.
			"a log that skips events",
			map[string]any{"game": "g", "events": []engine.Event{
				{Seq: 0, Type: engine.EvGameCreated, Data: json.RawMessage(`{"config":{"players":2}}`)},
				{Seq: 9, Type: engine.EvTurnStarted, Data: json.RawMessage(`{"player":0}`)},
			}},
			http.StatusUnprocessableEntity,
			"REPLAY_NOT_FOLDABLE",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			resp, body := e.req(t, "POST", "/api/replay/frames", c, tc.body)
			if resp.StatusCode != tc.want {
				t.Fatalf("status = %d, want %d (%v)", resp.StatusCode, tc.want, body)
			}
			if got := body["code"]; got != tc.code {
				t.Errorf("code = %v, want %v", got, tc.code)
			}
		})
	}
}

func TestUploadRequiresAuth(t *testing.T) {
	e := newEnv(t)
	resp, _ := e.req(t, "POST", "/api/replay/frames", nil, map[string]any{"events": []any{}})
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("anonymous upload = %d, want 401", resp.StatusCode)
	}
}

// TestInviteUnlocksAFinishedPrivateGame: a Discord watch post carries `inv=`
// and is often clicked after the game ends. The invite admits its holder to the
// live game and post-game screen, so the "Watch replay" button there must work
// too.
func TestInviteUnlocksAFinishedPrivateGame(t *testing.T) {
	e := newEnv(t)
	host, _ := e.discordUser(t, "h", "host")
	member, _ := e.discordUser(t, "m", "member")
	_, watcher := e.discordUser(t, "w", "watcher")

	const invite = "wcode123"
	id := finishedRealGame(t, e, host, member, invite)

	for _, path := range []string{"/api/games/" + id + "/frames", "/api/games/" + id + "/replay"} {
		t.Run(path, func(t *testing.T) {
			// Without the code: still closed. This is the half that must not regress.
			if code, _, _ := getFrames(t, e, path, watcher, false); code != http.StatusForbidden {
				t.Errorf("no invite: got %d, want 403", code)
			}
			// A wrong code is no code.
			if code, _, _ := getFrames(t, e, path+"?inv=nope", watcher, false); code != http.StatusForbidden {
				t.Errorf("wrong invite: got %d, want 403", code)
			}
			// With it: the same door the socket already opened.
			if code, _, _ := getFrames(t, e, path+"?inv="+invite, watcher, false); code != http.StatusOK {
				t.Errorf("correct invite: got %d, want 200", code)
			}
		})
	}
}

// An invited spectator is still a spectator: the code grants access to the
// game, not to the hidden hands, so they get the redacted view. In
// particular the seed stays a participant's.
func TestInvitedSpectatorGetsTheRedactedReplay(t *testing.T) {
	e := newEnv(t)
	host, _ := e.discordUser(t, "h", "host")
	member, _ := e.discordUser(t, "m", "member")
	_, watcher := e.discordUser(t, "w", "watcher")

	const invite = "wcode123"
	id := finishedRealGame(t, e, host, member, invite)

	_, theirs, _ := getFrames(t, e, "/api/games/"+id+"/frames?inv="+invite, watcher, false)
	if seed := theirs["meta"].(map[string]any)["seed"]; seed != nil {
		t.Errorf("an invited spectator's replay leaked the seed: %v", seed)
	}
	raw, _ := json.Marshal(theirs)
	if bytes.Contains(raw, []byte(`"seed"`)) {
		t.Error("the seed appears somewhere in an invited spectator's frames")
	}
}
