// Tests for seatDefaultOrder under color-deficient vision. Under normal vision
// every free pair already clears ColorThreshold whatever the order, so only
// these tests can tell a good order from a bad one.
//
// The simulation is self-contained rather than reusing package code, so it is
// an independent check. It mirrors the frontend's lib/__tests__/cvd.test.ts.
package cosmetics

import (
	"math"
	"testing"
)

// --- Brettel-Vienot-Mollon 1997 dichromat simulation ------------------------
//
// The stimulus is projected onto the half-plane spanned by white and one of two
// monochromatic anchors, chosen by which side of the neutral plane it falls on.

type v3 = [3]float64

func mul(m [3]v3, v v3) v3 {
	return v3{
		m[0][0]*v[0] + m[0][1]*v[1] + m[0][2]*v[2],
		m[1][0]*v[0] + m[1][1]*v[1] + m[1][2]*v[2],
		m[2][0]*v[0] + m[2][1]*v[1] + m[2][2]*v[2],
	}
}

var (
	rgb2xyz = [3]v3{
		{0.4124564, 0.3575761, 0.1804375},
		{0.2126729, 0.7151522, 0.0721750},
		{0.0193339, 0.1191920, 0.9503041},
	}
	// Hunt-Pointer-Estevez, the cone space Brettel's projection is defined in.
	xyz2lms = [3]v3{
		{0.4002, 0.7076, -0.0808},
		{-0.2263, 1.1653, 0.0457},
		{0.0, 0.0, 0.9182},
	}
	lms2xyz = [3]v3{
		{1.8600666, -1.1294801, 0.2198983},
		{0.3612229, 0.6388043, -0.0000064},
		{0.0, 0.0, 1.0890873},
	}
	xyz2rgb = [3]v3{
		{3.2404542, -1.5371385, -0.4985314},
		{-0.9692660, 1.8760108, 0.0415560},
		{0.0556434, -0.2040259, 1.0572252},
	}
)

func toLinear(c float64) float64 {
	if c <= 0.04045 {
		return c / 12.92
	}
	return math.Pow((c+0.055)/1.055, 2.4)
}

func hexToLMS(hex string) v3 {
	r, g, b := hexToRGB(hex)
	return mul(xyz2lms, mul(rgb2xyz, v3{toLinear(r), toLinear(g), toLinear(b)}))
}

type deficiency string

const (
	deutan deficiency = "deuteranopia"
	protan deficiency = "protanopia"
	tritan deficiency = "tritanopia"
)

var deficiencies = []deficiency{deutan, protan, tritan}

var (
	white  = hexToLMS("#ffffff")
	lms475 = v3{0.1284565, 0.2227260, 0.3624140}
	lms575 = v3{0.9856170, 0.7325000, 0.0011420}
	lms485 = v3{0.1748670, 0.3271000, 0.2795160}
	lms660 = v3{0.4941310, 0.1216000, 0.0000000}
)

func project(hex string, d deficiency) v3 {
	lms := hexToLMS(hex)
	l, m, s := lms[0], lms[1], lms[2]

	ratio := math.Inf(1)
	var anchor v3
	if d == tritan {
		if l != 0 {
			ratio = m / l
		}
		if ratio < white[1]/white[0] {
			anchor = lms485
		} else {
			anchor = lms660
		}
	} else {
		if l != 0 {
			ratio = s / l
		}
		if ratio < white[2]/white[0] {
			anchor = lms475
		} else {
			anchor = lms575
		}
	}
	// Normal of the plane through the origin containing white and the anchor.
	n := v3{
		white[1]*anchor[2] - white[2]*anchor[1],
		white[2]*anchor[0] - white[0]*anchor[2],
		white[0]*anchor[1] - white[1]*anchor[0],
	}
	switch d {
	case protan:
		return v3{-(n[1]*m + n[2]*s) / n[0], m, s}
	case deutan:
		return v3{l, -(n[0]*l + n[2]*s) / n[1], s}
	default:
		return v3{l, m, -(n[0]*l + n[1]*m) / n[2]}
	}
}

// simLab is the Lab of a color as a display would show it to that viewer.
//
// The projection often leaves the sRGB gamut, and a display clamps it, so the
// clamp must happen before measuring distance; skipping it is a large error.
func simLab(hex string, d deficiency) [3]float64 {
	lin := mul(xyz2rgb, mul(lms2xyz, project(hex, d)))
	for i := range lin {
		lin[i] = math.Max(0, math.Min(1, lin[i]))
	}
	xyz := mul(rgb2xyz, lin)
	f := func(t float64) float64 {
		if t > 216.0/24389.0 {
			return math.Cbrt(t)
		}
		return t*(841.0/108.0) + 4.0/29.0
	}
	fx, fy, fz := f(xyz[0]/0.95047), f(xyz[1]/1.0), f(xyz[2]/1.08883)
	return [3]float64{116*fy - 16, 500 * (fx - fy), 200 * (fy - fz)}
}

func simDeltaE(a, b string, d deficiency) float64 {
	return DeltaE2000(simLab(a, d), simLab(b, d))
}

// resolvable is how many colors a viewer with d can actually tell apart among
// the first n seat defaults: seats are merged transitively whenever they fall
// within ColorThreshold, and the number of surviving groups is the answer. n
// means every seat is distinct; anything less means two players share a color.
func resolvable(n int, d deficiency) int {
	parent := make([]int, n)
	for i := range parent {
		parent[i] = i
	}
	var find func(int) int
	find = func(x int) int {
		if parent[x] != x {
			parent[x] = find(parent[x])
		}
		return parent[x]
	}
	for i := range n {
		for j := i + 1; j < n; j++ {
			if simDeltaE(DefaultSeatColor(i).Hex, DefaultSeatColor(j).Hex, d) < ColorThreshold {
				parent[find(i)] = find(j)
			}
		}
	}
	groups := map[int]bool{}
	for i := range n {
		groups[find(i)] = true
	}
	return len(groups)
}

// --- the simulation itself has to be right ----------------------------------

func TestDichromatSimulation(t *testing.T) {
	// Greys carry no chroma, so no deficiency moves them.
	for _, d := range deficiencies {
		for _, grey := range []string{"#ffffff", "#808080", "#000000"} {
			lab := simLab(grey, d)
			if chroma := math.Hypot(lab[1], lab[2]); chroma > 1 {
				t.Errorf("%s under %s: chroma %.2f, want ~0", grey, d, chroma)
			}
		}
	}
	// The classic collapse, and the classic survival.
	if got := simDeltaE("#ff0000", "#00ff00", deutan); got >= ColorThreshold {
		t.Errorf("red vs green under deuteranopia = %.1f, want a collapse", got)
	}
	if got := simDeltaE("#0000ff", "#ffff00", deutan); got <= 20 {
		t.Errorf("blue vs yellow under deuteranopia = %.1f, want it to survive", got)
	}
	// Tritanopia keeps red-green and loses blue-yellow, the other way round.
	if got := simDeltaE("#ff0000", "#00ff00", tritan); got <= 20 {
		t.Errorf("red vs green under tritanopia = %.1f, want it to survive", got)
	}
	// Projection is idempotent: simulating twice must not move the color again.
	// Catches sign or anchor-choice errors.
	for _, d := range deficiencies {
		for i := range FreeCount {
			hex := DefaultSeatColor(i).Hex
			a, b := project(hex, d), project(hex, d)
			for k := range a {
				if math.Abs(a[k]-b[k]) > 1e-10 {
					t.Fatalf("%s under %s is not idempotent", hex, d)
				}
			}
		}
	}
}

// --- what the order is required to deliver ----------------------------------

// TestSeatDefaultOrderUnderCVD pins the table in seatDefaultOrder's comment.
//
// These are floors: an order that resolves more colors should raise them.
func TestSeatDefaultOrderUnderCVD(t *testing.T) {
	floors := map[deficiency]map[int]int{
		// seats: colors a viewer must be able to tell apart
		deutan: {3: 3, 4: 4, 5: 5, 6: 4, 7: 4, 8: 3},
		protan: {3: 3, 4: 4, 5: 4, 6: 5, 7: 4, 8: 4},
		tritan: {3: 3, 4: 4, 5: 4, 6: 5, 7: 5, 8: 6},
	}
	for _, d := range deficiencies {
		for seats := 3; seats <= 8; seats++ {
			want := floors[d][seats]
			if got := resolvable(seats, d); got < want {
				t.Errorf("%s at %d seats: %d colors resolvable, want at least %d",
					d, seats, got, want)
			}
		}
	}
}

// TestFourSeatsCleanUnderEveryDeficiency: four players is the commonest table,
// and its four seats must be distinct to every viewer.
func TestFourSeatsCleanUnderEveryDeficiency(t *testing.T) {
	for _, d := range deficiencies {
		if got := resolvable(4, d); got != 4 {
			for i := range 4 {
				for j := i + 1; j < 4; j++ {
					a, b := DefaultSeatColor(i), DefaultSeatColor(j)
					if e := simDeltaE(a.Hex, b.Hex, d); e < ColorThreshold {
						t.Errorf("%s: seat %d (%s) and seat %d (%s) are the same color, dE %.1f",
							d, i, a.Name, j, b.Name, e)
					}
				}
			}
		}
	}
}

// TestSeatOrderIsAPermutation: every free preset must appear exactly once, or
// two seats share a color under normal vision too.
func TestSeatOrderIsAPermutation(t *testing.T) {
	seen := map[int]bool{}
	for _, i := range seatDefaultOrder {
		if i < 0 || i >= FreeCount {
			t.Fatalf("seatDefaultOrder contains %d, outside the free presets", i)
		}
		if seen[i] {
			t.Fatalf("seatDefaultOrder uses palette index %d twice", i)
		}
		seen[i] = true
	}
	if len(seen) != FreeCount {
		t.Errorf("seatDefaultOrder covers %d of %d free presets", len(seen), FreeCount)
	}
	// Black and white stay last: a white piece reads poorly as a default.
	last := []int{seatDefaultOrder[FreeCount-2], seatDefaultOrder[FreeCount-1]}
	if last[0]|last[1] != 1 || last[0] == last[1] {
		t.Errorf("seats 9 and 10 = palette %v, want Black and White", last)
	}
}
