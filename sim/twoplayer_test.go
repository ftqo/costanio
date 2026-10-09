package sim

import (
	"errors"
	"os"
	"strconv"
	"testing"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/game"
)

// 2-player games are supported and are the cheapest self-play configuration, so
// the same invariant battery the 4-player suite runs has to hold at 2: resource
// conservation against the bank, no negative hands or piece counts, the distance
// rule, Decide purity, an illegal-command battery that must never panic or
// mutate, and Replay(log) deep-equal to the live state.
func TestTwoPlayerAdversarial(t *testing.T) {
	seeds := uint64(25)
	if raceEnabled {
		seeds = 3 // the detector costs ~15x here; see race_norace_test.go
	}
	for seed := uint64(1); seed <= seeds; seed++ {
		t.Run("", func(t *testing.T) {
			adversarialGame(t, "base", 2, seed, simpleActor)
		})
	}
}

func TestTwoPlayerAdversarialModules(t *testing.T) {
	rulesets := []string{"base+islands", "base+cak", "base+fishermen", "base+caravans", "base+raiders"}
	if raceEnabled {
		// Knights is the heaviest module and the likeliest to trip an invariant;
		// the others are covered on the non-race pass. See race_norace_test.go.
		rulesets = []string{"base+cak"}
	}
	for _, rs := range rulesets {
		t.Run(rs, func(t *testing.T) {
			adversarialGame(t, rs, 2, 1, simpleActor)
		})
	}
}

// TestTwoPlayerGamesTerminate guards the bank-trade dig in tradeTowardBuild.
//
// Without it, about 0.7% of two-player games never finished: both players had
// upgraded their setup settlements, had no open spot next to their network,
// and found nothing to trade toward, so every turn passed, even when a 4:1
// trade out of surplus ore was legal. Two players is where a total resource
// drought becomes possible, so the test lives here.
func TestTwoPlayerGamesTerminate(t *testing.T) {
	skipUnlessSlow(t, "runs hundreds of games")
	st := openStore(t)
	// The default is sized so this test fits its share of the package timeout
	// with the race detector on (~15x here). The timeout is per package, so
	// size heavy tests together. Raise it for a soak:
	//
	//	COSTAN_SIM_GAMES=1000 go test -race ./sim -run TestTwoPlayerGamesTerminate
	games := 600
	if raceEnabled {
		games = 60
	}
	if v := os.Getenv("COSTAN_SIM_GAMES"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 {
			t.Fatalf("COSTAN_SIM_GAMES=%q: want a positive integer", v)
		}
		games = n
	}
	stalemates := 0
	for seed := uint64(1); seed <= uint64(games); seed++ {
		_, err := RunGame(st, Options{
			Players: 2, Ruleset: "base", Seed: seed,
			Bots: func(engine.PlayerID) game.CommandSource { return bot.NewStrong() },
		})
		switch {
		case errors.Is(err, ErrStalemate):
			stalemates++
		case err != nil:
			t.Fatalf("seed %d: %v", seed, err)
		}
	}
	// The unfixed rate was ~0.7% (~4 expected here); any at all means the dig
	// has stopped working.
	if stalemates > 0 {
		t.Fatalf("%d/%d two-player games did not terminate", stalemates, games)
	}
}
