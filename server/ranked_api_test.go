package server

import (
	"net/http"
	"testing"
)

func TestRankedQueueJoinLeave(t *testing.T) {
	e := newEnv(t)

	// Discord user (non-guest) required for ranked.
	_, cookie := e.discordUser(t, "d99", "ranked-user")

	// Join the base queue.
	resp, _ := e.req(t, "POST", "/api/ranked/queue", cookie, map[string]any{"queue": "base"})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("join: got %d, want 204", resp.StatusCode)
	}

	// Status shows queued=true.
	resp, body := e.req(t, "GET", "/api/ranked/queue", cookie, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status: got %d, want 200", resp.StatusCode)
	}
	if queued, ok := body["queued"].(bool); !ok || !queued {
		t.Fatalf("status body: queued=true expected, got %v", body)
	}

	// Leave the queue.
	resp, _ = e.req(t, "DELETE", "/api/ranked/queue", cookie, nil)
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("leave: got %d, want 204", resp.StatusCode)
	}

	// Status shows queued=false after leave.
	resp, body = e.req(t, "GET", "/api/ranked/queue", cookie, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status after leave: got %d, want 200", resp.StatusCode)
	}
	if queued, ok := body["queued"].(bool); !ok || queued {
		t.Fatalf("after leave: want queued=false present, got %v", body)
	}

	// Guest must be rejected with 403.
	_, guestCookie := e.guest(t, "guest-ranked")
	resp, _ = e.req(t, "POST", "/api/ranked/queue", guestCookie, map[string]any{"queue": "base"})
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("guest join: got %d, want 403", resp.StatusCode)
	}
}

// TestRankedQueueDoubleJoinConflict: joining a queue a second time while already
// queued must return 409 Conflict (ErrAlreadyQueued). An unknown queue name must
// return 400 Bad Request.
func TestRankedQueueDoubleJoinConflict(t *testing.T) {
	e := newEnv(t)
	_, cookie := e.discordUser(t, "d100", "conflict-user")

	// First join succeeds.
	resp, _ := e.req(t, "POST", "/api/ranked/queue", cookie, map[string]any{"queue": "base"})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("first join: got %d, want 204", resp.StatusCode)
	}

	// Second join while already queued → 409.
	resp, _ = e.req(t, "POST", "/api/ranked/queue", cookie, map[string]any{"queue": "base"})
	if resp.StatusCode != http.StatusConflict {
		t.Fatalf("double join: got %d, want 409", resp.StatusCode)
	}

	// Leave so the next assertion is isolated.
	e.req(t, "DELETE", "/api/ranked/queue", cookie, nil)

	// Unknown queue → 400.
	resp, _ = e.req(t, "POST", "/api/ranked/queue", cookie, map[string]any{"queue": "nope"})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("unknown queue: got %d, want 400", resp.StatusCode)
	}
}

// Being in the ranked queue and being seated at a table are mutually exclusive.
// Joining the queue must drop the player from any lobby they're in.
func TestRankedJoinLeavesLobby(t *testing.T) {
	e := newEnv(t)
	u, cookie := e.discordUser(t, "dme1", "mutex-user")

	// Create a private lobby; the user is now seated in it.
	resp, _ := e.req(t, "POST", "/api/games", cookie, map[string]any{
		"config": map[string]any{"players": 4}, "private": true,
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create game: got %d, want 201", resp.StatusCode)
	}
	if games, _ := e.st.SeatedActiveGames(u.ID); len(games) != 1 {
		t.Fatalf("expected 1 seated game before queue, got %d", len(games))
	}

	// Joining the ranked queue drops them from the lobby.
	resp, _ = e.req(t, "POST", "/api/ranked/queue", cookie, map[string]any{"queue": "base"})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("ranked join: got %d, want 204", resp.StatusCode)
	}
	if games, _ := e.st.SeatedActiveGames(u.ID); len(games) != 0 {
		t.Fatalf("expected 0 seated games after joining queue, got %d", len(games))
	}
	_, body := e.req(t, "GET", "/api/ranked/queue", cookie, nil)
	if queued, _ := body["queued"].(bool); !queued {
		t.Fatalf("expected queued=true after ranked join, got %v", body)
	}
}

// The reverse: creating/joining a table must drop the player from the queue.
func TestJoiningLobbyLeavesRankedQueue(t *testing.T) {
	e := newEnv(t)
	u, cookie := e.discordUser(t, "dme2", "mutex-user2")

	// In the ranked queue.
	resp, _ := e.req(t, "POST", "/api/ranked/queue", cookie, map[string]any{"queue": "base"})
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("ranked join: got %d, want 204", resp.StatusCode)
	}

	// Creating a table drops them from the queue.
	resp, _ = e.req(t, "POST", "/api/games", cookie, map[string]any{
		"config": map[string]any{"players": 4}, "private": true,
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create game: got %d, want 201", resp.StatusCode)
	}
	_, body := e.req(t, "GET", "/api/ranked/queue", cookie, nil)
	if queued, _ := body["queued"].(bool); queued {
		t.Fatalf("expected queued=false after creating a table, got %v", body)
	}
	if games, _ := e.st.SeatedActiveGames(u.ID); len(games) != 1 {
		t.Fatalf("expected 1 seated game after create, got %d", len(games))
	}
}

// A queue membership is treated like a lobby seat across a disconnect: the drop
// is graced (so a refresh survives), and only fires if the user is truly gone.
func TestRankedQueueDisconnectGrace(t *testing.T) {
	t.Run("offline queuer is dropped when the grace fires", func(t *testing.T) {
		e := newEnv(t)
		clk := &fakeLeaveClock{}
		e.srv.clock = clk
		u, cookie := e.discordUser(t, "rg1", "grace-offline")
		if resp, _ := e.req(t, "POST", "/api/ranked/queue", cookie, map[string]any{"queue": "base"}); resp.StatusCode != http.StatusNoContent {
			t.Fatalf("join: %d", resp.StatusCode)
		}
		e.srv.scheduleRankedLeave(u.ID) // socket closed
		if _, q, _ := e.srv.ranked.Status(u.ID); !q {
			t.Fatal("should still be queued before the grace fires")
		}
		clk.fire() // user has no live connection
		if _, q, _ := e.srv.ranked.Status(u.ID); q {
			t.Fatal("offline queuer should be dropped after the grace window")
		}
	})

	t.Run("reconnected queuer stays in the queue", func(t *testing.T) {
		e := newEnv(t)
		clk := &fakeLeaveClock{}
		e.srv.clock = clk
		u, cookie := e.discordUser(t, "rg2", "grace-online")
		if resp, _ := e.req(t, "POST", "/api/ranked/queue", cookie, map[string]any{"queue": "base"}); resp.StatusCode != http.StatusNoContent {
			t.Fatalf("join: %d", resp.StatusCode)
		}
		e.srv.scheduleRankedLeave(u.ID)                // socket closed
		e.srv.hub.add(&Conn{srv: e.srv, userID: u.ID}) // ...then they reconnect
		clk.fire()                                     // grace fires, but they're online
		if _, q, _ := e.srv.ranked.Status(u.ID); !q {
			t.Fatal("a reconnected user must stay queued")
		}
	})
}
