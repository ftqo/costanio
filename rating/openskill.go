// Package rating implements a placement-aware, uncertainty-aware skill rating
// (Weng-Lin 2011 Bradley-Terry full-pairwise model, the basis of OpenSkill's
// BradleyTerryFull). Each player is a Gaussian (Mu, Sigma); a single game with
// a finishing order updates every player. Pure and deterministic.
package rating

import "math"

type Player struct {
	Mu    float64
	Sigma float64
}

const (
	Mu0    = 25.0
	Sigma0 = Mu0 / 3.0 // 8.3333
	Beta   = Sigma0 / 2.0
	Tau    = Sigma0 / 100.0 // additive dynamics: keeps sigma from collapsing to 0
	Kappa  = 1e-4           // floor multiplier so sigma^2 never goes negative
)

// Conservative is the displayed/match-making skill: Mu - 3*Sigma.
func Conservative(p Player) float64 { return p.Mu - 3*p.Sigma }

// Update returns new ratings given finishing ranks (1 = best; equal = tie).
// len(players) == len(ranks). Bradley-Terry full pairwise: each player is
// compared against every other; a player ranked ahead scored 1, tie 0.5,
// behind 0. Beta models per-game performance noise; Tau is added to variance
// before the update so ratings stay responsive.
func Update(players []Player, ranks []int) []Player {
	n := len(players)
	// Pre-inflate variance by Tau^2 (dynamics).
	varc := make([]float64, n) // sigma^2 + tau^2
	for i, p := range players {
		varc[i] = p.Sigma*p.Sigma + Tau*Tau
	}
	twoBeta2 := 2 * Beta * Beta
	out := make([]Player, n)
	for i := range players {
		var omega, delta float64
		for q := range players {
			if q == i {
				continue
			}
			ciq := math.Sqrt(varc[i] + varc[q] + twoBeta2)
			pi := 1 / (1 + math.Exp((players[q].Mu-players[i].Mu)/ciq))
			var s float64 // score of i vs q
			switch {
			case ranks[i] < ranks[q]:
				s = 1
			case ranks[i] == ranks[q]:
				s = 0.5
			default:
				s = 0
			}
			gamma := math.Sqrt(varc[i]) / ciq // per-comparison normalizer
			omega += varc[i] / ciq * (s - pi)
			delta += gamma * varc[i] / (ciq * ciq) * pi * (1 - pi)
		}
		newMu := players[i].Mu + omega
		newVar := varc[i] * math.Max(1-delta, Kappa)
		out[i] = Player{Mu: newMu, Sigma: math.Sqrt(newVar)}
	}
	return out
}
