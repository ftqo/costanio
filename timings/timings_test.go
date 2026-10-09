package timings_test

import (
	"testing"
	"time"

	"github.com/ftqo/costan.io/engine/explorers"
	"github.com/ftqo/costan.io/engine/islands"
	"github.com/ftqo/costan.io/engine/knights"
	"github.com/ftqo/costan.io/engine/raiders"
	"github.com/ftqo/costan.io/engine/scenarios"
	"github.com/ftqo/costan.io/engine/wagons"
	"github.com/ftqo/costan.io/timings"
)

// TestEveryModuleDecisionHasACap: adding a module decision without a budget
// fails here rather than silently inheriting the default. It imports the
// modules only for their id lists.
func TestEveryModuleDecisionHasACap(t *testing.T) {
	for _, set := range [][]string{
		knights.Decisions, explorers.Decisions, islands.Decisions, scenarios.Decisions,
		raiders.Decisions, wagons.Decisions,
	} {
		for _, id := range set {
			if _, ok := timings.ModuleCaps[id]; !ok {
				t.Errorf("module decision %q missing from ModuleCaps (default %v)", id, timings.ModuleDefaultCap)
			}
		}
	}
}

// TestNoOrphanedCaps: a cap for an id no module emits is a leftover from a
// renamed decision.
func TestNoOrphanedCaps(t *testing.T) {
	live := map[string]bool{}
	for _, set := range [][]string{
		knights.Decisions, explorers.Decisions, islands.Decisions, scenarios.Decisions,
		raiders.Decisions, wagons.Decisions,
	} {
		for _, id := range set {
			live[id] = true
		}
	}
	for id := range timings.ModuleCaps {
		if !live[id] {
			t.Errorf("ModuleCaps has %q but no module emits it", id)
		}
	}
}

func TestModuleCapTakesTheLongest(t *testing.T) {
	tests := []struct {
		name string
		ids  []string
		want time.Duration
	}{
		{"single quick", []string{"aqueduct"}, 20 * time.Second},
		{"single deliberative", []string{"wedding_give"}, 30 * time.Second},
		// A max, not a min: a player owed a one-tap pick and a hand-sized
		// decision must not be rushed through the hard one.
		{"quick alongside deliberative", []string{"aqueduct", "wedding_give"}, 30 * time.Second},
		{"two quicks", []string{"aqueduct", "gold_pick"}, 20 * time.Second},
		{"unknown id falls back", []string{"not_a_real_decision"}, timings.ModuleDefaultCap},
		{"unknown alongside quick", []string{"aqueduct", "not_a_real_decision"}, timings.ModuleDefaultCap},
		{"empty", nil, timings.ModuleDefaultCap},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := timings.ModuleCap(tt.ids); got != tt.want {
				t.Errorf("ModuleCap(%v) = %v; want %v", tt.ids, got, tt.want)
			}
		})
	}
}

func TestOfferLifetimeFor(t *testing.T) {
	tests := []struct {
		turnSec int
		want    time.Duration
	}{
		{0, timings.OfferDefaultLifetime},  // untimed: the fixed default
		{-5, timings.OfferDefaultLifetime}, // garbage reads as untimed, never negative
		{20, timings.OfferMinLifetime},     // half of 20 is under the floor
		{30, timings.OfferMinLifetime},     // exactly the floor
		{60, 30 * time.Second},             // half, inside both bounds
		{120, timings.OfferMaxLifetime},    // half of 120 is over the ceiling
		{3600, timings.OfferMaxLifetime},   // a very long turn cannot dominate the table
	}
	for _, tt := range tests {
		if got := timings.OfferLifetimeFor(tt.turnSec); got != tt.want {
			t.Errorf("OfferLifetimeFor(%d) = %v; want %v", tt.turnSec, got, tt.want)
		}
	}
}

// TestForClampsToTheTurnTimer: every cap served to a client is already clamped
// to that game's turn timer.
func TestForClampsToTheTurnTimer(t *testing.T) {
	w := timings.For(10)
	for kind, ms := range w.Caps {
		if ms > 10_000 {
			t.Errorf("cap %q = %dms exceeds the 10s turn timer", kind, ms)
		}
	}
	if w.Caps["main"] != 10_000 {
		t.Errorf("main cap = %dms; want the full 10s turn budget", w.Caps["main"])
	}

	// The Normal table serves each cap at its base value.
	w = timings.For(timings.DefaultTurnTimerSec)
	if got := w.Caps["roll"]; got != timings.RollCap.Milliseconds() {
		t.Errorf("roll cap = %dms; want %dms", got, timings.RollCap.Milliseconds())
	}
	// The two halves of a setup turn are served separately.
	if got := w.Caps["setup_road"]; got != timings.SetupRoadCap.Milliseconds() {
		t.Errorf("setup_road cap = %dms; want %dms", got, timings.SetupRoadCap.Milliseconds())
	}
	// A longer table serves the scaled cap, the same number the server arms.
	w = timings.For(120)
	if got := w.Caps["roll"]; got != 2*timings.RollCap.Milliseconds() {
		t.Errorf("relaxed roll cap = %dms; want %dms", got, 2*timings.RollCap.Milliseconds())
	}
	if got := w.Caps["main"]; got != 120_000 {
		t.Errorf("relaxed main = %dms; want the unscaled 120s turn", got)
	}
}

// TestForUntimedIsAllZero: the lobby rejects untimed configs, but an older game
// restored from its log could carry one, and the client must see zeros.
func TestForUntimedIsAllZero(t *testing.T) {
	w := timings.For(0)
	for kind, ms := range w.Caps {
		if ms != 0 {
			t.Errorf("cap %q = %dms; want 0 for an untimed game", kind, ms)
		}
	}
}

// TestPresetsAreValidConfigs stops a preset being added that the lobby would
// then refuse.
func TestPresetsAreValidConfigs(t *testing.T) {
	seen := map[int]bool{}
	for _, p := range timings.TurnTimerPresets {
		if p.Sec < timings.TurnTimerSecMin || p.Sec > timings.TurnTimerSecMax {
			t.Errorf("preset %q (%ds) is outside the configurable range", p.Label, p.Sec)
		}
		if seen[p.Sec] {
			t.Errorf("preset %q duplicates %ds", p.Label, p.Sec)
		}
		seen[p.Sec] = true
		if p.Label == "" {
			t.Errorf("preset at %ds has no label", p.Sec)
		}
	}
	if !seen[timings.DefaultTurnTimerSec] {
		t.Errorf("no preset for the default (%ds)", timings.DefaultTurnTimerSec)
	}
}

// Expansion decision caps are held at the floor a first-time player needs.
func TestModuleCapsAreSizedForAFirstTimer(t *testing.T) {
	const floor = 20 * time.Second
	if timings.ModuleDefaultCap < floor {
		t.Errorf("ModuleDefaultCap = %v, want at least %v", timings.ModuleDefaultCap, floor)
	}
	for id, got := range timings.ModuleCaps {
		if got < floor {
			t.Errorf("%s budget = %v, want at least %v", id, got, floor)
		}
	}
	for id, min := range map[string]time.Duration{
		"barbarian_downgrade": 30 * time.Second, // carries the pillage buyout under Rivers
		"raiders_treason":     45 * time.Second, // four hexes, a plan
	} {
		if got := timings.ModuleCaps[id]; got < min {
			t.Errorf("%s budget = %v, want at least %v", id, got, min)
		}
	}
}

// TestScaled pins the scaling rule: a Normal or shorter table keeps the base,
// a longer one scales linearly, whole seconds, up to MaxDecisionScale.
func TestScaled(t *testing.T) {
	sec := func(n int) time.Duration { return time.Duration(n) * time.Second }
	tests := []struct {
		base    time.Duration
		turnSec int
		want    time.Duration
	}{
		{sec(15), 0, sec(15)},
		{sec(15), 30, sec(15)},
		{sec(15), 60, sec(15)},
		{sec(15), 75, sec(18)}, // 18.75s truncated
		{sec(15), 120, sec(30)},
		{sec(45), 120, sec(90)},
		{sec(15), 240, sec(60)},
		{sec(15), 3600, sec(15) * timings.MaxDecisionScale},
	}
	for _, tt := range tests {
		if got := timings.Scaled(tt.base, tt.turnSec); got != tt.want {
			t.Errorf("Scaled(%v, %d) = %v; want %v", tt.base, tt.turnSec, got, tt.want)
		}
	}
}
