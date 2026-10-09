package server

import (
	"net/http"
	"testing"
)

// TestResetCarriesInviteForSpectators: resetting a private table makes a new
// game with a new invite code. The redirect frame must carry it, or every
// spectator is refused at the new lobby's `sub` gate (the rematch path does
// the same).
func TestResetCarriesInviteForSpectators(t *testing.T) {
	e := newEnv(t)
	_, hostC := e.discordUser(t, "d1", "host")
	_, aliceC := e.discordUser(t, "d2", "alice")
	_, bobC := e.discordUser(t, "d3", "bob")

	resp, created := e.req(t, "POST", "/api/games", hostC, map[string]any{
		"config": map[string]any{"players": 3}, "private": true,
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create = %d: %v", resp.StatusCode, created)
	}
	g := created["game"].(map[string]any)
	id, invite := g["id"].(string), g["invite_code"].(string)
	if invite == "" {
		t.Fatal("private game created without an invite code")
	}
	e.req(t, "POST", "/api/games/"+id+"/join", aliceC, map[string]any{"invite": invite})
	e.req(t, "POST", "/api/games/"+id+"/join", bobC, map[string]any{"invite": invite})
	if resp, out := e.req(t, "POST", "/api/games/"+id+"/start", hostC, nil); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("start = %d: %v", resp.StatusCode, out)
	}

	// A watcher follows the live private table on the invite they were given.
	_, watcherC := e.discordUser(t, "d4", "watcher")
	watcher := dialWS(t, e.ts, watcherC)
	watcher.send(map[string]any{"t": "sub", "id": "s1", "game": id, "invite": invite})
	watcher.waitFrame(func(f map[string]any) bool { return f["t"] == "state" }, "spectator state frame")

	if resp, _ := e.req(t, "POST", "/api/games/"+id+"/reset", hostC, nil); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("host reset = %d, want 204", resp.StatusCode)
	}

	f := watcher.waitFrame(func(f map[string]any) bool { return f["t"] == "lobby" && f["next"] != nil }, "reset redirect")
	next, _ := f["next"].(string)
	nextInvite, _ := f["next_invite"].(string)
	if nextInvite == "" {
		t.Fatal("reset redirect carried no next_invite")
	}
	newGame, err := e.st.GameByID(next)
	if err != nil {
		t.Fatal(err)
	}
	if nextInvite != newGame.InviteCode {
		t.Errorf("next_invite = %q, want the new lobby's code %q", nextInvite, newGame.InviteCode)
	}

	// And it is the code that actually opens the door: the same watcher follows
	// the reset table with it.
	watcher.send(map[string]any{"t": "sub", "id": "s2", "game": next, "invite": nextInvite})
	watcher.waitFrame(
		func(f map[string]any) bool { return f["t"] == "lobby" && f["game"] == next && f["summary"] != nil },
		"spectator lobby frame for the reset table",
	)
}

// TestResetOfPublicTableSendsNoInvite: a public table has no code to carry, and
// inventing an empty one on the frame would put `inv=` on every client's URL.
func TestResetOfPublicTableSendsNoInvite(t *testing.T) {
	e := newEnv(t)
	_, hostC := e.discordUser(t, "d1", "host")
	_, aliceC := e.discordUser(t, "d2", "alice")
	_, bobC := e.discordUser(t, "d3", "bob")
	id := startedGame(t, e, hostC, aliceC, bobC)

	host := dialWS(t, e.ts, hostC)
	host.send(map[string]any{"t": "sub", "id": "s1", "game": id})
	host.waitFrame(func(f map[string]any) bool { return f["t"] == "state" }, "host state frame")

	if resp, _ := e.req(t, "POST", "/api/games/"+id+"/reset", hostC, nil); resp.StatusCode != http.StatusNoContent {
		t.Fatalf("host reset = %d, want 204", resp.StatusCode)
	}
	f := host.waitFrame(func(f map[string]any) bool { return f["t"] == "lobby" && f["next"] != nil }, "reset redirect")
	if _, ok := f["next_invite"]; ok {
		t.Errorf("public reset carried next_invite = %v", f["next_invite"])
	}
}
