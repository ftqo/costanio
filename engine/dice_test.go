package engine

import (
	"strings"
	"testing"
)

func TestFairDiceDealExactDistribution(t *testing.T) {
	s := Empty()
	s.PublicSeed = 99
	s.Config.DiceMode = DiceFair

	counts := map[int]int{}
	seen := map[[2]int]bool{}
	for range 36 {
		d1, d2 := rollDice(s)
		if d1 < 1 || d1 > 6 || d2 < 1 || d2 > 6 {
			t.Fatalf("roll %d,%d out of range", d1, d2)
		}
		if seen[[2]int{d1, d2}] {
			t.Fatalf("outcome %d,%d repeated within an epoch", d1, d2)
		}
		seen[[2]int{d1, d2}] = true
		counts[d1+d2]++
		s.RollCount++
	}
	want := map[int]int{2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1}
	for total, n := range want {
		if counts[total] != n {
			t.Errorf("total %d appeared %d times, want %d", total, counts[total], n)
		}
	}

	// Next epoch reshuffles but stays deterministic.
	d1a, d2a := rollDice(s)
	s2 := Empty()
	s2.PublicSeed = 99
	s2.Config.DiceMode = DiceFair
	s2.RollCount = 36
	d1b, d2b := rollDice(s2)
	if d1a != d1b || d2a != d2b {
		t.Error("fair dice not deterministic across rebuilds")
	}
}

func TestRandomDiceDeterministicPerPosition(t *testing.T) {
	s := Empty()
	s.PublicSeed = 7
	s.Config.DiceMode = DiceRandom
	s.NextSeq = 42
	a1, a2 := rollDice(s)
	b1, b2 := rollDice(s)
	if a1 != b1 || a2 != b2 {
		t.Error("same position must roll the same dice")
	}
	s.NextSeq = 43
	c1, c2 := rollDice(s)
	if a1 == c1 && a2 == c2 {
		t.Log("adjacent positions rolled identically (possible but rare); not failing")
	}
}

func TestSeedCommitmentMatchesSeed(t *testing.T) {
	c1 := SeedCommitment(123)
	c2 := SeedCommitment(123)
	c3 := SeedCommitment(124)
	if c1 != c2 || c1 == c3 || len(c1) != 64 {
		t.Errorf("commitment broken: %s vs %s vs %s", c1, c2, c3)
	}
}

func TestGameCreatedHidesSeed(t *testing.T) {
	events, err := New(GameConfig{Players: 3}, SeedsFrom(555))
	if err != nil {
		t.Fatal(err)
	}
	created := events[0]
	if created.Visible == nil || len(created.Visible) != 0 {
		t.Fatalf("game_created must be hidden-from-all, got Visible=%v", created.Visible)
	}
	seeds := SeedsFrom(555)
	d := decode[GameCreatedData](created)
	// Each commitment covers its own seed; crossing them would fail every audit on
	// honest games.
	if d.SeedCommit != SeedCommitment(seeds.Private) {
		t.Errorf("private commitment %s does not cover the private seed", d.SeedCommit)
	}
	if d.PublicSeedCommit != SeedCommitment(seeds.Public) {
		t.Errorf("public commitment %s does not cover the public seed", d.PublicSeedCommit)
	}
	for _, key := range []string{"seed_commit", "public_seed_commit"} {
		if !strings.Contains(string(created.Data), key) {
			t.Errorf("%s missing from payload", key)
		}
	}
}

// TestLegacyLogKeepsOneSeed: a log from before the seed split carries no
// public commitment, and both streams must use its single seed so the game
// replays exactly.
func TestLegacyLogKeepsOneSeed(t *testing.T) {
	legacy := mustEvent(EvGameCreated, GameCreatedData{
		Config: GameConfig{Players: 3}, Seed: 4242, SeedCommit: SeedCommitment(4242),
	})
	legacy.Seq = 0
	s := Empty()
	if err := Apply(s, legacy); err != nil {
		t.Fatal(err)
	}
	if s.Seed != 4242 || s.PublicSeed != 4242 {
		t.Fatalf("legacy fold gave Seed=%d PublicSeed=%d, want both 4242", s.Seed, s.PublicSeed)
	}
}
