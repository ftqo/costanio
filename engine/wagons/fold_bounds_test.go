package wagons

import (
	"encoding/json"
	"fmt"
	"testing"

	"github.com/ftqo/costan.io/engine"
)

// TestFoldRefusesMalformedEvents checks that an out-of-range seat or trade-hex
// index in an event is an Apply error, not a panic or a silently dropped write.
// Apply also folds logs this server did not write (POST /api/replay/frames).
func TestFoldRefusesMalformedEvents(t *testing.T) {
	cases := []struct {
		typ  engine.EventType
		data map[string]any
	}{
		{EvTurn, map[string]any{"player": 9}},
		{EvMoved, map[string]any{"player": -1}},
		{EvBoosted, map[string]any{"player": 4, "mp": 2}},
		{EvCharged, map[string]any{"player": 0, "barb": 3}},
		{EvCharged, map[string]any{"player": 7, "barb": 0}},
		{EvBarbPending, map[string]any{"player": 5, "idx": 0}},
		{EvBarbPending, map[string]any{"player": 0, "idx": 3}},
		{EvBarbMoved, map[string]any{"player": 0, "barb": 3}},
		{EvBarbMoved, map[string]any{"player": 0, "barb": -2}},
		{EvLoaded, map[string]any{"player": 0, "hex": 3, "cargo": 1}},
		{EvLoaded, map[string]any{"player": 8, "hex": 0, "cargo": 1}},
		{EvDelivered, map[string]any{"player": 4, "hex": 0, "cargo": 1, "gold": 2}},
		{EvUpgraded, map[string]any{"player": 0, "level": maxLevel + 1}},
		{EvUpgraded, map[string]any{"player": 6, "level": 2}},
		{EvBought, map[string]any{"player": 0, "res": 99, "gold": 1}},
		{EvSold, map[string]any{"player": 0, "res": -1, "count": 1, "gold": 1}},
		{EvGoldMoved, map[string]any{"from": 0, "to": 12, "gold": 1}},
		{EvGoldMoved, map[string]any{"from": -3, "to": 1, "gold": 1}},
		{EvSwiftBought, map[string]any{"player": 4}},
		{EvSwiftPlayed, map[string]any{"player": 4}},
	}
	for _, c := range cases {
		t.Run(fmt.Sprintf("%s %v", c.typ, c.data), func(t *testing.T) {
			s, _ := opened(t, 4, "base+wagons")
			raw, err := json.Marshal(c.data)
			if err != nil {
				t.Fatal(err)
			}
			e := engine.Event{Seq: s.NextSeq, Type: c.typ, Data: raw}
			var applyErr error
			func() {
				defer func() {
					if r := recover(); r != nil {
						t.Fatalf("Apply panicked on a malformed event: %v", r)
					}
				}()
				applyErr = engine.Apply(s, e)
			}()
			if applyErr == nil {
				t.Fatal("Apply accepted a malformed event")
			}
		})
	}
}
