package sim

import (
	"strconv"
	"testing"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/islands"
	"github.com/ftqo/costan.io/game"
)

// shoresSailSeeds is sized to stay cheap under -race while still separating
// the two bots: over these seeds the house bot earns an island chip in most
// games at both player counts, and the same bot with Weights.IslandPull = 0
// (the evaluator before islandPull) in far fewer. See docs/bots.md, "Islands:
// the bot sails".
const shoresSailSeeds = 8

// sailTally plays shoresSailSeeds games of base+islands on Shores (Small) at
// the lobby's default start rule and counts ship builds and island chips.
func sailTally(t *testing.T, players int, newBot func() game.CommandSource) (shipless, chipGames, ships, chips int) {
	t.Helper()
	st := openStore(t)
	for seed := uint64(1); seed <= shoresSailSeeds; seed++ {
		res, err := RunGame(st, Options{
			Players: players, Ruleset: "base+islands", Seed: 4_200_000 + seed,
			Board: shoresBoard(t),
			Bots:  func(engine.PlayerID) game.CommandSource { return newBot() },
		})
		if err != nil {
			t.Fatalf("%dp seed %d: %v", players, seed, err)
		}
		events, err := Transcript(st, res.GameID)
		if err != nil {
			t.Fatal(err)
		}
		gs, gc := 0, 0
		for _, e := range events {
			switch e.Type {
			case islands.EvShipBuilt:
				gs++
			case islands.EvIslandChip:
				gc++
			default:
				// a tally, not a dispatch
			}
		}
		ships += gs
		chips += gc
		if gs == 0 {
			shipless++
		}
		if gc > 0 {
			chipGames++
		}
	}
	return shipless, chipGames, ships, chips
}

// TestShoresSmallBotsSail: on Shores (Small), the 3-4 player Islands map the
// lobby recommends, the house bot builds ships in every game and earns island
// chips in most of them.
//
// islandPull (bot/islands.go) prices the chip along the whole plan (roads to
// the coast, a coastal settlement, ships); reachableProduction's distance
// decay alone can't see it. With IslandPull off the same seeds earn chips in
// far fewer games.
func TestShoresSmallBotsSail(t *testing.T) {
	for _, players := range []int{3, 4} {
		t.Run(strconv.Itoa(players)+"p", func(t *testing.T) {
			t.Parallel()
			shipless, chipGames, ships, chips := sailTally(t, players, func() game.CommandSource { return bot.NewStrong() })
			t.Logf("%dp Shores (Small): %d games, %d ships, %d chips, %d games with a chip, %d with no ship",
				players, shoresSailSeeds, ships, chips, chipGames, shipless)
			if shipless > 0 {
				t.Errorf("%d of %d games built no ship at all", shipless, shoresSailSeeds)
			}
			if chipGames < shoresSailMinChipGames {
				t.Errorf("an island chip was earned in %d of %d games, want at least %d",
					chipGames, shoresSailSeeds, shoresSailMinChipGames)
			}
		})
	}
}

// shoresSailMinChipGames: the house bot earned a chip in 8 of 8 games at both
// player counts; with IslandPull = 0 it was 4 (3p) and 5 (4p), with one 3p game
// building no ship at all.
const shoresSailMinChipGames = 7
