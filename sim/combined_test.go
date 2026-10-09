package sim

import (
	"encoding/json"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/islands"
	"github.com/ftqo/costan.io/engine/knights"
)

func rawJSON(t *testing.T, v any) json.RawMessage {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func apply(t *testing.T, s *engine.State, cmd engine.Command) []engine.Event {
	t.Helper()
	events, err := engine.Decide(s, cmd)
	if err != nil {
		t.Fatalf("Decide(%s): %v", cmd.Type, err)
	}
	for _, e := range events {
		if err := engine.Apply(s, e); err != nil {
			t.Fatalf("Apply(%s): %v", e.Type, err)
		}
	}
	return events
}

// TestIslandsKnightsCoexist verifies the two largest expansions compose: in one
// game a player can build an Islands ship and a Knights knight, a roll runs both
// modules' dice hooks, and victory points from both modules sum.
func TestIslandsKnightsCoexist(t *testing.T) {
	// Canonical spelling: a lobby game of these two is "base+cak+islands",
	// and module hooks run in ruleset-string order. TargetVP is left unset
	// so the module defaults decide it (DefaultConfig is first-writer-wins).
	// Knights is the only defaulter here, so it is 13 VP either way; the
	// assertion below checks that rather than hardcoding 13.
	cfg := engine.GameConfig{Players: 4, Ruleset: engine.CanonicalRuleset("base+islands+cak")}
	log, err := engine.New(cfg, engine.SeedsFrom(3))
	if err != nil {
		t.Fatal(err)
	}
	s := engine.Empty()
	for _, e := range log {
		if err := engine.Apply(s, e); err != nil {
			t.Fatal(err)
		}
	}
	if s.Config.TargetVP != 13 {
		t.Fatalf("TargetVP = %d, want 13 (Knights default) in %s",
			s.Config.TargetVP, s.Config.Ruleset)
	}
	for s.Phase == engine.PhaseSetup {
		cmd, ok := engine.AutoCommand(s)
		if !ok {
			t.Fatal("setup stuck")
		}
		apply(t, s, cmd)
	}

	p := s.Cur
	// Roll: both modules' OnDiceRolled hooks must run. Force past any 7.
	events := apply(t, s, engine.Command{Player: p, Type: engine.CmdRollDice})
	// Drain everything the roll set off before building anything. With both
	// expansions loaded the event die can also leave a module pending choice,
	// which blocks ordinary actions with ErrModulePending. AutoCommand
	// resolves module pendings first (engine/auto.go), so loop until it has
	// nothing left.
	for s.RobberPending || len(s.PendingDiscards) > 0 || modulePending(s) {
		cmd, ok := engine.AutoCommand(s)
		if !ok {
			t.Fatal("stuck on interrupts")
		}
		apply(t, s, cmd)
	}
	sawEventDie := false
	for _, e := range events {
		if e.Type == knights.EvEventDie {
			sawEventDie = true
		}
	}
	if !sawEventDie {
		t.Error("Knights event die did not fire in an islands+cak game")
	}

	// Build a Islands ship off one of the player's coastal settlements.
	var shipEdge board.Edge
	shipOK := false
	for v, b := range s.Buildings {
		if b.Owner != p {
			continue
		}
		for _, e := range v.Edges() {
			if !s.Board.SeaEdge(e) {
				continue
			}
			if _, taken := s.Roads[e]; taken {
				continue
			}
			shipEdge, shipOK = e, true
		}
	}
	// Auto-pass's opening need not be coastal (starting settlements go on the
	// main island, and its first pick there may be inland), so when it is not,
	// put a settlement on the coast for the player: constructed, not a seed hunt.
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, v := range h.Vertices() {
			if shipOK || engine.CheckSettlementSpot(s, v) != nil {
				continue
			}
			for _, e := range v.Edges() {
				if _, taken := s.Roads[e]; !shipOK && !taken && s.Board.SeaEdge(e) {
					s.Buildings[v] = engine.Building{Owner: p}
					shipEdge, shipOK = e, true
				}
			}
		}
	}
	if !shipOK {
		t.Fatalf("player %d has no coastal settlement with a free sea edge", p)
	}
	s.Players[p].Hand = islands.CostShip
	apply(t, s, engine.Command{Player: p, Type: islands.CmdBuildShip, Data: rawJSON(t, map[string]any{"e": shipEdge})})
	sx, _ := s.Ext[islands.Name].(*islands.Ext)
	if sx == nil || sx.Ships[shipEdge] != p {
		t.Fatalf("ship not recorded in islands state")
	}

	// Build a Knights knight on the player's road network.
	var knightV board.Vertex
	knightOK := false
	for e, owner := range s.Roads {
		if owner != p {
			continue
		}
		for _, v := range []board.Vertex{e.A, e.B} {
			if _, taken := s.Buildings[v]; taken {
				continue
			}
			knightV, knightOK = v, true
		}
	}
	if !knightOK {
		t.Fatalf("player %d has no free vertex on their road network for a knight", p)
	}
	s.Players[p].Hand = engine.Hand{board.Sheep: 1, board.Ore: 1}
	apply(t, s, engine.Command{Player: p, Type: knights.CmdBuildKnight, Data: rawJSON(t, map[string]any{"v": knightV})})
	cx, _ := s.Ext[knights.Name].(*knights.Ext)
	if cx == nil {
		t.Fatal("cak state missing")
	}
	if k, ok := cx.Knights[knightV]; !ok || k.Owner != p {
		t.Fatalf("knight not recorded in cak state")
	}

	// Both modules' state coexist independently in the same game.
	if sx.Ships[shipEdge] != p || cx.Knights[knightV].Owner != p {
		t.Error("module states interfered with each other")
	}
}

// modulePending reports whether some module is blocking ordinary turn actions
// and can resolve itself. Mirrors the gate AutoCommand consults.
func modulePending(s *engine.State) bool {
	for _, m := range s.Modules() {
		h := m.Hooks()
		if h.Blocks != nil && h.Auto != nil && h.Blocks(s) {
			return true
		}
	}
	return false
}
