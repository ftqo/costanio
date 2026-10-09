package game

import (
	"testing"
	"time"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/scenarios"
	"github.com/ftqo/costan.io/timings"
)

// loadCaravansVoting opens a camel vote on a real board, with the ext
// InitCaravansExt derives (an oasis, spokes, caravan paths). A hollow ext has
// no legal camel path, so the vote would never reach the placement half. The
// board comes from seedGame's fixed seed, so the Fatals below are assertions
// about a deterministic board, never a skip.
func loadCaravansVoting(t *testing.T, players, turnTimerSec int) (*Actor, *fakeClock) {
	t.Helper()
	a, clock := loadCaravansActor(t, players, turnTimerSec)
	a.call(func() {
		x, ok := scenarios.InitCaravansExt(a.state)
		if !ok {
			t.Fatal("caravans module not active on base+caravans")
		}
		if !x.HasOasis {
			t.Fatal("no oasis on the generated board")
		}
		if len(scenarios.CamelPaths(a.state)) == 0 {
			t.Fatal("no legal camel path on a fresh board")
		}
		openVote(x, a.state.Cur)
	})
	return a, clock
}

// loadCaravansVotingUnplaceable opens the same vote over an ext with no oasis
// and no arrows, so legalPaths stays empty. No real game reaches this (a vote
// only opens when a legal path exists); it is the smallest state where
// Caravans.blocks is true while Caravans.auto has nothing to offer, driving
// AutoCommand to an EndTurn that Decide refuses. See
// TestTimeoutDrainLeavesNoDeadCountdown.
func loadCaravansVotingUnplaceable(t *testing.T, players, turnTimerSec int) (*Actor, *fakeClock) {
	t.Helper()
	a, clock := loadCaravansActor(t, players, turnTimerSec)
	a.call(func() {
		x := &scenarios.CaravansExt{Occupied: map[board.Edge]bool{}, CamelsLeft: scenarios.CamelSupply}
		a.state.Ext["caravans"] = x
		openVote(x, a.state.Cur)
	})
	return a, clock
}

// loadCaravansActor seeds a base+caravans game and puts it in the play phase,
// rolled, with no vote open yet.
func loadCaravansActor(t *testing.T, players, turnTimerSec int) (*Actor, *fakeClock) {
	t.Helper()
	st := openStore(t)
	clock := &fakeClock{}
	cfg := engine.GameConfig{Players: players, Ruleset: "base+caravans", TurnTimerSec: turnTimerSec}
	seedGame(t, st, "g1", players, cfg)
	a, err := Load("g1", st, Options{Clock: clock})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(a.Stop)
	a.call(func() {
		a.state.Phase = engine.PhasePlay
		a.state.Rolled = true
	})
	return a, clock
}

// openVote puts the ext in the state EvCamelVote's fold produces: bidding open,
// nobody has answered, no placer yet.
func openVote(x *scenarios.CaravansExt, finisher engine.PlayerID) {
	x.Voting = true
	x.Finisher = finisher
	x.Placer = engine.NoPlayer
	x.Bids = map[engine.PlayerID]scenarios.CamelBid{}
	x.Bidded = map[engine.PlayerID]bool{}
}

// camelsPlaced is how many camels have left the supply.
func camelsPlaced(t *testing.T, a *Actor) int {
	t.Helper()
	var n int
	a.call(func() {
		x, _ := scenarios.CaravansStateExt(a.state)
		n = scenarios.CamelSupply - x.CamelsLeft
	})
	return n
}

func moduleDeadlines(t *testing.T, a *Actor) (pending, armed int) {
	t.Helper()
	a.call(func() {
		for _, d := range engine.PendingDeciders(a.state) {
			if d.Kind == engine.DecisionModule {
				pending++
			}
		}
		a.armTimer()
		for _, sd := range a.seatDeadlines {
			if !sd.deadline.IsZero() {
				armed++
			}
		}
	})
	return
}

// assertOneBidderOnTheClock checks that exactly one seat is on the clock.
// Bidding is sequential, from the player who just finished their turn and
// clockwise, so seats not yet up cannot answer and must not have a running
// deadline that would auto-pass a bid never offered.
func assertOneBidderOnTheClock(t *testing.T, a *Actor, pending int) {
	t.Helper()
	if pending != 1 {
		t.Fatalf("%d seats owe a camel decision at once, want 1", pending)
	}
	a.call(func() {
		x, _ := scenarios.CaravansStateExt(a.state)
		for _, d := range engine.PendingDeciders(a.state) {
			if d.Kind == engine.DecisionModule && d.Seat != x.Finisher {
				t.Errorf("seat %d is on the clock, want the finisher %d",
					d.Seat, x.Finisher)
			}
		}
	})
}

func TestCaravanVoteArmsDeadlinesTimed(t *testing.T) {
	a, _ := loadCaravansVoting(t, 4, 60)
	pending, armed := moduleDeadlines(t, a)
	t.Logf("timed: moduleDeciders=%d armed=%d", pending, armed)
	if pending == 0 || armed == 0 {
		t.Fatal("timed caravans vote armed no deadline")
	}
	assertOneBidderOnTheClock(t, a, pending)
}

func TestCaravanVoteArmsDeadlinesUntimed(t *testing.T) {
	a, _ := loadCaravansVoting(t, 4, 0)
	pending, armed := moduleDeadlines(t, a)
	t.Logf("untimed: moduleDeciders=%d armed=%d", pending, armed)
	if pending == 0 || armed == 0 {
		t.Fatal("untimed caravans vote armed no deadline -> table frozen")
	}
	assertOneBidderOnTheClock(t, a, pending)
}

// TestCaravanVoteResolvesUntimed: on a table with no turn timer the camel vote
// must still time out seat by seat and close, through the placement, until
// the seat that is up can pass its turn (the strict Blocks holds the pass
// until the camel is placed).
func TestCaravanVoteResolvesUntimed(t *testing.T) {
	a, clock := loadCaravansVoting(t, 4, 0)
	closed := false
	for range 40 {
		var still bool
		a.call(func() {
			x, _ := scenarios.CaravansStateExt(a.state)
			still = x != nil && x.Voting
		})
		if !still {
			closed = true
			break
		}
		a.call(a.armTimer)
		clock.Advance(timings.ModuleDefaultCap + time.Minute)
		clock.Fire()
	}
	if !closed {
		t.Fatal("camel vote never closed on an untimed table")
	}
	if got := camelsPlaced(t, a); got != 1 {
		t.Fatalf("vote closed with %d camels placed, want 1", got)
	}
	var endErr error
	a.call(func() {
		_, endErr = engine.Decide(a.state, engine.Command{Player: a.state.Cur, Type: engine.CmdEndTurn})
	})
	if endErr != nil {
		t.Fatalf("active seat still cannot end its turn after the camel landed: %v", endErr)
	}
}

// TestCaravanVoteResolvesTimed is the same on a table with a turn timer, where
// the per-decision module caps rather than the floor size the budgets.
func TestCaravanVoteResolvesTimed(t *testing.T) {
	a, clock := loadCaravansVoting(t, 4, 60)
	for range 40 {
		var still bool
		a.call(func() {
			x, _ := scenarios.CaravansStateExt(a.state)
			still = x.Voting
		})
		if !still {
			break
		}
		a.call(a.armTimer)
		clock.Advance(2 * time.Minute)
		clock.Fire()
	}
	var voting bool
	a.call(func() { x, _ := scenarios.CaravansStateExt(a.state); voting = x.Voting })
	if voting {
		t.Fatal("camel vote never closed on a timed table")
	}
	if got := camelsPlaced(t, a); got != 1 {
		t.Fatalf("vote closed with %d camels placed, want 1", got)
	}
}
