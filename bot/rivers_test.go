package bot_test

import (
	"encoding/json"
	"fmt"
	"testing"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/engine"
	_ "github.com/ftqo/costan.io/engine/islands"
	_ "github.com/ftqo/costan.io/engine/knights"
	"github.com/ftqo/costan.io/engine/rivers"
	_ "github.com/ftqo/costan.io/engine/scenarios"
)

// Bridges must actually get built. A river of n hexes has n bridge sites (n-1
// seams plus one coastal outlet). If the module offered sites no bot could
// reach, bridges would silently never appear, so this plays whole games.

// TestBridgesBuiltOnBridgeSites plays base+rivers to a finish with each
// bot and counts the bridges. Both bots have a bridge policy, so a run with
// none means the scenario is not being played.
func TestBridgesBuiltOnBridgeSites(t *testing.T) {
	for _, kind := range []string{"strong", "simple"} {
		t.Run(kind, func(t *testing.T) {
			built, games := 0, 0
			for seed := uint64(1); seed <= 4; seed++ {
				s := playRiversGame(t, "base+rivers", kind, seed)
				games++
				x, ok := rivers.StateExt(s)
				if !ok {
					t.Fatalf("seed %d: no rivers ext", seed)
				}
				built += len(x.Bridges)
				// Every bridge stands on a site the module still calls one.
				for e := range x.Bridges {
					if !x.IsBridgeSite(e) {
						t.Fatalf("seed %d: bridge on non-site %v", seed, e)
					}
				}
				// And the site count is the scenario's: n per river.
				for ri, r := range x.Rivers {
					if len(r.Sites) != len(r.Hexes) {
						t.Fatalf("seed %d: river %d of %d hexes offers %d sites, want %d",
							seed, ri, len(r.Hexes), len(r.Sites), len(r.Hexes))
					}
				}
			}
			if built == 0 {
				t.Fatalf("%d games of base+rivers built no bridge", games)
			}
		})
	}
}

// TestRiversBotsStayLegal is the Raiders test's claim for
// this scenario, over the rulesets whose land mask or turn structure the module
// composes with.
func TestRiversBotsStayLegal(t *testing.T) {
	for _, ruleset := range []string{
		"base+rivers",
		engine.CanonicalRuleset("base+islands+rivers"),
		engine.CanonicalRuleset("base+cak+rivers"),
		engine.CanonicalRuleset("base+caravans+fishermen+rivers"),
	} {
		for _, kind := range []string{"strong", "simple"} {
			t.Run(ruleset+"/"+kind, func(t *testing.T) {
				for seed := uint64(1); seed <= 2; seed++ {
					playChecked(t, ruleset, kind, seed)
				}
			})
		}
	}
}

// playRiversGame is playChecked's sibling that hands back the finished state, so
// the caller can look at what the game ended up holding. It refuses an illegal
// command for the same reason playChecked does.
func playRiversGame(t *testing.T, ruleset, kind string, seed uint64) *engine.State {
	t.Helper()
	const players = 4
	evs, err := engine.New(engine.GameConfig{Players: players, Ruleset: ruleset}, engine.SeedsFrom(seed))
	if err != nil {
		t.Fatalf("%s seed %d: %v", ruleset, seed, err)
	}
	s, err := engine.Replay(evs)
	if err != nil {
		t.Fatal(err)
	}
	seats := make([]actor, players)
	for i := range seats {
		if kind == "simple" {
			b := bot.NewSimple()
			seats[i] = &b
		} else {
			seats[i] = bot.NewStrong()
		}
	}
	for range 8000 {
		if s.Phase == engine.PhaseFinished {
			return s
		}
		acted := false
		for i := range players {
			seat := engine.PlayerID(i)
			cmd, ok := seats[i].Act(s, seat)
			if !ok {
				continue
			}
			out, err := engine.Decide(s, cmd)
			if err != nil {
				t.Fatalf("%s/%s seed %d: seat %d proposed %s and the engine refused it: %v",
					ruleset, kind, seed, seat, cmd.Type, err)
			}
			for _, e := range out {
				if err := engine.Apply(s, e); err != nil {
					t.Fatalf("%s/%s seed %d: apply %s: %v", ruleset, kind, seed, e.Type, err)
				}
			}
			acted = true
			break
		}
		if acted {
			continue
		}
		cmd, ok := engine.AutoCommand(s)
		if !ok {
			return s
		}
		out, err := engine.Decide(s, cmd)
		if err != nil {
			t.Fatalf("%s/%s seed %d: engine auto move %s was refused: %v",
				ruleset, kind, seed, cmd.Type, err)
		}
		for _, e := range out {
			if err := engine.Apply(s, e); err != nil {
				t.Fatalf("%s/%s seed %d: apply %s: %v", ruleset, kind, seed, e.Type, err)
			}
		}
	}
	return s
}

// Coin conversions must not round-trip in one turn (sell wheat for a coin, then
// buy wheat back with coins). Counted over whole games, since it is a property
// of two decisions in sequence.
//
// The allowance is not zero: one legitimate case remains, where a seat sells
// from a real surplus and a later bank trade then leaves it short.
func TestStrongRiversNoSameTurnBuyback(t *testing.T) {
	trips := 0
	for seed := uint64(1); seed <= 3; seed++ {
		trips += riversRoundTrips(t, seed)
	}
	if trips > 1 {
		t.Fatalf("%d same-turn sell-then-buy-back round trips over three games, want at most 1", trips)
	}
}

// riversRoundTrips plays one four-seat Strong base+rivers game and counts the
// turns in which a seat sold a resource for a coin and then spent coins on that
// same resource.
func riversRoundTrips(t *testing.T, seed uint64) int {
	t.Helper()
	const players = 4
	evs, err := engine.New(engine.GameConfig{Players: players, Ruleset: "base+rivers"}, engine.SeedsFrom(seed))
	if err != nil {
		t.Fatal(err)
	}
	s, err := engine.Replay(evs)
	if err != nil {
		t.Fatal(err)
	}
	seats := make([]*bot.Strong, players)
	for i := range seats {
		seats[i] = bot.NewStrong()
	}
	sold := map[string]bool{}
	trips := 0
	apply := func(out []engine.Event) {
		for _, e := range out {
			var d struct {
				Player engine.PlayerID `json:"player"`
				Res    string          `json:"res"`
			}
			if e.Type == engine.EvTurnStarted {
				clear(sold)
			}
			if e.Type == rivers.EvCoinBought {
				_ = json.Unmarshal(e.Data, &d)
				sold[fmt.Sprint(d.Player, d.Res)] = true
			}
			if e.Type == rivers.EvCoinsSpent {
				_ = json.Unmarshal(e.Data, &d)
				if sold[fmt.Sprint(d.Player, d.Res)] {
					trips++
				}
			}
			if err := engine.Apply(s, e); err != nil {
				t.Fatalf("seed %d: apply %s: %v", seed, e.Type, err)
			}
		}
	}
	for range 8000 {
		if s.Phase == engine.PhaseFinished {
			return trips
		}
		acted := false
		for i := range players {
			cmd, ok := seats[i].Act(s, engine.PlayerID(i))
			if !ok {
				continue
			}
			out, err := engine.Decide(s, cmd)
			if err != nil {
				t.Fatalf("seed %d: %s refused: %v", seed, cmd.Type, err)
			}
			apply(out)
			acted = true
			break
		}
		if acted {
			continue
		}
		cmd, ok := engine.AutoCommand(s)
		if !ok {
			return trips
		}
		out, err := engine.Decide(s, cmd)
		if err != nil {
			t.Fatalf("seed %d: auto %s refused: %v", seed, cmd.Type, err)
		}
		apply(out)
	}
	return trips
}
