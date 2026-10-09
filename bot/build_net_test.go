package bot

import (
	"math"
	"testing"
)

func TestBuildNetLoads(t *testing.T) {
	n, err := buildNet.get()
	if err != nil {
		t.Fatal(err)
	}
	if len(n.Names) != buildFeatures {
		t.Fatalf("net declares %d features, code builds %d", len(n.Names), buildFeatures)
	}
	// The order is the contract with the trained net.
	if n.Names[0] != "is_road" || n.Names[4] != "is_end" ||
		n.Names[buildFeatures-1] != "blocks_opponent" {
		t.Fatalf("feature order changed: %v", n.Names)
	}
}

// TestBuildInputsShape pins the feature count the Go side actually emits: a
// mismatch against the net's expectation would score garbage rather than fail.
func TestBuildInputsShape(t *testing.T) {
	s := newBaseGame(t, 7)
	b := NewStrong(WithLearnedBuild())
	var x [buildFeatures]float64
	for _, k := range []buildKind{kindRoad, kindSettlement, kindCity, kindDev, kindEnd} {
		got := b.buildInputs(s, 0, buildCand{kind: k}, x[:0])
		if len(got) != buildFeatures {
			t.Fatalf("kind %d built %d features, want %d", k, len(got), buildFeatures)
		}
		for i, v := range got {
			if math.IsNaN(v) || math.IsInf(v, 0) {
				t.Fatalf("kind %d feature %d is %v", k, i, v)
			}
		}
	}
}

// End-to-end play is covered by sim: a bare Act loop does not advance a game
// (the actor owns dice, pendings and turn flow).
