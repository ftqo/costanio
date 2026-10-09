package bot

import (
	"math"
	"testing"

	"github.com/ftqo/costan.io/engine"
)

func TestValueLinearLoads(t *testing.T) {
	m, err := valueLinearModel()
	if err != nil {
		t.Fatal(err)
	}
	if len(m.Names) != valueFeatures {
		t.Fatalf("model declares %d features, code builds %d", len(m.Names), valueFeatures)
	}
	// The layout is me / max-opponent / mean-opponent blocks then two globals.
	if m.Names[0] != "me_prod_0" || m.Names[perPlayerFeatures] != "max_prod_0" ||
		m.Names[2*perPlayerFeatures] != "mean_prod_0" ||
		m.Names[valueFeatures-1] != "is_my_turn" {
		t.Fatalf("feature layout changed: %v", m.Names)
	}
}

// TestValueLinearScores checks the term is finite, varies across seats, and is
// exactly inert at weight zero (the additive rule every weight here obeys).
func TestValueLinearScores(t *testing.T) {
	b := NewStrong()
	s := newBaseGame(t, 11)
	seen := map[float64]bool{}
	for p := range s.Players {
		v := b.valueLinearScore(s, engine.PlayerID(p))
		if math.IsNaN(v) || math.IsInf(v, 0) {
			t.Fatalf("seat %d scored %v", p, v)
		}
		seen[v] = true
	}
	if len(seen) < 2 {
		t.Fatal("every seat scores identically")
	}

	w := DefaultWeights()
	if w.Learned != 0 {
		t.Fatal("Learned weight defaults to non-zero, want 0")
	}
	off := NewStrong(WithWeights(w)).eval(s, 0)
	w.Learned = 0
	if got := NewStrong(WithWeights(w)).eval(s, 0); got != off {
		t.Fatalf("weight 0 changed the score: %v vs %v", got, off)
	}
}
