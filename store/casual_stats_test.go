package store

import "testing"

// TestCasualStatsRoundTrip is the store half: what BumpStats writes,
// StatsFor reads back, and the three populations stay separate.
func TestCasualStatsRoundTrip(t *testing.T) {
	s := openTest(t)
	u, _ := s.CreateGuest("player")

	// Four bumps, one of each shape the finalize path can produce.
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(s.BumpStats(u.ID, "base", true, false, false, true))  // casual 4p, won
	must(s.BumpStats(u.ID, "base", false, false, false, true)) // casual 4p, lost
	must(s.BumpStats(u.ID, "base", false, true, false, true))  // casual 4p, drawn
	must(s.BumpStats(u.ID, "base", true, false, false, false)) // casual, not 4p
	must(s.BumpStats(u.ID, "base", true, false, true, false))  // ranked

	rows, err := s.StatsFor(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 {
		t.Fatalf("StatsFor returned %d rows, want 1", len(rows))
	}
	got := rows[0]
	// The career total counts all five; the casual mirror counts the three
	// four-handed non-ranked games. The mirrors do not partition the total.
	if got.Games != 5 {
		t.Errorf("games = %d, want 5", got.Games)
	}
	if got.CasualGames != 3 {
		t.Errorf("casual_games = %d, want 3", got.CasualGames)
	}
	if got.CasualWins != 1 {
		t.Errorf("casual_wins = %d, want 1", got.CasualWins)
	}
	if got.CasualDraws != 1 {
		t.Errorf("casual_draws = %d, want 1", got.CasualDraws)
	}
	// Ranked counts only the ranked game.
	var rg, rw int
	if err := s.db.QueryRow(
		`SELECT ranked_games, ranked_wins FROM stats WHERE user_id = ? AND ruleset = 'base'`,
		u.ID).Scan(&rg, &rw); err != nil {
		t.Fatal(err)
	}
	if rg != 1 || rw != 1 {
		t.Errorf("ranked = %d/%d, want 1/1", rg, rw)
	}
}

// TestBotStatsRoundTrip covers the personality-keyed bot stats table.
func TestBotStatsRoundTrip(t *testing.T) {
	s := openTest(t)
	for _, c := range []struct {
		name      string
		ruleset   string
		won, drew bool
	}{
		{"Bot Winston", "base", true, false},
		{"Bot Winston", "base", false, false},
		{"Bot Winston", "base+cak", false, false},
		{"Bot William", "base", false, true},
	} {
		if err := s.BumpBotStats(c.name, c.ruleset, c.won, c.drew); err != nil {
			t.Fatal(err)
		}
	}
	// An empty name (unresolved seat name) is dropped rather than pooled into
	// one "" row.
	if err := s.BumpBotStats("", "base", true, false); err != nil {
		t.Fatal(err)
	}

	rows, err := s.AllBotStats()
	if err != nil {
		t.Fatal(err)
	}
	byKey := map[string]BotStats{}
	for _, r := range rows {
		byKey[r.Name+"|"+r.Ruleset] = r
	}
	if len(byKey) != 3 {
		t.Fatalf("got %d rows, want 3 (two rulesets for Winston, one for William); rows=%+v", len(byKey), rows)
	}
	if w := byKey["Bot Winston|base"]; w.Games != 2 || w.Wins != 1 {
		t.Errorf("Winston base = %d/%d, want 2/1", w.Games, w.Wins)
	}
	// Rulesets do not pool.
	if w := byKey["Bot Winston|base+cak"]; w.Games != 1 || w.Wins != 0 {
		t.Errorf("Winston base+cak = %d/%d, want 1/0", w.Games, w.Wins)
	}
	if w := byKey["Bot William|base"]; w.Games != 1 || w.Draws != 1 || w.Wins != 0 {
		t.Errorf("William base = %d games %d wins %d draws, want 1/0/1", w.Games, w.Wins, w.Draws)
	}
	if _, ok := byKey["|base"]; ok {
		t.Error("an empty bot name created a row")
	}
}

// TestFinalizeGameWritesBothMirrors runs the whole FinalizeInput path, since
// these non-idempotent counters rely on committing with the match-history row.
func TestFinalizeGameWritesBothMirrors(t *testing.T) {
	s := openTest(t)
	u, _ := s.CreateGuest("player")

	in := FinalizeInput{
		Now:     1,
		Ruleset: "base",
		Stats: []StatBump{
			{UserID: u.ID, Ruleset: "base", Won: true, Casual4: true},
		},
		BotStats: []BotStatBump{
			{Name: "Bot Winston", Ruleset: "base"},
			{Name: "Bot Z", Ruleset: "base"},
		},
	}
	if err := s.FinalizeGame(in); err != nil {
		t.Fatal(err)
	}

	rows, err := s.StatsFor(u.ID)
	if err != nil || len(rows) != 1 {
		t.Fatalf("StatsFor: %v rows=%d", err, len(rows))
	}
	if rows[0].CasualGames != 1 || rows[0].CasualWins != 1 {
		t.Errorf("casual = %d/%d, want 1/1", rows[0].CasualGames, rows[0].CasualWins)
	}
	bots, err := s.AllBotStats()
	if err != nil {
		t.Fatal(err)
	}
	if len(bots) != 2 {
		t.Fatalf("got %d bot rows, want 2", len(bots))
	}
	for _, b := range bots {
		if b.Games != 1 || b.Wins != 0 {
			t.Errorf("%s = %d/%d, want 1/0 (the human won)", b.Name, b.Games, b.Wins)
		}
	}
}
