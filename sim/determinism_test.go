package sim

import (
	"bytes"
	"testing"
	"time"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/game"
)

// TestStrongDeterministic: a game must be fully reproducible from its seed, so
// identical inputs produce a byte-identical event log. The bot must never let
// Go's randomized map iteration choose between equal-scoring candidates.
//
// Without COSTAN_SIM_SLOW it narrows to one instance rather than skipping; the
// full sweep (every ruleset, three seeds) takes minutes.
func TestStrongDeterministic(t *testing.T) {
	// Bots play most rulesets with base moves, so target a VP base building
	// can reach (full Knights needs 13; see TestRulesetsPlayToCompletion).
	// base+cak runs to its real target so the late-game progress cards
	// (Intrigue and Diplomat candidates iterate maps) are played.
	// The scenario combinations run to their module targets (12 VP under
	// Caravans, 13 with Knights), where every module's hooks fire in one game.
	// Raiders runs to its own 12: below about 8 points nobody needs
	// prisoners, so a short game never fights the battles where the seeded
	// roll-offs and loss die live.
	targets := map[string]int{"base": 7, "base+caravans": 7, "base+cak": 13, "base+fishermen": 7, "base+islands": 7,
		"base+harbormaster": 7, "base+rivers": 7, "base+raiders": 12}

	run := func(seed uint64, ruleset string) ([]engine.Event, Result) {
		st := openStore(t)
		res, err := RunGame(st, Options{
			Players:  4,
			Seed:     seed,
			Ruleset:  ruleset,
			TargetVP: targets[ruleset],
			Timeout:  60 * time.Second,
			Bots:     func(engine.PlayerID) game.CommandSource { return bot.NewStrong() },
		})
		if err != nil {
			t.Fatalf("%s seed %d: %v", ruleset, seed, err)
		}
		ev, err := Transcript(st, res.GameID)
		if err != nil {
			t.Fatal(err)
		}
		return ev, res
	}

	rulesets := []string{"base", "base+caravans", "base+cak", "base+fishermen", "base+islands",
		"base+harbormaster", "base+rivers",
		"base+caravans+fishermen", "base+cak+caravans+fishermen+islands", "base+raiders",
		// The Knights pairing gets its own row: its board derivation differs
		// (rule B re-deals one starting-island forest), and it combines a
		// three-phase turn, an event die and a barbarian fleet.
		"cak+explorers"}
	seeds := []uint64{7, 31337, 999}
	if !slowEnabled() {
		// Narrowed, not skipped.
		//
		// base+cak rather than base: with sortVertices broken on purpose,
		// base seed 7 stayed identical while base+cak seed 7 diverged. The
		// 13-VP Knights game has the widest decision space. ~12s under -race.
		//
		// The two scenario combinations stay in on one seed each, since
		// module-interaction bugs only show up in combined games.
		rulesets, seeds = []string{"base+cak", "base+caravans+fishermen", "base+cak+caravans+fishermen+islands"}, seeds[:1]
	}

	for _, ruleset := range rulesets {
		t.Run(ruleset, func(t *testing.T) {
			// Several seeds: some divergences only appear on some boards.
			for _, seed := range seeds {
				checkDeterministic(t, run, seed, ruleset)
			}
		})
	}
}

func checkDeterministic(t *testing.T, run func(uint64, string) ([]engine.Event, Result), seed uint64, ruleset string) {
	t.Helper()
	evA, resA := run(seed, ruleset)
	evB, resB := run(seed, ruleset)

	if resA.Winner != resB.Winner || resA.WinnerVP != resB.WinnerVP {
		t.Fatalf("%s seed %d outcome differs: %+v vs %+v", ruleset, seed, resA, resB)
	}
	if len(evA) != len(evB) {
		t.Fatalf("%s seed %d event count differs: %d vs %d", ruleset, seed, len(evA), len(evB))
	}
	for i := range evA {
		if evA[i].Type != evB[i].Type || !bytes.Equal(evA[i].Data, evB[i].Data) {
			t.Fatalf("%s seed %d event %d differs:\n  A: %s %s\n  B: %s %s",
				ruleset, seed, i, evA[i].Type, evA[i].Data, evB[i].Type, evB[i].Data)
		}
	}
}
