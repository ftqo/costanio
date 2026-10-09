package ranked

import "testing"

func TestFormGroups_TightImmediate(t *testing.T) {
	// 4 same-rated players just queued -> one group immediately.
	pool := []entry{{1, 1000, false, 0}, {2, 1010, false, 0}, {3, 1005, false, 0}, {4, 1020, false, 0}}
	groups, rem := formGroups(pool, 0)
	if len(groups) != 1 || len(groups[0]) != 4 {
		t.Fatalf("expected one full group, got %v", groups)
	}
	if len(rem) != 0 {
		t.Fatalf("expected no remainder, got %d", len(rem))
	}
}

func TestFormGroups_WideOnlyAfterWait(t *testing.T) {
	// Spread of 600 exceeds baseBand(150) at tick 0 -> no group.
	pool := []entry{{1, 1000, false, 0}, {2, 1200, false, 0}, {3, 1400, false, 0}, {4, 1600, false, 0}}
	if g, _ := formGroups(pool, 0); len(g) != 0 {
		t.Fatalf("should not match a wide group immediately: %v", g)
	}
	// After enough ticks the band widens past the spread -> group forms.
	if g, _ := formGroups(pool, 20); len(g) != 1 {
		t.Fatalf("wide group should form after waiting: %v", g)
	}
}

func TestFormGroups_NotEnoughPlayers(t *testing.T) {
	pool := []entry{{1, 1000, false, 0}, {2, 1000, false, 0}, {3, 1000, false, 0}}
	if g, rem := formGroups(pool, 100); len(g) != 0 || len(rem) != 3 {
		t.Fatalf("fewer than 4 cannot form a group")
	}
}

// TestTolerance_ProvisionalBonus verifies that the provisional band bonus widens
// the acceptable spread: a window with spread between baseBand and
// baseBand+provisionalBandBonus does not form at tick 0 when all entries are
// non-provisional, but does form once one entry is marked provisional.
func TestTolerance_ProvisionalBonus(t *testing.T) {
	// spread = 300: baseBand(150) < 300, baseBand+provisionalBandBonus(150+200=350) >= 300
	pool := []entry{
		{1, 1000, false, 0},
		{2, 1100, false, 0},
		{3, 1200, false, 0},
		{4, 1300, false, 0},
	}
	// No provisional: spread 300 > baseBand 150 → no group at tick 0.
	if g, _ := formGroups(pool, 0); len(g) != 0 {
		t.Fatalf("all non-provisional: spread 300 should not form at tick 0 (band=%v), got groups: %v", baseBand, g)
	}
	// Mark one provisional: band widens to 350, spread 300 ≤ 350 → group forms.
	pool[2].provisional = true
	if g, _ := formGroups(pool, 0); len(g) != 1 {
		t.Fatalf("one provisional: spread 300 should form (band=%v), got groups: %v", baseBand+provisionalBandBonus, g)
	}
}

// TestTolerance_UsesMaxWait verifies that tolerance keys off the longest-waiting
// member in the window. A pool of 4 only forms a group because one member has
// a long wait; resetting that member's joinedTick to nowTick (zero wait) must
// prevent the group from forming.
func TestTolerance_UsesMaxWait(t *testing.T) {
	// Spread = 400. At tick 0, baseBand=150, won't form.
	// Need maxWait such that baseBand + growthPerTick*maxWait >= 400:
	//   (400 - 150) / 40 = 6.25 → maxWait >= 7 ticks → use joinedTick=0, nowTick=7.
	const nowTick = int64(7)
	pool := []entry{
		{1, 1000, false, 0}, // waited 7 ticks; this one carries the group
		{2, 1100, false, 7},
		{3, 1200, false, 7},
		{4, 1400, false, 7},
	}
	// maxWait = 7: band = 150 + 40*7 = 430 >= 400 → group forms.
	if g, _ := formGroups(pool, nowTick); len(g) != 1 {
		t.Fatalf("with long-waiter (maxWait=7): spread 400 should form (band=430), got groups: %v", g)
	}
	// Move the long-waiter's joinedTick to nowTick → maxWait = 0: band = 150 < 400 → no group.
	pool[0].joinedTick = nowTick
	if g, _ := formGroups(pool, nowTick); len(g) != 0 {
		t.Fatalf("without long-waiter (maxWait=0): spread 400 should not form (band=150), got groups: %v", g)
	}
}
