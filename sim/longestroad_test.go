package sim

import (
	"testing"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/game"
)

// TestValuingLongestRoadBeatsIgnoringIt validates through the real stack that
// counting the Longest Road title's victory points is an improvement, on a
// seed base the headless experiment never used.
//
// The bot still doesn't build toward the title (chasing it measured 48.1%
// [46.6, 49.6] over 4000 games; TestStrongDoesNotChaseLongestRoad guards that).
// Only the points are now visible, including on opponents.
func TestValuingLongestRoadBeatsIgnoringIt(t *testing.T) {
	skipLadderUnlessRequested(t)
	skipLadderUnderRace(t)
	skipUnlessSlow(t, "plays hundreds of games")
	st := openStore(t)
	l, err := Run(st, LadderOptions{
		Contenders: []Contender{
			{Name: "values-title", New: func() game.CommandSource { return bot.NewStrong() }},
			{Name: "chases-title", New: func() game.CommandSource { return bot.NewStrong(bot.WithLongestRoad()) }},
		},
		Games: 800, Players: 4, Seed: 9_100_000, Workers: 8,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Log("\n" + l.String())
	if l.Beats("chases-title", "values-title") {
		t.Fatalf("chasing longest road beat declining to chase:\n%s", l)
	}
}
