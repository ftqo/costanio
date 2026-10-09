package bot

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/knights"
	"github.com/ftqo/costan.io/engine/rivers"

	_ "github.com/ftqo/costan.io/engine/scenarios"
)

// Rivers with Knights lets a seat that lost the barbarian defense pay 5 coins
// to keep its city. The three cases: paying, being unable to pay, and no buyout
// on offer. The last two must reach the sacrifice, not a refused command.

// buyoutState builds a game of the given ruleset in the play phase where seat 1
// owes the barbarians a city and owns exactly one.
//
// Constructed rather than seed-hunted (CONTRIBUTING.md).
func buyoutState(t *testing.T, ruleset string, coins int) (*engine.State, board.Vertex) {
	t.Helper()
	log, err := engine.New(engine.GameConfig{Players: 4, Ruleset: ruleset}, engine.SeedsFrom(7))
	if err != nil {
		t.Fatal(err)
	}
	s := engine.Empty()
	for _, e := range log {
		if err := engine.Apply(s, e); err != nil {
			t.Fatal(err)
		}
	}
	for step := 0; s.Phase == engine.PhaseSetup && step < 200; step++ {
		cmd, ok := engine.AutoCommand(s)
		if !ok {
			t.Fatal("setup owes nothing but the game is still in setup")
		}
		evs, err := engine.Decide(s, cmd)
		if err != nil {
			t.Fatalf("setup decide %s: %v", cmd.Type, err)
		}
		for _, e := range evs {
			if err := engine.Apply(s, e); err != nil {
				t.Fatal(err)
			}
		}
	}
	if s.Phase != engine.PhasePlay {
		t.Fatalf("game is in phase %s, want play", s.Phase)
	}

	p := engine.PlayerID(1)
	var city board.Vertex
	found := false
	for v, b := range s.Buildings {
		if b.Owner == p && !found {
			b.City = true
			s.Buildings[v] = b
			city, found = v, true
		}
	}
	if !found {
		t.Fatalf("seat %d owns no building after setup", p)
	}
	cx, ok := knights.StateExt(s)
	if !ok {
		t.Fatalf("no knights ext in a %s game", ruleset)
	}
	cx.PendingDowngrade = []engine.PlayerID{p}
	if rx, ok := rivers.StateExt(s); ok {
		rx.Coins[p] = coins
	} else if coins > 0 {
		t.Fatalf("no rivers ext in a %s game (want %d coins)", ruleset, coins)
	}
	return s, city
}

// A seat that can pay pays: a city is worth far more than five coins.
func TestStrongBuysOffAPillage(t *testing.T) {
	s, _ := buyoutState(t, "base+cak+rivers", rivers.CoinsPerPillageBuyout)
	b := NewStrong()
	cmd, ok := b.knightsBarbarianSacrifice(s, engine.PlayerID(1))
	if !ok {
		t.Fatal("the bot answered nothing while it owed the barbarians a city")
	}
	if cmd.Type != knights.CmdPillageBuyout {
		t.Fatalf("the bot answered %s holding %d coins, want %s",
			cmd.Type, rivers.CoinsPerPillageBuyout, knights.CmdPillageBuyout)
	}
	// The engine must accept the command.
	if _, err := engine.Decide(s, cmd); err != nil {
		t.Fatalf("the engine refused the bot's buyout: %v", err)
	}
}

// One coin short, and the bot gives a city up rather than proposing a command
// the engine will refuse.
func TestStrongSacrificesWhenItCannotBuyOff(t *testing.T) {
	s, _ := buyoutState(t, "base+cak+rivers", rivers.CoinsPerPillageBuyout-1)
	b := NewStrong()
	cmd, ok := b.knightsBarbarianSacrifice(s, engine.PlayerID(1))
	if !ok {
		t.Fatal("the bot answered nothing while it owed the barbarians a city")
	}
	if cmd.Type != knights.CmdBarbarianDowngrade {
		t.Fatalf("a seat one coin short answered %s, want %s", cmd.Type, knights.CmdBarbarianDowngrade)
	}
	if _, err := engine.Decide(s, cmd); err != nil {
		t.Fatalf("the engine refused the bot's sacrifice: %v", err)
	}
}

// With nobody selling a buyout the offer does not exist at all, and the bot must
// not reach for a command this ruleset has no answer to.
func TestStrongSacrificesWhenNoBuyoutIsSold(t *testing.T) {
	s, _ := buyoutState(t, "base+cak", 0)
	b := NewStrong()
	cmd, ok := b.knightsBarbarianSacrifice(s, engine.PlayerID(1))
	if !ok {
		t.Fatal("the bot answered nothing while it owed the barbarians a city")
	}
	if cmd.Type != knights.CmdBarbarianDowngrade {
		t.Fatalf("a seat in base+cak answered %s, want %s", cmd.Type, knights.CmdBarbarianDowngrade)
	}
	if _, err := engine.Decide(s, cmd); err != nil {
		t.Fatalf("the engine refused the bot's sacrifice: %v", err)
	}
}
