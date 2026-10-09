package store

import (
	"encoding/json"
	"path/filepath"
	"testing"

	"github.com/ftqo/costan.io/engine"
)

// closedStore returns a Store whose underlying *sql.DB handles have been closed,
// so every query/exec issued through it fails at the driver, exercising error
// guards a healthy SQLite never triggers. The writer goroutine is stopped
// first. Both handles must be closed, or reads would succeed on rdb.
func closedStore(t *testing.T) *Store {
	t.Helper()
	s, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	// Stop the writer cleanly, then close both handles so subsequent ops error.
	s.stopWriter()
	s.w = nil
	if s.rdb != s.db {
		if err := s.rdb.Close(); err != nil {
			t.Fatalf("rdb.Close: %v", err)
		}
	}
	if err := s.db.Close(); err != nil {
		t.Fatalf("db.Close: %v", err)
	}
	// Neutralize the test cleanup's Close (db already closed, writer stopped).
	t.Cleanup(func() {})
	return s
}

// TestQueryErrorPaths drives every read/list method against a closed DB so its
// query-error guard returns the driver error instead of silently succeeding.
func TestQueryErrorPaths(t *testing.T) {
	s := closedStore(t)

	checks := []struct {
		name string
		fn   func() error
	}{
		{"GameByID", func() error { _, e := s.GameByID("x"); return e }},
		{"ListGames", func() error { _, e := s.ListGames("lobby", false); return e }},
		{"Seats", func() error { _, e := s.Seats("g"); return e }},
		{"SeatsForGames", func() error { _, e := s.SeatsForGames([]string{"g"}); return e }},
		{"SeatForUser", func() error { _, e := s.SeatForUser("g", 1); return e }},
		{"ActiveGameForUser", func() error { _, e := s.ActiveGameForUser(1); return e }},
		{"SeatedActiveGames", func() error { _, e := s.SeatedActiveGames(1); return e }},
		{"RecentChat", func() error { _, e := s.RecentChat("lobby", 5); return e }},
		{"LoadEvents", func() error { _, e := s.LoadEvents("g", 0); return e }},
		{"LoadLatestSnapshot", func() error { _, _, e := s.LoadLatestSnapshot("g"); return e }},
		{"MapByID", func() error { _, e := s.MapByID("m"); return e }},
		{"ListMaps", func() error { _, e := s.ListMaps(); return e }},
		{"StatsFor", func() error { _, e := s.StatsFor(1); return e }},
		{"Leaderboard", func() error { _, e := s.Leaderboard("base", 5); return e }},
		{"Balance", func() error { _, e := s.Balance(1); return e }},
		{"CountCredits", func() error { _, e := s.CountCredits(1, "r", 0); return e }},
		{"RecentLedger", func() error { _, e := s.RecentLedger(1, 5); return e }},
		{"Entitlements", func() error { _, e := s.Entitlements(1); return e }},
		{"HasEntitlement", func() error { _, e := s.HasEntitlement(1, "i"); return e }},
		{"Loadout", func() error { _, e := s.Loadout(1); return e }},
		{"Supporter", func() error { _, e := s.Supporter(1); return e }},
		{"StaleSupporters", func() error { _, e := s.StaleSupporters(0, 5); return e }},
		{"FriendsWithAccounts", func() error { _, e := s.FriendsWithAccounts(1); return e }},
		{"UserByID", func() error { _, e := s.UserByID(1); return e }},
		{"UserBySession", func() error { _, e := s.UserBySession("t"); return e }},
		{"Forfeited", func() error { _, e := s.Forfeited("g", 1); return e }},
		{"ActivityGame", func() error { _, e := s.ActivityGame("i"); return e }},
	}
	for _, c := range checks {
		if err := c.fn(); err == nil {
			t.Errorf("%s on closed DB returned nil error, want driver error", c.name)
		}
	}
}

// TestExecErrorPaths drives the write methods against a closed DB so their
// exec-error / Begin-error guards return the driver error.
func TestExecErrorPaths(t *testing.T) {
	s := closedStore(t)

	checks := []struct {
		name string
		fn   func() error
	}{
		{"CreateGuest", func() error { _, e := s.CreateGuest("x"); return e }},
		{"UpsertDiscordUser", func() error { _, e := s.UpsertDiscordUser("d", "n", ""); return e }},
		{"SetUserName", func() error { return s.SetUserName(1, "n") }},
		{"CreateGame", func() error {
			return s.CreateGame(&Game{ID: "g", Ruleset: "base", Config: json.RawMessage(`{}`)})
		}},
		{"UpdateGameConfig", func() error { return s.UpdateGameConfig("g", json.RawMessage(`{}`)) }},
		{"UpdateGameRuleset", func() error { return s.UpdateGameRuleset("g", "r") }},
		{"SetGameInvite", func() error { return s.SetGameInvite("g", "c") }},
		{"SetGameStatus", func() error { return s.SetGameStatus("g", "active") }},
		{"FinishGame", func() error { return s.FinishGame("g", 1) }},
		{"FinishGameOnce", func() error { _, e := s.FinishGameOnce("g", 1); return e }},
		{"AddSeat", func() error { return s.AddSeat("g", 0, 1) }},
		{"RemoveSeat", func() error { return s.RemoveSeat("g", 0) }},
		{"SetSeatStatus", func() error { return s.SetSeatStatus("g", 0, "bot") }},
		{"SetSeatColor", func() error { return s.SetSeatColor("g", 0, "red") }},
		{"SetSeatDisplayName", func() error { return s.SetSeatDisplayName("g", 0, "n") }},
		{"SaveChat", func() error { _, e := s.SaveChat("lobby", 1, "m"); return e }},
		{"SaveSnapshot", func() error { return s.SaveSnapshot("g", 1, []byte("s")) }},
		{"CreateSession", func() error { _, e := s.CreateSession(1); return e }},
		{"DeleteSession", func() error { return s.DeleteSession("t") }},
		{"SweepExpiredSessions", func() error { _, e := s.SweepExpiredSessions(); return e }},
		{"MergeGuestIntoDiscord", func() error { _, e := s.MergeGuestIntoDiscord(1, "d", "n", ""); return e }},
		{"BumpStats", func() error { return s.BumpStats(1, "base", true, false, true, false) }},
		{"LedgerCredit", func() error { _, e := s.LedgerCredit(1, 10, "r", "k"); return e }},
		{"LedgerSpend", func() error { _, e := s.LedgerSpend(1, 10, "r", "k"); return e }},
		{"GrantEntitlement", func() error { return s.GrantEntitlement(1, "i", "s") }},
		{"SetLoadoutSlot", func() error { return s.SetLoadoutSlot(1, "slot", "i") }},
		{"ClearLoadoutSlot", func() error { return s.ClearLoadoutSlot(1, "slot") }},
		{"SetSupporter", func() error { return s.SetSupporter(1, true, false, false, false, false, 0) }},
		{"ReplaceFriends", func() error { return s.ReplaceFriends(1, []string{"a"}) }},
		{"RecordForfeit", func() error { return s.RecordForfeit("g", 1) }},
		{"MapActivity", func() error { _, e := s.MapActivity("i", "g"); return e }},
		{"CreateMap", func() error {
			return s.CreateMap(&Map{ID: "m", Name: "n", Board: json.RawMessage(`{}`)})
		}},
	}
	for _, c := range checks {
		if err := c.fn(); err == nil {
			t.Errorf("%s on closed DB returned nil error, want driver error", c.name)
		}
	}
}

// TestAppendEventsTxErrorPaths exercises writeBatch's Begin error against a
// closed DB (driving the writeBatch path directly so the writer goroutine is not
// involved). The only driver-error guard before Commit is the Begin.
func TestAppendEventsTxErrorPaths(t *testing.T) {
	s := closedStore(t)
	// writeBatch begins a tx on a closed DB -> Begin error branch.
	err := s.writeBatch([]appendReq{
		{gameID: "g", events: []engine.Event{{Seq: 0, Type: "t", Data: json.RawMessage(`{}`)}}},
	})
	if err == nil {
		t.Error("writeBatch on closed DB returned nil, want driver error")
	}
}
