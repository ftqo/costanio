package sim

import (
	"encoding/json"
	"testing"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/scenarios"
	"github.com/ftqo/costan.io/game"
)

// TestBotSpendsFish checks the bot converts the fish it catches. Production
// hands tiles out automatically, so catches alone don't show the bot uses them,
// and a win rate can't show it when every opponent hoards too.
func TestBotSpendsFish(t *testing.T) {
	skipUnlessSlow(t, "plays hundreds of games")
	st := openStore(t)
	caught, spent, games := 0, 0, 0
	for seed := uint64(1); seed <= 120; seed++ {
		res, err := RunGame(st, Options{
			Players: 4, Ruleset: "base+fishermen", Seed: seed,
			Bots: func(engine.PlayerID) game.CommandSource { return bot.NewStrong() },
		})
		if err != nil {
			continue
		}
		games++
		events, err := Transcript(st, res.GameID)
		if err != nil {
			t.Fatal(err)
		}
		for _, e := range events {
			switch e.Type {
			case scenarios.EvFishCaught:
				caught++
			case scenarios.EvFishSpent:
				spent++
			default:
				// a tally, not a dispatch: every other event type is uncounted
			}
		}
	}
	t.Logf("%d games: %.2f fish caught, %.2f spent per game", games, float64(caught)/float64(games), float64(spent)/float64(games))
	if spent == 0 {
		t.Fatal("no fish spent in any game")
	}
}

// TestFishSpendingBeatsHoarding validates the gain through the real stack, on a
// seed base the headless experiment never used.
func TestFishSpendingBeatsHoarding(t *testing.T) {
	skipLadderUnlessRequested(t)
	st := openStore(t)
	l, err := Run(st, LadderOptions{
		Contenders: []Contender{
			{Name: "spends fish", New: func() game.CommandSource { return bot.NewStrong() }},
			{Name: "hoards fish", New: func() game.CommandSource { return bot.NewStrong(bot.WithoutFishSpending()) }},
		},
		Games: 1200, Players: 4, Ruleset: "base+fishermen", Seed: 2_400_000, Workers: 8,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Log("\n" + l.String())
	if l.Beats("hoards fish", "spends fish") {
		t.Fatalf("spending fish weakened the bot:\n%s", l)
	}
}

// TestBotPassesBoot checks the bot passes the boot. It costs its holder a
// victory point until passed, so a bot that never passes plays the rest of
// the game a point behind.
func TestBotPassesBoot(t *testing.T) {
	skipUnlessSlow(t, "plays hundreds of games")
	st := openStore(t)
	passes, games := 0, 0
	for seed := uint64(1); seed <= 150; seed++ {
		res, err := RunGame(st, Options{
			Players: 4, Ruleset: "base+fishermen", Seed: seed,
			Bots: func(engine.PlayerID) game.CommandSource { return bot.NewStrong() },
		})
		if err != nil {
			continue
		}
		games++
		events, err := Transcript(st, res.GameID)
		if err != nil {
			t.Fatal(err)
		}
		for _, e := range events {
			if e.Type == scenarios.EvBootGiven {
				passes++
			}
		}
	}
	t.Logf("%d games: %.2f boot passes per game", games, float64(passes)/float64(games))
	if passes == 0 {
		t.Fatal("the boot is never passed")
	}
}

// TestPassingBootBeatsKeepingIt prices the boot pass on its own, separately from
// the fish economy.
func TestPassingBootBeatsKeepingIt(t *testing.T) {
	skipLadderUnlessRequested(t)
	st := openStore(t)
	l, err := Run(st, LadderOptions{
		Contenders: []Contender{
			{Name: "passes boot", New: func() game.CommandSource { return bot.NewStrong() }},
			{Name: "keeps boot", New: func() game.CommandSource { return bot.NewStrong(bot.WithKeepBoot()) }},
		},
		Games: 2400, Players: 4, Ruleset: "base+fishermen", Seed: 6_800_000, Workers: 8,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Log("\n" + l.String())
	if l.Beats("keeps boot", "passes boot") {
		t.Fatalf("passing the boot weakened the bot:\n%s", l)
	}
}

// TestFishChanceSpendsAreUsed checks the two spends that resolve a random draw
// are actually reachable once scored by expectation rather than by simulation.
func TestFishChanceSpendsAreUsed(t *testing.T) {
	skipUnlessSlow(t, "plays hundreds of games")
	st := openStore(t)
	uses := map[string]int{}
	games := 0
	for seed := uint64(1); seed <= 150; seed++ {
		res, err := RunGame(st, Options{
			Players: 4, Ruleset: "base+fishermen", Seed: seed,
			Bots: func(engine.PlayerID) game.CommandSource { return bot.NewStrong() },
		})
		if err != nil {
			continue
		}
		games++
		events, err := Transcript(st, res.GameID)
		if err != nil {
			t.Fatal(err)
		}
		for _, e := range events {
			if e.Type != scenarios.EvFishSpent {
				continue
			}
			var d struct {
				Use string `json:"use"`
			}
			if json.Unmarshal(e.Data, &d) == nil {
				uses[d.Use]++
			}
		}
	}
	for _, u := range []string{scenarios.FishRemoveRobber, scenarios.FishSteal, scenarios.FishTakeResource, scenarios.FishFreeRoad, scenarios.FishDevCard} {
		t.Logf("  %-14s %5.2f / game", u, float64(uses[u])/float64(games))
	}
}

// TestFishChanceSpendsAddValue prices the two expectation-scored spends on top of
// the deterministic ones.
func TestFishChanceSpendsAddValue(t *testing.T) {
	skipLadderUnlessRequested(t)
	st := openStore(t)
	l, err := Run(st, LadderOptions{
		Contenders: []Contender{
			{Name: "all spends", New: func() game.CommandSource { return bot.NewStrong() }},
			{Name: "deterministic only", New: func() game.CommandSource { return bot.NewStrong(bot.WithoutFishChanceSpends()) }},
		},
		Games: 2400, Players: 4, Ruleset: "base+fishermen", Seed: 9_600_000, Workers: 8,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Log("\n" + l.String())
	if l.Beats("deterministic only", "all spends") {
		t.Fatalf("the chance-scored spends weakened the bot:\n%s", l)
	}
}
