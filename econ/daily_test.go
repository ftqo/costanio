package econ

import "testing"

// The ladder monetization.md §3 describes: 15 on the first day, +5 for each
// consecutive day before it, capped at 40.
func TestDailyPayoutLadder(t *testing.T) {
	cases := []struct {
		name string
		days []string
		want int
	}{
		{"never played", nil, 15},
		{"played yesterday", []string{"2026-08-11"}, 20},
		{"two days running", []string{"2026-08-11", "2026-08-10"}, 25},
		{"three", []string{"2026-08-11", "2026-08-10", "2026-08-09"}, 30},
		{"four", []string{"2026-08-11", "2026-08-10", "2026-08-09", "2026-08-08"}, 35},
		{"five", []string{"2026-08-11", "2026-08-10", "2026-08-09", "2026-08-08", "2026-08-07"}, 40},
		{
			"a long run stops at the cap",
			[]string{
				"2026-08-11", "2026-08-10", "2026-08-09", "2026-08-08",
				"2026-08-07", "2026-08-06", "2026-08-05", "2026-08-04",
			},
			40,
		},
		// Missing a day resets the streak even though older days are on the ledger.
		{"a gap resets it", []string{"2026-08-10", "2026-08-09", "2026-08-08"}, 15},
		{"an old run is not a streak", []string{"2026-07-01", "2026-06-30"}, 15},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := DailyPayoutFor(c.days, "2026-08-12"); got != c.want {
				t.Errorf("DailyPayoutFor(%v) = %d; want %d", c.days, got, c.want)
			}
		})
	}
}

// Already paid today: nothing more, so the caller can ask on every finished
// game.
func TestDailyPayoutOncePerDay(t *testing.T) {
	if got := DailyPayoutFor([]string{"2026-08-12", "2026-08-11"}, "2026-08-12"); got != 0 {
		t.Errorf("second game of the day = %d; want 0", got)
	}
}

func TestDayIsUTC(t *testing.T) {
	// 2026-08-12T00:30:00Z is still the 11th west of UTC; the day boundary must be
	// the UTC one the idem key uses, or a player could be paid twice for one day.
	if got := Day(1786494600); got != "2026-08-12" {
		t.Errorf("Day = %q; want 2026-08-12", got)
	}
}
