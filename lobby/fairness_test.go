package lobby

import (
	"encoding/json"
	"strconv"
	"testing"

	"github.com/ftqo/costan.io/engine"
)

// TestCreateCommitsPublicSeed: the commitment exists as soon as the table
// does, before anyone joins or the game starts. Committing at start would pass
// every other check while no longer proving anything (see docs/dice.md).
func TestCreateCommitsPublicSeed(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "fair-host", "host")
	sum, err := l.Create(host, engine.GameConfig{Players: 4, Ruleset: "base"}, false)
	if err != nil {
		t.Fatal(err)
	}
	g, err := st.GameByID(sum.Game.ID)
	if err != nil {
		t.Fatal(err)
	}
	if g.Status != "lobby" {
		t.Fatalf("expected a game still in the lobby, got %q", g.Status)
	}
	if g.PublicSeed == "" || g.PublicSeedCommit == "" {
		t.Fatal("a freshly created table carries no committed public seed")
	}
	seed, err := strconv.ParseUint(g.PublicSeed, 10, 64)
	if err != nil {
		t.Fatalf("stored public seed is not a uint64: %v", err)
	}
	if got := engine.SeedCommitment(seed); got != g.PublicSeedCommit {
		t.Fatalf("stored commitment %s does not match the stored seed (%s)", g.PublicSeedCommit, got)
	}
}

// TestStartRecordsPreShuffleRoster: a derived permutation with no recorded
// input cannot be checked, since any final seating fits some input.
func TestStartRecordsPreShuffleRoster(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "fair-host", "host")
	sum, err := l.Create(host, engine.GameConfig{Players: 3, Ruleset: "base", TurnOrder: engine.TurnOrderRandom}, false)
	if err != nil {
		t.Fatal(err)
	}
	id := sum.Game.ID
	if _, err := l.Join(discordUser(t, st, "fair-a", "alice"), id, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := l.Join(discordUser(t, st, "fair-b", "bob"), id, ""); err != nil {
		t.Fatal(err)
	}

	before, err := st.Seats(id)
	if err != nil {
		t.Fatal(err)
	}
	want := make([]int64, len(before))
	for i, s := range before {
		want[i] = s.UserID
	}

	if err := l.Start(host, id); err != nil {
		t.Fatal(err)
	}
	g, err := st.GameByID(id)
	if err != nil {
		t.Fatal(err)
	}
	var got []int64
	if err := json.Unmarshal([]byte(g.PreShuffleSeats), &got); err != nil {
		t.Fatalf("no readable pre-shuffle roster was recorded: %v (%q)", err, g.PreShuffleSeats)
	}
	if len(got) != len(want) {
		t.Fatalf("recorded roster %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("recorded roster %v, want %v", got, want)
		}
	}

	// The seating applied is the one the committed seed produces.
	seed, err := strconv.ParseUint(g.PublicSeed, 10, 64)
	if err != nil {
		t.Fatal(err)
	}
	after, err := st.Seats(id)
	if err != nil {
		t.Fatal(err)
	}
	for newNo, idx := range engine.SeatOrder(seed, len(want)) {
		if after[newNo].UserID != want[idx] {
			t.Fatalf("seat %d holds user %d, but the seed puts user %d there",
				newNo, after[newNo].UserID, want[idx])
		}
	}
}

// TestSeedsForDrawsIndependentSeeds: the private seed must not be derivable
// from the public one. Same public seed, two starts, two private seeds.
func TestSeedsForDrawsIndependentSeeds(t *testing.T) {
	l, st := newLobby(t)
	host := discordUser(t, st, "fair-host", "host")
	sum, err := l.Create(host, engine.GameConfig{Players: 2, Ruleset: "base"}, false)
	if err != nil {
		t.Fatal(err)
	}
	g, err := st.GameByID(sum.Game.ID)
	if err != nil {
		t.Fatal(err)
	}
	a, err := seedsFor(g)
	if err != nil {
		t.Fatal(err)
	}
	b, err := seedsFor(g)
	if err != nil {
		t.Fatal(err)
	}
	if a.Public != b.Public {
		t.Fatal("public seed changed from the committed one")
	}
	if a.Private == b.Private {
		t.Fatal("two starts produced the same private seed")
	}
	if a.Private == a.Public {
		t.Fatal("public and private seeds are equal")
	}
}
