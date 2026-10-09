package rating

import "math"

const (
	DisplayScale     = 24.0
	DisplayOffset    = 1000.0
	ProvisionalSigma = 6.0
	DecayDriftPerDay = 0.2
	MaxSigma         = Sigma0
)

// Display maps conservative skill to the familiar ~1000-centered integer.
func Display(p Player) int {
	return int(math.Round(DisplayScale*Conservative(p) + DisplayOffset))
}

// Provisional reports whether the rating is still calibrating (wide sigma).
func Provisional(p Player) bool { return p.Sigma > ProvisionalSigma }

// MuForDisplay inverts Display at a fixed sigma: used to backfill mu from an
// existing elo during migration. Display = scale*(mu-3sigma)+offset.
func MuForDisplay(elo int, sigma float64) float64 {
	return (float64(elo)-DisplayOffset)/DisplayScale + 3*sigma
}

// Decayed inflates sigma for an idle player (soft decay), capped at MaxSigma.
func Decayed(p Player, daysIdle float64) Player {
	drift := DecayDriftPerDay * daysIdle
	s := math.Sqrt(p.Sigma*p.Sigma + drift*drift)
	if s > MaxSigma {
		s = MaxSigma
	}
	return Player{Mu: p.Mu, Sigma: s}
}
