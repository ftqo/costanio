package ruletest

import (
	"slices"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/explorers"
	"github.com/ftqo/costan.io/engine/knights"
)

// Knights-with-Explorers combination rules where they differ from an earlier
// version of this pairing. See "Knights in an Explorers game" in
// docs/rules/explorers.md.

// ---- C. The first placement is a city, the second a harbour settlement -----

// The first placement is a city and the second a harbour settlement; the snake
// is unchanged. The forward leg is a city anywhere on the home island and collects
// the starting resources; the reverse leg is the coastal harbour settlement,
// which pays nothing.
func TestPairingSetupPlacesTheCityFirst(t *testing.T) {
	log, err := engine.New(engine.GameConfig{Players: 3, Ruleset: pairing}, engine.SeedsFrom(7))
	if err != nil {
		t.Fatal(err)
	}
	s := engine.Empty()
	for _, e := range log {
		if err := engine.Apply(s, e); err != nil {
			t.Fatal(err)
		}
	}
	var order []engine.CommandType
	for step := 0; s.Phase == engine.PhaseSetup && step < 200; step++ {
		cmd, ok := engine.AutoCommand(s)
		if !ok {
			t.Fatal("setup owes nothing")
		}
		order = append(order, cmd.Type)
		events, err := engine.Decide(s, cmd)
		if err != nil {
			t.Fatalf("setup decide %s: %v", cmd.Type, err)
		}
		for _, e := range events {
			if e.Type == explorers.EvHarbourPlaced && len(order) <= 3 {
				t.Errorf("step %d placed a harbour settlement on the forward leg", len(order))
			}
			if err := engine.Apply(s, e); err != nil {
				t.Fatal(err)
			}
		}
	}
	want := []engine.CommandType{
		explorers.CmdPlaceSettlement, explorers.CmdPlaceSettlement, explorers.CmdPlaceSettlement,
		explorers.CmdPlaceHarbour, explorers.CmdPlaceHarbour, explorers.CmdPlaceHarbour,
		explorers.CmdPlaceStart, explorers.CmdPlaceStart, explorers.CmdPlaceStart,
	}
	if !slices.Equal(order, want) {
		t.Errorf("setup ran %v, want %v", order, want)
	}
}

// Plain Explorers keeps its own order: harbour settlement first.
func TestPlainExplorersSetupHarbourFirst(t *testing.T) {
	log, err := engine.New(engine.GameConfig{Players: 3, Ruleset: "explorers"}, engine.SeedsFrom(7))
	if err != nil {
		t.Fatal(err)
	}
	s := engine.Empty()
	for _, e := range log {
		if err := engine.Apply(s, e); err != nil {
			t.Fatal(err)
		}
	}
	cmd, ok := engine.AutoCommand(s)
	if !ok || cmd.Type != explorers.CmdPlaceHarbour {
		t.Errorf("plain Explorers opens with %s, want %s", cmd.Type, explorers.CmdPlaceHarbour)
	}
}

// ---- I. The Aqueduct never pays on a 7 --------------------------------------

// Read literally, the combination's Aqueduct rule would pay a holder who gets no
// cards because a 7 was rolled. We read it as "not because of a 7": the Knights
// Aqueduct never pays on a 7, and the pairing keeps that. A 7 owes nobody an
// Aqueduct pick or gold.
func TestAqueductOwesNothingOnASeven(t *testing.T) {
	s := playState(t, pairing, 3)
	cx, ok := knights.StateExt(s)
	if !ok {
		t.Fatal("no cak ext")
	}
	holder := engine.PlayerID(1)
	cx.Players[holder].Improve[knights.Science] = 3
	x := mustExplorersExt(t, s)
	gold := explorers.Gold(x, holder)
	cx.AlchemistD1, cx.AlchemistD2 = 3, 4
	evs, err := engine.Decide(s, engine.Command{Player: s.Cur, Type: engine.CmdRollDice})
	if err != nil {
		t.Fatalf("roll: %v", err)
	}
	for _, e := range evs {
		e.Seq = s.NextSeq
		if err := engine.Apply(s, e); err != nil {
			t.Fatalf("apply %s: %v", e.Type, err)
		}
		if e.Type == knights.EvAqueductOwed {
			t.Errorf("a 7 emitted %s", e.Type)
		}
	}
	cx, _ = knights.StateExt(s)
	if len(cx.Aqueduct) != 0 {
		t.Errorf("a 7 owed Aqueduct picks to %v, want none", cx.Aqueduct)
	}
	x = mustExplorersExt(t, s)
	if got := explorers.Gold(x, holder); got != gold {
		t.Errorf("the Aqueduct holder's gold went %d -> %d on a 7, want unchanged", gold, got)
	}
}
