package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"github.com/ftqo/costan.io/game"
	"github.com/ftqo/costan.io/store"
)

func seedMatchForUser(t *testing.T, st *store.Store, userID int64, gameID string, finishedAt int64, vp int) {
	t.Helper()
	g := &store.Game{ID: gameID, Ruleset: "base", Config: []byte("{}"), CreatedBy: userID}
	if err := st.CreateGame(g); err != nil {
		t.Fatalf("CreateGame(%s): %v", gameID, err)
	}
	if err := st.SetGameStatus(gameID, "finished"); err != nil {
		t.Fatalf("SetGameStatus(%s): %v", gameID, err)
	}
	if err := st.AddSeat(gameID, 0, userID); err != nil {
		t.Fatalf("AddSeat(%s): %v", gameID, err)
	}
	rec := game.MatchRecord{
		Version:    game.MatchRecordVersion,
		GameID:     gameID,
		Ruleset:    "base",
		Ranked:     false,
		FinishedAt: finishedAt,
		Seats: []game.MatchSeat{
			{Seat: 0, UserID: userID, Name: "testplayer", IsBot: false, Color: "red"},
		},
		Scoreboard: game.Scoreboard{
			Winner: 0,
			Players: []game.PlayerStat{
				{Seat: 0, VP: vp},
			},
			Rolls: map[int]int{7: 3},
			Turns: 20,
		},
	}
	recJSON, err := json.Marshal(rec)
	if err != nil {
		t.Fatalf("json.Marshal record: %v", err)
	}
	row := store.MatchHistoryRow{
		GameID:     gameID,
		Ruleset:    "base",
		Ranked:     false,
		FinishedAt: finishedAt,
		Record:     string(recJSON),
	}
	if err := st.SaveMatchHistory(row); err != nil {
		t.Fatalf("SaveMatchHistory(%s): %v", gameID, err)
	}
}

func TestUserMatchesEndpointPublicAndPaginated(t *testing.T) {
	e := newEnv(t)

	// Create user U and seed two finished matches: finishedAt 200 and 100.
	u, _ := e.discordUser(t, "disc_mh_server_u1", "matchuser")
	seedMatchForUser(t, e.st, u.ID, fmt.Sprintf("srv_mh_g200_%d", u.ID), 200, 10)
	seedMatchForUser(t, e.st, u.ID, fmt.Sprintf("srv_mh_g100_%d", u.ID), 100, 8)
	gid200 := fmt.Sprintf("srv_mh_g200_%d", u.ID)
	gid100 := fmt.Sprintf("srv_mh_g100_%d", u.ID)

	userPath := fmt.Sprintf("/api/users/%d/matches", u.ID)

	// --- 1. GET without auth: must return 200 with newest-first order ---
	resp, out := e.req(t, "GET", userPath, nil, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("list without auth: status=%d, want 200; body=%v", resp.StatusCode, out)
	}
	matchesRaw, ok := out["matches"].([]any)
	if !ok {
		t.Fatalf("matches field not array: %v", out)
	}
	if len(matchesRaw) != 2 {
		t.Fatalf("list: got %d matches, want 2", len(matchesRaw))
	}
	first := matchesRaw[0].(map[string]any)
	second := matchesRaw[1].(map[string]any)
	if first["game_id"] != gid200 {
		t.Errorf("first game_id = %v, want %s", first["game_id"], gid200)
	}
	if second["game_id"] != gid100 {
		t.Errorf("second game_id = %v, want %s", second["game_id"], gid100)
	}
	// Players field must be present and VP filled
	players := first["players"].([]any)
	if len(players) == 0 {
		t.Error("players empty in first match summary")
	}
	p0 := players[0].(map[string]any)
	if int(p0["vp"].(float64)) != 10 {
		t.Errorf("vp = %v, want 10", p0["vp"])
	}

	// --- 2. Pagination: ?before=200&limit=10 -> only the 100 match ---
	resp, out = e.req(t, "GET", userPath+"?before=200&limit=10", nil, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("paginated: status=%d, body=%v", resp.StatusCode, out)
	}
	paged, ok := out["matches"].([]any)
	if !ok {
		t.Fatalf("paginated matches not array: %v", out)
	}
	if len(paged) != 1 {
		t.Fatalf("paginated: got %d matches, want 1", len(paged))
	}
	if paged[0].(map[string]any)["game_id"] != gid100 {
		t.Errorf("paginated first game_id = %v, want %s", paged[0].(map[string]any)["game_id"], gid100)
	}

	// --- 3. GET /api/matches/{gameId} -> 200 with the full record ---
	resp, detail := e.req(t, "GET", "/api/matches/"+gid200, nil, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("detail: status=%d, body=%v", resp.StatusCode, detail)
	}
	if detail["game_id"] != gid200 {
		t.Errorf("detail game_id = %v, want %s", detail["game_id"], gid200)
	}
	// scoreboard must be present
	sb, ok := detail["scoreboard"].(map[string]any)
	if !ok {
		t.Fatalf("scoreboard missing in detail: %v", detail)
	}
	if int(sb["winner"].(float64)) != 0 {
		t.Errorf("scoreboard winner = %v, want 0", sb["winner"])
	}

	// --- 4. Unknown gameId -> 404 ---
	resp, _ = e.req(t, "GET", "/api/matches/unknown_game_xyz", nil, nil)
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("unknown game: status=%d, want 404", resp.StatusCode)
	}
}
