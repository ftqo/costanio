package store

import "testing"

func TestRecentLedger(t *testing.T) {
	s := openTest(t)
	u, _ := s.CreateGuest("ann")

	// Empty -> no entries.
	got, err := s.RecentLedger(u.ID, 20)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 0 {
		t.Errorf("RecentLedger empty = %+v", got)
	}

	if _, err := s.LedgerCredit(u.ID, 100, "grant", "k1"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.LedgerCredit(u.ID, 50, "match", "k2"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.LedgerSpend(u.ID, 30, "purchase", "k3"); err != nil {
		t.Fatal(err)
	}

	got, err = s.RecentLedger(u.ID, 20)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 {
		t.Fatalf("RecentLedger = %d entries, want 3", len(got))
	}
	// Newest first (by id desc): the spend is most recent.
	if got[0].Amount != -30 || got[0].Reason != "purchase" {
		t.Errorf("newest entry = %+v, want -30/purchase", got[0])
	}
	if got[2].Amount != 100 || got[2].Reason != "grant" {
		t.Errorf("oldest entry = %+v, want 100/grant", got[2])
	}

	// Limit caps the returned rows.
	lim, err := s.RecentLedger(u.ID, 1)
	if err != nil || len(lim) != 1 {
		t.Errorf("RecentLedger limit 1 = %d %v, want 1", len(lim), err)
	}

	// limit <= 0 normalizes to the default (still returns all 3 here).
	def, err := s.RecentLedger(u.ID, 0)
	if err != nil || len(def) != 3 {
		t.Errorf("RecentLedger default limit = %d %v, want 3", len(def), err)
	}
}
