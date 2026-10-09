package game

import (
	"testing"
	"time"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/raiders"
)

// TestDecisionBudgetsScaleWithTurnTimer: every per-decision budget is a
// base sized for the Normal (60s) table, scaled by the table's own timer, so a
// Relaxed table also gets a longer roll window (for the Alchemist decision).
func TestDecisionBudgetsScaleWithTurnTimer(t *testing.T) {
	sec := func(n int) time.Duration { return time.Duration(n) * time.Second }
	mod := func(ids ...string) engine.Decider {
		return engine.Decider{Kind: engine.DecisionModule, Decisions: ids}
	}
	cases := []struct {
		name    string
		decider engine.Decider
		turnSec int
		want    time.Duration
	}{
		// Relaxed: twice the Normal base.
		{"relaxed roll", engine.Decider{Kind: engine.DecisionRoll}, 120, sec(30)},
		{"relaxed discard", engine.Decider{Kind: engine.DecisionDiscard}, 120, sec(60)},
		{"relaxed robber", engine.Decider{Kind: engine.DecisionRobber}, 120, sec(40)},
		{"relaxed setup", engine.Decider{Kind: engine.DecisionSetup}, 120, sec(90)},
		{"relaxed setup road", engine.Decider{Kind: engine.DecisionSetupRoad}, 120, sec(30)},
		{"relaxed muster", mod(raiders.PendMuster), 120, sec(40)},
		{"relaxed rider move", mod(raiders.DecisionRiderLeave), 120, sec(50)},
		{"relaxed treason", mod(raiders.PendTreason), 120, sec(90)},
		// Ranked Knights (75s): a quarter again.
		{"ranked cak roll", engine.Decider{Kind: engine.DecisionRoll}, 75, sec(18)},
		// Blitz (30s) keeps the base, sized for a first-time reader; the clamp
		// to the turn still compresses what exceeds it.
		{"blitz roll", engine.Decider{Kind: engine.DecisionRoll}, 30, sec(15)},
		{"blitz treason", mod(raiders.PendTreason), 30, sec(30)},
		// A very long table stops scaling at the ceiling, so an idle seat
		// cannot sit on a roll for a quarter of an hour.
		{"hour roll", engine.Decider{Kind: engine.DecisionRoll}, 3600, sec(60)},
	}
	for _, c := range cases {
		if got := budgetFor(c.decider, c.turnSec); got != c.want {
			t.Errorf("%s: budgetFor(%+v, %d) = %s, want %s", c.name, c.decider, c.turnSec, got, c.want)
		}
	}
}

// TestRelaxedFloorsScale: the two floors armTimer applies (the main-turn
// inactivity floor and the Alchemist's roll floor) are per-decision windows
// too, so a Relaxed table doubles them.
func TestRelaxedFloorsScale(t *testing.T) {
	a, clock := loadTimed(t, 4, 120)
	var remaining time.Duration
	a.call(func() {
		armMain(a)
		clock.Advance(115 * time.Second)
		a.armTimer()
		remaining = a.seatDeadlines[a.state.Cur].deadline.Sub(clock.Now())
	})
	if remaining != 30*time.Second {
		t.Fatalf("relaxed inactivity floor: want 30s, got %v", remaining)
	}

	c, cclock := loadTimedKnights(t, 4, 120)
	var playErr error
	c.call(func() {
		armRoll(c) // 30s on a Relaxed table
		p := c.state.Cur
		cclock.Advance(25 * time.Second) // 5s left
		playErr = playAlchemist(c, p, 3, 4)
		remaining = c.seatDeadlines[p].deadline.Sub(cclock.Now())
	})
	if playErr != nil {
		t.Fatalf("play alchemist: %v", playErr)
	}
	if remaining != 20*time.Second {
		t.Fatalf("relaxed alchemist floor: want 20s, got %v", remaining)
	}
}
