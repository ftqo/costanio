package game

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
)

// The view says who the friendly-robber shield covers, so the client's victim
// pickers never disagree with the server: the ruleset's starting score where
// the shield applies, and nothing where it does not (switched off, or a
// ruleset with no robber).
func TestFullViewHasFriendlyRobberThreshold(t *testing.T) {
	for _, tc := range []struct {
		ruleset  string
		friendly bool
		want     int // 0 = absent
	}{
		{"base", true, 2},
		{"base+cak", true, 3},
		{"base", false, 0},
		{"base+wagons", true, 0},
	} {
		log, err := engine.New(engine.GameConfig{Players: 4, Ruleset: tc.ruleset, FriendlyRobber: tc.friendly},
			engine.SeedsFrom(5))
		if err != nil {
			t.Fatalf("%s: %v", tc.ruleset, err)
		}
		s, err := engine.Replay(log)
		if err != nil {
			t.Fatalf("%s: %v", tc.ruleset, err)
		}
		v := NewFullView(s, 0)
		got := 0
		if v.FriendlyRobberMaxVP != nil {
			got = *v.FriendlyRobberMaxVP
		}
		if got != tc.want {
			t.Errorf("%s friendly=%v: friendly_robber_max_vp %d, want %d", tc.ruleset, tc.friendly, got, tc.want)
		}
	}
}
