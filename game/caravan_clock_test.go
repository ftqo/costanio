package game

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/scenarios"
)

// TestActiveSeatClockedAfterBidding: Caravans.blocksTurnActions
// frees the seat that is up once it has bid, so it may build, trade and play
// cards during the auction (docs/rules/scenarios.md, "The vote does not halt
// the table"). That seat must keep a DecisionMain deadline of its own while
// other seats still owe bids, so the turn timer still bounds its turn.
func TestActiveSeatClockedAfterBidding(t *testing.T) {
	a, _ := loadCaravansVoting(t, 4, 60)
	a.call(a.armTimer)
	var cur engine.PlayerID
	a.call(func() { cur = a.state.Cur })
	if err := a.Do(engine.Command{Player: cur, Type: scenarios.CmdBidCamel, Data: []byte(`{"wool":0,"grain":0}`)}); err != nil {
		t.Fatalf("active seat could not bid: %v", err)
	}

	var owedModule, others, gated, armed bool
	var kind engine.DecisionKind
	a.call(func() {
		for _, d := range engine.PendingDeciders(a.state) {
			switch {
			case d.Seat != cur:
				if d.Kind == engine.DecisionModule {
					others = true
				}
			case d.Kind == engine.DecisionModule:
				owedModule = true
			default:
				kind = d.Kind
			}
		}
		_, armed = a.seatDeadlines[cur]
		gated = engine.RequireActionableTurn(a.state, cur) != nil
	})
	if !others {
		t.Fatal("premise not reached: no other seat still owes a bid")
	}
	if owedModule {
		t.Fatalf("premise not reached: seat %d still owes the vote something after bidding", cur)
	}
	if gated {
		t.Fatalf("premise not reached: seat %d is gated during the vote, so it needs no clock", cur)
	}
	if kind != engine.DecisionMain {
		t.Fatalf("seat %d after bidding: PendingDeciders owes %v, want DecisionMain", cur, kind)
	}
	if !armed {
		t.Fatalf("seat %d after bidding: no deadline armed during the vote", cur)
	}
}

// TestPlacerIsNotDoubleClocked: a seat the vote is waiting on appears once, as
// the module decider, without a main-turn deadline as well. The placer is
// where the two can coincide, because blocksTurnActions holds it.
func TestPlacerIsNotDoubleClocked(t *testing.T) {
	a, _ := loadCaravansVoting(t, 4, 60)
	a.call(func() {
		x, _ := scenarios.CaravansStateExt(a.state)
		x.Placer = a.state.Cur
		for p := range len(a.state.Players) {
			x.Bidded[engine.PlayerID(p)] = true
		}
	})
	var kinds []engine.DecisionKind
	a.call(func() {
		for _, d := range engine.PendingDeciders(a.state) {
			if d.Seat == a.state.Cur {
				kinds = append(kinds, d.Kind)
			}
		}
	})
	if len(kinds) != 1 || kinds[0] != engine.DecisionModule {
		t.Fatalf("placer (also the seat that is up) owes %v, want exactly one DecisionModule", kinds)
	}
}

// TestActiveSeatUnclockedBeforeBidding: before it has bid, the seat that
// is up is gated by the module and its only decider is the bid it owes.
func TestActiveSeatUnclockedBeforeBidding(t *testing.T) {
	a, _ := loadCaravansVoting(t, 4, 60)
	var kinds []engine.DecisionKind
	a.call(func() {
		for _, d := range engine.PendingDeciders(a.state) {
			if d.Seat == a.state.Cur {
				kinds = append(kinds, d.Kind)
			}
		}
	})
	if len(kinds) != 1 || kinds[0] != engine.DecisionModule {
		t.Fatalf("a seat that has not bid owes %v, want exactly one DecisionModule", kinds)
	}
}
