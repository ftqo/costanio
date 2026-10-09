package knights

import (
	"reflect"
	"slices"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

func TestPendingDecidersUnionsInteractivePending(t *testing.T) {
	s, _ := newGame(t, 1, nil)
	x := ext(s)
	x.PendingGive = map[engine.PlayerID]int{1: 2}
	x.HarborGive = map[engine.PlayerID]board.Resource{2: board.Wood}
	var seats []engine.PlayerID
	for _, d := range (Module{}).Hooks().PendingDeciders(s) {
		seats = append(seats, d.Seat)
	}
	slices.Sort(seats)
	if want := []engine.PlayerID{1, 2}; !reflect.DeepEqual(seats, want) {
		t.Fatalf("PendingDeciders = %v, want %v", seats, want)
	}
}

// A seat owed only a one-tap pick (aqueduct resource, barbarian city sacrifice)
// is reported Quick so the timer layer gives it the short budget; a seat owed a
// deliberative pick as well keeps the longer one.
func TestPendingDecidersNamesEachObligation(t *testing.T) {
	s, _ := newGame(t, 1, nil)
	x := ext(s)
	x.Aqueduct = []engine.PlayerID{0}
	x.PendingDowngrade = []engine.PlayerID{1}
	x.PendingGive = map[engine.PlayerID]int{1: 2, 2: 1}

	// A seat may owe several at once (seat 1 here owes both a sacrifice and a
	// wedding give); each is reported so the timer layer can take the longest.
	got := map[engine.PlayerID][]string{}
	for _, d := range (Module{}).Hooks().PendingDeciders(s) {
		got[d.Seat] = append(got[d.Seat], d.Decision)
	}
	for _, ids := range got {
		slices.Sort(ids)
	}
	want := map[engine.PlayerID][]string{
		0: {DecisionAqueduct},
		1: {DecisionBarbarianDowngrade, DecisionWeddingGive},
		2: {DecisionWeddingGive},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("obligations = %v, want %v", got, want)
	}
}

func TestPendingDecidersNoneWhenIdle(t *testing.T) {
	s, _ := newGame(t, 1, nil)
	if seats := (Module{}).Hooks().PendingDeciders(s); len(seats) != 0 {
		t.Fatalf("want no deciders on a fresh turn, got %v", seats)
	}
}
