package sim

import (
	"strconv"
	"strings"
	"testing"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/islands"
	"github.com/ftqo/costan.io/game"

	"github.com/ftqo/costan.io/engine/board"
)

// Shores (Small) as authored in the frontend map gallery: land only, radius 4,
// one gold islet. Frame() computes the ocean, as a real game does.
//
// recommendedMap sends a 4-player base+islands game here, so this is the board
// to measure Islands play on; procedural generation is a single landmass.
const shoresLand = "0,-3 2,-3 3,-3 3,-2 -1,-1 0,-1 1,-1 3,-1 -2,0 -1,0 0,0 1,0 -3,1 -2,1 -1,1 0,1 1,1 3,1 -3,2 -2,2 -1,2 0,2 2,2 -3,3 -2,3 -1,3 1,3"
const shoresGold = "4,-1"

// Archipelago: six roughly-equal islands, two gold islets. The map where sailing
// should matter most, since no player has a large home island to expand across.
const archiLand = "0,-3 3,-3 5,-3 -1,-2 0,-2 2,-2 3,-2 5,-2 6,-2 -2,-1 -1,-1 1,-1 2,-1 5,-1 -2,1 1,1 2,1 4,1 5,1 -3,2 -2,2 0,2 1,2 3,2 4,2 -3,3 -2,3 0,3 2,3 3,3"
const archiGold = "1,-3 6,-3"

func shoresBoard(t *testing.T) *board.Board { return isleBoard(t, 4, shoresLand, shoresGold) }

func archiBoard(t *testing.T) *board.Board { return isleBoard(t, 6, archiLand, archiGold) }

func isleBoard(t *testing.T, radius int, landSpec, goldSpec string) *board.Board {
	t.Helper()
	parse := func(spec string) []board.Hex {
		var out []board.Hex
		for p := range strings.FieldsSeq(spec) {
			qr := strings.Split(p, ",")
			q, err1 := strconv.Atoi(qr[0])
			r, err2 := strconv.Atoi(qr[1])
			if err1 != nil || err2 != nil {
				t.Fatalf("bad hex %q", p)
			}
			out = append(out, board.Hex{Q: q, R: r})
		}
		return out
	}
	land, gold := parse(landSpec), parse(goldSpec)
	b := &board.Board{Radius: radius, Robber: land[0], Tiles: map[board.Hex]board.Tile{}}
	for _, h := range land {
		b.Tiles[h] = board.Tile{Res: board.ResLand}
	}
	for _, h := range gold {
		b.Tiles[h] = board.Tile{Res: board.Gold}
	}
	b.Frame()
	return b
}

func TestShoresHasIslands(t *testing.T) {
	b := shoresBoard(t)
	distinct := map[int]bool{}
	for _, id := range b.Islands() {
		distinct[id] = true
	}
	t.Logf("Shores (Small): %d distinct islands", len(distinct))
	if len(distinct) < 2 {
		t.Fatalf("Shores should be an archipelago, got %d island(s)", len(distinct))
	}
}

// TestShoresIslandChain: on the board Islands games are played on, does the bot
// sail, arrive, and score?
func TestShoresIslandChain(t *testing.T) {
	skipUnlessSlow(t, "plays hundreds of games")
	for _, tc := range []struct {
		name string
		new  func() game.CommandSource
	}{
		{"sails", func() game.CommandSource { return bot.NewStrong() }},
		{"land only", func() game.CommandSource { return bot.NewStrong(bot.WithLandOnly()) }},
	} {
		st := openStore(t)
		ships, chips, games := 0, 0, 0
		for seed := uint64(1); seed <= 150; seed++ {
			res, err := RunGame(st, Options{
				Players: 4, Ruleset: "base+islands", Seed: seed,
				Board: shoresBoard(t),
				Bots:  func(engine.PlayerID) game.CommandSource { return tc.new() },
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
				case islands.EvShipBuilt:
					ships++
				case islands.EvIslandChip:
					chips++
				default:
					// a tally, not a dispatch: every other event type is uncounted
				}
			}
		}
		if games == 0 {
			t.Errorf("%-10s no games completed", tc.name)
			continue
		}
		t.Logf("%-10s %d games: %.2f ships/game, %.2f island chips/game (2 VP each)",
			tc.name, games, float64(ships)/float64(games), float64(chips)/float64(games))
	}
}

// TestShoresSailingWins is the head-to-head on the real board, where there is
// somewhere to sail to (on a single landmass sailing measured 48.6%).
func TestShoresSailingWins(t *testing.T) {
	skipLadderUnlessRequested(t)
	skipLadderUnderRace(t)
	skipUnlessSlow(t, "plays hundreds of games")
	st := openStore(t)
	l, err := Run(st, LadderOptions{
		Contenders: []Contender{
			{Name: "sails", New: func() game.CommandSource { return bot.NewStrong() }},
			{Name: "land only", New: func() game.CommandSource { return bot.NewStrong(bot.WithLandOnly()) }},
		},
		Games: 1200, Players: 4, Ruleset: "base+islands",
		Board: shoresBoard(t), Seed: 5_100_000, Workers: 8,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Log("\n" + l.String())
	// 1200 games resolves about +/-2.8 points, so this can't see the measured
	// +3.4; it catches sailing breaking outright. The 6000-game figures are in
	// docs/bots.md.
	if l.Beats("land only", "sails") {
		t.Fatalf("sailing loses on Shores:\n%s", l)
	}
}

// TestArchipelagoSailingWins is the same head-to-head on the map that most
// needs sailing: six roughly equal islands, no large home island.
func TestArchipelagoSailingWins(t *testing.T) {
	skipLadderUnlessRequested(t)
	skipLadderUnderRace(t)
	skipUnlessSlow(t, "plays hundreds of games")
	b := archiBoard(t)
	distinct := map[int]bool{}
	for _, id := range b.Islands() {
		distinct[id] = true
	}
	t.Logf("archipelago: %d distinct islands", len(distinct))

	st := openStore(t)
	l, err := Run(st, LadderOptions{
		Contenders: []Contender{
			{Name: "sails", New: func() game.CommandSource { return bot.NewStrong() }},
			{Name: "land only", New: func() game.CommandSource { return bot.NewStrong(bot.WithLandOnly()) }},
		},
		Games: 1200, Players: 4, Ruleset: "base+islands",
		Board: b, Seed: 3_141_000, Workers: 8,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Log("\n" + l.String())
}
