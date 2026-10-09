package bot

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
)

func TestSetupRoadNetLoads(t *testing.T) {
	n, err := setupRoadNet.get()
	if err != nil {
		t.Fatal(err)
	}
	if len(n.Names) != setupRoadFeatures {
		t.Fatalf("net declares %d features, code builds %d", len(n.Names), setupRoadFeatures)
	}
	// The order is the contract with the trained net.
	if n.Names[0] != "far_pips" || n.Names[setupRoadFeatures-1] != "my_distinct_so_far" {
		t.Fatalf("feature order changed: %v", n.Names)
	}
}

// TestSetupRoadDisagrees checks the option changes decisions. An option that
// never does would ladder as a neutral result rather than as a no-op.
func TestSetupRoadDisagrees(t *testing.T) {
	hand := NewStrong()
	learned := NewStrong(WithLearnedSetupRoad())
	diff, n := 0, 0
	for seed := uint64(1); seed <= 150; seed++ {
		s := newBaseGame(t, seed)
		// Place a settlement first so a road is owed and LastSettlement is set.
		cmd, ok := hand.Act(s, s.Cur)
		if !ok || cmd.Type != engine.CmdPlaceSettlement {
			continue
		}
		evs, err := engine.Decide(s, cmd)
		if err != nil {
			continue
		}
		for _, e := range evs {
			if err := engine.Apply(s, e); err != nil {
				t.Fatal(err)
			}
		}
		if !s.NeedRoad {
			continue
		}
		a, ok1 := hand.Act(s.Clone(), s.Cur)
		c, ok2 := learned.Act(s.Clone(), s.Cur)
		if !ok1 || !ok2 || a.Type != engine.CmdPlaceRoad {
			continue
		}
		n++
		if string(a.Data) != string(c.Data) {
			diff++
		}
	}
	if n == 0 {
		t.Fatal("no setup-road decision reached on any board")
	}
	t.Logf("opening road differs on %d of %d boards (%.0f%%)", diff, n, 100*float64(diff)/float64(n))
	if diff == 0 {
		t.Fatal("learned scorer never differs from the hand-written one")
	}
}
