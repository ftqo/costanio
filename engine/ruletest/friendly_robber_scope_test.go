package ruletest

import (
	"bufio"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// playedThroughSetup is a real game of ruleset rs driven through its setup
// draft by the engine's own auto-player, with the friendly robber switched on.
func playedThroughSetup(t *testing.T, rs string, players int) *engine.State {
	t.Helper()
	cfg := engine.GameConfig{Players: players, Ruleset: engine.CanonicalRuleset(rs), FriendlyRobber: true}
	log, err := engine.New(cfg, engine.SeedsFrom(11))
	if err != nil {
		t.Fatalf("%s: %v", rs, err)
	}
	s, err := engine.Replay(log)
	if err != nil {
		t.Fatalf("%s: %v", rs, err)
	}
	for range 400 {
		if s.Phase != engine.PhaseSetup {
			return s
		}
		cmd, ok := engine.AutoCommand(s)
		if !ok {
			t.Fatalf("%s: setup stuck", rs)
		}
		evs, err := engine.Decide(s, cmd)
		if err != nil {
			t.Fatalf("%s: setup %s: %v", rs, cmd.Type, err)
		}
		for _, e := range evs {
			if err := engine.Apply(s, e); err != nil {
				t.Fatalf("%s: apply %s: %v", rs, e.Type, err)
			}
		}
	}
	t.Fatalf("%s: setup did not finish in 400 commands", rs)
	return nil
}

// The shield covers "players still at their starting score" (engine/types.go,
// GameConfig.FriendlyRobber). That is 2 in the base game but 3 under Knights,
// Wagons and Raiders, which deal a city in the second placement, so the threshold
// is the ruleset's starting score from the setup draft (engine.State.StartingVP).
func TestFriendlyRobberShieldsStartingScore(t *testing.T) {
	for _, tc := range []struct {
		ruleset string
		start   int
	}{
		{"base", 2},
		{"base+islands", 2},
		{"base+cak", 3},
		{"base+cak+islands", 3},
	} {
		s := playedThroughSetup(t, tc.ruleset, 4)
		if got := s.StartingVP(); got != tc.start {
			t.Errorf("%s: StartingVP %d, want %d", tc.ruleset, got, tc.start)
		}
		if got := s.FriendlyRobberMaxVP(); got != tc.start {
			t.Errorf("%s: shield threshold %d, want the starting score %d", tc.ruleset, got, tc.start)
		}
		for p := range s.Players {
			seat := engine.PlayerID(p)
			if vp := s.PublicVPWithModules(seat); vp != tc.start {
				t.Fatalf("%s: seat %d leaves setup on %d VP, want %d", tc.ruleset, p, vp, tc.start)
			}
			if !s.FriendlyRobberProtected(seat) {
				t.Errorf("%s: seat %d at its starting %d VP is not shielded", tc.ruleset, p, tc.start)
			}
		}
		// One point above the start and the shield is gone. A settlement is a
		// point wherever it stands, so drop one anywhere free of buildings.
		seat := engine.PlayerID(0)
		for v := range freeVertices(s) {
			s.Buildings[v] = engine.Building{Owner: seat}
			break
		}
		if s.FriendlyRobberProtected(seat) {
			t.Errorf("%s: seat 0 at %d VP, one above the start, is still shielded",
				tc.ruleset, s.PublicVPWithModules(seat))
		}
	}
}

func freeVertices(s *engine.State) map[board.Vertex]bool {
	out := map[board.Vertex]bool{}
	for h := range s.Board.Tiles {
		for _, v := range h.Vertices() {
			if _, ok := s.Buildings[v]; !ok && s.Board.LandVertex(v) {
				out[v] = true
			}
		}
	}
	return out
}

// With no robber in the game the setting means nothing, so the engine ignores it
// rather than let a hidden toggle shield the other steals that ask the same
// question (a Raiders 7, the Fishermen three-fish spend).
func TestFriendlyRobberIsIgnoredWithoutARobber(t *testing.T) {
	for _, rs := range []string{"base+wagons", "base+raiders", "base+cak+raiders", "base+fishermen+wagons"} {
		if engine.RulesetHasRobber(engine.CanonicalRuleset(rs)) {
			t.Errorf("%s: RulesetHasRobber = true, want false", rs)
		}
		s := playedThroughSetup(t, rs, 4)
		if s.FriendlyRobberActive() {
			t.Errorf("%s: the shield is active in a game with no robber", rs)
		}
		for p := range s.Players {
			if s.FriendlyRobberProtected(engine.PlayerID(p)) {
				t.Errorf("%s: seat %d shielded in a game with no robber", rs, p)
			}
		}
	}
	for _, rs := range []string{"base", "base+cak", "base+islands", "base+fishermen"} {
		if !engine.RulesetHasRobber(engine.CanonicalRuleset(rs)) {
			t.Errorf("%s: RulesetHasRobber = false, want true", rs)
		}
	}
}

// Every ruleset's robber answer, held to testdata/robber.txt, which the frontend
// also reads (format.test.ts "the lobby's friendly-robber row"); the lobby hides
// the setting where it says 0. Regenerate with COSTAN_UPDATE_ROBBER=1 and read the
// diff.
//
// Each answer is checked against what a game does: a ruleset with no robber must
// start with the robber off the board and have a module suppressing it on a 7
// (NoRobber).
func TestEveryRulesetsRobberAnswer(t *testing.T) {
	got := map[string]bool{}
	for _, rs := range engine.ValidRulesets() {
		got[rs] = engine.RulesetHasRobber(rs)
	}
	path := filepath.Join("testdata", "robber.txt")
	if os.Getenv("COSTAN_UPDATE_ROBBER") != "" {
		rows := make([]string, 0, len(got))
		for rs, has := range got {
			n := 0
			if has {
				n = 1
			}
			rows = append(rows, rs+" "+strconv.Itoa(n))
		}
		slices.Sort(rows)
		if err := os.WriteFile(path, []byte(strings.Join(rows, "\n")+"\n"), 0o644); err != nil {
			t.Fatal(err)
		}
		t.Fatal("rewrote testdata/robber.txt; read the diff, then run again without COSTAN_UPDATE_ROBBER")
	}
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	want := map[string]bool{}
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		parts := strings.Fields(sc.Text())
		if len(parts) != 2 {
			continue
		}
		want[parts[0]] = parts[1] == "1"
	}
	if len(want) != len(got) {
		t.Errorf("%d valid rulesets, the table has %d: regenerate it and read the diff", len(got), len(want))
	}
	for rs, has := range got {
		if w, ok := want[rs]; !ok || w != has {
			t.Errorf("%s: RulesetHasRobber %v, table says %v (present %v)", rs, has, w, ok)
		}
		if has {
			continue
		}
		log, err := engine.New(engine.GameConfig{Players: 4, Ruleset: rs}, engine.SeedsFrom(3))
		if err != nil {
			t.Fatalf("%s: %v", rs, err)
		}
		s, err := engine.Replay(log)
		if err != nil {
			t.Fatalf("%s: %v", rs, err)
		}
		if s.Board.RobberOnBoard() {
			t.Errorf("%s says it has no robber and starts with one on the board", rs)
		}
		suppressed := false
		for _, m := range s.Modules() {
			if h := m.Hooks().NoRobber; h != nil && h(s) {
				suppressed = true
			}
		}
		if !suppressed {
			t.Errorf("%s says it has no robber and no module suppresses it on a 7", rs)
		}
	}
}
