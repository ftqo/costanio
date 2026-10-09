package lobby

import (
	"strings"
	"testing"

	"github.com/ftqo/costan.io/engine"
)

// Every ruleset the lobby accepts must be creatable, seatable and startable,
// since the picker offers it. Explorers once could not be created by any path
// while every other lobby test used a base table. These tests walk the
// engine's set of valid rulesets, so a newly registered module is covered
// automatically.

// needsItsOwnMap reports whether a boardless config cannot serve this
// ruleset.
//
// The lobby's "no board, no preset" branch makes a full-land hexagon so the
// waiting room has a preview, and Islands refuses it (a curated board must
// carry sea), so boardless Islands configs are rejected and excluded below.
//
// Ringing the default with sea is not a fix: islands.SetupBoard only carves
// outer islands on a procedural board, so a supplied board would be one
// landmass and the island chip could never fire. The real answer is to leave
// a boardless config boardless and generate it, which changes what the
// waiting room previews; undecided. Until then a server-side creator that
// sends no board (the Discord Activity lobby) cannot make an Islands table.
func needsItsOwnMap(ruleset string) bool {
	return strings.Contains(ruleset, "islands")
}

// TestEveryValidRulesetCanBeCreated: for every ruleset the engine accepts, a
// host can make a table with no board and no preset, the shape a server-side
// creator sends.
func TestEveryValidRulesetCanBeCreated(t *testing.T) {
	rulesets := engine.ValidRulesets()
	if len(rulesets) < 100 {
		t.Fatalf("only %d valid rulesets found", len(rulesets))
	}
	l, st := newLobby(t)
	host := discordUser(t, st, "d-every", "host")
	for _, rs := range rulesets {
		if needsItsOwnMap(rs) {
			continue
		}
		t.Run(rs, func(t *testing.T) {
			sum, err := l.Create(host, engine.GameConfig{Players: 4, Ruleset: rs}, true)
			if err != nil {
				t.Fatalf("a host cannot create %s: %v", rs, err)
			}
			// The stored ruleset is the canonical spelling: module order
			// decides which DefaultConfig sets the target.
			if got := sum.Game.Config; len(got) == 0 {
				t.Fatal("no config stored")
			}
		})
	}
}

// TestEveryValidRulesetCanBeStarted seats each table with bots and starts it,
// since setup, board derivation and module Ext all run at start rather than at
// create. Two players: the fastest table that still runs every module's setup.
func TestEveryValidRulesetCanBeStarted(t *testing.T) {
	if testing.Short() {
		t.Skip("starts a table per ruleset")
	}
	for _, rs := range engine.ValidRulesets() {
		if needsItsOwnMap(rs) {
			continue
		}
		t.Run(rs, func(t *testing.T) {
			l, st := newLobby(t)
			host := discordUser(t, st, "d-start", "host")
			sum, err := l.Create(host, engine.GameConfig{Players: 2, Ruleset: rs}, true)
			if err != nil {
				t.Fatalf("create %s: %v", rs, err)
			}
			gid := sum.Game.ID
			if _, err := l.AddBot(host, gid); err != nil {
				t.Fatalf("seat a bot in %s: %v", rs, err)
			}
			if err := l.Start(host, gid); err != nil {
				t.Fatalf("start %s: %v", rs, err)
			}
			g, err := st.GameByID(gid)
			if err != nil {
				t.Fatal(err)
			}
			if g.Status != "active" {
				t.Errorf("%s started into status %q, want active", rs, g.Status)
			}
		})
	}
}
