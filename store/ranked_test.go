package store

import "testing"

func TestRankedStrikeEscalates(t *testing.T) {
	s := openTest(t)
	u, _ := s.CreateGuest("u")
	c1, _ := s.BumpRankedStrike(u.ID, 1000)
	c2, _ := s.BumpRankedStrike(u.ID, 1000)
	if c2 <= c1 {
		t.Fatalf("second strike should be a longer cooldown: %d then %d", c1, c2)
	}
	until, _ := s.RankedCooldownUntil(u.ID)
	if until != c2 {
		t.Fatalf("cooldown mismatch: %d != %d", until, c2)
	}
}

// The ladder: 5 min, 15 min, 1 h, then 3 h and 12 h, flat after that.
func TestRankedStrikeLadderMatchesDesign(t *testing.T) {
	s := openTest(t)
	u, _ := s.CreateGuest("ladder")
	const now = int64(1_000_000)
	want := []int64{5 * 60, 15 * 60, 60 * 60, 3 * 60 * 60, 12 * 60 * 60, 12 * 60 * 60}
	for i, w := range want {
		until, err := s.BumpRankedStrike(u.ID, now)
		if err != nil {
			t.Fatal(err)
		}
		if got := until - now; got != w {
			t.Errorf("strike %d cooldown = %ds, want %ds", i+1, got, w)
		}
	}
}

// A clean window resets the strike count, so a much later forfeit is priced as
// a first offence.
func TestRankedStrikesResetAfterCleanWindow(t *testing.T) {
	s := openTest(t)
	u, _ := s.CreateGuest("decay")
	const now = int64(2_000_000)
	for range 5 {
		if _, err := s.BumpRankedStrike(u.ID, now); err != nil {
			t.Fatal(err)
		}
	}

	// One second short of the window: still escalated (flat at the top step).
	near := now + rankedCleanWindow - 1
	until, err := s.BumpRankedStrike(u.ID, near)
	if err != nil {
		t.Fatal(err)
	}
	if got := until - near; got != 12*60*60 {
		t.Fatalf("strike inside the clean window = %ds, want the top step %ds", got, 12*60*60)
	}

	// A full clean window after that one starts the ladder over.
	clean := near + rankedCleanWindow
	until, err = s.BumpRankedStrike(u.ID, clean)
	if err != nil {
		t.Fatal(err)
	}
	if got := until - clean; got != 5*60 {
		t.Errorf("first strike after a clean window = %ds, want the bottom step %ds", got, 5*60)
	}
}

func TestRankedGameFlagPersists(t *testing.T) {
	s := openTest(t)
	u, err := s.CreateGuest("host")
	if err != nil {
		t.Fatalf("CreateGuest: %v", err)
	}
	g := &Game{ID: "g1", Ruleset: "base", Config: []byte("{}"), CreatedBy: u.ID, Ranked: true}
	if err := s.CreateGame(g); err != nil {
		t.Fatal(err)
	}
	got, _ := s.GameByID("g1")
	if !got.Ranked {
		t.Fatal("ranked flag did not persist")
	}
}
