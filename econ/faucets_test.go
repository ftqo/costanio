package econ

import (
	"fmt"
	"testing"
	"time"
)

func TestMatchRewardBelowHumanThreshold(t *testing.T) {
	l, st := openLedger(t)
	u, _ := st.CreateGuest("solo")

	// Fewer than 2 humans: a no-op returning the current balance, nothing credited.
	bal, err := l.MatchReward(u.ID, "g1", 1)
	if err != nil || bal != 0 {
		t.Fatalf("MatchReward(humans=1) = %d, %v; want 0, nil", bal, err)
	}
	if got, _ := l.Balance(u.ID); got != 0 {
		t.Fatalf("balance after sub-threshold reward = %d; want 0", got)
	}
}

func TestMatchRewardCreditsAndIsIdempotent(t *testing.T) {
	l, st := openLedger(t)
	u, _ := st.CreateGuest("player")

	bal, err := l.MatchReward(u.ID, "g100", 2)
	if err != nil || bal != MatchPayout {
		t.Fatalf("MatchReward = %d, %v; want %d", bal, err, MatchPayout)
	}

	// Same gameID -> same idem key -> no double-pay.
	bal, err = l.MatchReward(u.ID, "g100", 2)
	if err != nil || bal != MatchPayout {
		t.Fatalf("replayed MatchReward = %d, %v; want %d (idempotent)", bal, err, MatchPayout)
	}
}

func TestMatchRewardDailyCap(t *testing.T) {
	l, st := openLedger(t)
	u, _ := st.CreateGuest("grinder")

	// Reward up to the cap across distinct games.
	for g := 1; g <= MatchDailyCap; g++ {
		if _, err := l.MatchReward(u.ID, fmt.Sprintf("g%d", g), 2); err != nil {
			t.Fatalf("reward for game %d: %v", g, err)
		}
	}
	atCap, _ := l.Balance(u.ID)
	if atCap != MatchPayout*MatchDailyCap {
		t.Fatalf("balance at cap = %d; want %d", atCap, MatchPayout*MatchDailyCap)
	}

	// One more distinct game is over the cap: a no-op, balance frozen.
	bal, err := l.MatchReward(u.ID, fmt.Sprintf("g%d", MatchDailyCap+1), 2)
	if err != nil {
		t.Fatal(err)
	}
	if bal != atCap {
		t.Fatalf("over-cap reward = %d; want %d (no-op)", bal, atCap)
	}
}

func TestStipendIsMonthlyIdempotent(t *testing.T) {
	l, st := openLedger(t)
	u, _ := st.CreateGuest("supporter")

	bal, err := l.Stipend(u.ID)
	if err != nil || bal != StipendPayout {
		t.Fatalf("stipend = %d, %v; want %d", bal, err, StipendPayout)
	}

	// Same calendar month -> same idem key -> single payout.
	bal, err = l.Stipend(u.ID)
	if err != nil || bal != StipendPayout {
		t.Fatalf("repeated stipend = %d, %v; want %d (idempotent)", bal, err, StipendPayout)
	}

	// Sanity: the month-keyed nature is what makes the second call a no-op.
	if month := time.Now().UTC().Format("2006-01"); month == "" {
		t.Fatal("unexpected empty month")
	}
}
