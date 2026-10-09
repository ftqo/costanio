package ranked

import "testing"

func TestConfigForBase(t *testing.T) {
	cfg, ok := ConfigFor("base")
	if !ok {
		t.Fatal("base queue must resolve")
	}
	if cfg.Players != 4 || cfg.TargetVP != 10 || cfg.Ruleset != "base" {
		t.Fatalf("bad base cfg: %+v", cfg)
	}
	if cfg.FriendlyRobber {
		t.Fatal("ranked must not use friendly robber")
	}
	if cfg.DiceMode != "random" || cfg.BoardMode != "fair" {
		t.Fatal("ranked must use random dice + fair board")
	}
	if !cfg.MemoryMode {
		t.Fatal("ranked must lock memory mode on")
	}
}

func TestConfigForKnights(t *testing.T) {
	cfg, ok := ConfigFor("cak")
	if !ok || cfg.Ruleset != "base+cak" || cfg.TargetVP != 13 || cfg.Players != 4 {
		t.Fatalf("bad cak cfg: %+v ok=%v", cfg, ok)
	}
	if cfg.FriendlyRobber {
		t.Fatal("ranked must not use friendly robber")
	}
	if cfg.DiceMode != "random" || cfg.BoardMode != "fair" {
		t.Fatal("ranked must use random dice + fair board")
	}
	if cfg.TurnOrder != "random" {
		t.Fatal("ranked must use random turn order")
	}
	if cfg.DiscardLimit != 7 {
		t.Fatalf("ranked must use discard limit 7, got %d", cfg.DiscardLimit)
	}
	if !cfg.MemoryMode {
		t.Fatal("ranked must lock memory mode on")
	}
}

func TestConfigForUnknown(t *testing.T) {
	if _, ok := ConfigFor("nope"); ok {
		t.Fatal("unknown queue must not resolve")
	}
}

// Ranked is exactly two modes: 4p base and 4p Knights. Adding a queue is a
// product decision (new leaderboard, split rating pools, thinner matchmaking),
// so it should break this test rather than arrive as a side effect.
func TestQueuesAreFourPlayerModes(t *testing.T) {
	want := []Queue{
		{Key: "base", Ruleset: "base", Label: "Base (4p)"},
		{Key: "cak", Ruleset: "base+cak", Label: "Knights (4p)"},
	}
	if len(Queues) != len(want) {
		t.Fatalf("Queues = %+v, want exactly %+v", Queues, want)
	}
	for i, q := range Queues {
		if q != want[i] {
			t.Errorf("Queues[%d] = %+v, want %+v", i, q, want[i])
		}
		cfg, ok := ConfigFor(q.Key)
		if !ok || cfg.Players != groupSize {
			t.Errorf("queue %q: cfg.Players = %d (ok=%v), want %d to match the matchmaker group size", q.Key, cfg.Players, ok, groupSize)
		}
	}
	if got := Rulesets(); len(got) != 2 || got[0] != "base" || got[1] != "base+cak" {
		t.Errorf("Rulesets() = %v, want [base base+cak]", got)
	}
	for _, rs := range []string{"base+islands", "base+fishermen", "base+caravans", "", "cak"} {
		if IsRuleset(rs) {
			t.Errorf("IsRuleset(%q) = true, want false", rs)
		}
	}
}
