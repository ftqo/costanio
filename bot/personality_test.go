package bot

import (
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// TestWilliamIsTheHouseStrategy pins William to exactly DefaultWeights, which
// every measurement in docs/bots.md was taken against. DeepEqual catches a new
// Weights field set in one place but not the other.
func TestWilliamIsTheHouseStrategy(t *testing.T) {
	p, ok := PersonalityByName("William")
	if !ok {
		t.Fatal("William is not registered")
	}
	if !reflect.DeepEqual(p.Weights, DefaultWeights()) {
		t.Errorf("William weights:\n got %+v\nwant %+v", p.Weights, DefaultWeights())
	}
	if len(p.Options) != 0 {
		t.Errorf("William carries %d options, want 0", len(p.Options))
	}
	// The constructed bot must match plain NewStrong too, not just the vector.
	if got, want := p.New().w, NewStrong().w; !reflect.DeepEqual(got, want) {
		t.Errorf("William.New() does not evaluate like NewStrong()")
	}
}

// TestDefaultWeightsHaveNoRouteTerm pins the additive rule the Weights doc
// states: a new field is zero in every shipped vector, so the older evaluator
// is reproduced exactly.
func TestDefaultWeightsHaveNoRouteTerm(t *testing.T) {
	if w := DefaultWeights(); w.Route != 0 {
		t.Errorf("DefaultWeights().Route = %v, want 0", w.Route)
	}
	if w := BaselineWeights(); w.Route != 0 {
		t.Errorf("BaselineWeights().Route = %v, want 0", w.Route)
	}
}

// TestRegistryIsWellFormed holds the invariants everything else depends on.
func TestRegistryIsWellFormed(t *testing.T) {
	ps := Personalities()
	if len(ps) < 10 {
		// A ten-seat table needs ten distinct names, or pickBotName repeats one.
		t.Fatalf("registry holds %d personalities, want at least 10", len(ps))
	}
	seenName := map[string]bool{}
	seenChar := map[string]bool{}
	for _, p := range ps {
		if p.Name == "" {
			t.Error("a personality has no name")
		}
		if seenName[p.Name] {
			t.Errorf("duplicate personality name %q", p.Name)
		}
		seenName[p.Name] = true
		if p.Character == "" {
			t.Errorf("%s has no character line", p.Name)
		}
		if seenChar[p.Character] {
			t.Errorf("%s reuses another personality's character line", p.Name)
		}
		seenChar[p.Character] = true
		// Player-facing copy: no em dashes.
		if strings.Contains(p.Character, "\u2014") {
			t.Errorf("%s: character line contains an em dash", p.Name)
		}
		if p.New() == nil {
			t.Errorf("%s does not construct", p.Name)
		}
	}
	if _, ok := PersonalityByName("Winston"); !ok {
		t.Error("Winston is not registered")
	}
	if _, ok := PersonalityByName("nobody"); ok {
		t.Error("PersonalityByName invented a personality")
	}
}

// TestEveryPersonalityIsADistinctVector checks no two personalities share a
// weight vector, so no personality is another one under a different name.
func TestEveryPersonalityIsADistinctVector(t *testing.T) {
	seen := map[Weights]string{}
	for _, p := range Personalities() {
		// Options are funcs and not comparable, so key on weights alone (the
		// stronger property).
		if prev, dup := seen[p.Weights]; dup {
			t.Errorf("%s has the same weight vector as %s", p.Name, prev)
		}
		seen[p.Weights] = p.Name
	}
}

// TestDisplayNameRoundTrips: the display name is where a personality is
// recorded, so it must round-trip or a reloaded game seats the wrong strategy.
func TestDisplayNameRoundTrips(t *testing.T) {
	for _, p := range Personalities() {
		got, ok := PersonalityForDisplayName(p.DisplayName())
		if !ok || got.Name != p.Name {
			t.Errorf("%q did not round-trip: got %q ok=%v", p.DisplayName(), got.Name, ok)
		}
	}
	// Anything that is not a personality must fail closed: a human's name, a
	// takeover bot using one, a retired personality.
	for _, bad := range []string{"", "Bot ", "Bot", "Winston", "bot Winston", "Alice", "Bot Nobody"} {
		if _, ok := PersonalityForDisplayName(bad); ok {
			t.Errorf("PersonalityForDisplayName(%q) resolved, want no match", bad)
		}
	}
	// The constructor never returns nil: the server's bot factory has no error
	// path.
	for _, n := range []string{"", "Alice", "Bot Winston"} {
		if NewPersonalityFor(n) == nil {
			t.Errorf("NewPersonalityFor(%q) returned nil", n)
		}
	}
}

// TestWinstonIsARoadMaximalist checks the weight, the lrChase option, and that
// Route dominates the steepest VP step.
func TestWinstonIsARoadMaximalist(t *testing.T) {
	p, ok := PersonalityByName("Winston")
	if !ok {
		t.Fatal("Winston is not registered")
	}
	b := p.New()
	if b.w.Route != winstonRouteWeight {
		t.Errorf("Winston.Route = %v, want %v", b.w.Route, winstonRouteWeight)
	}
	// Without lrChase, bestPlay only offers roads when no frontier spot is
	// reachable.
	if !b.lrChase {
		t.Error("Winston has lrChase off")
	}
	// One edge of route must outweigh the largest single-action gain from other
	// terms: a victory point at the top of the convex curve.
	w := b.w
	const topVP = 12.0
	vpJump := w.VP + w.VPRush*(2*topVP+1) // d/dv of VP*v + VPRush*v^2, at v = 12
	if w.Route <= vpJump {
		t.Errorf("Route %v does not exceed the steepest VP step %v", w.Route, vpJump)
	}
}

// TestWinstonPrefersARoadToASettlement: with a road and a settlement both legal
// and affordable, Winston takes the road and William does not.
func TestWinstonPrefersARoadToASettlement(t *testing.T) {
	s := midGameState(t)
	seat := engine.PlayerID(0)

	winston := PersonalityByNameOrFail(t, "Winston").New()
	winston.Prime(s.Board)
	cmd, ok := winston.bestPlay(s.Clone(), seat)
	if !ok {
		t.Fatal("Winston found no play")
	}
	if cmd.Type != engine.CmdBuildRoad {
		t.Errorf("Winston played %v, want a road", cmd.Type)
	}

	william := PersonalityByNameOrFail(t, "William").New()
	william.Prime(s.Board)
	wcmd, wok := william.bestPlay(s.Clone(), seat)
	if !wok {
		t.Fatal("William found no play")
	}
	if wcmd.Type == engine.CmdBuildRoad {
		// The fixture must discriminate, or the test passes vacuously.
		t.Errorf("William also built a road; fixture does not discriminate")
	}
}

// TestEveryPersonalityStaysLegal runs each personality over a real state and
// requires every command it proposes to be one the engine accepts.
//
// Strong.score already drops illegal candidates; this covers the rule-played
// paths (progress cards, the boot) that emit commands without that check.
func TestEveryPersonalityStaysLegal(t *testing.T) {
	for _, p := range Personalities() {
		t.Run(p.Name, func(t *testing.T) {
			s := midGameState(t)
			b := p.New()
			b.Prime(s.Board)
			for step := range 200 {
				cmd, ok := b.Act(s, actingSeat(s))
				if !ok {
					t.Fatalf("step %d: %s returned no command", step, p.Name)
				}
				if err := engine.DecideForEval(s, cmd); err != nil {
					t.Fatalf("step %d: %s proposed an illegal %v: %v", step, p.Name, cmd.Type, err)
				}
				if s.Phase == engine.PhaseFinished {
					return
				}
			}
		})
	}
}

// PersonalityByNameOrFail is PersonalityByName with the lookup error turned
// into a test failure.
func PersonalityByNameOrFail(t *testing.T, name string) Personality {
	t.Helper()
	p, ok := PersonalityByName(name)
	if !ok {
		t.Fatalf("%s is not registered", name)
	}
	return p
}

// midGameState constructs the position these tests need rather than hunting a
// seed for it (see CONTRIBUTING.md). It plays setup with the baseline bot, then
// gives seat 0 a hand that affords every build and rolls the dice.
func midGameState(t *testing.T, seedOpt ...uint64) *engine.State {
	t.Helper()
	seed := uint64(7)
	if len(seedOpt) > 0 {
		seed = seedOpt[0]
	}
	s := newBaseGame(t, seed)
	base := NewSimple()
	// Setup only; stop at PhasePlay before anything is spent.
	for i := 0; i < 2000 && s.Phase == engine.PhaseSetup; i++ {
		seat := actingSeat(s)
		cmd, ok := base.Act(s, seat)
		if !ok {
			t.Fatalf("setup stalled at step %d (phase %s cur %d)", i, s.Phase, s.Cur)
		}
		if err := engine.DecideForEval(s, cmd); err != nil {
			t.Fatalf("setup: baseline produced illegal %s: %v", cmd.Type, err)
		}
	}
	if s.Phase == engine.PhaseSetup {
		t.Fatal("setup never completed")
	}
	// Four of each resource affords a road, a settlement or a city.
	s.Cur = 0
	for _, r := range board.Resources {
		s.Players[0].Hand[r] = 4
	}
	if !s.Rolled {
		if err := engine.DecideForEval(s, engine.Command{Player: s.Cur, Type: engine.CmdRollDice}); err != nil {
			t.Fatalf("roll: %v", err)
		}
		// A 7 gives a different position; retry with the next seed rather than
		// skip.
		if len(seedOpt) == 0 && (s.RobberPending || len(s.PendingDiscards) > 0) {
			return midGameState(t, seed+1)
		}
	}
	return s
}

// TestFrontendCopyCoversEveryPersonality checks that every personality has a
// matching character line in the frontend copy (botPersonality.ts), which is
// what players see. Like server.TestFrontendCopyCoversEveryTransportCode.
func TestFrontendCopyCoversEveryPersonality(t *testing.T) {
	path := filepath.Join("..", "frontend", "src", "lib", "botPersonality.ts")
	src, err := os.ReadFile(path)
	if err != nil {
		t.Skipf("frontend copy not readable (%v)", err)
	}
	copyFor := map[string]string{}
	re := regexp.MustCompile(`id:\s*"bot\.character\.([A-Za-z0-9]+)",\s*\n\s*message:\s*"((?:[^"\\]|\\.)*)"`)
	for _, m := range re.FindAllStringSubmatch(string(src), -1) {
		copyFor[m[1]] = strings.ReplaceAll(m[2], `\"`, `"`)
	}
	if len(copyFor) == 0 {
		t.Fatalf("%s parsed to zero entries", path)
	}
	for _, p := range Personalities() {
		got, ok := copyFor[p.Name]
		if !ok {
			t.Errorf("%s has no character line in %s", p.Name, path)
		} else if got != p.Character {
			// The English must match: translators work from the frontend copy.
			t.Errorf("%s: character differs between the registry and the frontend copy\n  go: %q\n  ts: %q", p.Name, p.Character, got)
		}
		delete(copyFor, p.Name)
	}
	for k := range copyFor {
		t.Errorf("%s has copy for unregistered personality %q", path, k)
	}
}
