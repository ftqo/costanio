package cosmetics

import (
	"math"
	"testing"
)

// Reference pairs from Sharma et al. (2005), "The CIEDE2000 Color-Difference
// Formula", Table 1. Inputs are L*a*b*; expected ΔE00 to 4 decimals.
func TestDeltaE2000Reference(t *testing.T) {
	cases := []struct {
		l1, a1, b1, l2, a2, b2, want float64
	}{
		{50, 2.6772, -79.7751, 50, 0, -82.7485, 2.0425},
		{50, 3.1571, -77.2803, 50, 0, -82.7485, 2.8615},
		{50, 2.8361, -74.0200, 50, 0, -82.7485, 3.4412},
		{50, -1.3802, -84.2814, 50, 0, -82.7485, 1.0000},
		{50, 2.5, 0, 50, 0, -2.5, 4.3065},
		{50, 2.5, 0, 73, 25, -18, 27.1492},
		{50, 2.5, 0, 50, 3.1736, 0.5854, 1.0000},
		{50, 2.5, 0, 50, 3.2972, 0, 1.0000},
	}
	for i, c := range cases {
		got := DeltaE2000([3]float64{c.l1, c.a1, c.b1}, [3]float64{c.l2, c.a2, c.b2})
		if math.Abs(got-c.want) > 1e-3 {
			t.Errorf("case %d: ΔE00 = %.4f; want %.4f", i, got, c.want)
		}
	}
}

func TestHexToLabKnown(t *testing.T) {
	// Pure white and black anchor the conversion.
	if lab := hexToLab("#ffffff"); math.Abs(lab[0]-100) > 0.1 || math.Abs(lab[1]) > 0.1 || math.Abs(lab[2]) > 0.1 {
		t.Errorf("white -> %v; want ~[100,0,0]", lab)
	}
	if lab := hexToLab("#000000"); math.Abs(lab[0]) > 0.1 {
		t.Errorf("black L = %.2f; want ~0", lab[0])
	}
}
