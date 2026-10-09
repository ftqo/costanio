package bot_test

import (
	"encoding/json"
	"slices"
	"testing"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/raiders"
	"github.com/ftqo/costan.io/engine/scenarios"
)

// TestStrongPaysTheHurryInFishWithNoGrain: under Fishermen with Raiders two
// fish pay for a rider's five-path move when there is no grain to pay it. The
// position is constructed: one rider, no grain, two fish, and one raider on a
// coastal hex only the hurried reach touches, so the hurry completes a battle.
func TestStrongPaysTheHurryInFishWithNoGrain(t *testing.T) {
	evs, err := engine.New(engine.GameConfig{Players: 4, Ruleset: engine.CanonicalRuleset("base+fishermen+raiders")}, engine.SeedsFrom(3))
	if err != nil {
		t.Fatal(err)
	}
	s, err := engine.Replay(evs)
	if err != nil {
		t.Fatal(err)
	}
	for s.Phase == engine.PhaseSetup {
		cmd, ok := engine.AutoCommand(s)
		if !ok {
			t.Fatal("setup stuck")
		}
		out, err := engine.Decide(s, cmd)
		if err != nil {
			t.Fatal(err)
		}
		for _, e := range out {
			if err := engine.Apply(s, e); err != nil {
				t.Fatal(err)
			}
		}
	}
	s.Rolled = true
	p := s.Cur
	for i := range s.Players {
		s.Players[i].Hand = engine.Hand{}
	}
	fx, _ := scenarios.FishStateExt(s)
	fx.Held[p] = [3]int{2, 0, 0}
	rx, _ := raiders.StateExt(s)
	for i := range rx.RaiderCount {
		rx.RaiderCount[i] = 0
	}
	// Find a rider path and a coastal hex that only the hurry reaches.
	found := false
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, e := range h.Edges() {
			from := board.NewEdge(e.A, e.B)
			if !s.Board.LandEdge(from) {
				continue
			}
			rx.RiderAt = map[board.Edge]engine.PlayerID{from: p}
			ms := raiders.MovesFor(s, p)
			if len(ms) != 1 || len(ms[0].Hurry) == 0 {
				continue
			}
			for ci, c := range rx.Coast {
				touchesBase, touchesHurry := false, false
				for _, ce := range c.Edges() {
					ce = board.NewEdge(ce.A, ce.B)
					if ce == from || slices.Contains(ms[0].To, ce) {
						touchesBase = true
					}
					if slices.Contains(ms[0].Hurry, ce) {
						touchesHurry = true
					}
				}
				if touchesHurry && !touchesBase {
					// One raider, and one of our riders already on another of
					// its paths: the arrival makes two against one.
					for _, ce := range c.Edges() {
						ce = board.NewEdge(ce.A, ce.B)
						if !slices.Contains(ms[0].Hurry, ce) && ce != from {
							rx.RiderAt[ce] = p
							rx.Moved = map[board.Edge]bool{ce: true}
							break
						}
					}
					rx.RaiderCount[ci] = 1
					found = true
					break
				}
			}
			if found {
				break
			}
		}
		if found {
			break
		}
	}
	if !found {
		t.Fatal("no constructed position with a hurry-only battle")
	}
	strong := bot.NewStrong()
	cmd, ok := strong.Act(s, p)
	if !ok {
		t.Fatal("Strong did nothing")
	}
	if cmd.Type != scenarios.CmdSpendFish || !slices.Contains([]string{`"rider_hurry"`}, string(jsonField(t, cmd.Data, "use"))) {
		t.Fatalf("Strong proposed %s %s, want the two-fish rider hurry", cmd.Type, cmd.Data)
	}
	if _, err := engine.Decide(s, cmd); err != nil {
		t.Fatalf("the engine refused Strong's fish hurry: %v", err)
	}
}

func jsonField(t *testing.T, raw []byte, key string) []byte {
	t.Helper()
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	return m[key]
}
