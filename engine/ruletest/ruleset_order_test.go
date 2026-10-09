package ruletest

import (
	"encoding/json"
	"slices"
	"strings"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	_ "github.com/ftqo/costan.io/engine/explorers"
	_ "github.com/ftqo/costan.io/engine/harbormaster"
	_ "github.com/ftqo/costan.io/engine/islands"
	_ "github.com/ftqo/costan.io/engine/knights"
	_ "github.com/ftqo/costan.io/engine/rivers"
	_ "github.com/ftqo/costan.io/engine/scenarios"
	_ "github.com/ftqo/costan.io/engine/wagons"
)

// A ruleset string is a "+"-separated module list, and modulesFor keeps its
// order. New applies every module's DefaultConfig in that order, and a defaulter
// that sets TargetVP only when it is zero means the spelling could choose the
// victory condition. So rulesets are canonicalised at creation only:
// Config.Ruleset is logged, and normalising inside modulesFor would re-resolve
// persisted non-canonical games into a different module order and break their
// replay.

func newState(t *testing.T, cfg engine.GameConfig) *engine.State {
	t.Helper()
	seeds := engine.Seeds{Public: 0x5EED, Private: 0xC0FFEE}
	evs, err := engine.New(cfg, seeds)
	if err != nil {
		t.Fatalf("engine.New(%q): %v", cfg.Ruleset, err)
	}
	s, err := engine.Replay(evs)
	if err != nil {
		t.Fatalf("replay(%q): %v", cfg.Ruleset, err)
	}
	return s
}

// TestCanonicalRuleset pins the canonical spelling itself: base first if
// present, every module name once, the rest sorted lexicographically.
func TestCanonicalRuleset(t *testing.T) {
	for _, tc := range []struct{ in, want string }{
		{"base", "base"},
		{"", ""},
		{"base+cak", "base+cak"},
		{"base+caravans+cak", "base+cak+caravans"},
		{"base+cak+caravans", "base+cak+caravans"},
		{"base+islands+fishermen", "base+fishermen+islands"},
		{"base+fishermen+islands", "base+fishermen+islands"},
		{"cak+base", "base+cak"},
		{"base+cak+cak", "base+cak"},
		{"base++cak", "base+cak"},
		{"islands", "islands"},
		{"islands+cak", "cak+islands"},
		{"base+harbormaster+cak", "base+cak+harbormaster"},
		{"base+cak+harbormaster", "base+cak+harbormaster"},
		{"base+islands+harbormaster", "base+harbormaster+islands"},
	} {
		if got := engine.CanonicalRuleset(tc.in); got != tc.want {
			t.Errorf("CanonicalRuleset(%q) = %q, want %q", tc.in, got, tc.want)
		}
		if again := engine.CanonicalRuleset(tc.want); again != tc.want {
			t.Errorf("CanonicalRuleset not idempotent: %q -> %q", tc.want, again)
		}
	}
}

// TestOrderDoesNotChangeTargetVP asserts both halves: the raw spellings still
// diverge (which is why creation must normalise), and the canonical spelling of
// each is the same string. Comparing two canonicalised states alone would pass
// even with CanonicalRuleset as the identity. That production creation calls it
// is pinned in game.TestStartCanonicalisesRuleset.
func TestOrderDoesNotChangeTargetVP(t *testing.T) {
	// The pairing where module order still picks a different victory condition,
	// spelled raw as a host could.
	//
	// Knights and Raiders both set a whole target through ConfigDefaulter (13 and
	// 12), first writer wins, and the canonical sort decides which. raiders.md
	// states 13 for the pairing, which the canonical spelling gives. (Caravans
	// uses an additive TargetVPAdjuster, so it does not race.)
	knights := newState(t, engine.GameConfig{Players: 4, Ruleset: "base+cak+raiders"})
	rai := newState(t, engine.GameConfig{Players: 4, Ruleset: "base+raiders+cak"})
	if knights.Config.TargetVP == rai.Config.TargetVP {
		t.Fatalf("both raw orders play to %d VP, want different targets", knights.Config.TargetVP)
	}
	if knights.Config.TargetVP != 13 || rai.Config.TargetVP != 12 {
		t.Errorf("raw orders give TargetVP %d and %d, want 13 (Knights first) and 12 (Raiders first)",
			knights.Config.TargetVP, rai.Config.TargetVP)
	}

	for _, pair := range [][2]string{
		{"base+cak+raiders", "base+raiders+cak"},
		{"base+fishermen+islands", "base+islands+fishermen"},
	} {
		ca, cb := engine.CanonicalRuleset(pair[0]), engine.CanonicalRuleset(pair[1])
		if ca != cb {
			t.Errorf("canonical(%q) = %q but canonical(%q) = %q", pair[0], ca, pair[1], cb)
			continue
		}
		// One spelling, therefore one game: built once and checked against the
		// raw spelling it normalises, which is where a difference can exist.
		canon := newState(t, engine.GameConfig{Players: 4, Ruleset: ca})
		raw := newState(t, engine.GameConfig{Players: 4, Ruleset: pair[1]})
		if canon.Config.Ruleset != ca {
			t.Errorf("state built from %q reports ruleset %q", ca, canon.Config.Ruleset)
		}
		jc, _ := json.Marshal(canon.Board)
		jr, _ := json.Marshal(raw.Board)
		if pair[1] == ca && string(jc) != string(jr) {
			t.Errorf("%q is already canonical but produced a different board", pair[1])
		}
	}

	// The specific number, so a change to either default has to be made
	// here on purpose.
	if got := newState(t, engine.GameConfig{Players: 4, Ruleset: engine.CanonicalRuleset("base+raiders+cak")}).Config.TargetVP; got != 13 {
		t.Errorf("canonical base+cak+raiders TargetVP = %d, want 13 (Knights wins the default)", got)
	}

	// A pairing target set by an additive TargetVPAdjuster comes out the same
	// whatever the spelling. Wagons needs it: Knights and Caravans sort before
	// it and both set a number, and both specs price the pairing at 15.
	//
	// Raw on both sides, since the canonical spellings are one game by
	// construction.
	for _, tc := range []struct {
		a, b string
		want int
	}{
		{"base+cak+wagons", "base+wagons+cak", 15},
		{"base+caravans+wagons", "base+wagons+caravans", 15},
		// Knights' 13, lifted to the Wagons pairing's 15, plus Caravans' 2. No
		// spec states this three-way row; what matters is that the spelling does
		// not change it.
		{"base+cak+caravans+wagons", "base+wagons+caravans+cak", 17},
		{"base+fishermen+wagons", "base+wagons+fishermen", 13},
		// Caravans itself, which is why the divergence check above had to move.
		{"base+cak+caravans", "base+caravans+cak", 15},
		{"base+caravans+islands", "base+islands+caravans", 14},
	} {
		ga := newState(t, engine.GameConfig{Players: 4, Ruleset: tc.a}).Config.TargetVP
		gb := newState(t, engine.GameConfig{Players: 4, Ruleset: tc.b}).Config.TargetVP
		if ga != tc.want || gb != tc.want {
			t.Errorf("%q plays to %d and %q to %d, want %d from both",
				tc.a, ga, tc.b, gb, tc.want)
		}
	}
	// And a host who named a target still gets it, with no adjustment on top.
	named := newState(t, engine.GameConfig{Players: 4, Ruleset: engine.CanonicalRuleset("base+cak+wagons"), TargetVP: 12})
	if named.Config.TargetVP != 12 {
		t.Errorf("a host-chosen target of 12 became %d", named.Config.TargetVP)
	}
}

// TestNonCanonicalRulesetReplaysUnchanged: a game created before
// canonicalisation has its exact ruleset string in GameCreated, and resolution
// must honour it letter for letter or the replay is a different game.
func TestNonCanonicalRulesetReplaysUnchanged(t *testing.T) {
	const legacy = "base+caravans+cak" // non-canonical order, as stored

	evs, err := engine.New(engine.GameConfig{Players: 4, Ruleset: legacy}, engine.Seeds{Public: 0x5EED, Private: 0xC0FFEE})
	if err != nil {
		t.Fatal(err)
	}
	// Round-trip through JSON: this is the log as SQLite hands it back.
	raw, err := json.Marshal(evs)
	if err != nil {
		t.Fatal(err)
	}
	var persisted []engine.Event
	if err := json.Unmarshal(raw, &persisted); err != nil {
		t.Fatal(err)
	}
	s, err := engine.Replay(persisted)
	if err != nil {
		t.Fatal(err)
	}
	if s.Config.Ruleset != legacy {
		t.Fatalf("replayed ruleset = %q, want the persisted string %q verbatim", s.Config.Ruleset, legacy)
	}
	if s.Config.TargetVP != 15 {
		t.Fatalf("replayed TargetVP = %d, want 15", s.Config.TargetVP)
	}
	// Resolution is a pure function of the logged string, so a second replay
	// agrees with the first.
	s2, err := engine.Replay(persisted)
	if err != nil {
		t.Fatal(err)
	}
	if s2.Config.TargetVP != s.Config.TargetVP || s2.Config.Ruleset != s.Config.Ruleset {
		t.Fatalf("replay is not deterministic: %+v vs %+v", s.Config, s2.Config)
	}
}

// TestSetupRobberNeverOnWater sweeps every module order that shapes a board.
// Fishermen turns deserts into lakes and Islands carves the outer ring, so a
// robber rescued only when not on Land could end up drowned in
// base+fishermen+islands.
func TestSetupRobberNeverOnWater(t *testing.T) {
	rulesets := []string{
		"base", "base+islands", "base+fishermen", "base+caravans", "base+cak",
		"base+fishermen+islands", "base+islands+fishermen",
		"base+caravans+islands", "base+islands+caravans",
		"base+cak+islands", "base+islands+cak",
		// Wagons takes the robber off the board entirely, so "never on water"
		// means never anywhere. Islands is refused beside it.
		"base+wagons", "base+cak+wagons", "base+caravans+wagons", "base+fishermen+wagons",
	}
	for _, rs := range rulesets {
		for players := 2; players <= 10; players++ {
			for seed := range uint64(40) {
				evs, err := engine.New(engine.GameConfig{Players: players, Ruleset: rs}, engine.Seeds{Public: seed, Private: seed ^ 0x9E37})
				if err != nil {
					t.Fatalf("%s %dp seed %d: %v", rs, players, seed, err)
				}
				s, err := engine.Replay(evs)
				if err != nil {
					t.Fatalf("%s %dp seed %d: %v", rs, players, seed, err)
				}
				b := s.Board
				// Off the board is a legal starting state. In Fishermen it is the
				// only one: the robber starts beside the board and enters on the
				// first 7. Under Wagons the robber is out of the game entirely (a 7
				// moves a barbarian and NoRobber stops it ever arming).
				if !b.RobberOnBoard() {
					// Caravans also starts it beside the board, not on the oasis (the
					// desert the base game would otherwise use).
					if !hasModule(rs, "fishermen") && !hasModule(rs, "wagons") && !hasModule(rs, "caravans") {
						t.Fatalf("%s %dp seed %d: robber is beside the board in a ruleset with no rule that puts it there",
							rs, players, seed)
					}
					continue
				}
				tile, ok := b.Tiles[b.Robber]
				if !ok {
					t.Fatalf("%s %dp seed %d: robber at %v is off the board", rs, players, seed, b.Robber)
				}
				if !b.RobberOK(b.Robber) {
					t.Fatalf("%s %dp seed %d: robber on %v (%v), which is not a hex it may occupy", rs, players, seed, b.Robber, tile.Res)
				}
				// Sea is the hazard: Islands carves the outer ring. A lake is not
				// water for this purpose: it is a flooded desert that produces
				// nothing, so a robber there blocks nothing (the 2-fish spend names
				// board.Lake, decideMoveRobber takes any Land hex, and
				// board.RobberOK agrees).
				if tile.Res == board.Sea || tile.Res == board.Border {
					t.Fatalf("%s %dp seed %d: robber on water/border %v (%v)", rs, players, seed, b.Robber, tile.Res)
				}
				// If the board has a hex where the robber blocks nothing (a desert,
				// or a lake), setup must use it. Parking it on producing land blocks
				// one player's corner from turn one until a 7 or a knight moves it.
				//
				// Conditional because on a small base+islands board the carve can
				// take the only desert (2p seed 1), leaving the fallback no choice.
				// Fishermen always has lakes.
				if !b.RobberNeutral(b.Robber) && anyNeutral(b) {
					t.Fatalf("%s %dp seed %d: robber on producing %v (%v) with a neutral hex free",
						rs, players, seed, b.Robber, tile.Res)
				}
			}
		}
	}
}

// anyNeutral reports whether the board offers the robber a home that blocks
// nothing: a desert, or the lake Fishermen turned one into.
func anyNeutral(b *board.Board) bool {
	return slices.ContainsFunc(board.HexesInRadius(b.Radius), b.RobberNeutral)
}

// hasModule reports whether a raw ruleset string names a module.
func hasModule(ruleset, name string) bool {
	return slices.Contains(strings.Split(ruleset, "+"), name)
}
