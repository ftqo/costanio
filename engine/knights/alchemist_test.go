package knights

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
)

// The Alchemist names both dice. The roll must show the named faces in the
// order named, and the second is the red production die, which gates the
// progress-card draw (engine/knights/hooks.go, `red := d2`). A swap leaves the
// total unchanged but alters the draw, so both are asserted.
func TestAlchemistNamedDiceLandInOrder(t *testing.T) {
	cases := []struct{ d1, d2 int }{
		{1, 6},
		{6, 1},
		{2, 5},
		{5, 2},
		{3, 4},
		{1, 1},
	}
	for _, tc := range cases {
		s, _ := newGame(t, 21, nil)
		p := s.Cur
		x := ext(s)
		x.Players[p].Progress = []ProgressCard{CardAlchemist}

		step(t, s, engine.Command{Player: p, Type: CmdPlayProgress,
			Data: mustJSON(t, map[string]any{"card": CardAlchemist, "d1": tc.d1, "d2": tc.d2})})
		if x.AlchemistD1 != tc.d1 || x.AlchemistD2 != tc.d2 {
			t.Fatalf("fixed dice = %d,%d, want %d,%d", x.AlchemistD1, x.AlchemistD2, tc.d1, tc.d2)
		}

		events := step(t, s, engine.Command{Player: p, Type: engine.CmdRollDice})

		var sawRoll, sawDie bool
		for _, e := range events {
			switch e.Type {
			case engine.EvDiceRolled:
				d := engine.DecodeEvent[engine.DiceRolledData](e)
				if d.D1 != tc.d1 || d.D2 != tc.d2 {
					t.Errorf("rolled %d,%d, want %d,%d", d.D1, d.D2, tc.d1, tc.d2)
				}
				sawRoll = true
			case EvEventDie:
				d := engine.DecodeEvent[eventDieData](e)
				if d.Red != tc.d2 {
					t.Errorf("event-die red = %d, want the second named face %d", d.Red, tc.d2)
				}
				sawDie = true
			default:
				// only the two dice events are under test here
			}
		}
		if !sawRoll {
			t.Errorf("no dice_rolled for %d,%d", tc.d1, tc.d2)
		}
		if !sawDie {
			t.Errorf("no event die for %d,%d", tc.d1, tc.d2)
		}
	}
}
