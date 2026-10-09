package sim

import (
	"testing"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/wagons"
	"github.com/ftqo/costan.io/game"
	"github.com/ftqo/costan.io/store"
)

// wagonRulesets are every shipped combination that includes the scenario, in
// the spelling a lobby produces. Islands and Explorers are refused beside it
// (engine/compat.go).
var wagonRulesets = canonical([]string{
	"base+wagons",
	"base+cak+wagons",
	"base+fishermen+wagons",
	"base+caravans+wagons",
	"base+caravans+fishermen+wagons",
})

// TestWagonsAlwaysHasTradeHexes: every hook in engine/wagons keys off HasTrade,
// so a board with no cape triple would silently play without the scenario
// while still raising the target to 13. Board generation only, so it runs in
// the default gate.
func TestWagonsAlwaysHasTradeHexes(t *testing.T) {
	for _, rs := range wagonRulesets {
		for _, players := range []int{2, 3, 4, 5, 6, 8, 10} {
			for seed := uint64(1); seed <= 40; seed++ {
				evs, err := engine.New(engine.GameConfig{Players: players, Ruleset: rs},
					engine.Seeds{Public: seed, Private: seed ^ 0x9E37})
				if err != nil {
					t.Fatalf("%s/%dp/seed %d: new: %v", rs, players, seed, err)
				}
				s, err := engine.Replay(evs)
				if err != nil {
					t.Fatalf("%s/%dp/seed %d: replay: %v", rs, players, seed, err)
				}
				x, ok := wagons.StateExt(s)
				if !ok || !x.HasTrade {
					t.Fatalf("%s/%dp/seed %d: no trade hexes",
						rs, players, seed)
				}
				// The three legs of the circuit are the same length; that is
				// why the derivation prefers the alternating triple.
				r := s.Board.Radius
				for i := range x.Trade {
					for j := i + 1; j < len(x.Trade); j++ {
						if got := hexDistance(x.Trade[i], x.Trade[j]); got != 2*r {
							t.Fatalf("%s/%dp/seed %d: legs of %d and %d are %d apart, want 2R = %d",
								rs, players, seed, i, j, got, 2*r)
						}
					}
				}
				// Three barbarians, on three distinct paths a road could hold.
				seen := map[board.Edge]bool{}
				for i, e := range x.Barb {
					if e == (board.Edge{}) || seen[e] {
						t.Fatalf("%s/%dp/seed %d: barbarian %d unplaced or duplicated (%v)",
							rs, players, seed, i, e)
					}
					seen[e] = true
					if !e.Valid() || !s.Board.LandEdge(e) {
						t.Fatalf("%s/%dp/seed %d: barbarian %d on non-path %v",
							rs, players, seed, i, e)
					}
				}
				// And the robber is out of the game entirely, from setup.
				if s.Board.RobberOnBoard() {
					t.Fatalf("%s/%dp/seed %d: robber on board at %v",
						rs, players, seed, s.Board.Robber)
				}
			}
		}
	}
}

func hexDistance(a, b board.Hex) int {
	dq, dr := a.Q-b.Q, a.R-b.R
	ds := -dq - dr
	abs := func(n int) int {
		if n < 0 {
			return -n
		}
		return n
	}
	return (abs(dq) + abs(dr) + abs(ds)) / 2
}

// TestWagonsScenarioIsPlayed: three seeded games, each of which must produce
// scenario-only events. A game where nobody drives a wagon still finishes, so
// finishing is not enough.
func TestWagonsScenarioIsPlayed(t *testing.T) {
	st := openStore(t)
	for seed := uint64(1); seed <= 3; seed++ {
		res, err := RunGame(st, Options{
			Players: 4, Ruleset: "base+wagons", Seed: seed,
			Bots: func(engine.PlayerID) game.CommandSource { return bot.NewStrong() },
		})
		if err != nil {
			t.Fatalf("seed %d: %v", seed, err)
		}
		events, err := Transcript(st, res.GameID)
		if err != nil {
			t.Fatal(err)
		}
		var moved, loaded, deliveredN, tolls int
		for _, e := range events {
			switch e.Type {
			case wagons.EvMoved:
				moved++
			case wagons.EvLoaded:
				loaded++
			case wagons.EvDelivered:
				deliveredN++
			case wagons.EvGoldMoved:
				tolls++
			default:
				// a tally, not a dispatch
			}
		}
		t.Logf("seed %d: %d events, %d paths driven, %d loads, %d deliveries",
			seed, len(events), moved, loaded, deliveredN)
		if moved == 0 {
			t.Fatalf("seed %d: no wagon moved", seed)
		}
		if loaded == 0 {
			t.Fatalf("seed %d: no wagon loaded", seed)
		}
		if deliveredN == 0 {
			t.Fatalf("seed %d: no cargo delivered", seed)
		}
	}
}

// TestWagonsInvariantsAcrossRulesets is the slow-tier sweep. It checks the
// scenario's own bookkeeping after each game, which card conservation does not
// cover: gold is not a resource and delivered tokens are not bank cards.
func TestWagonsInvariantsAcrossRulesets(t *testing.T) {
	skipUnlessSlow(t, "plays hundreds of games")
	st := openStore(t)
	perRuleset := uint64(30)
	if raceEnabled {
		perRuleset = 6
	}
	for i, rs := range wagonRulesets {
		base := uint64(i+1) * 1000
		games, delivered, dry := 0, 0, 0
		for n := range perRuleset {
			res, err := RunGame(st, Options{
				Players: 4, Ruleset: rs, Seed: base + n,
				Bots: func(engine.PlayerID) game.CommandSource { return bot.NewStrong() },
			})
			if err != nil {
				t.Fatalf("%s seed %d: %v", rs, base+n, err)
			}
			games++
			s := replayGame(t, st, res.GameID)
			x, ok := wagons.StateExt(s)
			if !ok {
				t.Fatalf("%s seed %d: module state missing", rs, base+n)
			}
			total := 0
			for seat := range s.Players {
				p := engine.PlayerID(seat)
				// Gold is a count and is unbounded (the supply is not a
				// component here), but it can never go negative: every spend is
				// checked and every toll is refused when it cannot be paid.
				if g := x.Gold[seat]; g < 0 {
					t.Fatalf("%s seed %d: seat %d finished with %d gold", rs, base+n, seat, g)
				}
				if l := x.Level[seat]; l < 1 || l > 5 {
					t.Fatalf("%s seed %d: seat %d is at level %d, outside 1..5", rs, base+n, seat, l)
				}
				total += x.Landed[seat]
				// The scenario's VP is what its own hook says, which is what
				// the scoreboard reads.
				want := x.Landed[seat]
				if x.Level[seat] >= 5 {
					want++
				}
				got := 0
				for _, m := range s.Modules() {
					if h := m.Hooks().VictoryCheck; h != nil {
						got += h(s, p)
					}
				}
				if rs == "base+wagons" && got != want {
					t.Fatalf("%s seed %d: seat %d scores %d from the module, want %d",
						rs, base+n, seat, got, want)
				}
			}
			// Every stack draw is accounted for: the tokens delivered plus the
			// ones still on wagons cannot exceed what the three stacks dealt.
			dealt := 0
			for i := range x.Drawn {
				dealt += x.Refill[i]*12 + x.Drawn[i]
			}
			held := 0
			for _, c := range x.Cargo {
				if c != 0 {
					held++
				}
			}
			if total+held > dealt {
				t.Fatalf("%s seed %d: %d tokens delivered and %d carried against %d dealt",
					rs, base+n, total, held, dealt)
			}
			delivered += total
			if total == 0 {
				dry++
			}
			// The Longest Road award is not in play, so nobody can hold it.
			if s.LongestRoadHolder != engine.NoPlayer {
				t.Fatalf("%s seed %d: seat %d holds Longest Road",
					rs, base+n, s.LongestRoadHolder)
			}
		}
		t.Logf("%s: %d games, %d cargo delivered, %d games with none", rs, games, delivered, dry)
		if delivered == 0 {
			t.Errorf("%s: no cargo delivered in %d games", rs, games)
		}
	}
}

// replayGame folds a finished game's whole log, so an invariant is asserted
// against the state the log produces rather than a live one.
func replayGame(t *testing.T, st *store.Store, id string) *engine.State {
	t.Helper()
	events, err := st.LoadEvents(id, 0)
	if err != nil {
		t.Fatal(err)
	}
	s, err := engine.Replay(events)
	if err != nil {
		t.Fatalf("replaying %s: %v", id, err)
	}
	return s
}
