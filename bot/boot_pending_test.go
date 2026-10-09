package bot

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/islands"
	"github.com/ftqo/costan.io/engine/scenarios"
)

// The boot may only be passed on an actionable turn: after the roll and with
// no module interrupt outstanding (decideGiveBoot gates on
// RequireActionableTurn). Strong must resolve a pending (e.g. a gold choice)
// before passing the boot, or the give_boot is rejected.
func TestStrongResolvesPendingBeforePassingBoot(t *testing.T) {
	events, err := engine.New(engine.GameConfig{Players: 4, Ruleset: "base+fishermen+islands"}, engine.SeedsFrom(5))
	if err != nil {
		t.Fatal(err)
	}
	s := engine.Empty()
	for _, e := range events {
		if err := engine.Apply(s, e); err != nil {
			t.Fatal(err)
		}
	}
	s.Phase = engine.PhasePlay
	s.Cur = 0
	s.Rolled = true

	fx, ok := scenarios.FishStateExt(s)
	if !ok {
		t.Fatal("fishermen ext missing")
	}
	fx.BootHolder, fx.BootInPlay = 0, true
	// Every other seat is at least level on public VP, so a pass is available.
	ix, ok := islands.StateExt(s)
	if !ok {
		ix = &islands.Ext{
			Ships:       map[board.Edge]engine.PlayerID{},
			BuiltTurn:   map[board.Edge]bool{},
			PendingGold: map[engine.PlayerID]int{},
			Reached:     map[engine.PlayerID]map[int]bool{},
			IslandVP:    map[engine.PlayerID]int{},
		}
		s.Ext[islands.Name] = ix
	}
	ix.PendingGold[0] = 2

	b := NewStrong()
	if err := engine.RequireActionableTurn(s, 0); err == nil {
		t.Fatal("fixture: expected the gold pending to block the turn")
	}
	cmd, ok := b.Act(s, 0)
	if !ok {
		t.Fatal("bot returned no command")
	}
	if cmd.Type == scenarios.CmdGiveBoot {
		t.Fatalf("bot passed the boot with a gold choice pending")
	}
	if cmd.Type != islands.CmdChooseGold {
		t.Fatalf("cmd = %s, want %s", cmd.Type, islands.CmdChooseGold)
	}
	if _, err := engine.Decide(s, cmd); err != nil {
		t.Fatalf("bot's command rejected: %v", err)
	}

	// Once the pending is cleared, the pass is the first thing this turn.
	delete(ix.PendingGold, 0)
	cmd, ok = b.Act(s, 0)
	if !ok || cmd.Type != scenarios.CmdGiveBoot {
		t.Fatalf("after pending cleared: cmd = %s ok=%v, want %s", cmd.Type, ok, scenarios.CmdGiveBoot)
	}
}
