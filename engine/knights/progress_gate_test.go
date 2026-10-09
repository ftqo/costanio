package knights

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
)

// drawsOnGate rolls until a non-ship event-die face appears with the given red
// value (every player pre-set to improvement `level` in all tracks) and reports
// whether the gated player drew a progress card on that roll.
func drawsOnGate(t *testing.T, level, red int) (sawGate, drew bool) {
	t.Helper()
	s, _ := newGame(t, 5, nil)
	x := ext(s)
	for p := range s.Players {
		x.Players[p].Improve[Trade] = level
		x.Players[p].Improve[Politics] = level
		x.Players[p].Improve[Science] = level
	}
	for i := 0; i < 200 && !sawGate; i++ {
		out := (Module{}).onDiceRolled(s, 6-red, red) // d2==red drives the gate
		gate, drewThis := false, false
		for j := range out {
			switch out[j].Type {
			case EvEventDie:
				if engine.DecodeEvent[eventDieData](out[j]).Face != "ship" {
					gate = true
				}
			case EvProgressDrawn:
				drewThis = true
			default:
			}
			out[j].Seq = s.NextSeq
			if err := engine.Apply(s, out[j]); err != nil {
				t.Fatal(err)
			}
		}
		if gate {
			sawGate, drew = true, drewThis
		}
		if x.Barbarians >= barbarianTrack-1 {
			x.Barbarians = 0
		}
	}
	return sawGate, drew
}

// TestProgressGateDrawsAtLevelPlusOne: a level-1 city draws on red=2 (it shows
// two red pips).
func TestProgressGateDrawsAtLevelPlusOne(t *testing.T) {
	sawGate, drew := drawsOnGate(t, 1, 2)
	if !sawGate {
		fixtureGone(t, "no gate face seen")
	}
	if !drew {
		t.Error("level-1 city did not draw on red=2; the chart draws on red<=level+1")
	}
}

// TestProgressGateNoDrawAboveThreshold: a level-1 city does not draw on red=3.
func TestProgressGateNoDrawAboveThreshold(t *testing.T) {
	sawGate, drew := drawsOnGate(t, 1, 3)
	if !sawGate {
		fixtureGone(t, "no gate face seen")
	}
	if drew {
		t.Error("level-1 city drew on red=3; must require red<=level+1 (==2)")
	}
}

// TestProgressGateTopLevelDrawsOnSix: the top level draws on every red value,
// including 6.
func TestProgressGateTopLevelDrawsOnSix(t *testing.T) {
	sawGate, drew := drawsOnGate(t, maxImprovement, 6)
	if !sawGate {
		fixtureGone(t, "no gate face seen")
	}
	if !drew {
		t.Error("max-level city did not draw on red=6; top level draws regardless of red")
	}
}
