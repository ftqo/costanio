package store

import (
	"testing"

	"github.com/ftqo/costan.io/rating"
)

func TestApplyGameRatings(t *testing.T) {
	s := openTest(t)
	u := make([]int64, 4)
	for i := range u {
		usr, err := s.CreateGuest("p")
		if err != nil {
			t.Fatal(err)
		}
		u[i] = usr.ID
	}
	// Player order = finishing order 1..4.
	if err := s.ApplyGameRatings("base", u, []int{1, 2, 3, 4}, 1000); err != nil {
		t.Fatal(err)
	}
	r1, _ := s.RatingRow(u[0], "base")
	r4, _ := s.RatingRow(u[3], "base")
	if !(r1.Mu > rating.Mu0 && r4.Mu < rating.Mu0) {
		t.Fatalf("winner mu should rise, last should fall: %v %v", r1, r4)
	}
	if r1.Display <= r4.Display {
		t.Fatalf("winner display %d should exceed last %d", r1.Display, r4.Display)
	}
	if r1.Sigma >= rating.Sigma0 {
		t.Fatalf("sigma should shrink after a game: %.3f", r1.Sigma)
	}
}

func TestRatingRowDefault(t *testing.T) {
	s := openTest(t)
	usr, _ := s.CreateGuest("x")
	r, err := s.RatingRow(usr.ID, "base")
	if err != nil {
		t.Fatal(err)
	}
	if r.Mu != rating.Mu0 || r.Display != 1000 {
		t.Fatalf("unrated default wrong: %+v", r)
	}
}

func TestLeaderboardProvisionalFlag(t *testing.T) {
	s := openTest(t)
	// Accounts (not guests): the leaderboard excludes guests, so provisional
	// flagging is only meaningful for real users.
	a, _ := s.UpsertDiscordUser("d-a", "a", "")
	b, _ := s.UpsertDiscordUser("d-b", "b", "")
	// a plays one game (still provisional), b is hand-settled to low sigma.
	_ = s.ApplyGameRatings("base", []int64{a.ID, b.ID}, []int{1, 2}, 1000)
	_ = s.SetRatingRow(b.ID, "base", 30, 3, 1000) // helper: settled sigma
	entries, _ := s.Leaderboard("base", 50)
	byID := map[int64]LeaderboardEntry{}
	for _, e := range entries {
		byID[e.UserID] = e
	}
	if !byID[a.ID].Provisional {
		t.Fatal("a should be provisional")
	}
	if byID[b.ID].Provisional {
		t.Fatal("b should be settled")
	}
}

// TestLeaderboardExcludesGuests asserts a guest (the shape every bot takes) with
// a rating row never surfaces on the leaderboard, while an account does.
func TestLeaderboardExcludesGuests(t *testing.T) {
	s := openTest(t)
	acct, _ := s.UpsertDiscordUser("d-acct", "Account", "")
	bot, _ := s.CreateGuest("Bot William")
	// Both hold a rating row for the ruleset.
	_ = s.ApplyGameRatings("base", []int64{acct.ID, bot.ID}, []int{1, 2}, 1000)
	entries, err := s.Leaderboard("base", 50)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if e.UserID == bot.ID {
			t.Fatalf("guest/bot %d (%q) must not appear on the leaderboard", bot.ID, e.Name)
		}
	}
	var sawAccount bool
	for _, e := range entries {
		if e.UserID == acct.ID {
			sawAccount = true
		}
	}
	if !sawAccount {
		t.Fatal("account should appear on the leaderboard")
	}
}

func TestStatForProvisional(t *testing.T) {
	s := openTest(t)
	u, _ := s.CreateGuest("u")

	// Play a game so a stats row exists for "base".
	_ = s.BumpStats(u.ID, "base", true, false, true, false)

	// No rating row yet -> unrated user reads as provisional=true.
	got, err := s.StatsFor(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 {
		t.Fatalf("StatsFor = %d rows, want 1", len(got))
	}
	if !got[0].Provisional {
		t.Fatal("unrated user should be provisional")
	}

	// Now settle the rating (low sigma).
	if err := s.SetRatingRow(u.ID, "base", 30, 3, 1000); err != nil {
		t.Fatal(err)
	}
	got, err = s.StatsFor(u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 {
		t.Fatalf("StatsFor = %d rows after settle, want 1", len(got))
	}
	if got[0].Provisional {
		t.Fatal("settled user should not be provisional")
	}
}
