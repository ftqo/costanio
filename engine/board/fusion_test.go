package board

import "testing"

// opaque hides a value from constant folding, so the arithmetic below is what
// the compiler emits for the solver rather than an exact compile-time result.
//
//go:noinline
func opaque(x float64) float64 { return x }

// TestPenaltyArithmeticIsNotFused: `a + b + x*20` may compile to a fused
// multiply-add (it does on arm64), giving 91.2 instead of the
// 91.19999999999999 amd64 and JavaScript compute, so boards would differ by
// architecture and verify/board.mjs could not reproduce them. roundf prevents
// the fusion; this fails if that protection is lost.
func TestPenaltyArithmeticIsNotFused(t *testing.T) {
	numPart, resPart, pip := opaque(18), opaque(40), opaque(1.66)
	// What every IEEE-754 double implementation, JavaScript included, computes
	// when the multiply rounds before the add.
	const want = 91.19999999999999
	if got := numPart + resPart + roundf(pip*20); got != want {
		t.Errorf("penalty sum = %v (bits %x), want %v (multiply fused into add)", got, got, want)
	}
}
