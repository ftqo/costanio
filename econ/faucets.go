package econ

import (
	"fmt"
	"time"
)

// Faucet payouts (starter values; docs/cosmetics.md §3, monetization.md §3).
const (
	MatchPayout   = 10
	MatchDailyCap = 3 // rewarded matches per day
	DailyPayout   = 15
	StreakStep    = 5
	StreakMax     = 40
	StipendPayout = 10_000
	SignupPayout  = 5_000
)

// MatchReward credits the match-completion faucet: +MatchPayout, idempotent per
// game, only when the game had 2+ humans, and capped at MatchDailyCap rewarded
// matches per UTC day (anti bot-farming). A no-op (returns current balance, nil)
// when the game didn't qualify or the cap is reached. The per-game idem key
// (match:{gameID}:{userID}) makes retries and event replay safe. gameID is a
// string because games.id is TEXT.
func (l *Ledger) MatchReward(userID int64, gameID string, humans int) (int, error) {
	if humans < 2 {
		return l.Balance(userID)
	}
	startOfDay := time.Now().UTC().Truncate(24 * time.Hour).Unix()
	rewarded, err := l.st.CountCredits(userID, "match", startOfDay)
	if err != nil {
		return 0, err
	}
	if rewarded >= MatchDailyCap {
		return l.Balance(userID)
	}
	key := fmt.Sprintf("match:%s:%d", gameID, userID)
	return l.Grant(userID, MatchPayout, "match", key)
}

// Signup credits the one-time welcome grant every new account starts with. The
// idem key is the user id alone, so it is safe to call on every login: only the
// first one pays. A guest who later links a provider keeps their user id, so
// they are not paid twice for the same account.
func (l *Ledger) Signup(userID int64) (int, error) {
	return l.Grant(userID, SignupPayout, "signup", fmt.Sprintf("signup:%d", userID))
}

// Stipend credits the monthly supporter stipend, idempotent per calendar month.
func (l *Ledger) Stipend(userID int64) (int, error) {
	key := fmt.Sprintf("stipend:%d:%s", userID, time.Now().UTC().Format("2006-01"))
	return l.Grant(userID, StipendPayout, "stipend", key)
}

// DailyPayoutFor is what the first qualifying game of `today` is worth, given
// the days this player was last paid the daily faucet. The streak is the run of
// days ending yesterday, so missing a day resets it. It is computed from the
// ledger's own payment days, so there is no separate counter to drift.
//
// Returns 0 when today is already paid, so it is safe to call on every finished
// game.
//
// days: distinct UTC days ("2006-01-02"), newest first, as store.CreditDays
// returns them. today: the same format.
func DailyPayoutFor(days []string, today string) int {
	paid := make(map[string]bool, len(days))
	for _, d := range days {
		if d == today {
			return 0
		}
		paid[d] = true
	}
	t, err := time.Parse(dayLayout, today)
	if err != nil {
		return 0
	}
	streak := 0
	for {
		t = t.AddDate(0, 0, -1)
		if !paid[t.Format(dayLayout)] {
			break
		}
		streak++
	}
	payout := min(DailyPayout+StreakStep*streak, StreakMax)
	return payout
}

// dayLayout is the UTC day a streak is counted in, matching the format
// store.CreditDays returns and the date in the daily faucet's idempotency key.
const dayLayout = "2006-01-02"

// Day is the UTC day a unix timestamp falls in.
func Day(unix int64) string { return time.Unix(unix, 0).UTC().Format(dayLayout) }

// StreakWindow is how far back a streak is looked for. Beyond StreakMax the
// payout stops climbing, so days older than the run that could still raise it
// cannot change the answer.
const StreakWindow = 45 * 24 * time.Hour
