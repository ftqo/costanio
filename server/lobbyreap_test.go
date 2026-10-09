package server

import (
	"testing"
	"time"

	"github.com/ftqo/costan.io/store"
)

func lobbyGame(id string, createdAt int64) *store.Game {
	return &store.Game{ID: id, Status: "lobby", CreatedAt: createdAt}
}

func TestOrphanedLobbies(t *testing.T) {
	now := time.Unix(10_000, 0)
	minAge := 2 * time.Minute

	// Helpers for the per-game predicates.
	none := func(int64) bool { return false }
	noFollowers := func(string) bool { return false }

	t.Run("deserted aged lobby is orphaned", func(t *testing.T) {
		lobbies := []*store.Game{lobbyGame("g", 0)} // created long ago
		seats := map[string][]*store.Seat{"g": {{GameID: "g", No: 0, UserID: 1}}}
		got := orphanedLobbies(lobbies, seats, none, noFollowers, now, minAge)
		if len(got) != 1 || got[0] != "g" {
			t.Fatalf("want [g], got %v", got)
		}
	})

	t.Run("a seated user still online keeps the lobby", func(t *testing.T) {
		lobbies := []*store.Game{lobbyGame("g", 0)}
		seats := map[string][]*store.Seat{"g": {{GameID: "g", No: 0, UserID: 1}, {GameID: "g", No: 1, UserID: 2}}}
		online := func(uid int64) bool { return uid == 2 }
		got := orphanedLobbies(lobbies, seats, online, noFollowers, now, minAge)
		if len(got) != 0 {
			t.Fatalf("want none, got %v", got)
		}
	})

	t.Run("a follower keeps the lobby", func(t *testing.T) {
		lobbies := []*store.Game{lobbyGame("g", 0)}
		seats := map[string][]*store.Seat{"g": {{GameID: "g", No: 0, UserID: 1}}}
		hasFollowers := func(id string) bool { return id == "g" }
		got := orphanedLobbies(lobbies, seats, none, hasFollowers, now, minAge)
		if len(got) != 0 {
			t.Fatalf("want none, got %v", got)
		}
	})

	t.Run("online host spectating bots keeps the lobby", func(t *testing.T) {
		// The host created the lobby, added bots, dropped their seat to spectate,
		// then stepped into the map builder, so they're online but neither seated
		// nor following. Only bots remain seated. The table is still theirs and
		// must not be reaped out from under them.
		lobbies := []*store.Game{{ID: "g", Status: "lobby", CreatedAt: 0, CreatedBy: 1}}
		seats := map[string][]*store.Seat{"g": {{GameID: "g", No: 1, UserID: 2}, {GameID: "g", No: 2, UserID: 3}}}
		online := func(uid int64) bool { return uid == 1 } // the host, online elsewhere on the site
		got := orphanedLobbies(lobbies, seats, online, noFollowers, now, minAge)
		if len(got) != 0 {
			t.Fatalf("want none (host still online), got %v", got)
		}
	})

	t.Run("a new lobby is spared", func(t *testing.T) {
		lobbies := []*store.Game{lobbyGame("g", now.Unix()-1)} // 1s old, under minAge
		seats := map[string][]*store.Seat{"g": {{GameID: "g", No: 0, UserID: 1}}}
		got := orphanedLobbies(lobbies, seats, none, noFollowers, now, minAge)
		if len(got) != 0 {
			t.Fatalf("want none (too new), got %v", got)
		}
	})

	t.Run("only the orphaned lobbies are returned", func(t *testing.T) {
		lobbies := []*store.Game{lobbyGame("dead", 0), lobbyGame("alive", 0), lobbyGame("fresh", now.Unix())}
		seats := map[string][]*store.Seat{
			"dead":  {{GameID: "dead", No: 0, UserID: 1}},
			"alive": {{GameID: "alive", No: 0, UserID: 2}},
			"fresh": {{GameID: "fresh", No: 0, UserID: 3}},
		}
		online := func(uid int64) bool { return uid == 2 }
		got := orphanedLobbies(lobbies, seats, online, noFollowers, now, minAge)
		if len(got) != 1 || got[0] != "dead" {
			t.Fatalf("want [dead], got %v", got)
		}
	})
}
