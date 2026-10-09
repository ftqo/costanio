package bot

import (
	"strings"
	"testing"

	"github.com/ftqo/costan.io/engine"
	_ "github.com/ftqo/costan.io/engine/knights"
	_ "github.com/ftqo/costan.io/engine/scenarios"
	"github.com/ftqo/costan.io/engine/wagons"
)

// TestWagonBotsStayLegal plays whole games with each bot and
// requires every command it proposes to be one the engine accepts.
//
// The actor falls back to a legal move when a bot is refused (game/actor.go),
// so a bot proposing illegal moves would still finish games; this asserts the
// property directly. Steps come from wagons.LegalSteps and every other
// candidate is confirmed with Decide, so a failure means one of those was
// skipped.
func TestWagonBotsStayLegal(t *testing.T) {
	for _, tc := range []struct {
		name string
		act  func() func(*engine.State, engine.PlayerID) (engine.Command, bool)
	}{
		{"simple", func() func(*engine.State, engine.PlayerID) (engine.Command, bool) {
			b := NewSimple()
			return b.Act
		}},
		{"strong", func() func(*engine.State, engine.PlayerID) (engine.Command, bool) {
			b := NewStrong()
			return b.Act
		}},
	} {
		for _, ruleset := range []string{"base+wagons", engine.CanonicalRuleset("base+caravans+wagons")} {
			t.Run(tc.name+"/"+ruleset, func(t *testing.T) {
				for seed := uint64(1); seed <= 3; seed++ {
					playWagonGame(t, ruleset, seed, tc.act)
				}
			})
		}
	}
}

// playWagonGame drives one game with a bot per seat and fails on the first
// command any of them proposes that the engine refuses.
func playWagonGame(t *testing.T, ruleset string, seed uint64,
	newBot func() func(*engine.State, engine.PlayerID) (engine.Command, bool)) {
	t.Helper()
	const players = 4
	evs, err := engine.New(engine.GameConfig{Players: players, Ruleset: ruleset}, engine.SeedsFrom(seed))
	if err != nil {
		t.Fatalf("%s seed %d: %v", ruleset, seed, err)
	}
	s, err := engine.Replay(evs)
	if err != nil {
		t.Fatalf("%s seed %d: %v", ruleset, seed, err)
	}
	acts := make([]func(*engine.State, engine.PlayerID) (engine.Command, bool), players)
	for i := range acts {
		acts[i] = newBot()
	}

	wagonCmds := 0
	for step := 0; step < 6000 && s.Phase != engine.PhaseFinished; step++ {
		cmd, ok := engine.Command{}, false
		fromBot := false
		for seat := range players {
			if c, o := acts[seat](s, engine.PlayerID(seat)); o {
				cmd, ok, fromBot = c, true, true
				break
			}
		}
		if !ok {
			// No bot had an opinion: the engine's own minimal move keeps the
			// game going. Those are not what this test is about.
			cmd, ok = engine.AutoCommand(s)
		}
		if !ok {
			t.Fatalf("%s seed %d: nobody owes anything at step %d, phase %s", ruleset, seed, step, s.Phase)
		}
		if fromBot && strings.HasPrefix(string(cmd.Type), "wagons_") {
			wagonCmds++
		}
		out, err := engine.Decide(s, cmd)
		if err != nil {
			if !fromBot {
				t.Fatalf("%s seed %d: engine auto move %s was refused: %v", ruleset, seed, cmd.Type, err)
			}
			t.Fatalf("%s seed %d step %d: bot proposed %s for seat %d, refused: %v\n"+
				"payload: %s", ruleset, seed, step, cmd.Type, cmd.Player, err, cmd.Data)
		}
		for _, e := range out {
			if err := engine.Apply(s, e); err != nil {
				t.Fatalf("%s seed %d: applying %s: %v", ruleset, seed, e.Type, err)
			}
		}
	}
	if s.Phase != engine.PhaseFinished {
		t.Fatalf("%s seed %d: the game did not finish in 6000 steps", ruleset, seed)
	}
	// The lane must actually fire, or the test proves nothing.
	if wagonCmds == 0 {
		t.Fatalf("%s seed %d: no wagons command in the whole game", ruleset, seed)
	}
	x, ok := wagons.StateExt(s)
	if !ok {
		t.Fatalf("%s seed %d: no wagons state in a finished game", ruleset, seed)
	}
	t.Logf("%s seed %d: %d wagons commands, deliveries %v, levels %v",
		ruleset, seed, wagonCmds, x.Landed, x.Level)
}
