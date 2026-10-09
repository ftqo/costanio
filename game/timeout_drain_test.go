package game

import (
	"testing"
	"time"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/scenarios"
)

// TestTimeoutDrainLeavesNoDeadCountdown pins the second exit from
// autoTimeoutDecision's drain loop: AutoCommand answers for a seat in the
// batch and engine.Decide rejects it. Like the other exit (handled by
// drainStaleBatch), it must drop the stale deadline, re-arm the clock and
// count toward maxEmptyDrains, or the table freezes.
//
// The state is a caravans vote whose ext has no oasis, so Caravans.blocks
// stays true while Caravans.auto has no placement. AutoCommand falls through to
// EndTurn for the timed-out placer, and decideEndTurn refuses it with
// ErrModulePending. No live game reaches that ext, so this is defence in depth
// on a constructed state.
//
// The clock is armed once and then only advanced, as on a live table.
func TestTimeoutDrainLeavesNoDeadCountdown(t *testing.T) {
	a, clock := loadCaravansVotingUnplaceable(t, 4, 60)
	a.call(a.armTimer)
	for range 30 {
		clock.Advance(2 * time.Minute)
		clock.Fire()
		var voting, paused bool
		a.call(func() {
			x, _ := scenarios.CaravansStateExt(a.state)
			voting, paused = x.Voting, a.paused
		})
		if !voting || paused {
			return // resolved, or frozen loudly (paused-error), which is the contract
		}
	}
	var placer engine.PlayerID
	var armed int
	var paused bool
	a.call(func() {
		x, _ := scenarios.CaravansStateExt(a.state)
		placer, paused, armed = x.Placer, a.paused, len(a.seatDeadlines)
	})
	t.Fatalf("vote still open on placer=%d after 30 timer firings, "+
		"paused=%v, %d expired deadline(s) with no timer", placer, paused, armed)
}
