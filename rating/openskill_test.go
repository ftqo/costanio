package rating

import (
	"math"
	"testing"
)

func approx(t *testing.T, got, want, tol float64, msg string) {
	t.Helper()
	if math.Abs(got-want) > tol {
		t.Fatalf("%s: got %.4f want %.4f (tol %.4f)", msg, got, want, tol)
	}
}

// Two equal fresh players, player 0 wins. Hand-computed against the Weng-Lin
// BT-full formulas: c=sqrt(2*Sigma0^2 + 2*Beta^2)=13.1762, p=0.5,
// Omega_winner=(Sigma0^2/c)*0.5=+2.6352, Sigma^2 *= (1 - 0.06326).
func TestUpdate_TwoPlayerEqual(t *testing.T) {
	in := []Player{{Mu0, Sigma0}, {Mu0, Sigma0}}
	out := Update(in, []int{1, 2}) // player 0 first, player 1 second
	approx(t, out[0].Mu, 27.6352, 0.01, "winner mu")
	approx(t, out[1].Mu, 22.3648, 0.01, "loser mu")
	if !(out[0].Sigma < Sigma0 && out[1].Sigma < Sigma0) {
		t.Fatalf("sigma should shrink for both: %v", out)
	}
	approx(t, out[0].Sigma, 8.0655, 0.01, "winner sigma")
	// Symmetric mu movement around the mean.
	approx(t, (out[0].Mu+out[1].Mu)/2, Mu0, 1e-6, "mu mean conserved")
}

// 4-player FFA: placement order must be reflected in mu ordering, sigma shrinks.
func TestUpdate_FourPlayerOrdering(t *testing.T) {
	in := []Player{{Mu0, Sigma0}, {Mu0, Sigma0}, {Mu0, Sigma0}, {Mu0, Sigma0}}
	out := Update(in, []int{1, 2, 3, 4})
	for i := range 3 {
		if !(out[i].Mu > out[i+1].Mu) {
			t.Fatalf("place %d mu (%.3f) should exceed place %d mu (%.3f)", i+1, out[i].Mu, i+2, out[i+1].Mu)
		}
	}
	for i := range out {
		if out[i].Sigma >= Sigma0 {
			t.Fatalf("sigma should shrink for player %d: %.4f", i, out[i].Sigma)
		}
	}
}

// Ties update symmetrically.
func TestUpdate_Tie(t *testing.T) {
	in := []Player{{Mu0, Sigma0}, {Mu0, Sigma0}}
	out := Update(in, []int{1, 1})
	approx(t, out[0].Mu, Mu0, 1e-6, "tie mu 0 unchanged")
	approx(t, out[1].Mu, Mu0, 1e-6, "tie mu 1 unchanged")
}

func TestConservative(t *testing.T) {
	approx(t, Conservative(Player{25, 8}), 1.0, 1e-9, "conservative")
}
