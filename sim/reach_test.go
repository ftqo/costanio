package sim

import (
	"testing"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/game"
)

// TestAcceptPathReached counts how often the cloned acceptance policy is even
// consulted. A neutral ladder result means nothing if the code never runs.
func TestAcceptPathReached(t *testing.T) {
	st := openStore(t)
	calls, offers := 0, 0
	for i := range 30 {
		res, err := RunGame(st, Options{
			Players: 4, Ruleset: "base", Seed: uint64(5000 + i),
			Bots: func(engine.PlayerID) game.CommandSource {
				return bot.NewStrong(bot.WithAcceptProbe(func() { calls++ }))
			},
		})
		if err != nil {
			t.Fatal(err)
		}
		evs, err := Transcript(st, res.GameID)
		if err != nil {
			t.Fatal(err)
		}
		for _, e := range evs {
			if e.Type == engine.EvTradeOffered {
				offers++
			}
		}
	}
	t.Logf("respond() entered %d times against %d offers over 30 games", calls, offers)
	if calls == 0 {
		t.Fatal("respond() never consulted")
	}
}
