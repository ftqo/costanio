package bot_test

import (
	"testing"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/engine"
	_ "github.com/ftqo/costan.io/engine/harbormaster"
	_ "github.com/ftqo/costan.io/engine/islands"
	_ "github.com/ftqo/costan.io/engine/knights"
	_ "github.com/ftqo/costan.io/engine/raiders"
	_ "github.com/ftqo/costan.io/engine/rivers"
	_ "github.com/ftqo/costan.io/engine/scenarios"
	_ "github.com/ftqo/costan.io/engine/wagons"
)

// A bot must never propose an illegal command. Raiders makes this easy to get
// wrong: three of its commands are ordinary turn actions, which any other
// module's open interrupt refuses. A refused move does not crash (game.Actor
// falls back to auto), so this plays the rulesets end to end and requires that
// every command either bot proposes is accepted.
func TestRaidersBotsStayLegal(t *testing.T) {
	for _, ruleset := range []string{
		"base+raiders",
		engine.CanonicalRuleset("base+cak+raiders"),
		engine.CanonicalRuleset("base+islands+raiders"),
		engine.CanonicalRuleset("base+fishermen+raiders"),
		engine.CanonicalRuleset("base+caravans+raiders"),
		// Composed rulesets sample more coast shapes, which is where the bot's
		// Treason plan and the module's can disagree.
		engine.CanonicalRuleset("base+harbormaster+raiders+rivers+wagons"),
		engine.CanonicalRuleset("base+cak+harbormaster+raiders+rivers"),
	} {
		for _, kind := range []string{"strong", "simple"} {
			t.Run(ruleset+"/"+kind, func(t *testing.T) {
				for seed := uint64(1); seed <= 3; seed++ {
					playChecked(t, ruleset, kind, seed)
				}
			})
		}
	}
}

type actor interface {
	Act(*engine.State, engine.PlayerID) (engine.Command, bool)
}

func playChecked(t *testing.T, ruleset, kind string, seed uint64) {
	t.Helper()
	const players = 4
	evs, err := engine.New(engine.GameConfig{Players: players, Ruleset: ruleset}, engine.SeedsFrom(seed))
	if err != nil {
		t.Fatalf("%s seed %d: %v", ruleset, seed, err)
	}
	s, err := engine.Replay(evs)
	if err != nil {
		t.Fatal(err)
	}
	seats := make([]actor, players)
	for i := range seats {
		if kind == "simple" {
			b := bot.NewSimple()
			seats[i] = &b
		} else {
			seats[i] = bot.NewStrong()
		}
	}
	// Like the actor: ask every seat, and use the engine's auto move when none
	// acts. Unlike the actor, a refused bot move fails the test.
	for range 8000 {
		if s.Phase == engine.PhaseFinished {
			return
		}
		acted := false
		for i := range players {
			seat := engine.PlayerID(i)
			cmd, ok := seats[i].Act(s, seat)
			if !ok {
				continue
			}
			if cmd.Player != seat {
				t.Fatalf("%s/%s seed %d: seat %d proposed a command for seat %d", ruleset, kind, seed, seat, cmd.Player)
			}
			out, err := engine.Decide(s, cmd)
			if err != nil {
				t.Fatalf("%s/%s seed %d: seat %d proposed %s and the engine refused it: %v",
					ruleset, kind, seed, seat, cmd.Type, err)
			}
			for _, e := range out {
				if err := engine.Apply(s, e); err != nil {
					t.Fatalf("%s/%s seed %d: apply %s: %v", ruleset, kind, seed, e.Type, err)
				}
			}
			acted = true
			break
		}
		if acted {
			continue
		}
		cmd, ok := engine.AutoCommand(s)
		if !ok {
			return // nothing owed; a stalemate is a bot property, not a bug here
		}
		out, err := engine.Decide(s, cmd)
		if err != nil {
			t.Fatalf("%s/%s seed %d: engine auto move %s was refused: %v",
				ruleset, kind, seed, cmd.Type, err)
		}
		for _, e := range out {
			if err := engine.Apply(s, e); err != nil {
				t.Fatalf("%s/%s seed %d: apply %s: %v", ruleset, kind, seed, e.Type, err)
			}
		}
	}
}
