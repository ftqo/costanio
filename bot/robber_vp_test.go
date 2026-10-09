package bot

import (
	"encoding/json"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/knights"
)

// TestRobberVictimSeesModuleVP: with equal hands, the robber should prefer the
// player who is actually ahead, counting Knights metropolises (2 VP each, which
// engine.PublicVP cannot see).
//
// The metropolis is set by applying the real cak event, the same path a game
// uses.
func TestRobberVictimSeesModuleVP(t *testing.T) {
	cfg := engine.GameConfig{Players: 4, Ruleset: "base+cak", TargetVP: 13, DiscardLimit: 7,
		DiceMode: "random", BoardMode: "fair"}
	evs, err := engine.New(cfg, engine.SeedsFrom(5))
	if err != nil {
		t.Fatal(err)
	}
	s, err := engine.Replay(evs)
	if err != nil {
		t.Fatal(err)
	}

	const rich, poor = engine.PlayerID(1), engine.PlayerID(2)
	// Identical hands, so the card half of the key ties and the VP half decides.
	for _, p := range []engine.PlayerID{rich, poor} {
		s.Players[p].Hand = engine.Hand{}
		s.Players[p].Hand[0] = 3
	}
	if before, other := victimPriority(s, rich), victimPriority(s, poor); before != other {
		t.Fatalf("seats not tied before the metropolis (%d vs %d)", before, other)
	}

	data, err := json.Marshal(map[string]any{
		"track": knights.Trade, "holder": rich, "prev": engine.NoPlayer,
		// The vertex only records where the metropolis sits; VP does not read it.
		"v": board.Vertex{},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := engine.Apply(s, engine.Event{Seq: s.NextSeq, Type: knights.EvMetropolis, Data: data}); err != nil {
		t.Fatalf("apply metropolis: %v", err)
	}
	if s.PublicVPWithModules(rich) == s.PublicVP(rich) {
		t.Fatal("metropolis did not change module VP")
	}

	if got, other := victimPriority(s, rich), victimPriority(s, poor); got <= other {
		t.Errorf("victim priority: metropolis holder %d, other %d, want the holder higher", got, other)
	}
}
