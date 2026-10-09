package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

// mockBackend records the create/bot/start calls for a 4-player game.
func TestFillAndStartSequence(t *testing.T) {
	var creates, bots, starts int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/api/games":
			atomic.AddInt32(&creates, 1)
			var body struct {
				Config  gameConfig `json:"config"`
				Private bool       `json:"private"`
			}
			json.NewDecoder(r.Body).Decode(&body)
			if body.Config.Players != 4 {
				t.Errorf("create players = %d; want 4", body.Config.Players)
			}
			if !body.Private {
				t.Error("create should request a private game (guests spectate via invite)")
			}
			w.WriteHeader(http.StatusCreated)
			w.Write([]byte(`{"game":{"id":"g1","status":"lobby","invite_code":"inv1"},"seats":[]}`))
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/bots"):
			atomic.AddInt32(&bots, 1)
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`{"game":{"id":"g1"},"seats":[]}`))
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/start"):
			atomic.AddInt32(&starts, 1)
			w.WriteHeader(http.StatusNoContent)
		default:
			t.Errorf("unexpected %s %s", r.Method, r.URL.Path)
		}
	}))
	defer srv.Close()

	c, _ := NewClient(srv.URL)
	g, err := c.FillAndStart(gameConfig{Players: 4, Ruleset: "base"})
	if err != nil {
		t.Fatal(err)
	}
	if g.ID != "g1" || g.Invite != "inv1" {
		t.Fatalf("game = %+v; want {g1 inv1}", g)
	}
	if creates != 1 || bots != 3 || starts != 1 {
		t.Fatalf("calls: creates=%d bots=%d starts=%d; want 1/3/1", creates, bots, starts)
	}
}
