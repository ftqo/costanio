package store

import (
	"encoding/json"
	"errors"
	"fmt"
	"testing"
)

// seedFinishedGame creates a user + a finished game with one seat and returns the game ID.
func seedFinishedGame(t *testing.T, s *Store) string {
	t.Helper()
	u, err := s.UpsertDiscordUser("disc_mh1", "MHUser", "")
	if err != nil {
		t.Fatalf("UpsertDiscordUser: %v", err)
	}
	g := &Game{ID: "mh_game1", Ruleset: "base", Config: json.RawMessage("{}"), CreatedBy: u.ID}
	if err := s.CreateGame(g); err != nil {
		t.Fatalf("CreateGame: %v", err)
	}
	if err := s.SetGameStatus(g.ID, "finished"); err != nil {
		t.Fatalf("SetGameStatus: %v", err)
	}
	if err := s.AddSeat(g.ID, 0, u.ID); err != nil {
		t.Fatalf("AddSeat: %v", err)
	}
	return g.ID
}

// seedThreeMatchesForUser seeds user U with 3 finished games (finished_at 300,200,100)
// and a 4th bot-only game that U is not seated in. Returns (userID, g3_id, g2_id, g1_id)
// where g3 has finished_at=300 (newest), g2=200, g1=100 (oldest).
func seedThreeMatchesForUser(t *testing.T, s *Store) (userID int64, g3, g2, g1 string) {
	t.Helper()
	u, err := s.UpsertDiscordUser("disc_mh_u1", "MatchUser", "")
	if err != nil {
		t.Fatalf("UpsertDiscordUser: %v", err)
	}
	userID = u.ID

	mkGame := func(id string, finishedAt int64) {
		g := &Game{ID: id, Ruleset: "base", Config: json.RawMessage("{}"), CreatedBy: userID}
		if err := s.CreateGame(g); err != nil {
			t.Fatalf("CreateGame(%s): %v", id, err)
		}
		if err := s.SetGameStatus(id, "finished"); err != nil {
			t.Fatalf("SetGameStatus(%s): %v", id, err)
		}
		if err := s.AddSeat(id, 0, userID); err != nil {
			t.Fatalf("AddSeat(%s): %v", id, err)
		}
		row := MatchHistoryRow{GameID: id, Ruleset: "base", Ranked: false, FinishedAt: finishedAt, Record: `{"version":1}`}
		if err := s.SaveMatchHistory(row); err != nil {
			t.Fatalf("SaveMatchHistory(%s): %v", id, err)
		}
	}

	mkGame("mh_g1", 100)
	mkGame("mh_g2", 200)
	mkGame("mh_g3", 300)
	g1, g2, g3 = "mh_g1", "mh_g2", "mh_g3"

	// Bot-only game: U is not seated in this game.
	botUser, err := s.UpsertDiscordUser("disc_mh_bot", "BotPlayer", "")
	if err != nil {
		t.Fatalf("UpsertDiscordUser bot: %v", err)
	}
	botGame := &Game{ID: "mh_bot_game", Ruleset: "base", Config: json.RawMessage("{}"), CreatedBy: botUser.ID}
	if err := s.CreateGame(botGame); err != nil {
		t.Fatalf("CreateGame bot: %v", err)
	}
	if err := s.SetGameStatus("mh_bot_game", "finished"); err != nil {
		t.Fatalf("SetGameStatus bot: %v", err)
	}
	if err := s.AddSeat("mh_bot_game", 0, botUser.ID); err != nil {
		t.Fatalf("AddSeat bot: %v", err)
	}
	if err := s.SetSeatStatus("mh_bot_game", 0, "bot"); err != nil {
		t.Fatalf("SetSeatStatus bot: %v", err)
	}
	botRow := MatchHistoryRow{GameID: "mh_bot_game", Ruleset: "base", Ranked: false, FinishedAt: 400, Record: `{"version":1}`}
	if err := s.SaveMatchHistory(botRow); err != nil {
		t.Fatalf("SaveMatchHistory bot: %v", err)
	}

	return userID, g3, g2, g1
}

func TestMatchHistoryExcludesBotsAndPaginates(t *testing.T) {
	st := openTest(t)
	u, g3, g2, g1 := seedThreeMatchesForUser(t, st)

	all, err := st.MatchHistoryForUser(u, 0, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 3 {
		t.Fatalf("got %d matches, want 3 (bot-only game excluded)", len(all))
	}
	// newest first: g3(300), g2(200), g1(100)
	if all[0].GameID != g3 || all[2].GameID != g1 {
		t.Errorf("order wrong: %v", []string{all[0].GameID, all[1].GameID, all[2].GameID})
	}
	// g2 must be in the middle
	if all[1].GameID != g2 {
		t.Errorf("middle entry = %q, want %q", all[1].GameID, g2)
	}

	// Cursor pagination: before newest (300) -> returns g2(200) and g1(100)
	page, err := st.MatchHistoryForUser(u, all[0].FinishedAt, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(page) != 2 {
		t.Errorf("cursor page = %d, want 2", len(page))
	}
	// Boundary row (g3) must be excluded; remaining page is newest-first: g2(200), g1(100).
	if len(page) == 2 && (page[0].GameID != g2 || page[1].GameID != g1) {
		t.Errorf("cursor page order/content = %v, want [%s %s]", []string{page[0].GameID, page[1].GameID}, g2, g1)
	}

	// MatchHistoryByGame: present
	row, err := st.MatchHistoryByGame(g1)
	if err != nil {
		t.Fatalf("MatchHistoryByGame(%s): %v", g1, err)
	}
	if row.GameID != g1 {
		t.Errorf("MatchHistoryByGame game_id = %q, want %q", row.GameID, g1)
	}

	// MatchHistoryByGame: absent returns ErrNotFound
	_, err = st.MatchHistoryByGame("no_such_game")
	if !errors.Is(err, ErrNotFound) {
		t.Errorf("MatchHistoryByGame(missing) err = %v, want ErrNotFound", err)
	}
}

// TestMatchHistoryForUserLimitClamp verifies that limit<=0 defaults to 20, and
// limit>50 is clamped to 50 (not reset to the default 20). It seeds 60 matches
// so the two outcomes differ.
func TestMatchHistoryForUserLimitClamp(t *testing.T) {
	st := openTest(t)

	u, err := st.UpsertDiscordUser("disc_clamp_u", "ClampUser", "")
	if err != nil {
		t.Fatalf("UpsertDiscordUser: %v", err)
	}

	// Seed 60 finished games for this user with distinct finished_at values.
	for i := 1; i <= 60; i++ {
		id := fmt.Sprintf("clamp_g%02d", i)
		g := &Game{ID: id, Ruleset: "base", Config: json.RawMessage("{}"), CreatedBy: u.ID}
		if err := st.CreateGame(g); err != nil {
			t.Fatalf("CreateGame(%s): %v", id, err)
		}
		if err := st.SetGameStatus(id, "finished"); err != nil {
			t.Fatalf("SetGameStatus(%s): %v", id, err)
		}
		if err := st.AddSeat(id, 0, u.ID); err != nil {
			t.Fatalf("AddSeat(%s): %v", id, err)
		}
		row := MatchHistoryRow{GameID: id, Ruleset: "base", Ranked: false, FinishedAt: int64(i * 10), Record: `{"version":1}`}
		if err := st.SaveMatchHistory(row); err != nil {
			t.Fatalf("SaveMatchHistory(%s): %v", id, err)
		}
	}

	// limit=100 -> clamped to 50, not 20.
	rows, err := st.MatchHistoryForUser(u.ID, 0, 100)
	if err != nil {
		t.Fatalf("limit=100: %v", err)
	}
	if len(rows) != 50 {
		t.Errorf("limit=100 (clamped to 50) got %d, want 50", len(rows))
	}

	// limit=0 -> default 20.
	rows, err = st.MatchHistoryForUser(u.ID, 0, 0)
	if err != nil {
		t.Fatalf("limit=0: %v", err)
	}
	if len(rows) != 20 {
		t.Errorf("limit=0 (default 20) got %d, want 20", len(rows))
	}

	// limit=1 -> exactly 1 row
	rows, err = st.MatchHistoryForUser(u.ID, 0, 1)
	if err != nil {
		t.Fatalf("limit=1: %v", err)
	}
	if len(rows) != 1 {
		t.Errorf("limit=1 got %d, want 1", len(rows))
	}
}

func TestFinishedGamesWithoutMatchHistory(t *testing.T) {
	st := openTest(t)

	// Create user for seeding games.
	u, err := st.UpsertDiscordUser("disc_bftest", "BFUser", "")
	if err != nil {
		t.Fatalf("UpsertDiscordUser: %v", err)
	}

	mkGame := func(id, status string) {
		g := &Game{ID: id, Ruleset: "base", Config: json.RawMessage("{}"), CreatedBy: u.ID}
		if err := st.CreateGame(g); err != nil {
			t.Fatalf("CreateGame(%s): %v", id, err)
		}
		if err := st.SetGameStatus(id, status); err != nil {
			t.Fatalf("SetGameStatus(%s): %v", id, err)
		}
	}

	// finished with a human seat, no match_history row: should appear
	mkGame("bf_g1", "finished")
	if err := st.AddSeat("bf_g1", 0, u.ID); err != nil {
		t.Fatalf("AddSeat bf_g1: %v", err)
	}
	mkGame("bf_g2", "finished")
	if err := st.AddSeat("bf_g2", 0, u.ID); err != nil {
		t.Fatalf("AddSeat bf_g2: %v", err)
	}

	// active game: must not appear
	mkGame("bf_active", "active")
	if err := st.AddSeat("bf_active", 0, u.ID); err != nil {
		t.Fatalf("AddSeat bf_active: %v", err)
	}

	// finished but already has a match_history row: must not appear
	mkGame("bf_g3", "finished")
	if err := st.AddSeat("bf_g3", 0, u.ID); err != nil {
		t.Fatalf("AddSeat bf_g3: %v", err)
	}
	row := MatchHistoryRow{GameID: "bf_g3", Ruleset: "base", Ranked: false, FinishedAt: 1, Record: `{"version":1}`}
	if err := st.SaveMatchHistory(row); err != nil {
		t.Fatalf("SaveMatchHistory: %v", err)
	}

	// bot-only finished game: no match_history row but all seats are bots, must not appear
	botU, err := st.UpsertDiscordUser("disc_bfbot", "BFBot", "")
	if err != nil {
		t.Fatalf("UpsertDiscordUser bot: %v", err)
	}
	mkGame("bf_botonly", "finished")
	if err := st.AddSeat("bf_botonly", 0, botU.ID); err != nil {
		t.Fatalf("AddSeat bf_botonly: %v", err)
	}
	if err := st.SetSeatStatus("bf_botonly", 0, "bot"); err != nil {
		t.Fatalf("SetSeatStatus bf_botonly: %v", err)
	}

	ids, err := st.FinishedGamesWithoutMatchHistory()
	if err != nil {
		t.Fatalf("FinishedGamesWithoutMatchHistory: %v", err)
	}
	got := make(map[string]bool, len(ids))
	for _, id := range ids {
		got[id] = true
	}

	if !got["bf_g1"] || !got["bf_g2"] {
		t.Errorf("expected bf_g1 and bf_g2 in result, got %v", ids)
	}
	if got["bf_active"] {
		t.Error("active game bf_active must not appear")
	}
	if got["bf_g3"] {
		t.Error("already-recorded bf_g3 must not appear")
	}
	if got["bf_botonly"] {
		t.Error("bot-only game bf_botonly must not appear")
	}
}

func TestSaveMatchHistoryRoundTripAndIdempotent(t *testing.T) {
	st := openTest(t)
	gid := seedFinishedGame(t, st)
	row := MatchHistoryRow{GameID: gid, Ruleset: "base", Ranked: false, FinishedAt: 100, Record: `{"version":1}`}
	if err := st.SaveMatchHistory(row); err != nil {
		t.Fatalf("save: %v", err)
	}
	// second insert with same game_id must be a no-op (idempotent), not an error
	row.Record = `{"version":1,"changed":true}`
	if err := st.SaveMatchHistory(row); err != nil {
		t.Fatalf("re-save: %v", err)
	}
	// Assert via direct query.
	var got string
	if err := st.db.QueryRow("SELECT record FROM match_history WHERE game_id = ?", gid).Scan(&got); err != nil {
		t.Fatalf("get: %v", err)
	}
	if got != `{"version":1}` {
		t.Errorf("record = %q, want original", got)
	}
}
