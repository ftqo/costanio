package sim

import (
	"encoding/json"
	"testing"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	_ "github.com/ftqo/costan.io/engine/islands"
	"github.com/ftqo/costan.io/engine/scenarios"
	"github.com/ftqo/costan.io/game"
	"github.com/ftqo/costan.io/store"
)

// caravanRulesets are every shipped combination that includes the scenario, all
// reachable from the lobby (engine/compat.go refuses no pair among them).
//
// They go through engine.CanonicalRuleset, as every creation path does, because
// each module's SetupBoard runs in ruleset-string order: a hand-written order
// would test a board no game can have. The helper is in canonical_test.go.
var caravanRulesets = canonical([]string{
	"base+caravans",
	"base+islands+caravans",
	"base+fishermen+caravans",
	"base+islands+fishermen+caravans",
	"base+cak+caravans",
})

// TestCaravansAlwaysHasOasis: every hook in engine/scenarios/caravans.go keys off
// HasOasis, so a board with no oasis plays a Caravans game with no camels while
// still moving the win to 12 VP. Islands carves the outer ring into sea, which
// on small boards can drown the only desert.
//
// Board generation only, so it runs in the default gate.
func TestCaravansAlwaysHasOasis(t *testing.T) {
	for _, rs := range caravanRulesets {
		for _, players := range []int{2, 3, 4, 5, 6, 8, 10} {
			for seed := uint64(1); seed <= 60; seed++ {
				evs, err := engine.New(engine.GameConfig{Players: players, Ruleset: rs},
					engine.Seeds{Public: seed, Private: seed})
				if err != nil {
					t.Fatalf("%s/%dp/seed %d: new: %v", rs, players, seed, err)
				}
				s, err := engine.Replay(evs)
				if err != nil {
					t.Fatalf("%s/%dp/seed %d: replay: %v", rs, players, seed, err)
				}
				oasis, ok := scenarios.OasisOf(s)
				if !ok {
					t.Fatalf("%s/%dp/seed %d: no oasis",
						rs, players, seed)
				}
				// A procedural board must place the oasis on real scenario
				// terrain, not through the land-hex fallback.
				if res := s.Board.Tiles[oasis].Res; res != board.ResNone && res != board.Lake {
					t.Fatalf("%s/%dp/seed %d: oasis %v is %v, want desert (or lake under Fishermen)",
						rs, players, seed, oasis, res)
				}
			}
		}
	}
}

// TestCamelsGetPlaced checks that camels leave the supply and land on the board
// in real bot games. EvCamelPlaced is the event that means a camel; EvCamelBuilt
// is only a marker that the builder acted this turn.
func TestCamelsGetPlaced(t *testing.T) {
	st := openStore(t)
	// Seeds 1, 3 and 6 are 4-player base+islands+caravans boards whose only
	// desert can drown in the Islands carve.
	for _, seed := range []uint64{1, 3, 6} {
		res, err := RunGame(st, Options{
			Players: 4, Ruleset: engine.CanonicalRuleset("base+islands+caravans"), Seed: seed,
			Bots: func(engine.PlayerID) game.CommandSource { return bot.NewStrong(bot.WithCamelBids()) },
		})
		if err != nil {
			t.Fatalf("seed %d: %v", seed, err)
		}
		events, err := Transcript(st, res.GameID)
		if err != nil {
			t.Fatal(err)
		}
		placed, resolved := 0, 0
		for _, e := range events {
			switch e.Type {
			case scenarios.EvCamelPlaced:
				placed++
			case scenarios.EvCamelResolved:
				resolved++
			default:
				// a tally, not a dispatch: every other event type is uncounted
			}
		}
		t.Logf("seed %d: %d events, %d camels placed, %d votes resolved", seed, len(events), placed, resolved)
		if placed == 0 {
			t.Fatalf("seed %d: base+islands+caravans game placed no camel", seed)
		}
	}
}

// TestCamelEconomyAcrossRulesets is the slow-tier sweep: a per-game camel rate
// over every ruleset with the scenario, so a combination that goes inert shows
// up as a zero.
//
// Each ruleset gets its own seed block: RunGame names rows "sim-<seed>", so
// reusing seeds in a shared store would collide on games.id.
func TestCamelEconomyAcrossRulesets(t *testing.T) {
	skipUnlessSlow(t, "plays hundreds of games")
	st := openStore(t)
	perRuleset := uint64(40)
	if raceEnabled {
		perRuleset = 8 // the sweep asserts "a camel got placed"; a smaller sample is simply less coverage
	}
	for i, rs := range caravanRulesets {
		base := uint64(i+1) * 1000
		placed, games, dry := 0, 0, 0
		var total camelStats
		for n := range perRuleset {
			res, err := RunGame(st, Options{
				Players: 4, Ruleset: rs, Seed: base + n,
				Bots: func(engine.PlayerID) game.CommandSource { return bot.NewStrong(bot.WithCamelBids()) },
			})
			if err != nil {
				t.Logf("%s seed %d did not finish: %v", rs, base+n, err)
				continue
			}
			games++
			events, err := Transcript(st, res.GameID)
			if err != nil {
				t.Fatal(err)
			}
			cs := collectCamelStats(t, events)
			placed += cs.placed
			total.sentByBot += cs.sentByBot
			total.rounds += cs.rounds
			total.byBid += cs.byBid
			total.cards += cs.cards
			total.offFirst += cs.offFirst
			if cs.placed == 0 {
				dry++
			}
		}
		if games == 0 {
			t.Fatalf("%s: no game completed", rs)
		}
		g := float64(games)
		t.Logf("%s: %d games, %.2f camels placed per game, %d games with none", rs, games, float64(placed)/g, dry)
		// Auction figures per game. Each can only be moved by a bot decision:
		// auto bids {0,0} and takes paths[0], so on the fallback all are zero.
		t.Logf("%s: %.2f rounds, %.2f cards paid, %.2f rounds won on a bid, %.2f placements off the first path",
			rs, float64(total.rounds)/g, float64(total.cards)/g, float64(total.byBid)/g, float64(total.offFirst)/g)
		if dry > 0 {
			t.Errorf("%s: %d of %d games placed no camel at all", rs, dry, games)
		}
		// A ruleset where no bid card is ever paid has an inert lane.
		if total.cards == 0 {
			t.Errorf("%s: no bid card paid across %d games", rs, games)
		}
		// offFirst, not sentByBot: a bot returning paths[0] every time
		// would fill that column while choosing nothing. Only a camel off
		// the first legal path is something Caravans.auto cannot produce.
		if total.offFirst == 0 {
			t.Errorf("%s: none of %d placements across %d games left the first legal path (%d issued by a bot)",
				rs, placed, games, total.sentByBot)
		}
	}
}

// camelStats is what a Caravans transcript says about the auction, in fields a
// bot decision can move and the engine's fallback (Caravans.auto bids {0, 0}
// and takes the first legal path) cannot:
//
//   - Src: the actor credits SourceBot to a command the bot returned and
//     SourceAuto to the fallback (game/actor.go).
//   - cards: `settle` charges every bidder, so a card reaching the bank is a
//     real bid.
//   - reason: pickPlacer's outcome. An all-zero round is always "nobody";
//     "majority" and "coalition" mean a bid decided it.
type camelStats struct {
	placed int // EvCamelPlaced
	// sentByBot counts placements the bot issued. It is not a count of
	// decisions: camelPlace keeps the first path unless another scores
	// strictly higher, so with equal scores (the common case) the bot sends
	// exactly what Caravans.auto would. About four fifths of bot placements
	// are the first path. Do not gate on it; gate on offFirst.
	sentByBot int
	rounds    int // EvCamelResolved
	// byBid counts rounds a bid decided: "majority" (a unique top bidder) or
	// "coalition" (two or more bidders with a strict majority naming the same
	// placement). "tie" and "nobody" give the camel to whoever ended the turn.
	byBid int
	cards int // cards paid into the bank across every round, both piles
	// offFirst counts placements not on the first legal path. Caravans.auto
	// returns legalPaths(...)[0], so this is non-zero only when something
	// chose where the camel goes.
	offFirst int
}

func collectCamelStats(t *testing.T, events []engine.Event) camelStats {
	t.Helper()
	var st camelStats
	for i, e := range events {
		switch e.Type {
		case scenarios.EvCamelPlaced:
			st.placed++
			if e.Src == engine.SourceBot {
				st.sentByBot++
			}
			if !onFirstPath(t, events[:i], e) {
				st.offFirst++
			}
		case scenarios.EvCamelResolved:
			st.rounds++
			var d struct {
				Reason string `json:"reason"`
				Paid   []struct {
					// The two bid piles, by position: wool and grain
					// normally, brick and lumber with Knights.
					Cards [2]int `json:"cards"`
				} `json:"paid"`
			}
			if err := json.Unmarshal(e.Data, &d); err != nil {
				t.Fatalf("decode %s: %v", e.Type, err)
			}
			// "coalition" counts alongside "majority": both are rounds a
			// bid decided, unlike "tie" and "nobody".
			if d.Reason == "majority" || d.Reason == "coalition" {
				st.byBid++
			}
			for _, p := range d.Paid {
				st.cards += p.Cards[0] + p.Cards[1]
			}
		default:
			// a tally, not a dispatch
		}
	}
	return st
}

// onFirstPath reports whether a placement took the first legal path, which is
// what Caravans.auto takes. It folds the log up to (not including) the event so
// it checks against the board the placer saw.
func onFirstPath(t *testing.T, before []engine.Event, placed engine.Event) bool {
	t.Helper()
	s, err := engine.Replay(before)
	if err != nil {
		t.Fatalf("replay to seq %d: %v", placed.Seq, err)
	}
	paths := scenarios.CamelPaths(s)
	if len(paths) == 0 {
		t.Fatalf("seq %d: a camel was placed with no legal path open", placed.Seq)
	}
	var d engine.CamelPath
	if err := json.Unmarshal(placed.Data, &d); err != nil {
		t.Fatalf("decode %s: %v", placed.Type, err)
	}
	return paths[0].Caravan == d.Caravan && paths[0].E == d.E
}

// runCamelGames plays a seed range with one bot configuration and sums the
// camel columns.
//
// tag is required: sim.GameID hashes the GameConfig, seed and Options.IDTag,
// and Options.Bots is not in the GameConfig, so two arms that differ only in
// bots would get the same game id and fail with ErrDuplicateGame in a shared
// store.
func runCamelGames(t *testing.T, st *store.Store, tag string, seeds []uint64, ruleset string, opts ...bot.Option) camelStats {
	t.Helper()
	var total camelStats
	for _, seed := range seeds {
		res, err := RunGame(st, Options{
			Players: 4, Ruleset: engine.CanonicalRuleset(ruleset), Seed: seed, IDTag: tag,
			Bots: func(engine.PlayerID) game.CommandSource {
				return bot.NewStrong(append([]bot.Option{bot.WithCamelBids()}, opts...)...)
			},
		})
		if err != nil {
			t.Fatalf("seed %d: %v", seed, err)
		}
		events, err := Transcript(st, res.GameID)
		if err != nil {
			t.Fatal(err)
		}
		s := collectCamelStats(t, events)
		total.placed += s.placed
		total.sentByBot += s.sentByBot
		total.rounds += s.rounds
		total.byBid += s.byBid
		total.cards += s.cards
		total.offFirst += s.offFirst
	}
	return total
}

// TestBotsPriceTheCamelAuction is the credit test for bot/caravans.go, written
// as an A/B rather than a threshold on a heuristic.
//
// The control is bot.WithoutCamelPlay(), which falls back to Caravans.auto as
// every bot did before the lane. It must show an inert mechanic: camels placed
// and rounds resolved by the engine, no cards paid, no round decided by a bid.
func TestBotsPriceTheCamelAuction(t *testing.T) {
	seeds := []uint64{11, 12, 13, 14}
	// One store for both arms, so a missing IDTag fails loudly with
	// ErrDuplicateGame on the second arm.
	st := openStore(t)
	off := runCamelGames(t, st, "camel-lane-off", seeds, "base+caravans", bot.WithoutCamelPlay())
	on := runCamelGames(t, st, "camel-lane-on", seeds, "base+caravans")
	t.Logf("lane off: %+v", off)
	t.Logf("lane on:  %+v", on)

	// The control: the mechanic runs and nobody decides anything.
	if off.placed == 0 || off.rounds == 0 {
		t.Fatalf("control placed no camel (%+v)", off)
	}
	if off.sentByBot != 0 {
		t.Errorf("control credited %d placements to a bot, want 0", off.sentByBot)
	}
	if off.offFirst != 0 {
		t.Errorf("control put %d camels off the first legal path, want 0", off.offFirst)
	}
	if off.cards != 0 || off.byBid != 0 {
		t.Errorf("control paid %d cards and won %d rounds on a bid, want 0 and 0", off.cards, off.byBid)
	}

	// The lane: the bot chooses where the camel goes, and pays for the right.
	if on.sentByBot == 0 {
		t.Errorf("no camel placed by a bot (%+v)", on)
	}
	if on.cards == 0 {
		t.Errorf("no card paid across %d rounds", on.rounds)
	}
	// A bot returning paths[0] is credited to SourceBot while choosing
	// what auto would have, so check that placement is actually chosen.
	if on.offFirst == 0 {
		t.Errorf("all %d camels landed on the first legal path", on.placed)
	}
	if on.byBid == 0 {
		t.Errorf("none of %d rounds was decided by a bid", on.rounds)
	}

	// See TestCamelLaneAffordable.
	assertCamelSpendIsAffordable(t, "lane on", on)

	// The no-bid arm is a ladder arm (sim/camellane_test.go), and a ladder
	// cannot tell whether a contender still does what its name says.
	// WithoutCamelBids must pay nothing and still choose placements.
	nobid := runCamelGames(t, st, "camel-no-bid", seeds, "base+caravans", bot.WithoutCamelBids())
	t.Logf("lane no-bid: %+v", nobid)
	if nobid.cards != 0 || nobid.byBid != 0 {
		t.Errorf("no-bid arm paid %d cards and won %d rounds on a bid, want 0 and 0",
			nobid.cards, nobid.byBid)
	}
	if nobid.offFirst == 0 {
		t.Errorf("no-bid arm placed every camel on the first legal path")
	}

	// Unpriced bids pay over four times as much for the same influence.
	unpriced := runCamelGames(t, st, "camel-lane-legacy", seeds, "base+caravans", bot.WithUnpricedCamelBids())
	t.Logf("lane unpriced: %+v", unpriced)
	if unpriced.cards <= on.cards {
		t.Errorf("unpriced arm paid %d cards, want more than the priced lane's %d",
			unpriced.cards, on.cards)
	}
	// offFirst is the placement influence the cards are meant to buy.
	if unpriced.offFirst > on.offFirst {
		t.Logf("unpriced moved %d placements off the first path against %d priced", unpriced.offFirst, on.offFirst)
	}
}

// camelCardsPerRoundCap is the most bid cards per camel round this bot may pay
// across a game before the default gate calls the lane unpriced. Counted in
// cards because the piles differ by ruleset (brick and lumber with Knights).
//
// Over 24 seeds the priced lane spends about 0.2-0.3 and the unpriced lane
// 1.4-1.7, so 0.7 sits well between them. Fewer seeds are too noisy (see
// camelSpendSeeds). The self-check in TestCamelLaneAffordable asserts
// the unpriced arm fails this bound.
//
// This is not a tuning target. When it fails the lane is mispriced; fix
// bot/caravans.go, not this number.
const camelCardsPerRoundCap = 0.7

// camelSpendSeeds is 24 games per arm (about 370 camel rounds). Four seeds give
// about 60 rounds, and the unpriced arm then reads anywhere from 0.63 to 1.44.
// Costs about 15 seconds in the default gate.
func camelSpendSeeds() []uint64 {
	seeds := make([]uint64, 0, 24)
	for i := uint64(21); i < 45; i++ {
		seeds = append(seeds, i)
	}
	return seeds
}

// TestCamelLaneAffordable bounds what the camel lane spends, in the
// default gate.
//
// Ladders skip under -race and need COSTAN_LADDERS=1, so neither gate measures
// bot strength, and a win-rate baseline cheap enough for the gate is too noisy.
// Spend is cheap, deterministic on a seed, and shows a mispriced lane quickly:
// the unpriced lane paid 1.44 cards a round to move a placement occasionally.
//
// This does not show the lane is good (the ladder in sim/camellane_test.go
// does that); it shows it is not overspending. Any bot lane that pays a
// resource cost can be checked this way: count spend and effect from the
// transcript and bound the ratio loosely.
func TestCamelLaneAffordable(t *testing.T) {
	seeds := camelSpendSeeds()
	st := openStore(t)
	on := runCamelGames(t, st, "camel-affordable", seeds, "base+caravans")
	unpriced := runCamelGames(t, st, "camel-affordable-legacy", seeds, "base+caravans", bot.WithUnpricedCamelBids())
	t.Logf("priced lane: %+v", on)
	t.Logf("unpriced lane: %+v", unpriced)

	assertCamelSpendIsAffordable(t, "priced lane", on)

	if unpriced.rounds == 0 {
		t.Fatal("unpriced arm resolved no round")
	}
	unpricedPer := float64(unpriced.cards) / float64(unpriced.rounds)
	pricedPer := float64(on.cards) / float64(on.rounds)

	// The unpriced lane must fail the bound, or the bound has drifted (or the
	// boards changed under it) and the test proves nothing.
	if unpricedPer <= camelCardsPerRoundCap {
		t.Errorf("unpriced lane spends %.2f cards a round, inside the %.2f bound",
			unpricedPer, camelCardsPerRoundCap)
	}

	// Relative check as well: board changes move what a camel round costs
	// on these seeds, and both arms see the same boards. A priced lane must
	// spend materially less than an unpriced one.
	if pricedPer*2 > unpricedPer {
		t.Errorf("priced lane spends %.3f cards a round against %.3f unpriced, want at most half",
			pricedPer, unpricedPer)
	}
	t.Logf("spend: priced %.3f, unpriced %.3f, ratio %.1fx", pricedPer, unpricedPer, unpricedPer/pricedPer)
}

func assertCamelSpendIsAffordable(t *testing.T, label string, st camelStats) {
	t.Helper()
	if st.rounds == 0 {
		t.Fatalf("%s: no camel round resolved", label)
	}
	per := float64(st.cards) / float64(st.rounds)
	t.Logf("%s: %.2f bid cards per camel round (%d cards, %d rounds), %d placements off the first path",
		label, per, st.cards, st.rounds, st.offFirst)
	if per > camelCardsPerRoundCap {
		t.Errorf("%s: %.2f bid cards paid per camel round, over the %.2f bound",
			label, per, camelCardsPerRoundCap)
	}
}
