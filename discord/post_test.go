package discord

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestPostChannelMessageReturnsID(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/channels/chan1/messages") {
			t.Errorf("unexpected path %s", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bot tok" {
			t.Errorf("bad auth %q", r.Header.Get("Authorization"))
		}
		var body map[string]any
		raw, _ := io.ReadAll(r.Body)
		json.Unmarshal(raw, &body)
		if _, ok := body["embeds"]; !ok {
			t.Errorf("no embeds in body: %s", raw)
		}
		w.Write([]byte(`{"id":"msg99"}`))
	}))
	defer srv.Close()

	c := Client{Token: "tok", BaseURL: srv.URL, HTTP: srv.Client()}
	id, err := c.PostChannelMessage(context.Background(), "chan1",
		Embed{Title: "Report"}, []ActionRow{{Buttons: []Button{{Label: "Warn", CustomID: "x", Style: ButtonSecondary}}}})
	if err != nil || id != "msg99" {
		t.Fatalf("id=%q err=%v", id, err)
	}
}

func TestSendDMOpensChannelThenPosts(t *testing.T) {
	var openHit, postHit bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/users/@me/channels"):
			openHit = true
			w.Write([]byte(`{"id":"dm7"}`))
		case strings.HasSuffix(r.URL.Path, "/channels/dm7/messages"):
			postHit = true
			w.Write([]byte(`{"id":"m1"}`))
		default:
			t.Errorf("unexpected path %s", r.URL.Path)
		}
	}))
	defer srv.Close()
	c := Client{Token: "tok", BaseURL: srv.URL, HTTP: srv.Client()}
	if err := c.SendDM(context.Background(), "user42", "you were warned"); err != nil {
		t.Fatal(err)
	}
	if !openHit || !postHit {
		t.Fatalf("openHit=%v postHit=%v", openHit, postHit)
	}
}
