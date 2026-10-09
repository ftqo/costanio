package bot

import (
	"maps"
	"math"
	"slices"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/scenarios"
)

// caravansGame returns a fresh 4-player base+caravans state with the camel
// module's ext populated, plus that ext.
func caravansGame(t *testing.T, seed uint64) (*engine.State, *scenarios.CaravansExt) {
	t.Helper()
	evs, err := engine.New(engine.GameConfig{Players: 4, Ruleset: engine.CanonicalRuleset("base+caravans")},
		engine.Seeds{Public: seed, Private: seed})
	if err != nil {
		t.Fatal(err)
	}
	s, err := engine.Replay(evs)
	if err != nil {
		t.Fatal(err)
	}
	s.Phase = engine.PhasePlay
	// No camel event has happened on a brand-new game, so the fold has not
	// created the module's ext yet.
	x, ok := scenarios.InitCaravansExt(s)
	if !ok || !x.HasOasis {
		t.Fatal("caravans ext missing or oasis-less")
	}
	return s, x
}

// place drives a real CmdPlaceCamel through the engine so the chain, the
// occupied set and the supply all move the way the rules say.
func place(t *testing.T, s *engine.State, seat engine.PlayerID, p engine.CamelPath) {
	t.Helper()
	x, _ := scenarios.CaravansStateExt(s)
	x.Voting, x.Placer = true, seat
	evs, err := engine.Decide(s, camelPlaceCmd(seat, p))
	if err != nil {
		t.Fatalf("place %+v: %v", p, err)
	}
	for _, e := range evs {
		e.Seq = s.NextSeq
		if err := engine.Apply(s, e); err != nil {
			t.Fatal(err)
		}
	}
}

// openRoundOn opens a camel round whose clock has come round to `seat`.
//
// Bidding runs from the finisher clockwise, one seat on the clock at a time
// (others get ErrNotYourTurn). Every seat between the finisher and `seat` is
// marked as answered in Bidded with no entry in Bids, i.e. it passed, so `seat`
// is the last to answer.
func openRoundOn(t *testing.T, s *engine.State, x *scenarios.CaravansExt, finisher, seat engine.PlayerID) {
	t.Helper()
	x.Voting, x.Placer, x.Finisher = true, engine.NoPlayer, finisher
	x.Bids = map[engine.PlayerID]scenarios.CamelBid{}
	x.Bidded = map[engine.PlayerID]bool{}
	for i := range len(s.Players) {
		p := engine.PlayerID((int(finisher) + i) % len(s.Players))
		if p == seat {
			return
		}
		x.Bidded[p] = true
	}
	t.Fatalf("seat %d is not in the bidding order behind finisher %d", seat, finisher)
}

// TestCamelPlaceHighestScoringPath: the bot picks the best path, not just any
// path.
//
// One path is clearly worth a point: caravan 1 has its first camel down, we own
// the settlement its chain runs through, and a second camel puts our building
// between two camels (+1 VP).
func TestCamelPlaceHighestScoringPath(t *testing.T) {
	s, x := caravansGame(t, 4)

	// Seed caravan 1 with one camel, then own the vertex its chain will run
	// through when the next camel extends it.
	var first engine.CamelPath
	for _, p := range scenarios.CamelPaths(s) {
		if p.Caravan == 1 {
			first = p
			break
		}
	}
	if first.E == (board.Edge{}) {
		t.Fatal("caravan 1 has no opening path")
	}
	place(t, s, 0, first)
	// Applying EvCamelPlaced closes the round (Voting false, Placer NoPlayer),
	// so re-open one for the camel under test.
	x.Voting, x.Placer = true, 0
	front := first.E.Other(x.ArrowCorner[1])
	s.Buildings[front] = engine.Building{Owner: 0}

	b := bidder()
	paths := scenarios.CamelPaths(s)
	if len(paths) < 2 {
		t.Fatalf("only %d paths", len(paths))
	}
	scores := make([]float64, len(paths))
	best, bestI := math.Inf(-1), -1
	for i, p := range paths {
		sc, ok := b.score(s, 0, camelPlaceCmd(0, p))
		if !ok {
			t.Fatalf("path %+v scored illegal", p)
		}
		scores[i] = sc
		if sc > best {
			best, bestI = sc, i
		}
	}
	// The paths must not all be worth the same, or any choice would pass.
	spread := best - scores[0]
	allSame := true
	for _, sc := range scores {
		if math.Abs(sc-scores[0]) > 1e-9 {
			allSame = false
		}
	}
	if allSame {
		t.Fatalf("every path scores %.4f", scores[0])
	}
	if bestI == 0 {
		t.Fatalf("best path is paths[0] (%.4f, spread %.4f)", best, spread)
	}

	cmd, ok := b.camelPlace(s, 0)
	if !ok {
		t.Fatal("camelPlace declined")
	}
	want := camelPlaceCmd(0, paths[bestI])
	if string(cmd.Data) != string(want.Data) {
		t.Errorf("placed %s, want %s (scores %v)", cmd.Data, want.Data, scores)
	}
}

// TestCamelWinChanceTieRule checks the two properties the bid depends on:
// more cards never wins less often, and the finisher wins ties (so its zero
// bid is an entry rather than a pass). Only the shape is checked, not the
// numbers.
func TestCamelWinChanceTieRule(t *testing.T) {
	s, x := caravansGame(t, 4)
	// Give every rival production and cards, so publicHandEstimate returns a
	// real spread rather than the empty-hand zero.
	for p := range s.Players {
		s.Players[p].Hand = engine.Hand{}
		s.Players[p].Hand[board.Sheep] = 3
		s.Players[p].Hand[board.Wheat] = 3
	}
	b := bidder()

	x.Finisher = 1 // seat 0 is not the finisher
	prev := -1.0
	for k := range camelBidCapDefault + 1 {
		p := b.camelWinChance(s, x, 0, k)
		if p < prev-1e-12 {
			t.Errorf("k=%d wins less often (%.4f) than k=%d (%.4f)", k, p, k-1, prev)
		}
		prev = p
	}
	if got := b.camelWinChance(s, x, 0, 0); got != 0 {
		t.Errorf("non-finisher zero bid: p=%.4f, want 0", got)
	}

	x.Finisher = 0 // now seat 0 ends the turn, so ties fall to it
	if got := b.camelWinChance(s, x, 0, 0); got <= 0 {
		t.Errorf("finisher zero bid: p=%.4f, want > 0", got)
	}
	// The finisher is never worse off at the same bid and strictly better
	// somewhere (both saturate at 1.0 once k exceeds what rivals could name).
	strictlyBetter := false
	for k := 1; k <= camelBidCapDefault; k++ {
		x.Finisher = 0
		asFinisher := b.camelWinChance(s, x, 0, k)
		x.Finisher = 1
		asRival := b.camelWinChance(s, x, 0, k)
		if asFinisher < asRival-1e-12 {
			t.Errorf("k=%d: finisher %.4f < non-finisher %.4f",
				k, asFinisher, asRival)
		}
		if asFinisher > asRival+1e-12 {
			strictlyBetter = true
		}
	}
	if !strictlyBetter {
		t.Error("finisher never better off at any bid")
	}
}

// TestCamelBidSpendsCheapestCards checks what camelBidCosts returns: a
// non-decreasing price, a split that adds up, and a split the seat can back.
//
// The hand is lopsided, so an even split or always taking the first pile would
// name cards the seat does not hold (rejected with ErrNoResources).
//
// The piles are addressed positionally through scenarios.BidResources, since the bid
// resources depend on the ruleset.
func TestCamelBidSpendsCheapestCards(t *testing.T) {
	s, _ := caravansGame(t, 4)
	res := scenarios.BidResources(s)
	held := [2]int{3, 1}
	s.Players[0].Hand = engine.Hand{}
	s.Players[0].Hand[res[0]] = held[0]
	s.Players[0].Hand[res[1]] = held[1]
	b := bidder()

	cost, cards := b.camelBidCosts(s, 0, 4)
	if cost[0] != 0 || cards[0] != ([2]int{}) {
		t.Errorf("k=0 is not free: cost %.4f, cards %v", cost[0], cards[0])
	}
	for k := 1; k <= 4; k++ {
		if cost[k] < cost[k-1]-1e-9 {
			t.Errorf("k=%d costs %.4f, less than k=%d at %.4f",
				k, cost[k], k-1, cost[k-1])
		}
		if cost[k] < 0 {
			t.Errorf("k=%d: negative cost %.4f", k, cost[k])
		}
		if cards[k][0]+cards[k][1] != k {
			t.Errorf("k=%d names %v (%d cards)", k, cards[k], cards[k][0]+cards[k][1])
		}
		if cards[k][0] > held[0] || cards[k][1] > held[1] {
			t.Errorf("k=%d names %v (%v), seat holds %v", k, cards[k], res, held)
		}
	}
}

// TestCamelBidAbstainsWhenCamelWorthless: in an all-pay auction a losing bid is
// lost, so with nothing to gain the bot does not bid.
//
// Nobody owns a building and no chain has a second camel, so every path leaves
// the position identical: the gain is zero.
func TestCamelBidAbstainsWhenCamelWorthless(t *testing.T) {
	s, x := caravansGame(t, 4)
	openRoundOn(t, s, x, 1, 0)
	for p := range s.Players {
		s.Players[p].Hand = engine.Hand{}
		s.Players[p].Hand[board.Sheep] = 5
		s.Players[p].Hand[board.Wheat] = 5
	}
	b := bidder()

	// The gain is the swing against not choosing, which is zero here (the value
	// of the best placement alone would not be).
	if gain, ok := b.camelGain(s, 0); !ok || math.Abs(gain) > 1e-9 {
		t.Errorf("gain = %.4f (ok=%v), want 0", gain, ok)
	}

	cmd, ok := b.camelAction(s, 0)
	if !ok {
		t.Fatal("no bid offered")
	}
	if cmd.Type != scenarios.CmdBidCamel {
		t.Fatalf("cmd type = %s, want %s", cmd.Type, scenarios.CmdBidCamel)
	}
	d, err := engine.DecodeCommand[struct {
		Cards [2]int `json:"cards"`
	}](cmd.Data)
	if err != nil {
		t.Fatal(err)
	}
	if d.Cards != ([2]int{}) {
		t.Errorf("bid %v, want no cards", d.Cards)
	}
	// And the bid the engine gets is a legal one.
	if _, err := engine.Decide(s.Clone(), cmd); err != nil {
		t.Errorf("illegal bid: %v", err)
	}
}

// TestCamelBidPaysWhenCamelOutvaluesCards: when the camel is worth more than
// winning it costs, the bot bids.
//
// The rivals are poor on purpose, since the price of winning depends on what
// they can back. Against rich rivals (four wool and four grain each) the camel is
// worth 12.6 against a 19.0 price, and abstaining is correct.
func TestCamelBidPaysWhenCamelOutvaluesCards(t *testing.T) {
	s, x := caravansGame(t, 4)
	var first engine.CamelPath
	for _, p := range scenarios.CamelPaths(s) {
		if p.Caravan == 1 {
			first = p
			break
		}
	}
	place(t, s, 0, first)
	s.Buildings[first.E.Other(x.ArrowCorner[1])] = engine.Building{Owner: 0}

	openRoundOn(t, s, x, 1, 0)
	for p := range s.Players {
		s.Players[p].Hand = engine.Hand{}
	}
	// We can pay; nobody else can. One card takes the round outright.
	s.Players[0].Hand[board.Sheep] = 4
	s.Players[0].Hand[board.Wheat] = 4
	b := bidder()
	// Check the arithmetic first so a weight change fails with the numbers.
	gain, ok := b.camelGain(s, 0)
	if !ok {
		t.Fatal("no gain")
	}
	if price := b.camelCardPrice(s, 0); gain <= price {
		t.Fatalf("gain %.4f <= one-card price %.4f", gain, price)
	}
	cmd, ok := b.camelAction(s, 0)
	if !ok {
		t.Fatal("no bid offered")
	}
	d, err := engine.DecodeCommand[struct {
		Cards [2]int `json:"cards"`
	}](cmd.Data)
	if err != nil {
		t.Fatal(err)
	}
	if total := d.Cards[0] + d.Cards[1]; total == 0 {
		t.Errorf("abstained: gain %.4f, card price %.4f",
			gain, b.camelCardPrice(s, 0))
	} else if total > camelBidCapDefault {
		t.Errorf("named %d cards, cap %d", total, camelBidCapDefault)
	}
	if _, err := engine.Decide(s.Clone(), cmd); err != nil {
		t.Errorf("illegal bid: %v", err)
	}
}

// TestCamelBidWinChanceCeiling: the bid stops below the affordable
// maximum because camelWinChance saturates (here by k=2) and the loop's strict
// `ev > bestEV+1e-9` does not advance on a tie, independent of cost.
// TestCamelBidRefusesThinRound covers the cost term.
func TestCamelBidWinChanceCeiling(t *testing.T) {
	s, x := caravansGame(t, 4)
	var first engine.CamelPath
	for _, p := range scenarios.CamelPaths(s) {
		if p.Caravan == 1 {
			first = p
			break
		}
	}
	place(t, s, 0, first)
	s.Buildings[first.E.Other(x.ArrowCorner[1])] = engine.Building{Owner: 0}
	openRoundOn(t, s, x, 1, 0)
	// Two of each for us, so four cards are affordable. One card each for the
	// rivals sets the ceiling: two cards already always win.
	for p := range s.Players {
		s.Players[p].Hand = engine.Hand{}
		s.Players[p].Hand[board.Sheep] = 1
	}
	s.Players[0].Hand[board.Sheep] = 2
	s.Players[0].Hand[board.Wheat] = 2
	b := bidder()

	gain, ok := b.camelGain(s, 0)
	if !ok || gain <= 0 {
		t.Fatalf("gain = %.4f, want > 0", gain)
	}
	maxK := min(s.Players[0].Hand[board.Sheep]+s.Players[0].Hand[board.Wheat], camelBidCapDefault)

	k := bidTotal(t, b, s, 0)
	if k <= 0 {
		t.Fatalf("abstained, gain %.4f", gain)
	}
	if k >= maxK {
		t.Fatalf("bid the whole affordable hand (%d of %d)", k, maxK)
	}
	// It stopped at the ceiling: more cards would not raise the win chance.
	top := b.camelWinChance(s, x, 0, maxK)
	at := b.camelWinChance(s, x, 0, k)
	if at < top-1e-9 {
		t.Errorf("bid %d wins %.4f, affordable max wins %.4f at %d: not saturated",
			k, at, top, maxK)
	}
	if b.camelWinChance(s, x, 0, k-1) >= at-1e-9 {
		t.Errorf("bid %d wins no more often than %d", k, k-1)
	}
}

// TestCamelBidRefusesThinRound fails if `- cost[k]` is no longer subtracted.
//
// It compares against a counterfactual cost-blind bot (argmax over k of
// P(win | k) * gain), not a recomputation of the bot's own arithmetic. The
// fixture makes that bot bid and the real bot pass; its premises (positive gain,
// cost-blind bot bids) are asserted with Fatal. Eight players spread the rival
// product over seven factors.
//
// The round is thin because the camel scores an opponent (pure denial, so the
// gain does not grow with our position) and seat 0 is two public points up,
// where camelCardPrice's convex VP term makes a card cost 6.25 instead of 3.25.
// A denial worth 6.28 at 0.56 to win does not clear one card at 6.25. Both are
// needed: if the camel scored us, raising our VP would raise the gain faster
// than the price.
func TestCamelBidRefusesThinRound(t *testing.T) {
	s, x := caravansGameWide(t, 1)
	var first engine.CamelPath
	for _, p := range scenarios.CamelPaths(s) {
		if p.Caravan == 1 {
			first = p
			break
		}
	}
	place(t, s, 0, first)
	s.Buildings[first.E.Other(x.ArrowCorner[1])] = engine.Building{Owner: 1}
	giveTwoPublicVP(s, 0)
	openRoundOn(t, s, x, 1, 0)
	for p := range s.Players {
		s.Players[p].Hand = engine.Hand{}
		s.Players[p].Hand[board.Sheep] = 2
		s.Players[p].Hand[board.Wheat] = 2
		if p != 0 {
			// Rivals hold cards, so publicHandEstimate credits them with something
			// to bid. Hand size matters here, not contents.
			s.Players[p].Hand[board.Ore] = 3
			s.Players[p].Hand[board.Brick] = 3
		}
	}
	b := bidder()

	gain, ok := b.camelGain(s, 0)
	if !ok || gain <= 0 {
		t.Fatalf("gain = %.4f, want > 0", gain)
	}
	maxK := min(s.Players[0].Hand[board.Sheep]+s.Players[0].Hand[board.Wheat], camelBidCapDefault)

	// The cost-blind bid: P(win | k) * gain, maximised over k. No cost anywhere.
	blind, blindEV := 0, 0.0
	for k := range maxK + 1 {
		if ev := b.camelWinChance(s, x, 0, k) * gain; k == 0 || ev > blindEV+1e-9 {
			blindEV, blind = ev, k
		}
	}
	if blind <= 0 {
		t.Fatalf("cost-blind bot passes too (gain %.4f)", gain)
	}

	if k := bidTotal(t, b, s, 0); k != 0 {
		t.Errorf("named %d cards, cost-blind EV %.4f; "+
			"gain %.4f, P(win | %d) = %.4f, EV %.4f, cost %.4f",
			k, blindEV, gain, blind, b.camelWinChance(s, x, 0, blind), blindEV, costOfK(b, s, maxK, blind))
	}
}

// giveTwoPublicVP puts a seat two public victory points ahead by handing it the
// Largest Army title.
//
// A title rather than a building, so only the bidder's VP moves (a city near a
// caravan would change camelGain too). Largest Army rather than Longest Road
// because finalizeWith recomputes the route title on every command.
func giveTwoPublicVP(s *engine.State, seat engine.PlayerID) {
	s.LargestArmyHolder = seat
}

// caravansGameWide is caravansGame at eight seats: camelWinChance takes a
// product over rivals, so seven price a bid very differently from three.
func caravansGameWide(t *testing.T, seed uint64) (*engine.State, *scenarios.CaravansExt) {
	t.Helper()
	evs, err := engine.New(engine.GameConfig{Players: 8, Ruleset: engine.CanonicalRuleset("base+caravans")},
		engine.Seeds{Public: seed, Private: seed})
	if err != nil {
		t.Fatal(err)
	}
	s, err := engine.Replay(evs)
	if err != nil {
		t.Fatal(err)
	}
	s.Phase = engine.PhasePlay
	x, ok := scenarios.InitCaravansExt(s)
	if !ok || !x.HasOasis {
		t.Fatal("caravans ext missing or oasis-less")
	}
	return s, x
}

// bidTotal is the number of cards the bot names, through the real entry point.
func bidTotal(t *testing.T, b *Strong, s *engine.State, seat engine.PlayerID) int {
	t.Helper()
	cmd, ok := b.camelAction(s, seat)
	if !ok {
		t.Fatal("no bid offered")
	}
	d, err := engine.DecodeCommand[scenarios.CamelBid](cmd.Data)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := engine.Decide(s.Clone(), cmd); err != nil {
		t.Fatalf("illegal bid: %v", err)
	}
	return d.Total()
}

// costOfK is for failure messages only: what k cards cost in eval.
func costOfK(b *Strong, s *engine.State, maxK, k int) float64 {
	cost, _ := b.camelBidCosts(s, 0, maxK)
	return cost[k]
}

// camelOpponentFacingRound: the building the next camel would score belongs to
// an opponent, so winning buys only denial, and every rival can back the same
// four cards we can. 44.7% of measured bids had a self-gain of zero or less.
func camelOpponentFacingRound(t *testing.T) (*engine.State, *scenarios.CaravansExt) {
	t.Helper()
	s, x := caravansGame(t, 4)
	var first engine.CamelPath
	for _, p := range scenarios.CamelPaths(s) {
		if p.Caravan == 1 {
			first = p
			break
		}
	}
	place(t, s, 0, first)
	s.Buildings[first.E.Other(x.ArrowCorner[1])] = engine.Building{Owner: 1}
	openRoundOn(t, s, x, 2, 0)
	for p := range s.Players {
		s.Players[p].Hand = engine.Hand{}
		s.Players[p].Hand[board.Sheep] = 4
		s.Players[p].Hand[board.Wheat] = 4
	}
	return s, x
}

// TestCamelGainIgnoresOpponentDiscount: what a camel is worth to us does not
// depend on Weights.Opp (see neutralPricer), over a 960x sweep. The bid
// compares an eval difference with cards paid from hand, so it needs a value
// that a ranking weight cannot scale.
//
// The legacy arm shows the production-weight pricer fails the same check.
func TestCamelGainIgnoresOpponentDiscount(t *testing.T) {
	s, _ := camelOpponentFacingRound(t)
	oppScales := []float64{0.1, 9.6, 96}

	var priced, legacy []float64
	for _, opp := range oppScales {
		w := DefaultWeights()
		w.Opp = opp
		g, ok := bidder(WithWeights(w)).camelGain(s, 0)
		if !ok {
			t.Fatalf("Opp=%g: no gain", opp)
		}
		gl, _ := bidder(WithWeights(w), WithUnpricedCamelBids()).camelGain(s, 0)
		priced, legacy = append(priced, g), append(legacy, gl)
	}
	t.Logf("gain by Opp %v: priced %v, legacy %v", oppScales, priced, legacy)

	for i := range priced {
		if math.Abs(priced[i]-priced[0]) > 1e-6 {
			t.Errorf("gain at Opp=%g is %.4f, want %.4f (as at Opp=%g)",
				oppScales[i], priced[i], priced[0], oppScales[0])
		}
	}
	// The production-weight pricer scales with Opp.
	if legacy[2] <= legacy[0]*100 {
		t.Errorf("legacy gain %.4f -> %.4f over a 960x Opp sweep, want > 100x",
			legacy[0], legacy[2])
	}
}

// TestCamelBidRefusesUnaffordableDenial: on the same fixture the priced bid
// abstains, while the legacy arm stakes its whole cap on a prize it values at
// 0.63, less than one card.
//
// Seat 0 is two public points up. At 0.86 to win, a denial worth 6.28 clears a
// card at 3.25 but not at 6.25, which is a card's price two points along
// (camelCardPrice is convex in the bidder's VP). Denial does not grow as we
// climb, so the price overtakes it.
func TestCamelBidRefusesUnaffordableDenial(t *testing.T) {
	s, x := camelOpponentFacingRound(t)
	giveTwoPublicVP(s, 0)

	b := bidder()
	gain, _ := b.camelGain(s, 0)
	price := b.camelCardPrice(s, 0)
	cost, _ := b.camelBidCosts(s, 0, camelBidCapDefault)

	// Report the bot's own arithmetic alongside the answer.
	for k := 1; k <= camelBidCapDefault; k++ {
		ev := b.camelWinChance(s, x, 0, k)*gain - cost[k]
		t.Logf("k=%d win=%.4f gain=%.4f cost=%.4f ev=%+.4f", k, b.camelWinChance(s, x, 0, k), gain, cost[k], ev)
		if ev > 0 {
			t.Fatalf("bidding %d cards has EV %+.4f, want <= 0", k, ev)
		}
	}
	if k := bidTotal(t, b, s, 0); k != 0 {
		t.Errorf("named %d cards, gain %.4f, card price %.4f", k, gain, price)
	}

	legacy := bidder(WithUnpricedCamelBids())
	if k := bidTotal(t, legacy, s, 0); k != camelBidCapDefault {
		t.Errorf("legacy arm named %d cards, want cap %d",
			k, camelBidCapDefault)
	}
}

// TestCamelCardPriceQuarterOfNextPoint checks the exchange rate, derived
// from the rules: a settlement costs four cards and is worth at least one
// victory point, so a card is a quarter of the next point under selfScore's
// convex VP terms. (handValue would price it at 0.54, or zero past the third
// card of a resource.)
func TestCamelCardPriceQuarterOfNextPoint(t *testing.T) {
	s, _ := caravansGame(t, 4)
	b := bidder()
	w := DefaultWeights()
	for vp := range 4 {
		// Reach the VP by settlements, so PublicVPWithModules moves the way a
		// real game moves it rather than by poking a counter.
		got := b.camelCardPrice(s, engine.PlayerID(0))
		want := (w.VP + w.VPRush*(2*float64(s.PublicVPWithModules(0))+1)) / 4
		if math.Abs(got-want) > 1e-9 {
			t.Fatalf("at %d VP: card price %.4f, want %.4f",
				s.PublicVPWithModules(0), got, want)
		}
		// The price rises with VP, following selfScore's convexity.
		if vp > 0 && got <= 0 {
			t.Fatalf("non-positive card price %.4f", got)
		}
		if !addSettlementForPrice(t, s) {
			break
		}
	}
	// Against handValue's reading of the same card.
	hand := w.Hand * b.resourceWeight(board.Wheat, gamePhase(s, 0))
	if b.camelCardPrice(s, 0) <= hand*2 {
		t.Errorf("card price %.4f not above 2x handValue %.4f",
			b.camelCardPrice(s, 0), hand)
	}
}

// addSettlementForPrice puts one more settlement on the board for seat 0,
// reporting whether it could.
func addSettlementForPrice(t *testing.T, s *engine.State) bool {
	t.Helper()
	// Deterministic order: Board.Tiles is a map.
	hexes := slices.SortedFunc(maps.Keys(s.Board.Tiles), func(a, b board.Hex) int {
		if a.Q != b.Q {
			return a.Q - b.Q
		}
		return a.R - b.R
	})
	for _, h := range hexes {
		for _, v := range h.Vertices() {
			if _, taken := s.Buildings[v]; taken {
				continue
			}
			s.Buildings[v] = engine.Building{Owner: 0}
			return true
		}
	}
	return false
}

// TestCamelWinChanceAbstainingTable: the rival model puts real mass on
// abstaining (see camelZeroBidMass). The uniform arm is for comparison: on this
// fixture 0.0156 against 0.7915. The exact ratio depends on publicHandEstimate,
// so the assertions are bounds.
func TestCamelWinChanceAbstainingTable(t *testing.T) {
	s, x := caravansGame(t, 4)
	// Every rival holds enough wool and grain to back the cap, which is the
	// case the uniform model handles worst.
	for p := range s.Players {
		s.Players[p].Hand = engine.Hand{}
		s.Players[p].Hand[board.Sheep] = 4
		s.Players[p].Hand[board.Wheat] = 4
	}
	x.Finisher = 1 // seat 0 is not the finisher, so k=0 is a pass

	priced := bidder().camelWinChance(s, x, 0, 1)
	uniform := bidder(WithUniformCamelRivals()).camelWinChance(s, x, 0, 1)
	t.Logf("P(win | 1 card), 4 seats: priced %.4f, uniform %.4f (ratio %.1fx)", priced, uniform, priced/uniform)

	// 0.75 rather than the exact 0.778: the uniform tail's m comes from
	// publicHandEstimate.
	if priced < 0.75 {
		t.Errorf("one-card bid wins %.4f, want >= 0.75 "+
			"(about 0.9^3)", priced)
	}
	if uniform > 0.05 {
		t.Errorf("uniform arm gives %.4f, want <= 0.05 "+
			"(about 0.008)", uniform)
	}
	// More cards never wins less often.
	prev := -1.0
	for k := range camelBidCapDefault + 1 {
		p := bidder().camelWinChance(s, x, 0, k)
		if p < prev-1e-12 {
			t.Errorf("k=%d wins less often (%.4f) than k=%d (%.4f)", k, p, k-1, prev)
		}
		if p > 1+1e-12 {
			t.Errorf("k=%d: p=%.4f > 1", k, p)
		}
		prev = p
	}
}

// bidder is a Strong with camel bidding turned on.
//
// Bidding is off by default (see WithCamelBids); these tests cover its
// arithmetic.
func bidder(opts ...Option) *Strong {
	return NewStrong(append([]Option{WithCamelBids()}, opts...)...)
}
