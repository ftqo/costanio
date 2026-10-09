package bot

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/explorers"
)

// TestExplorersGoldBuysTheScarcestCard: Explorers has no ports and no
// development deck, so the 2-gold purchase is the only way to get a card a seat
// lacks. explorersGoldTrades must buy the scarcest card, not always
// board.Resources[0] (wood), or seats stall with no ship, crew or settler.
//
// The state is constructed: a seat with gold, a pile of one resource, and
// nothing it can build.
func TestExplorersGoldBuysTheScarcestCard(t *testing.T) {
	s := explorersPlayable(t, 5)
	seat := s.Cur

	// A pile of wood and nothing else: no build this scenario has is affordable
	// (a ship needs wool, a crew wool and ore, a harbour grain and ore), so the
	// gold purchase is the only move left and the question is which card it buys.
	s.Players[seat].Hand = engine.Hand{}
	s.Players[seat].Hand[board.Wood] = 5
	x, ok := explorers.StateExt(s)
	if !ok {
		t.Fatal("no explorers ext")
	}
	x.Seats[seat].Gold = explorers.GoldPerResource + explorers.Tribute

	cmd, ok := explorersGoldTrades(s, x, seat)
	if !ok {
		t.Fatal("seat with gold and one dead resource proposed no trade")
	}
	if cmd.Type != explorers.CmdGoldBuy {
		t.Fatalf("the seat proposed %s, want a gold purchase", cmd.Type)
	}
	got, err := engine.DecodeCommand[struct {
		Res board.Resource `json:"res"`
	}](cmd.Data)
	if err != nil {
		t.Fatal(err)
	}
	if got.Res == board.Wood {
		t.Fatal("seat bought the resource it already holds five of")
	}
	if s.Players[seat].Hand[got.Res] != 0 {
		t.Fatalf("bought %v, seat already holds %d, want the scarcest",
			got.Res, s.Players[seat].Hand[got.Res])
	}
	// And the engine accepts it.
	if _, err := engine.Decide(s, cmd); err != nil {
		t.Fatalf("the engine refused the purchase: %v", err)
	}
}

// explorersPlayable plays the module's own setup draft out and hands back a
// state on the current seat's actionable turn.
func explorersPlayable(t *testing.T, seed uint64) *engine.State {
	t.Helper()
	return explorersPlayableRuleset(t, seed, "explorers")
}

func explorersPlayableRuleset(t *testing.T, seed uint64, ruleset string) *engine.State {
	t.Helper()
	events, err := engine.New(engine.GameConfig{Players: 4, Ruleset: ruleset}, engine.SeedsFrom(seed))
	if err != nil {
		t.Fatal(err)
	}
	s := engine.Empty()
	for _, e := range events {
		if err := engine.Apply(s, e); err != nil {
			t.Fatal(err)
		}
	}
	for step := 0; s.Phase == engine.PhaseSetup && step < 400; step++ {
		cmd, ok := engine.AutoCommand(s)
		if !ok {
			t.Fatal("the setup draft owes nothing and never ended")
		}
		out, err := engine.Decide(s, cmd)
		if err != nil {
			t.Fatalf("setup %s: %v", cmd.Type, err)
		}
		for _, e := range out {
			if err := engine.Apply(s, e); err != nil {
				t.Fatal(err)
			}
		}
	}
	if s.Phase != engine.PhasePlay {
		t.Fatalf("phase %s after the draft, want play", s.Phase)
	}
	s.Rolled = true
	return s
}
