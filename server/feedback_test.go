package server

import (
	"net/http"
	"strings"
	"testing"
)

func TestFeedbackStoresTrimmedMessageAndBarePath(t *testing.T) {
	e := newEnv(t)
	_, c := e.guest(t, "Ann")
	resp, _ := e.req(t, "POST", "/api/feedback", c, map[string]any{
		"msg":  "  the robber is hard to see  \n",
		"page": "/game/abc?invite=SECRET#top",
	})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("status %d, want 204", resp.StatusCode)
	}
	f, err := e.st.FeedbackByID(1)
	if err != nil {
		t.Fatal(err)
	}
	if f.Msg != "the robber is hard to see" {
		t.Errorf("msg %q, want it trimmed", f.Msg)
	}
	if f.Page != "/game/abc" {
		t.Errorf("page %q, want the bare path with no query or fragment", f.Page)
	}
}

func TestFeedbackRefusals(t *testing.T) {
	e := newEnv(t)
	_, c := e.guest(t, "Ann")

	if resp, _ := e.req(t, "POST", "/api/feedback", nil, map[string]any{"msg": "hi"}); resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("signed out: status %d, want 401", resp.StatusCode)
	}
	if resp, body := e.req(t, "POST", "/api/feedback", c, map[string]any{"msg": " \n\t "}); resp.StatusCode != http.StatusBadRequest || body["code"] != "FEEDBACK_REQUIRED" {
		t.Errorf("blank: status %d code %v, want 400 FEEDBACK_REQUIRED", resp.StatusCode, body["code"])
	}
	// The limit is in characters, not bytes: exactly the limit in a
	// multi-byte script is accepted, one more is not.
	if resp, _ := e.req(t, "POST", "/api/feedback", c, map[string]any{"msg": strings.Repeat("é", maxFeedbackLen)}); resp.StatusCode != http.StatusNoContent {
		t.Errorf("at the limit: status %d, want 204", resp.StatusCode)
	}
	resp, body := e.req(t, "POST", "/api/feedback", c, map[string]any{"msg": strings.Repeat("é", maxFeedbackLen+1)})
	if resp.StatusCode != http.StatusBadRequest || body["code"] != "FEEDBACK_TOO_LONG" {
		t.Fatalf("over the limit: status %d code %v, want 400 FEEDBACK_TOO_LONG", resp.StatusCode, body["code"])
	}
	if p, _ := body["params"].(map[string]any); p["max"] != float64(maxFeedbackLen) {
		t.Errorf("params %v, want max %d", body["params"], maxFeedbackLen)
	}
}

func TestFeedbackRateLimited(t *testing.T) {
	e := newEnv(t)
	_, c := e.guest(t, "Ann")
	var last *http.Response
	var body map[string]any
	for range 4 { // burst is 3
		last, body = e.req(t, "POST", "/api/feedback", c, map[string]any{"msg": "again"})
	}
	if last.StatusCode != http.StatusTooManyRequests || body["code"] != "FEEDBACK_RATE_LIMITED" {
		t.Errorf("fourth send: status %d code %v, want 429 FEEDBACK_RATE_LIMITED", last.StatusCode, body["code"])
	}
}

func TestFeedbackPage(t *testing.T) {
	for in, want := range map[string]string{
		"/lobby":                       "/lobby",
		"/game/x?code=1":               "/game/x",
		"/a#b":                         "/a",
		"https://evil.example/x":       "",
		"//evil.example/x":             "",
		"":                             "",
		"/" + strings.Repeat("a", 400): "/" + strings.Repeat("a", maxFeedbackPageLen-2) + "…",
	} {
		if got := feedbackPage(in); got != want {
			t.Errorf("feedbackPage(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestFeedbackEmbedEscapesPlayerText(t *testing.T) {
	e := newEnv(t)
	bot, gotPath, gotBody := fakeChannelPost(t)
	e.srv.discordBot = bot
	if err := e.st.SetFeedbackChannel("fbchan"); err != nil {
		t.Fatal(err)
	}
	u, _ := e.discordUser(t, "444", hostileName)
	id, err := e.st.CreateFeedback(u.ID, hostileMsg, "/lobby")
	if err != nil {
		t.Fatal(err)
	}

	e.srv.postFeedbackEmbed(id)
	if !strings.HasSuffix(*gotPath, "/channels/fbchan/messages") {
		t.Fatalf("posted to %q, want the feedback channel", *gotPath)
	}
	emb := lastEmbed(t, *gotBody)
	assertQuoted(t, "feedback description", emb.Description)
	assertInert(t, "feedback description", emb.Description)
	for _, f := range emb.Fields {
		assertInert(t, "feedback field "+f.Name, f.Value, "(<@444>)")
	}
	if f, _ := e.st.FeedbackByID(id); f == nil {
		t.Fatal("feedback row went missing")
	}
}

func TestFeedbackWithNoChannelPostsNothing(t *testing.T) {
	e := newEnv(t)
	bot, gotPath, _ := fakeChannelPost(t)
	e.srv.discordBot = bot
	u, _ := e.guest(t, "Ann")
	id, err := e.st.CreateFeedback(u.ID, "hello", "")
	if err != nil {
		t.Fatal(err)
	}
	e.srv.postFeedbackEmbed(id)
	if *gotPath != "" {
		t.Errorf("posted to %q with no feedback channel set", *gotPath)
	}
}
