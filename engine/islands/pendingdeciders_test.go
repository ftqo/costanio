package islands

import (
	"reflect"
	"slices"
	"testing"

	"github.com/ftqo/costan.io/engine"
)

func TestPendingDecidersGoldOwed(t *testing.T) {
	s := builtState(t, 3)
	x := ext(s)
	x.PendingGold = map[engine.PlayerID]int{2: 1, 0: 2}
	var seats []engine.PlayerID
	for _, d := range (Module{}).Hooks().PendingDeciders(s) {
		if d.Decision != DecisionGoldPick {
			t.Errorf("gold pick reported as %q, want %q", d.Decision, DecisionGoldPick)
		}
		seats = append(seats, d.Seat)
	}
	slices.Sort(seats)
	if want := []engine.PlayerID{0, 2}; !reflect.DeepEqual(seats, want) {
		t.Fatalf("PendingDeciders = %v, want %v", seats, want)
	}
}

func TestPendingDecidersNoneWhenEmpty(t *testing.T) {
	s := builtState(t, 3)
	if seats := (Module{}).Hooks().PendingDeciders(s); len(seats) != 0 {
		t.Fatalf("want no deciders, got %v", seats)
	}
}
