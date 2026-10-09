package ruletest

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
)

// Every ruleset must be able to end by surrender, draw and claim: the modules
// react to a batch of events they have never seen, and a module that panicked
// or refused would leave a stuck game with no way out of it.
func TestConcedeWorksUnderEveryRuleset(t *testing.T) {
	for _, ruleset := range []string{"base", "base+islands", "base+cak", "base+fishermen", "base+caravans",
		"base+harbormaster", "base+rivers", "base+raiders", "base+wagons"} {
		t.Run(ruleset, func(t *testing.T) {
			cfg := engine.GameConfig{Players: 2, Ruleset: ruleset}
			log, err := engine.New(cfg, engine.SeedsFrom(42))
			if err != nil {
				t.Fatal(err)
			}
			s, err := engine.Replay(log)
			if err != nil {
				t.Fatal(err)
			}
			for s.TurnsCompleted < engine.DrawMinTurns {
				cmd, ok := engine.AutoCommand(s)
				if !ok {
					t.Fatalf("no auto command at turn %d, phase %s", s.TurnsCompleted, s.Phase)
				}
				events, err := engine.Decide(s, cmd)
				if err != nil {
					t.Fatalf("Decide(%s): %v", cmd.Type, err)
				}
				for _, e := range events {
					if err := engine.Apply(s, e); err != nil {
						t.Fatal(err)
					}
				}
				log = append(log, events...)
				if s.Phase == engine.PhaseFinished {
					t.Fatal("auto play finished the game before a draw was offered")
				}
			}
			events, err := engine.Decide(s, engine.Command{Player: 0, Type: engine.CmdOfferDraw})
			if err != nil {
				t.Fatalf("offer draw: %v", err)
			}
			for _, e := range events {
				if err := engine.Apply(s, e); err != nil {
					t.Fatal(err)
				}
			}
			log = append(log, events...)
			events, err = engine.Decide(s, engine.Command{Player: 1, Type: engine.CmdRespondDraw, Data: []byte(`{"accept":true}`)})
			if err != nil {
				t.Fatalf("accept draw: %v", err)
			}
			for _, e := range events {
				if err := engine.Apply(s, e); err != nil {
					t.Fatal(err)
				}
			}
			log = append(log, events...)
			if s.Phase != engine.PhaseFinished || s.Winner != engine.NoPlayer {
				t.Fatalf("phase %s winner %d, want finished with no winner", s.Phase, s.Winner)
			}
			replayed, err := engine.Replay(log)
			if err != nil {
				t.Fatalf("Replay: %v", err)
			}
			if replayed.Winner != s.Winner || replayed.Phase != s.Phase || replayed.TurnsCompleted != s.TurnsCompleted {
				t.Fatal("replay diverged from the live state")
			}
		})
	}
}
