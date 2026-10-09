package lobby

import (
	"testing"

	"github.com/ftqo/costan.io/bot"
	"github.com/ftqo/costan.io/engine"
)

// TestBotNamesMatchPersonalityRegistry: the bot's name is its personality
// (there is no personality column), so a name the registry does not know
// reloads as the default strategy with a blank character line.
func TestBotNamesMatchPersonalityRegistry(t *testing.T) {
	names := botNames()
	if len(names) != len(bot.Personalities()) {
		t.Fatalf("pool holds %d names, registry holds %d", len(names), len(bot.Personalities()))
	}
	for _, n := range names {
		if _, ok := bot.PersonalityForDisplayName(n); !ok {
			t.Errorf("pool name %q resolves to no personality", n)
		}
	}
	// The pool must cover the largest table (ten seats, nine bots), or
	// pickBotName repeats a name.
	if len(names) < 10 {
		t.Errorf("pool holds %d names, want at least 9", len(names))
	}
}

// TestAddBotSeatsDistinctPersonalities: filling a table never seats one
// personality twice.
func TestAddBotSeatsDistinctPersonalities(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "d1", "host")
	sum, err := l.Create(host, engine.GameConfig{Players: 8}, false)
	if err != nil {
		t.Fatal(err)
	}
	gid := sum.Game.ID
	for i := range 7 {
		if sum, err = l.AddBot(host, gid); err != nil {
			t.Fatalf("AddBot %d: %v", i, err)
		}
	}
	seen := map[string]bool{}
	bots := 0
	for _, s := range sum.Seats {
		if s.Status != "bot" {
			continue
		}
		bots++
		if seen[s.UserName] {
			t.Errorf("personality %q seated twice at one table", s.UserName)
		}
		seen[s.UserName] = true
		if _, ok := bot.PersonalityForDisplayName(s.UserName); !ok {
			t.Errorf("seated bot %q is not a registered personality", s.UserName)
		}
	}
	if bots != 7 {
		t.Errorf("seated %d bots, want 7", bots)
	}
}

// TestAddBotVariesPersonality: the pick is random. Stated as
// "not always the first name" over forty tables; with 11 names a correct
// implementation fails by chance with probability (1/11)^40.
func TestAddBotVariesPersonality(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "d1", "host")

	first := map[string]int{}
	const tables = 40
	for i := range tables {
		sum, err := l.Create(host, engine.GameConfig{Players: 2}, false)
		if err != nil {
			t.Fatalf("Create %d: %v", i, err)
		}
		sum, err = l.AddBot(host, sum.Game.ID)
		if err != nil {
			t.Fatalf("AddBot %d: %v", i, err)
		}
		for _, s := range sum.Seats {
			if s.Status == "bot" {
				first[s.UserName]++
			}
		}
	}
	if len(first) < 2 {
		t.Errorf("across %d tables the first bot was always %v", tables, first)
	}
}

// TestRandomIndexIsUniform guards the rejection sampling: a modulo of one byte
// would favour the low indices noticeably with an 11-name pool.
func TestRandomIndexIsUniform(t *testing.T) {
	const n, draws = 11, 22000
	counts := make([]int, n)
	for range draws {
		i := randomIndex(n)
		if i < 0 || i >= n {
			t.Fatalf("randomIndex(%d) = %d, out of range", n, i)
		}
		counts[i]++
	}
	// Expected 2000 each. A wide band: a smoke test for systematic bias that
	// must not flake.
	for i, c := range counts {
		if c < 1500 || c > 2500 {
			t.Errorf("index %d drawn %d times in %d, want near %d", i, c, draws, draws/n)
		}
	}
	if randomIndex(1) != 0 || randomIndex(0) != 0 {
		t.Error("randomIndex must return 0 for a degenerate pool")
	}
}
