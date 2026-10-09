package rating

import "testing"

func TestDisplayRoundTrip(t *testing.T) {
	// Backfill: an existing elo of 1000 at sigma 6 must Display back to 1000.
	mu := MuForDisplay(1000, ProvisionalSigma)
	got := Display(Player{Mu: mu, Sigma: ProvisionalSigma})
	if got != 1000 {
		t.Fatalf("round trip: got %d want 1000", got)
	}
	if Display(Player{Mu: MuForDisplay(1432, 6), Sigma: 6}) != 1432 {
		t.Fatalf("round trip 1432 failed")
	}
}

func TestProvisional(t *testing.T) {
	if !Provisional(Player{Mu0, Sigma0}) {
		t.Fatal("fresh player must be provisional")
	}
	if Provisional(Player{30, 3}) {
		t.Fatal("settled player must not be provisional")
	}
}

func TestDecayInflatesSigma(t *testing.T) {
	p := Player{Mu: 30, Sigma: 2}
	d := Decayed(p, 30)
	if d.Sigma <= p.Sigma {
		t.Fatalf("sigma should inflate: %.3f -> %.3f", p.Sigma, d.Sigma)
	}
	if d.Mu != p.Mu {
		t.Fatal("decay must not move mu")
	}
	if Decayed(Player{Mu: 30, Sigma: Sigma0}, 9999).Sigma > MaxSigma+1e-9 {
		t.Fatal("sigma must be capped at MaxSigma")
	}
}
