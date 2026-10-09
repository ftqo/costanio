package raiders

import (
	"encoding/json"
	"errors"
	"fmt"
	"testing"

	"github.com/ftqo/costan.io/engine"
)

// TestFoldRefusesMalformedEvents: every seat, card and resource the fold
// indexes by is checked first, so a malformed or foreign log becomes
// engine.ErrMalformedEvent (paused-error in the game layer) rather than a panic
// or a write to the wrong seat.
func TestFoldRefusesMalformedEvents(t *testing.T) {
	cases := []struct {
		typ  engine.EventType
		data map[string]any
	}{
		{EvLanding, map[string]any{"player": 9, "numbers": []int{5}}},
		{EvCard, map[string]any{"player": 0, "card": 42}},
		{EvCard, map[string]any{"player": -1, "card": 0, "free": true}},
		{EvRiderPlaced, map[string]any{"player": 4}},
		{EvIntrigue, map[string]any{"player": 7}},
		{EvBattle, map[string]any{"prisoners": []map[string]any{{"player": 5, "count": 1}}}},
		{EvBattle, map[string]any{"gold": []map[string]any{{"player": -2, "count": 3}}}},
		{EvSevenOpened, map[string]any{"player": 4}},
		{EvSevenStolen, map[string]any{"thief": 0, "victim": 6, "res": 1}},
		{EvGoldSpent, map[string]any{"player": 0, "gold": 2, "res": 99}},
		{EvGoldGained, map[string]any{"player": 11, "gold": 1}},
		{EvGoldTransfer, map[string]any{"from": 0, "to": 4, "gold": 1}},
	}
	for _, c := range cases {
		t.Run(fmt.Sprintf("%s %v", c.typ, c.data), func(t *testing.T) {
			log, err := engine.New(engine.GameConfig{Players: 4, Ruleset: "base+raiders"}, engine.SeedsFrom(1))
			if err != nil {
				t.Fatal(err)
			}
			s, err := engine.Replay(log)
			if err != nil {
				t.Fatal(err)
			}
			raw, err := json.Marshal(c.data)
			if err != nil {
				t.Fatal(err)
			}
			var applyErr error
			func() {
				defer func() {
					if r := recover(); r != nil {
						t.Fatalf("Apply panicked on a malformed event: %v", r)
					}
				}()
				applyErr = engine.Apply(s, engine.Event{Seq: s.NextSeq, Type: c.typ, Data: raw})
			}()
			if !errors.Is(applyErr, engine.ErrMalformedEvent) {
				t.Fatalf("Apply = %v, want ErrMalformedEvent", applyErr)
			}
		})
	}
}
