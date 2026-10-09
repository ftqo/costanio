package sim

import (
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/ftqo/costan.io/engine"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/game"
)

// Ladders for the camel lane (bot/caravans.go) and the fish ladder. Ladders run
// in neither gate, so run these before merging a bot/ change:
//
//	COSTAN_LADDERS=1 go test -timeout 120m -run TestCamelLane ./sim
//
// They skip under -race (see ladder_race_test.go).
//
// Results, 4-player base+caravans, 4000 games, seat-rotated, Wilson 95%:
//
//	bidding    23.9%  [22.7, 25.3]  avgVP 8.71
//	no-bid     29.1%  [27.7, 30.6]  avgVP 9.12
//	off        28.4%  [27.0, 29.8]  avgVP 9.03
//	legacy     18.5%  [17.3, 19.7]  avgVP 8.17
//
// The null arm puts the noise floor at about +/-1.6 points. Placement without
// bidding is indistinguishable from no lane; bidding costs about five points,
// so it is off by default (bot.WithCamelBids opts in). The lane stays on
// because without it every camel round goes to whoever ended the turn.
//
// A ladder over a lane that rarely activates needs the activation rate
// reported alongside the win rate: before bot.camelZeroBidMass, almost no bid
// fired and every bidding arm measured as placement-only.
//
// With pricing in place the bid cap is inert (cap 2, 4, 8 and 64 all overlap
// the 25% fair share).

// camelLaneGames is games per arm for the headline run. Override with
// CAMEL_GAMES for a quicker, noisier look; at 4000 games the noise floor is
// about +/-1.6 points.
func camelLaneGames(def int) int {
	if v := os.Getenv("CAMEL_GAMES"); v != "" {
		var n int
		if _, err := fmt.Sscanf(v, "%d", &n); err == nil && n > 0 {
			return n
		}
	}
	return def
}

func camelWorkers() int {
	if v := os.Getenv("CAMEL_WORKERS"); v != "" {
		var n int
		if _, err := fmt.Sscanf(v, "%d", &n); err == nil && n > 0 {
			return n
		}
	}
	return 10
}

// camelArms are the ways to play a camel round, run as one seat-rotated ladder
// so every pairwise comparison shares boards and seating.
//
//   - placement: the shipped bot, placement only.
//   - bidding: placement plus priced bids (bot.WithCamelBids).
//   - legacy: unpriced bids (bot.WithUnpricedCamelBids).
//   - off: no lane at all, the control.
//
// The arm count must divide the seat count (Run refuses a field it cannot
// balance), so at 6 players the field drops to three arms. Seat bias is about
// 4 points on its own (see Run), so un-rotating seats is not an option.
func camelArms(players int) []Contender {
	arms := []Contender{
		// The default bot: placement chosen, no bid named. See WithCamelBids.
		{Name: "placement", New: func() game.CommandSource { return bot.NewStrong() }},
		{Name: "legacy", New: func() game.CommandSource {
			return bot.NewStrong(bot.WithCamelBids(), bot.WithUnpricedCamelBids())
		}},
		{Name: "bidding", New: func() game.CommandSource { return bot.NewStrong(bot.WithCamelBids()) }},
		{Name: "off", New: func() game.CommandSource { return bot.NewStrong(bot.WithoutCamelPlay()) }},
	}
	if players%len(arms) != 0 {
		arms = append(arms[:2], arms[3]) // placement, legacy, off
	}
	return arms
}

func TestCamelLaneLadder(t *testing.T) {
	skipLadderUnlessRequested(t)
	for _, tc := range []struct {
		name    string
		players int
		games   int
		seed    uint64
	}{
		// Both player counts, so the result is not specific to one field size.
		{"4p", 4, camelLaneGames(8000), 1900000},
		{"6p", 6, camelLaneGames(6000), 1910000},
	} {
		t.Run(tc.name, func(t *testing.T) {
			l, err := Run(openStore(t), LadderOptions{
				Contenders: camelArms(tc.players),
				Games:      tc.games, Players: tc.players, Ruleset: "base+caravans",
				Seed: tc.seed, Workers: camelWorkers(),
			})
			if err != nil {
				t.Fatal(err)
			}
			t.Logf("\n### camel lane, %s base+caravans\n%s", tc.name, l.String())
			for _, other := range []string{"legacy", "bidding", "off"} {
				if l.find(other) == nil {
					continue
				}
				t.Logf("placement beats %s: %v | %s beats placement: %v",
					other, l.Beats("placement", other), other, l.Beats(other, "placement"))
			}
			// The lane is not a gain. The claim is that the shipped lane
			// (placement only) is not a loss against no lane.
			if l.Beats("off", "placement") {
				t.Errorf("no-lane control beats the shipped lane")
			}
			// Bidding is off because it lost by about five points. If it stops
			// losing, revisit the default.
			if l.find("bidding") != nil && !l.Beats("placement", "bidding") {
				t.Logf("bidding is no longer clearly worse than placement-only")
			}
		})
	}
}

// TestCamelLaneNullArm establishes the noise floor: identical bots on both
// sides, so anything it reports is noise.
func TestCamelLaneNullArm(t *testing.T) {
	skipLadderUnlessRequested(t)
	l, err := Run(openStore(t), LadderOptions{
		Contenders: []Contender{
			{Name: "null-a", New: func() game.CommandSource { return bot.NewStrong() }},
			{Name: "null-b", New: func() game.CommandSource { return bot.NewStrong() }},
		},
		Games: camelLaneGames(4000), Players: 4, Ruleset: "base+caravans",
		Seed: 1990000, Workers: camelWorkers(),
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("\n### null arm\n%s", l.String())
	if l.Beats("null-a", "null-b") || l.Beats("null-b", "null-a") {
		t.Errorf("a bot beat a copy of itself")
	}
}

// TestCamelBidCapSweep prices the cap (bot.WithCamelBidCap). A correctly priced
// bid stops before the cap binds, so the cap should be inert; if a cap below 4
// measures better, the pricing is wrong and the cap is hiding it.
func TestCamelBidCapSweep(t *testing.T) {
	skipLadderUnlessRequested(t)
	capped := func(k int) func() game.CommandSource {
		return func() game.CommandSource { return bot.NewStrong(bot.WithCamelBidCap(k)) }
	}
	l, err := Run(openStore(t), LadderOptions{
		Contenders: []Contender{
			{Name: "cap2", New: capped(2)},
			{Name: "cap4", New: capped(4)},
			{Name: "cap8", New: capped(8)},
			{Name: "cap64", New: capped(64)},
		},
		Games: camelLaneGames(4000), Players: 4, Ruleset: "base+caravans",
		Seed: 1920000, Workers: camelWorkers(),
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("\n### camelBidCap sweep\n%s", l.String())
	if l.Beats("cap2", "cap4") {
		t.Errorf("cap 2 beats the shipped cap 4")
	}
}

// TestCamelLaneRivalModel prices the rival-model recalibration
// (camelZeroBidMass in bot/caravans.go). With a uniform rival draw a one-card
// bid's win chance at four seats is (1/5)^3, so the bot almost never bid.
//
//   - recalibrated: bidding on, rivals modelled as usually abstaining.
//   - uniform: bidding on with the uniform rival model. It almost never bids,
//     so it measures like placement.
//   - placement: the shipped bot.
//   - off: no lane at all.
//
// 1200 games, 4 players, base+caravans, seat-rotated:
//
//	recalibrated  22.3%  [20.1, 24.8]  avgVP 8.57
//	uniform       26.9%  [24.5, 29.5]  avgVP 8.87
//	placement     27.3%  [24.8, 29.8]  avgVP 8.93
//	off           23.5%  [21.2, 26.0]  avgVP 8.79
//
// The assertion is only that the shipped lane is not a loss.
func TestCamelLaneRivalModel(t *testing.T) {
	skipLadderUnlessRequested(t)
	l, err := Run(openStore(t), LadderOptions{
		Contenders: []Contender{
			{Name: "recalibrated", New: func() game.CommandSource { return bot.NewStrong(bot.WithCamelBids()) }},
			{Name: "uniform", New: func() game.CommandSource {
				return bot.NewStrong(bot.WithCamelBids(), bot.WithUniformCamelRivals())
			}},
			{Name: "placement", New: func() game.CommandSource { return bot.NewStrong() }},
			{Name: "off", New: func() game.CommandSource { return bot.NewStrong(bot.WithoutCamelPlay()) }},
		},
		Games: camelLaneGames(8000), Players: 4, Ruleset: "base+caravans",
		Seed: 1930000, Workers: camelWorkers(),
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("\n### camel rival model\n%s", l.String())
	for _, a := range []string{"recalibrated", "uniform", "placement", "off"} {
		for _, b := range []string{"recalibrated", "uniform", "placement", "off"} {
			if a != b && l.Beats(a, b) {
				t.Logf("%s beats %s", a, b)
			}
		}
	}
	// The shipped configuration is placement-only, so the other arms are held
	// against it. Bidding is expected to lose (see WithCamelBids); this notices if
	// that changes.
	if l.Beats("off", "placement") {
		t.Errorf("no-lane control beats the shipped placement-only lane")
	}
	if l.Beats("uniform", "recalibrated") {
		t.Errorf("shipped uniform rival model beats the recalibrated one")
	}
}

// seatFairness reports how a ladder's wins were distributed across seats, with
// Wilson intervals against the fair share. Counts are summed across contenders
// and compared with 1/players; every seat plays every game, so games played is
// the denominator.
func seatFairness(l Ladder, players int) (wins []int, rates, lo, hi []float64, spread float64) {
	wins = make([]int, players)
	for _, r := range l.Results {
		for seat, n := range r.SeatWins {
			wins[seat] += n
		}
	}
	rates = make([]float64, players)
	lo, hi = make([]float64, players), make([]float64, players)
	best, worst := 0.0, 1.0
	for seat := range players {
		rates[seat] = float64(wins[seat]) / float64(max(l.Played, 1))
		lo[seat], hi[seat] = wilson(wins[seat], max(l.Played, 1))
		best, worst = max(best, rates[seat]), min(worst, rates[seat])
	}
	return wins, rates, lo, hi, best - worst
}

// TestSeatFairnessAtTenPlayers measures the seat-win distribution at ten
// players on base+caravans+fishermen, with plain base as the control. Two
// identical contenders, so the only thing varying is the seat.
//
// Seat bias is a property of the game: seats place in order and the first pick
// is the best. The question is whether a scenario adds to it.
//
// 1200 games, 10 players, base, fair share 10.0%:
//
//	seat 0  13.4%  [11.6, 15.5]      seat 5   9.2%  [7.7, 10.9]
//	seat 1  13.3%  [11.5, 15.4]      seat 6   7.8%  [6.4,  9.5]
//	seat 2  12.8%  [11.0, 14.8]      seat 7   7.4%  [6.1,  9.0]
//	seat 3  11.5%  [ 9.8, 13.4]      seat 8   7.2%  [5.8,  8.8]
//	seat 4  10.1%  [ 8.5, 11.9]      seat 9   7.3%  [6.0,  8.9]
//
// 600 games, base+caravans+fishermen:
//
//	seat 0  11.5%  [9.2, 14.3]       seat 5   7.3%  [5.5,  9.7]
//	seat 1  12.2%  [9.8, 15.0]       seat 6   7.5%  [5.7,  9.9]
//	seat 2  13.2%  [10.7, 16.1]      seat 7   7.2%  [5.4,  9.5]
//	seat 3  11.0%  [8.7, 13.8]       seat 8   9.5%  [7.4, 12.1]
//	seat 4   9.2%  [7.1, 11.7]       seat 9  11.5%  [9.2, 14.3]
//
// Same gradient (6.0 points wide against base's 6.2): the skew comes from the
// opening, not the modules. At n=100 a 10% rate has an interval about six
// points either side, too wide to read a per-seat skew.
func TestSeatFairnessAtTenPlayers(t *testing.T) {
	skipLadderUnlessRequested(t)
	const players = 10
	for _, tc := range []struct {
		name    string
		ruleset string
		seed    uint64
	}{
		{"base", "base", 1940000},
		{"tab", engine.CanonicalRuleset("base+caravans+fishermen"), 1950000},
	} {
		t.Run(tc.name, func(t *testing.T) {
			l, err := Run(openStore(t), LadderOptions{
				Contenders: []Contender{
					{Name: "a", New: func() game.CommandSource { return bot.NewStrong() }},
					{Name: "b", New: func() game.CommandSource { return bot.NewStrong() }},
				},
				Games: camelLaneGames(3000), Players: players, Ruleset: tc.ruleset,
				Seed: tc.seed, Workers: camelWorkers(),
				// Ten seats is several times the work of four, and one game over
				// the deadline aborts the ladder; 30s was too short on a busy
				// machine. See LadderOptions.Timeout.
				Timeout: 5 * time.Minute,
			})
			if err != nil {
				t.Fatal(err)
			}
			wins, rates, lo, hi, spread := seatFairness(l, players)
			var b strings.Builder
			fmt.Fprintf(&b, "\n### seat fairness, %dp %s (%d games, fair share %.1f%%)\n",
				players, tc.ruleset, l.Played, 100/float64(players))
			for seat := range players {
				fmt.Fprintf(&b, "  seat %d  %5.1f%%  [%.1f%%, %.1f%%]\n",
					seat, rates[seat]*100, lo[seat]*100, hi[seat]*100)
			}
			fmt.Fprintf(&b, "  widest gap between seats: %.1f points\n", spread*100)
			t.Log(b.String())
			// Not asserted against the fair share: seat bias is a property of
			// the game and would fail on base too. Every seat must be able to
			// win at all; a seat that cannot is a rules or seating defect.
			// The check is on the count, because a Wilson interval around zero
			// wins still has a positive upper bound.
			for seat := range players {
				if wins[seat] == 0 {
					t.Errorf("seat %d won none of %d games", seat, l.Played)
				}
			}
		})
	}
}

// TestFishLaneLadder prices the fish-ladder changes: the chance rungs pay
// their fish on the scored clone, the 3-fish steal uses the neutral opponent
// scale, and a pile of five or six fish stays out of the cheap rungs while the
// top one is one catch away (bot.fishRungFloor).
//
//   - ungated: without the fishRungFloor rule.
//   - hold: with the held-fish term (see fishHoldWeightDefault).
//   - no-spend: catches fish and never spends them, the historical control.
//
// 1200 games, 4 players, base+fishermen, seat-rotated:
//
//	current   29.8%  [27.3, 32.5]  avgVP 7.65
//	ungated   28.0%  [25.5, 30.6]  avgVP 7.56
//	hold      26.2%  [23.8, 28.8]  avgVP 7.45
//	no-spend  15.9%  [14.0, 18.1]  avgVP 7.02
//
// current is not a measured gain over ungated (intervals overlap), only not a
// loss. Spending fish at all is worth about 14 points.
func TestFishLaneLadder(t *testing.T) {
	skipLadderUnlessRequested(t)
	l, err := Run(openStore(t), LadderOptions{
		Contenders: []Contender{
			{Name: "current", New: func() game.CommandSource { return bot.NewStrong() }},
			{Name: "ungated", New: func() game.CommandSource { return bot.NewStrong(bot.WithoutFishRungGate()) }},
			{Name: "hold", New: func() game.CommandSource { return bot.NewStrong(bot.WithFishHoldWeight(0.5)) }},
			{Name: "no-spend", New: func() game.CommandSource { return bot.NewStrong(bot.WithoutFishSpending()) }},
		},
		Games: camelLaneGames(4000), Players: 4, Ruleset: "base+fishermen",
		Seed: 1960000, Workers: camelWorkers(),
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("\n### fish lane\n%s", l.String())
	for _, other := range []string{"ungated", "hold", "no-spend"} {
		t.Logf("current beats %s: %v | %s beats current: %v",
			other, l.Beats("current", other), other, l.Beats(other, "current"))
	}
	// As with the camel lane, the claim is that making the top rung
	// reachable is not a loss.
	if l.Beats("ungated", "current") {
		t.Errorf("ungated bot beats the gated one")
	}
	if l.Beats("no-spend", "current") {
		t.Errorf("bot that never spends fish beats one that does")
	}
}
