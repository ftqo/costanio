package sim

import (
	"sync/atomic"
	"testing"
	"time"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/explorers"
	"github.com/ftqo/costan.io/game"
)

type explorersUpgradeCounter struct {
	game.CommandSource
	cities, harbours *atomic.Int64
}

func (b *explorersUpgradeCounter) Act(s *engine.State, seat engine.PlayerID) (engine.Command, bool) {
	cmd, ok := b.CommandSource.Act(s, seat)
	if ok {
		switch cmd.Type {
		case engine.CmdBuildCity:
			b.cities.Add(1)
		case explorers.CmdBuildHarbour:
			b.harbours.Add(1)
		default:
			// Only count the two upgrade choices.
		}
	}
	return cmd, ok
}

// Measure actual city use as well as wins: a policy that produces no cities
// cannot provide evidence about the city branch, whatever its ladder score.
func TestExplorersCityChoiceLadder(t *testing.T) {
	skipLadderUnlessRequested(t)
	var cities, harbours [2]atomic.Int64
	contenders := []Contender{
		{Name: "city-choice", New: func() game.CommandSource { return &explorersUpgradeCounter{bot.NewStrong(), &cities[0], &harbours[0]} }},
		{Name: "harbour-first", New: func() game.CommandSource {
			return &explorersUpgradeCounter{bot.NewStrong(bot.WithoutExplorersCityChoice()), &cities[1], &harbours[1]}
		}},
	}
	ladder, err := Run(openStore(t), LadderOptions{
		Contenders: contenders, Games: 256, Players: 4, Ruleset: "cak+explorers", Seed: 1, Workers: 4,
		Timeout: 5 * time.Minute, BotDelay: time.Millisecond,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Log(ladder.String())
	for i, contender := range contenders {
		t.Logf("%s: cities=%d harbours=%d", contender.Name, cities[i].Load(), harbours[i].Load())
	}
	if ladder.Stalemates != 0 || ladder.Draws != 0 {
		t.Fatalf("unfinished games: %+v", ladder)
	}
	if cities[0].Load() == 0 {
		t.Fatal("the new policy never built a city")
	}
	if ladder.Beats("harbour-first", "city-choice") {
		t.Fatal("city choice loses to the prior policy with non-overlapping confidence intervals")
	}
}
