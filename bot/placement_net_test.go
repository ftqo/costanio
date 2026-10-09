package bot

import (
	"fmt"
	"math"
	"testing"

	"github.com/ftqo/costan.io/engine"
)

func TestPlacementNetLoads(t *testing.T) {
	n, err := placementNetwork()
	if err != nil {
		t.Fatal(err)
	}
	if len(n.Names) != placementFeatures {
		t.Fatalf("net declares %d features, code builds %d", len(n.Names), placementFeatures)
	}
	// The feature order is the contract with the trained net. A rename or a
	// reordering in training silently permutes the inputs, so pin the first and last.
	if n.Names[0] != "pip_wood" || n.Names[placementFeatures-1] != "is_second" {
		t.Fatalf("feature order changed: %v", n.Names)
	}
	for i := range n.Sd {
		if n.Sd[i] <= 0 {
			t.Fatalf("feature %s has non-positive sd %f", n.Names[i], n.Sd[i])
		}
	}
}

// TestPlacementNetScores checks the scorer produces finite, varying, repeatable
// numbers on a real opening, and that it builds exactly the declared inputs.
func TestPlacementNetScores(t *testing.T) {
	s := newBaseGame(t, 42)
	b := NewStrong(WithLearnedPlacement())
	bi := b.cache(s)

	seen := map[float64]bool{}
	for _, v := range bi.vertices {
		if engine.CheckSettlementSpot(s, v) != nil {
			continue
		}
		if got := len(b.placementInputs(s, 0, v)); got != placementFeatures {
			t.Fatalf("built %d features, want %d", got, placementFeatures)
		}
		sc := b.placementScore(s, 0, v)
		if math.IsNaN(sc) || math.IsInf(sc, 0) {
			t.Fatalf("vertex %v scored %v", v, sc)
		}
		if sc != b.placementScore(s, 0, v) {
			t.Fatalf("vertex %v scored differently on a repeat call", v)
		}
		seen[sc] = true
	}
	if len(seen) < 5 {
		t.Fatalf("only %d distinct scores across the board", len(seen))
	}
}

// TestLearnedPlacementDiffers checks the learned net (the default) and
// WithHandPlacement pick differently on at least one board, so the option is
// not a no-op. It sweeps boards because the policies agree on about 35% of them.
func TestLearnedPlacementDiffers(t *testing.T) {
	const boards = 40
	differed := 0
	var example string
	for seed := uint64(1); seed <= boards; seed++ {
		s := newBaseGame(t, seed)
		hand := NewStrong(WithHandPlacement())
		learned := NewStrong(WithLearnedPlacement())
		a, ok1 := hand.Act(s.Clone(), 0)
		c, ok2 := learned.Act(s.Clone(), 0)
		if !ok1 || !ok2 {
			t.Fatalf("seed %d: no placement produced (hand=%v learned=%v)", seed, ok1, ok2)
		}
		if a.Type != engine.CmdPlaceSettlement || c.Type != engine.CmdPlaceSettlement {
			t.Fatalf("seed %d: expected placements, got %v and %v", seed, a.Type, c.Type)
		}
		if string(a.Data) != string(c.Data) {
			differed++
			if example == "" {
				example = fmt.Sprintf("seed %d: hand-written picks %s, learned picks %s",
					seed, a.Data, c.Data)
			}
		}
	}
	if differed == 0 {
		t.Fatalf("learned net matched the hand-written opening on all %d boards", boards)
	}
	t.Logf("openings differ on %d/%d boards; %s", differed, boards, example)
}
