package bot

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"

	// Register the Knights module so the "base+cak" ruleset resolves and
	// its BlocksVertex hook is active.
	_ "github.com/ftqo/costan.io/engine/knights"
)

// knightBuiltData mirrors cak's internal knightData JSON shape so the test can
// inject an enemy knight onto a vertex via the engine's event-apply path
// (knights.EvKnightBuilt is exported; its payload type is not).
type knightBuiltData struct {
	Player engine.PlayerID `json:"player"`
	V      board.Vertex    `json:"v"`
	Free   bool            `json:"free"`
	Level  int             `json:"level"`
}

// knightsGameInPlay drives a base+cak game with Simple bots until the current seat
// is on a play-phase turn that has a genuine open settlement frontier (i.e.
// settleableSpot returns a spot). That spot is what we'll block with a knight.
func knightsGameInPlay(t *testing.T, seed uint64) (*engine.State, board.Vertex) {
	t.Helper()
	log, err := engine.New(engine.GameConfig{Players: 3, Ruleset: "base+cak"}, engine.SeedsFrom(seed))
	if err != nil {
		t.Fatal(err)
	}
	s := engine.Empty()
	for _, e := range log {
		if err := engine.Apply(s, e); err != nil {
			t.Fatal(err)
		}
	}
	b := NewSimple()
	for i := 0; i < 30000 && s.Phase != engine.PhaseFinished; i++ {
		seat := actingSeat(s)
		// Stop the moment the current seat, on its own rolled turn, has an open
		// frontier spot to settle into.
		if s.Phase == engine.PhasePlay && s.Cur == seat && s.Rolled &&
			len(s.PendingDiscards) == 0 && !s.RobberPending {
			if v, ok := settleableSpot(s, seat); ok {
				return s, v
			}
		}
		cmd, ok := b.Act(s, seat)
		if !ok {
			t.Fatalf("bot has no move at step %d", i)
		}
		events, err := engine.Decide(s, cmd)
		if err != nil {
			t.Fatalf("illegal %s at step %d: %v", cmd.Type, i, err)
		}
		for _, e := range events {
			if err := engine.Apply(s, e); err != nil {
				t.Fatal(err)
			}
		}
	}
	return nil, board.Vertex{}
}

// TestSimpleSkipsModuleBlockedSpot: under Knights an enemy knight bars a
// vertex, so Simple must not propose a settlement there (settleableSpot has to
// respect module blockers). An enemy knight is injected on the vertex Simple
// would otherwise choose.
func TestSimpleSkipsModuleBlockedSpot(t *testing.T) {
	var checked int
	for seed := uint64(1); seed <= 40 && checked < 1; seed++ {
		s, target := knightsGameInPlay(t, seed)
		if s == nil {
			continue // this seed never opened a frontier; try another
		}
		seat := s.Cur

		// Pick an enemy seat to own the blocking knight.
		enemy := engine.PlayerID((int(seat) + 1) % len(s.Players))

		// Inject an enemy knight on the spot Simple just chose, via the engine
		// event-apply path (knights.EvKnightBuilt is exported; its payload is not).
		ev := engine.NewEvent(
			engine.EventType("cak_knight_built"),
			knightBuiltData{Player: enemy, V: target, Free: true, Level: 1},
		)
		ev.Seq = s.NextSeq
		if err := engine.Apply(s, ev); err != nil {
			t.Fatalf("apply knight event: %v", err)
		}

		// Sanity: the engine now bars a settlement at the target, and the bot
		// still has the hand to want one.
		if engine.CheckSettlementSpot(s, target) == nil {
			t.Fatalf("expected engine to bar knight-blocked vertex %+v", target)
		}
		s.Players[seat].Hand.Add(engine.CostSettlement)

		got, ok := settleableSpot(s, seat)
		if ok && got == target {
			t.Fatalf("seed %d: Simple chose the knight-blocked vertex %+v", seed, target)
		}
		// Whatever Simple picks (if anything) must be engine-legal.
		if ok && engine.CheckSettlementSpot(s, got) != nil {
			t.Fatalf("seed %d: Simple chose an engine-illegal spot %+v", seed, got)
		}

		// The road helper must likewise only propose engine-legal roads.
		if e, ok := extendingRoad(s, seat); ok {
			cmd := engine.Command{Player: seat, Type: engine.CmdBuildRoad,
				Data: raw(map[string]any{"e": e})}
			if _, err := engine.Decide(s.Clone(), cmd); err != nil {
				t.Fatalf("seed %d: Simple proposed an engine-illegal road %+v: %v", seed, e, err)
			}
		}
		checked++
	}
	if checked == 0 {
		t.Fatal("no seed produced an open frontier")
	}
}
