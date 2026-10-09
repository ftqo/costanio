package sim

import (
	"testing"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/islands"
	"github.com/ftqo/costan.io/game"
)

// TestBotSails checks the bot builds ships. Ship builds must be candidates and
// an eval term must see across water, or the bot never sails, and no
// head-to-head shows it since every opponent shares the blind spot.
//
// It runs on Shores, the map a 4-player base+islands game uses. A single
// landmass gives the bot nowhere to sail, so it correctly declines there.
func TestBotSails(t *testing.T) {
	skipUnlessSlow(t, "plays hundreds of games")
	st := openStore(t)
	ships, games := 0, 0
	for seed := uint64(1); seed <= 120; seed++ {
		res, err := RunGame(st, Options{
			Players: 4, Ruleset: "base+islands", Seed: seed,
			Board: shoresBoard(t),
			Bots:  func(engine.PlayerID) game.CommandSource { return bot.NewStrong() },
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
			if e.Type == islands.EvShipBuilt {
				ships++
			}
		}
	}
	t.Logf("%d games on Shores: %.2f ships built per game", games, float64(ships)/float64(games))
	if ships == 0 {
		t.Fatal("no ships built on an archipelago")
	}
}

// TestProceduralIslandsAreSailable: the procedural Islands carve drowns a channel
// behind an arc and produces 2 to 4 landmasses, and bot.islandsActive turns
// sailing on when there is more than one. If the carve regressed to a single
// landmass, the bot would stop sailing and this fails.
func TestProceduralIslandsAreSailable(t *testing.T) {
	skipUnlessSlow(t, "plays hundreds of games")
	st := openStore(t)
	ships := 0
	for seed := uint64(1); seed <= 60; seed++ {
		res, err := RunGame(st, Options{
			Players: 4, Ruleset: "base+islands", Seed: seed,
			Bots: func(engine.PlayerID) game.CommandSource { return bot.NewStrong() },
		})
		if err != nil {
			continue
		}
		events, err := Transcript(st, res.GameID)
		if err != nil {
			t.Fatal(err)
		}
		for _, e := range events {
			if e.Type == islands.EvShipBuilt {
				ships++
			}
		}
	}
	t.Logf("%d ships built across 60 procedural base+islands games", ships)
	if ships == 0 {
		t.Error("no ships built on a procedural islands board")
	}
}
