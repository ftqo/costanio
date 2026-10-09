package sim

import (
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/game"
)

// TestFriendlyRobberNeverRobsProtected plays full bot games with the friendly
// robber on and replays each transcript: no steal may name a player who was
// protected (public VP at or below the ruleset's starting score,
// State.FriendlyRobberMaxVP) at that moment. Knights runs too, since its seats
// start on 3. Both bot tiers run, Simple (the auto/greedy path) and Strong
// (which simulates moves through the engine), so both robber-placement paths
// are exercised; an illegal placement would also stall the game, which the
// completion check catches. Protection keys off public VP, so hidden VP cards
// don't matter.
func TestFriendlyRobberNeverRobsProtected(t *testing.T) {
	skipUnlessSlow(t, "plays full games")
	tiers := []struct {
		name string
		bots func(engine.PlayerID) game.CommandSource // nil = default Simple
	}{
		{"simple", nil},
		{"strong", func(engine.PlayerID) game.CommandSource { return bot.NewStrong() }},
	}
	rulesets := []struct {
		ruleset string
		target  int
		seeds   uint64
	}{
		{"base", 8, 20},
		{"base+cak", 10, 6},
	}
	for _, tier := range tiers {
		for _, rc := range rulesets {
			t.Run(tier.name+"/"+rc.ruleset, func(t *testing.T) {
				seeds := rc.seeds
				steals := 0
				for seed := uint64(1); seed <= seeds; seed++ {
					st := openStore(t)
					res, err := RunGame(st, Options{
						Players:        4,
						Seed:           seed,
						Ruleset:        rc.ruleset,
						TargetVP:       rc.target,
						FriendlyRobber: true,
						Timeout:        60 * time.Second,
						Bots:           tier.bots,
					})
					if err != nil {
						if errors.Is(err, ErrStalemate) {
							continue // rare non-terminating seed; not a friendly-robber failure
						}
						t.Fatalf("seed %d: %v", seed, err)
					}
					ev, err := Transcript(st, res.GameID)
					if err != nil {
						t.Fatalf("seed %d transcript: %v", seed, err)
					}

					s := engine.Empty()
					for _, e := range ev {
						if e.Type == engine.EvCardStolen || e.Type == knightsCommodityStolen {
							var d struct {
								Victim engine.PlayerID `json:"victim"`
							}
							if err := json.Unmarshal(e.Data, &d); err != nil {
								t.Fatalf("seed %d: decode stolen: %v", seed, err)
							}
							if s.FriendlyRobberMaxVP() != map[string]int{"base": 2, "base+cak": 3}[rc.ruleset] {
								t.Fatalf("%s: shield threshold %d", rc.ruleset, s.FriendlyRobberMaxVP())
							}
							if s.FriendlyRobberProtected(d.Victim) {
								t.Fatalf("seed %d: robbed protected player %d at public VP %d",
									seed, d.Victim, s.PublicVPWithModules(d.Victim))
							}
							steals++
						}
						if err := engine.Apply(s, e); err != nil {
							t.Fatalf("seed %d: replay apply %s: %v", seed, e.Type, err)
						}
					}
				}
				if steals == 0 {
					t.Fatal("no steals across any seed")
				}
				t.Logf("checked %d steals across %d seeds, none on a protected player", steals, seeds)
			})
		}
	}
}

// knightsCommodityStolen is Knights' commodity steal, spelled here so this file
// does not import the module for one constant.
const knightsCommodityStolen engine.EventType = "cak_commodity_stolen"
