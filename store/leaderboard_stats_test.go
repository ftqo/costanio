package store

import (
	"testing"

	"github.com/ftqo/costan.io/rating"
)

func TestStatsForJoinsRating(t *testing.T) {
	s := openTest(t)
	u, _ := s.CreateGuest("ann")

	// No stats yet.
	got, err := s.StatsFor(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 {
		t.Errorf("StatsFor before any games = %+v, want none", got)
	}

	// One ruleset with a rating, another without (defaults to 1000).
	if err := s.BumpStats(u.ID, "base", true, false, true, false); err != nil {
		t.Fatal(err)
	}
	if err := s.BumpStats(u.ID, "base", false, false, true, false); err != nil {
		t.Fatal(err)
	}
	if err := s.BumpStats(u.ID, "base+islands", true, false, true, false); err != nil {
		t.Fatal(err)
	}
	if err := s.SetRatingRow(u.ID, "base", rating.MuForDisplay(1200, rating.ProvisionalSigma), rating.ProvisionalSigma, 1000); err != nil {
		t.Fatal(err)
	}

	got, err = s.StatsFor(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("StatsFor = %d rows, want 2", len(got))
	}
	byRule := map[string]UserStats{}
	for _, st := range got {
		byRule[st.Ruleset] = st
	}
	base := byRule["base"]
	if base.Games != 2 || base.Wins != 1 || base.Elo != 1200 {
		t.Errorf("base stats = %+v, want 2/1/1200", base)
	}
	sea := byRule["base+islands"]
	if sea.Games != 1 || sea.Wins != 1 || sea.Elo != 1000 {
		t.Errorf("base+islands stats = %+v, want 1/1/1000 (default elo)", sea)
	}
}

func TestLeaderboard(t *testing.T) {
	s := openTest(t)
	hi, _ := s.UpsertDiscordUser("d1", "Hi", "")
	lo, _ := s.UpsertDiscordUser("d2", "Lo", "")
	other, _ := s.UpsertDiscordUser("d3", "Other", "")

	if err := s.SetRatingRow(hi.ID, "base", rating.MuForDisplay(1500, rating.ProvisionalSigma), rating.ProvisionalSigma, 1000); err != nil {
		t.Fatal(err)
	}
	if err := s.SetRatingRow(lo.ID, "base", rating.MuForDisplay(1100, rating.ProvisionalSigma), rating.ProvisionalSigma, 1000); err != nil {
		t.Fatal(err)
	}
	// other plays a different ruleset only; must not appear in base board.
	if err := s.SetRatingRow(other.ID, "base+islands", rating.MuForDisplay(2000, rating.ProvisionalSigma), rating.ProvisionalSigma, 1000); err != nil {
		t.Fatal(err)
	}
	// Stats join: hi has games/wins, lo has none recorded.
	if err := s.BumpStats(hi.ID, "base", true, false, true, false); err != nil {
		t.Fatal(err)
	}
	// Cosmetics join: hi has a decoration equipped, lo has none.
	if err := s.SetLoadoutSlot(hi.ID, "decoration", "decoration.supporter"); err != nil {
		t.Fatal(err)
	}

	board, err := s.Leaderboard("base", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(board) != 2 {
		t.Fatalf("leaderboard = %d entries, want 2", len(board))
	}
	// Ordered by elo desc.
	if board[0].UserID != hi.ID || board[1].UserID != lo.ID {
		t.Errorf("order = %+v, want [Hi, Lo]", board)
	}
	if board[0].Name != "Hi" || board[0].Elo != 1500 || board[0].Games != 1 || board[0].Wins != 1 {
		t.Errorf("top entry = %+v", board[0])
	}
	// lo has no stats row -> COALESCE to 0.
	if board[1].Games != 0 || board[1].Wins != 0 {
		t.Errorf("no-stats entry = %+v, want 0/0", board[1])
	}
	// Cosmetics join: hi shows its equipped decoration; lo shows none.
	if board[0].Decoration != "decoration.supporter" {
		t.Errorf("top entry decoration = %q, want decoration.supporter", board[0].Decoration)
	}
	if board[1].Decoration != "" {
		t.Errorf("no-cosmetics entry = %q, want empty", board[1].Decoration)
	}

	// limit <= 0 falls back to a sane default (still returns rows).
	def, err := s.Leaderboard("base", 0)
	if err != nil || len(def) != 2 {
		t.Errorf("Leaderboard default limit = %d %v, want 2", len(def), err)
	}
	// Over-cap limit also normalized.
	cap, err := s.Leaderboard("base", 9999)
	if err != nil || len(cap) != 2 {
		t.Errorf("Leaderboard over-cap = %d %v, want 2", len(cap), err)
	}
}

// TestLeaderboardCountsOnlyRankedGames: the leaderboard's games and wins sit
// beside a ranked-only ELO, so casual wins against bots must not count there.
func TestLeaderboardCountsOnlyRankedGames(t *testing.T) {
	s := openTest(t)
	// A real account: Leaderboard filters out guests (and so bots).
	u, err := s.UpsertDiscordUser("d-farmer", "Farmer", "")
	if err != nil {
		t.Fatal(err)
	}
	// Five casual wins against bots, then one real ranked win.
	for range 5 {
		if err := s.BumpStats(u.ID, "base", true, false, false, false); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.BumpStats(u.ID, "base", true, false, true, false); err != nil {
		t.Fatal(err)
	}
	if err := s.SetRatingRow(u.ID, "base", rating.MuForDisplay(1200, rating.ProvisionalSigma), rating.ProvisionalSigma, 1000); err != nil {
		t.Fatal(err)
	}

	rows, err := s.Leaderboard("base", 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 {
		t.Fatalf("leaderboard rows = %d, want 1", len(rows))
	}
	if rows[0].Games != 1 || rows[0].Wins != 1 {
		t.Errorf("leaderboard = %d games / %d wins, want 1/1",
			rows[0].Games, rows[0].Wins)
	}

	// The career total still counts all six.
	career, err := s.StatsFor(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(career) != 1 || career[0].Games != 6 || career[0].Wins != 6 {
		t.Errorf("career stats = %+v, want 6 games / 6 wins", career)
	}
}
