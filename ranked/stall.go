package ranked

import "github.com/ftqo/costan.io/engine"

// StallLaps is how many full laps of the table a seat may have every one of its
// decisions made by the clock before the table stops treating it as occupied.
//
// One lap, the same as a disconnected seat gets before it is handed to a bot
// (game.escalateAbsent): stalling and disconnecting must cost the same.
//
// A seat that acts for itself at any point clears the count.
const StallLaps = 1

// StallTracker records which seats are having their moves made for them, in the
// same unit game/ counts absence in: completed turns.
//
// Disconnecting from a ranked game costs a rated last place and a queue
// cooldown (the absent seat escalates to a bot, which records a forfeit). A
// seat that stays connected but never acts would otherwise have every decision
// resolved by the turn timer, never be marked auto, and be rated on its real
// VP, while dragging the game out. After StallLaps a stalled seat is handed to
// a bot exactly as a disconnect is, so the forfeit, last place and queue strike
// follow.
//
// Plain state, no lock: it lives in the actor goroutine that owns the game,
// alongside the absentSince map it mirrors.
type StallTracker struct {
	since map[engine.PlayerID]int64
}

// NewStallTracker returns an empty tracker.
func NewStallTracker() *StallTracker {
	return &StallTracker{since: map[engine.PlayerID]int64{}}
}

// Clock records that the turn timer, not the player, resolved a decision for
// this seat at turnsCompleted turns played. The first such decision starts the
// window and later ones don't extend it, so the count is consecutive.
func (t *StallTracker) Clock(seat engine.PlayerID, turnsCompleted int64) {
	if _, already := t.since[seat]; already {
		return
	}
	t.since[seat] = turnsCompleted
}

// Acted records that the player moved for themselves, which clears the window.
// Call it on any command the seat issues.
func (t *StallTracker) Acted(seat engine.PlayerID) {
	delete(t.since, seat)
}

// Gone reports whether the seat has been stalling for StallLaps full laps of a
// players-wide table. False for a seat that is not stalling at all, and for a
// table with no seats (a lap of nothing never elapses).
func (t *StallTracker) Gone(seat engine.PlayerID, turnsCompleted int64, players int) bool {
	since, stalling := t.since[seat]
	if !stalling || players <= 0 {
		return false
	}
	return turnsCompleted-since >= int64(players)*StallLaps
}

// Stalling reports whether the clock is currently making this seat's moves.
func (t *StallTracker) Stalling(seat engine.PlayerID) bool {
	_, ok := t.since[seat]
	return ok
}
