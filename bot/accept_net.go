package bot

import (
	_ "embed"
	"math"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// Accept or decline, cloned from human play.
//
// Trained on 1749287 responses to plain offers in human games: AUC 0.780 on
// held-out games against 0.634 for "accept if the trade completes a build",
// and accuracy 0.849 against always-decline's 0.844 (15.6% of offers are
// accepted). AUC is the target because the bot only needs to rank offers;
// acceptThreshold is tuned on the ladder.
//
// The responder's own hand is an input (its own information). Everything about
// the offerer is public: piece counts, visible VP, hand size.
//
// Features must match the training order, recorded in accept_net.json's
// "features" list.

//go:embed accept_net.json
var acceptNetJSON []byte

const acceptFeatures = 24

var acceptNet = newLazyNet(&acceptNetJSON, acceptFeatures, "accept net")

// acceptProbability returns the cloned policy's probability that a strong human
// would take this offer, and whether it could be computed at all.
func (b *Strong) acceptProbability(s *engine.State, seat engine.PlayerID) (float64, bool) {
	net, err := acceptNet.get()
	if err != nil || s.ActiveOffer == nil {
		return 0, false
	}
	var x [acceptFeatures]float64
	f := b.acceptInputs(s, seat, x[:0])
	if f == nil {
		return 0, false
	}
	return 1 / (1 + math.Exp(-net.score(f))), true
}

// acceptInputs builds the feature vector from the responder's seat. The
// responder gets what the offerer put up and gives what the offerer asked for.
func (b *Strong) acceptInputs(s *engine.State, seat engine.PlayerID, x []float64) []float64 {
	o := s.ActiveOffer
	hand := s.Players[seat].Hand
	gets, gives := o.Give, o.Want
	if !hand.Has(gives) {
		return nil // could not have paid: not a decision
	}

	after := hand
	getCount, giveCount := 0, 0
	scarceGet, scarceGive := 0.0, 0.0
	for _, r := range board.Resources {
		after[r] += gets[r] - gives[r]
		getCount += gets[r]
		giveCount += gives[r]
		if gets[r] > 0 && hand[r] == 0 {
			scarceGet++
		}
		if gives[r] > 0 && hand[r] <= 1 {
			scarceGive++
		}
	}

	completes := func(cost engine.Hand) float64 {
		return btof(after.Has(cost) && !hand.Has(cost))
	}

	handSize, afterSize := 0, 0
	for _, r := range board.Resources {
		handSize += hand[r]
		afterSize += after[r]
	}

	myVP := s.PublicVPWithModules(seat)
	offVP := s.PublicVPWithModules(o.By)
	leader := 0
	for p := range s.Players {
		if vp := s.PublicVPWithModules(engine.PlayerID(p)); vp > leader {
			leader = vp
		}
	}

	count := func(who engine.PlayerID) (float64, float64) {
		set, cit := 0.0, 0.0
		for _, bld := range s.Buildings {
			if bld.Owner != who {
				continue
			}
			if bld.City {
				cit++
			} else {
				set++
			}
		}
		return set, cit
	}
	mySet, myCit := count(seat)
	offSet, offCit := count(o.By)

	offHand := 0
	for _, r := range board.Resources {
		offHand += s.Players[o.By].Hand[r]
	}

	// How little we produce of what is moving, from our own board.
	pipsOf := perResourcePips(s, seat)
	wantProd, giveProd := 0.0, 0.0
	for _, r := range board.Resources {
		if gives[r] > 0 {
			wantProd += pipsOf[r]
		}
		if gets[r] > 0 {
			giveProd += pipsOf[r]
		}
	}

	x = append(x,
		float64(getCount), float64(giveCount), float64(getCount-giveCount),
		scarceGet, scarceGive,
		completes(engine.CostRoad), completes(engine.CostSettlement),
		completes(engine.CostCity), completes(engine.CostDevCard),
		float64(handSize), btof(afterSize > 7),
		float64(offVP), btof(offVP == leader), float64(offVP-myVP),
		float64(offHand), offSet, offCit,
		float64(myVP), float64(myVP-leader), mySet, myCit,
		wantProd, giveProd,
		float64(s.TurnsCompleted))
	return x
}
