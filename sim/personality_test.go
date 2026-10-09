package sim

import (
	"encoding/json"
	"os"
	"slices"
	"testing"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/game"
	"github.com/ftqo/costan.io/store"
)

// personalityTally is what one seat did over a run, counted from the event log.
//
// These count behaviour rather than win rate: a head-to-head cannot see what a
// bot never does (see docs/bots.md). A personality's claim is about what it
// plays. Strength needs a ladder and is not measured here.
type personalityTally struct {
	games       int
	roads       int
	settlements int
	cities      int
	devBuys     int
	offers      int
	bankTrades  int
	robberMoves int
	knights     int // EvKnightPlayed: dev-card knights this seat actually played
	turns       int // EvTurnEnded for this seat: the denominator every rate needs
	longestRoad int // games finished holding the title
	routeLen    int // route length at the end, summed
	wins        int
}

func (a *personalityTally) add(b personalityTally) {
	a.games += b.games
	a.roads += b.roads
	a.settlements += b.settlements
	a.cities += b.cities
	a.devBuys += b.devBuys
	a.offers += b.offers
	a.bankTrades += b.bankTrades
	a.robberMoves += b.robberMoves
	a.knights += b.knights
	a.turns += b.turns
	a.longestRoad += b.longestRoad
	a.routeLen += b.routeLen
	a.wins += b.wins
}

// playerOf pulls the acting seat out of an event payload. Every event this
// counts carries the actor under one of these two keys.
func playerOf(e engine.Event) (engine.PlayerID, bool) {
	var d struct {
		Player *engine.PlayerID `json:"player"`
		By     *engine.PlayerID `json:"by"`
	}
	if json.Unmarshal(e.Data, &d) != nil {
		return 0, false
	}
	switch {
	case d.Player != nil:
		return *d.Player, true
	case d.By != nil:
		return *d.By, true
	}
	return 0, false
}

// measureSeat plays one game with `seat` on `mk` and the other three on the
// house strategy, and tallies what that seat did.
func measureSeat(t *testing.T, seed uint64, seat engine.PlayerID, mk func() game.CommandSource) personalityTally {
	t.Helper()
	st, err := store.OpenMem()
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	res, err := RunGame(st, Options{
		Players: 4, Ruleset: "base", Seed: seed, DiceMode: "random", BoardMode: "fair",
		Bots: func(p engine.PlayerID) game.CommandSource {
			if p == seat {
				return mk()
			}
			return bot.NewStrong()
		},
		// GameID cannot see Options.Bots, so two arms over one seed range in
		// one store need distinct tags. See the GameID doc.
		IDTag: "personality",
	})
	if err != nil {
		t.Fatalf("seed %d: %v", seed, err)
	}
	events, err := st.LoadEvents(res.GameID, 0)
	if err != nil {
		t.Fatal(err)
	}
	tally := personalityTally{games: 1}
	if res.Winner == seat {
		tally.wins = 1
	}
	s := engine.Empty()
	for _, e := range events {
		if err := engine.Apply(s, e); err != nil {
			t.Fatalf("replay: %v", err)
		}
		p, ok := playerOf(e)
		if !ok || p != seat {
			continue
		}
		switch e.Type {
		case engine.EvRoadBuilt:
			tally.roads++
		case engine.EvSettlementBuilt:
			// Count the build, not setup placement (EvSettlementPlace), which every
			// seat does twice regardless of strategy.
			tally.settlements++
		case engine.EvCityBuilt:
			tally.cities++
		case engine.EvDevCardBought:
			tally.devBuys++
		case engine.EvTradeOffered:
			tally.offers++
		case engine.EvBankTraded:
			tally.bankTrades++
		case engine.EvRobberMoved:
			tally.robberMoves++
		case engine.EvKnightPlayed:
			tally.knights++
		case engine.EvTurnEnded:
			tally.turns++
		default:
			// Every other event type. This tally counts the handful of actions a
			// personality's character makes a claim about, not the log.
		}
	}
	if s.LongestRoadHolder == seat {
		tally.longestRoad = 1
	}
	tally.routeLen = engine.LongestRouteLength(s, seat)
	return tally
}

// measure runs `games` seeds for one personality, rotating the seat so seat bias
// doesn't leak into the numbers (as sim.Run does).
func measure(t *testing.T, name string, games int) personalityTally {
	t.Helper()
	p, ok := bot.PersonalityByName(name)
	if !ok {
		t.Fatalf("%s is not registered", name)
	}
	var total personalityTally
	for i := range games {
		total.add(measureSeat(t, uint64(1000+i), engine.PlayerID(i%4), func() game.CommandSource {
			return p.New()
		}))
	}
	return total
}

// personalityGames is the sample size: small for the default gate, with the
// slow gate running the hundred-game sample docs/bots.md reports. Behaviour
// counts need far fewer games than win rates; a bot building nearly twice as
// many roads shows it in a handful.
//
// A row that passes on one seed range may still flip on another: see
// wholeGameRowGames.
func personalityGames() int {
	if os.Getenv("COSTAN_SIM_SLOW") != "" {
		return 100
	}
	return 16
}

// TestWinstonChasesLongestRoad: Winston's road preference over whole games
// against the house strategy. The vector and single-decision checks are
// bot.TestWinstonIsARoadMaximalist and bot.TestWinstonPrefersARoadToASettlement.
func TestWinstonChasesLongestRoad(t *testing.T) {
	n := personalityGames()
	winston := measure(t, "Winston", n)
	william := measure(t, "William", n)

	t.Logf("over %d games each, 4-player base, seat rotated:", n)
	t.Logf("  Winston: %d roads, route %d, Longest Road in %d games, %d settlements, %d cities, %d wins",
		winston.roads, winston.routeLen, winston.longestRoad, winston.settlements, winston.cities, winston.wins)
	t.Logf("  William: %d roads, route %d, Longest Road in %d games, %d settlements, %d cities, %d wins",
		william.roads, william.routeLen, william.longestRoad, william.settlements, william.cities, william.wins)

	if winston.roads <= william.roads {
		t.Errorf("Winston built %d roads, William %d; want Winston more",
			winston.roads, william.roads)
	}
	if winston.routeLen <= william.routeLen {
		t.Errorf("Winston's total route was %d, William's %d; want Winston longer",
			winston.routeLen, william.routeLen)
	}
	if winston.longestRoad <= william.longestRoad {
		t.Errorf("Winston held Longest Road in %d games, William %d; want Winston more",
			winston.longestRoad, william.longestRoad)
	}
}

// wholeGameRowGames is the sample a whole-game rate row needs before it may
// gate.
//
// Random-mode dice, dev draws and robber steals are rngFor(seed, NextSeq), so
// any change that adds or removes one event re-rolls the rest of every game.
// Over 500 games cut into seat-aligned windows, at 16 games Camembert's offer
// row inverts in 21% of windows, Camembert's settlement row in 16%, Bop's
// settlement row in 9% and Winston's city row in 4%; at 100 games they are
// 1%, 0%, 0%, 0%. Winston's road row and Happaya's offer row never invert at
// 16, so those two gate at the default sample and the others at this one.
const wholeGameRowGames = 100

// TestEveryPersonalityPlaysItsCharacter checks each personality that makes a
// countable claim, and logs the whole roster either way.
//
// Few rows are gated because most weight differences move no countable
// statistic (docs/bots.md: the 13-weight vector is worth about +3.7 points end
// to end). Winston moves a lot because it adds a new term (Weights.Route).
// Personalities without a row are covered by
// bot.TestEveryPersonalityIsADistinctVector and
// bot.TestEveryPersonalityStaysLegal. The logged numbers back the table in
// docs/bots.md.
func TestEveryPersonalityPlaysItsCharacter(t *testing.T) {
	n := personalityGames()
	base := measure(t, "William", n)
	logTally(t, "William", base)

	// Per turn, not per run: raw counts scale with game length.
	rate := func(t *testing.T, p personalityTally, of func(personalityTally) int) float64 {
		t.Helper()
		if p.turns == 0 {
			t.Fatal("the seat took no turns")
		}
		return float64(of(p)) / float64(p.turns)
	}

	measured := map[string]bool{}
	for _, tc := range []struct {
		name string
		stat string
		of   func(personalityTally) int
		more bool // beat William's rate, else come in under it
		// minGames is the smallest sample this row is asserted at. Below it the
		// row is only logged; see wholeGameRowGames.
		minGames int
	}{
		{"Winston", "roads built", func(p personalityTally) int { return p.roads }, true, 16},
		{"Winston", "cities built", func(p personalityTally) int { return p.cities }, false, wholeGameRowGames},
		{"Happaya", "trades offered", func(p personalityTally) int { return p.offers }, true, 16},
		{"Camembert", "trades offered", func(p personalityTally) int { return p.offers }, true, wholeGameRowGames},
		{"Camembert", "settlements built", func(p personalityTally) int { return p.settlements }, false, wholeGameRowGames},
		{"Bop", "settlements built", func(p personalityTally) int { return p.settlements }, false, wholeGameRowGames},
	} {
		t.Run(tc.name+"/"+tc.stat, func(t *testing.T) {
			got := measure(t, tc.name, n)
			if !measured[tc.name] {
				logTally(t, tc.name, got)
				measured[tc.name] = true
			}
			g, w := rate(t, got, tc.of), rate(t, base, tc.of)
			t.Logf("  %s per turn: %s %.3f, William %.3f", tc.stat, tc.name, g, w)
			if n < tc.minGames {
				// Not a skip: the games were played and the numbers logged; only the
				// verdict is withheld. TestEveryPersonalityDecidesInCharacter covers
				// the same character at this sample size on identical positions.
				t.Logf("  (not asserted at %d games: this row needs %d; COSTAN_SIM_SLOW=1 asserts it)", n, tc.minGames)
				return
			}
			if tc.more && g <= w {
				t.Errorf("%s: %s per turn = %.3f, William = %.3f; want more", tc.name, tc.stat, g, w)
			}
			if !tc.more && g >= w {
				t.Errorf("%s: %s per turn = %.3f, William = %.3f; want fewer", tc.name, tc.stat, g, w)
			}
		})
	}

	// The rest are logged, not gated: no single countable event differs
	// enough to assert.
	for _, name := range bot.PersonalityNames() {
		if name == "William" || measured[name] {
			continue
		}
		t.Run(name+"/unpriced", func(t *testing.T) {
			logTally(t, name, measure(t, name, n))
		})
	}
}

// decisionProbe plays the house bot's move and, at every point where the seat
// is free to choose what to do with its turn, asks each probe personality what
// it would do from the same position. Probes never move a piece, so every probe
// answers the same positions.
type decisionProbe struct {
	house  game.CommandSource
	probes map[string]*bot.Strong
	chose  map[string]map[engine.CommandType]int // shared across seats and games
	asked  *int
}

func (d decisionProbe) Act(s *engine.State, seat engine.PlayerID) (engine.Command, bool) {
	if s.Phase == engine.PhasePlay && s.Cur == seat && s.Rolled && s.ActiveOffer == nil &&
		!s.RobberPending && len(s.PendingDiscards) == 0 {
		*d.asked++
		for name, p := range d.probes {
			if cmd, ok := p.Act(s.Clone(), seat); ok {
				d.chose[name][cmd.Type]++
			}
		}
	}
	return d.house.Act(s, seat)
}

// TestEveryPersonalityDecidesInCharacter holds the gated characters at the
// default sample size, which whole-game rates cannot (see wholeGameRowGames).
//
// Whole-game rates compare two different games, since the NextSeq-keyed dice
// diverge after the first different event. Here the house bot plays every
// seat, and at each turn decision the personality and William are both asked
// what they would do from that position. Over 300 games cut into 16-game
// windows no row inverted in any window.
//
// Camembert's "fewer settlements" is not here: paired, it inverted in 4 of
// 285 windows (the hoarding shows over a whole game, not per decision). It
// gates in the whole-game test at wholeGameRowGames.
//
// A probe sees only the position the seat itself is handed.
func TestEveryPersonalityDecidesInCharacter(t *testing.T) {
	n := personalityGames()
	rows := []struct {
		name string
		cmd  engine.CommandType
		more bool
	}{
		{"Winston", engine.CmdBuildRoad, true},
		{"Winston", engine.CmdBuildCity, false},
		{"Happaya", engine.CmdOfferTrade, true},
		{"Camembert", engine.CmdOfferTrade, true},
		{"Bop", engine.CmdBuildSettlement, false},
	}
	names := []string{"William"}
	for _, r := range rows {
		if !slices.Contains(names, r.name) {
			names = append(names, r.name)
		}
	}
	chose := map[string]map[engine.CommandType]int{}
	pers := map[string]bot.Personality{}
	for _, name := range names {
		chose[name] = map[engine.CommandType]int{}
		pers[name] = bot.PersonalityByNameOrSkip(t, name)
	}
	asked := 0
	for i := range n {
		st, err := store.OpenMem()
		if err != nil {
			t.Fatal(err)
		}
		_, err = RunGame(st, Options{
			Players: 4, Ruleset: "base", Seed: uint64(1000 + i), DiceMode: "random", BoardMode: "fair",
			Bots: func(engine.PlayerID) game.CommandSource {
				probes := map[string]*bot.Strong{}
				for _, name := range names {
					probes[name] = pers[name].New()
				}
				return decisionProbe{house: bot.NewStrong(), probes: probes, chose: chose, asked: &asked}
			},
			IDTag: "personality-decisions",
		})
		st.Close()
		if err != nil {
			t.Fatalf("seed %d: %v", 1000+i, err)
		}
	}
	if asked == 0 {
		t.Fatal("no turn decision was probed")
	}
	t.Logf("%d games, %d turn decisions asked of every probe", n, asked)
	for _, r := range rows {
		g, w := chose[r.name][r.cmd], chose["William"][r.cmd]
		t.Logf("  %-9s %-17s %s %d, William %d", r.name, r.cmd, r.name, g, w)
		if r.more && g <= w {
			t.Errorf("%s chose %s at %d of %d positions, William at %d; want more", r.name, r.cmd, g, asked, w)
		}
		if !r.more && g >= w {
			t.Errorf("%s chose %s at %d of %d positions, William at %d; want fewer", r.name, r.cmd, g, asked, w)
		}
	}
}

// logTally prints one personality's per-turn rates, every counter. It is the
// source of the table in docs/bots.md.
func logTally(t *testing.T, name string, p personalityTally) {
	t.Helper()
	if p.turns == 0 {
		t.Fatalf("%s took no turns", name)
	}
	r := func(n int) float64 { return float64(n) / float64(p.turns) }
	t.Logf("%-10s %d games %4d turns | per turn: settle %.3f city %.3f road %.3f dev %.3f knight %.3f bank %.3f offer %.3f | route %d, Longest Road %d/%d",
		name, p.games, p.turns, r(p.settlements), r(p.cities), r(p.roads), r(p.devBuys),
		r(p.knights), r(p.bankTrades), r(p.offers), p.routeLen, p.longestRoad, p.games)
}

// TestMixedPersonalityTablesFinish plays what production seats: four different
// personalities at one table, drawn without replacement as lobby.pickBotName
// does. A table of four unusual bots can reach positions a clone table never
// does; a game that can't finish returns ErrStalemate, and an engine invariant
// violation surfaces as an error.
//
// It walks the registry in a rotating window so every personality is seated
// several times.
func TestMixedPersonalityTablesFinish(t *testing.T) {
	names := bot.PersonalityNames()
	tables := personalityGames() / 2
	for i := range tables {
		seats := make([]bot.Personality, 4)
		for j := range seats {
			seats[j] = bot.PersonalityByNameOrSkip(t, names[(i*4+j)%len(names)])
		}
		st, err := store.OpenMem()
		if err != nil {
			t.Fatal(err)
		}
		res, err := RunGame(st, Options{
			Players: 4, Ruleset: "base", Seed: uint64(5000 + i),
			DiceMode: "random", BoardMode: "fair", IDTag: "mixed-personalities",
			Bots: func(p engine.PlayerID) game.CommandSource { return seats[int(p)].New() },
		})
		st.Close()
		if err != nil {
			t.Fatalf("table %d (%s, %s, %s, %s): %v",
				i, seats[0].Name, seats[1].Name, seats[2].Name, seats[3].Name, err)
		}
		if res.WinnerVP < 10 {
			t.Errorf("table %d finished with a winner on %d VP, below the target", i, res.WinnerVP)
		}
	}
}
