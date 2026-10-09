package ranked

import "testing"

// The window opens on the first clock-made move and closes only when the player
// moves for themselves, so a seat that acts once every lap never trips.
func TestStallTrackerCountsConsecutively(t *testing.T) {
	const players = 4
	tr := NewStallTracker()

	if tr.Gone(0, 100, players) {
		t.Error("a seat nobody has auto-passed for is not gone")
	}
	tr.Clock(0, 10)
	if !tr.Stalling(0) {
		t.Error("seat 0 should be stalling after the clock moved for it")
	}
	if tr.Gone(0, 13, players) {
		t.Error("three turns counted as a full lap of four seats")
	}
	if !tr.Gone(0, 14, players) {
		t.Error("a full lap of clock-made moves should be gone")
	}

	// Acting for themselves resets the window, and a later auto-pass starts a
	// fresh one rather than resuming the old count.
	tr.Acted(0)
	if tr.Stalling(0) || tr.Gone(0, 14, players) {
		t.Error("a seat that acted is neither stalling nor gone")
	}
	tr.Clock(0, 14)
	if tr.Gone(0, 17, players) {
		t.Error("the window must restart from the move that reopened it")
	}
	if !tr.Gone(0, 18, players) {
		t.Error("a full lap after the restart should be gone")
	}
}

// Repeated clock moves inside one window must not push the deadline out: the
// count is how long the stall has run, not how many decisions it swallowed.
func TestStallTrackerClockDoesNotExtendWindow(t *testing.T) {
	tr := NewStallTracker()
	tr.Clock(1, 5)
	for turn := int64(6); turn <= 8; turn++ {
		tr.Clock(1, turn)
	}
	if !tr.Gone(1, 9, 4) {
		t.Error("window should still be measured from turn 5")
	}
}

// A table with no seats has no lap, so nothing can elapse: guard against the
// zero-players state an actor can briefly hold.
func TestStallTrackerNoPlayers(t *testing.T) {
	tr := NewStallTracker()
	tr.Clock(0, 0)
	if tr.Gone(0, 1_000_000, 0) {
		t.Error("a lap of a zero-seat table never elapses")
	}
}
