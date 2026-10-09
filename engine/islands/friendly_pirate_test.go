package islands

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// The friendly-robber option must shield low-public-VP players from the pirate
// as it does from the land robber. These tests use a controlled island board, a
// victim ship bordering a sea hex, and land buildings to set the victim's
// public VP.

// shipVictim places a ship owned by `owner` bordering seaHex and hands them
// cards, then gives them `buildings` worth of public VP on land vertices.
func shipVictim(t *testing.T, s *engine.State, seaHex board.Hex, owner engine.PlayerID, vp int) {
	t.Helper()
	ext(s).Ships[seaHex.Edges()[0]] = owner
	s.Players[owner].Hand = engine.Hand{board.Ore: 2}
	verts := board.Hex{Q: 0, R: 0}.Vertices()
	for i := range vp {
		s.Buildings[verts[i]] = engine.Building{Owner: owner} // one settlement = 1 VP each
	}
	if got := s.PublicVPWithModules(owner); got != vp {
		t.Fatalf("setup: player %d public VP %d, want %d", owner, got, vp)
	}
}

// TestFriendlyPirateExcludesProtectedVictim: a low-VP ship owner is a pirate
// victim with the toggle off, but vanishes from the victim set with it on.
func TestFriendlyPirateExcludesProtectedVictim(t *testing.T) {
	seaA := board.Hex{Q: 2, R: 0}
	s := builtState(t, 3, seaA)
	s.RobberPending = true
	shipVictim(t, s, seaA, 1, 1) // public VP 1 → protected under the toggle

	s.Config.FriendlyRobber = false
	if !pirateVictims(s, seaA, 0)[1] {
		t.Fatal("toggle off: player 1 should be a pirate victim")
	}
	s.Config.FriendlyRobber = true
	if pirateVictims(s, seaA, 0)[1] {
		t.Error("toggle on: protected (1 VP) player 1 must not be a pirate victim")
	}
}

// TestFriendlyPirateForcesRobbableHex: with an unprotected ship reachable, the
// pirate may not be parked on an empty sea hex; it must rob the target.
func TestFriendlyPirateForcesRobbableHex(t *testing.T) {
	seaTarget := board.Hex{Q: 2, R: 0}
	seaEmpty := board.Hex{Q: -2, R: 0}
	s := builtState(t, 3, seaTarget, seaEmpty)
	s.RobberPending = true
	s.Config.FriendlyRobber = true
	shipVictim(t, s, seaTarget, 1, 3) // public VP 3 → unprotected

	// The empty sea hex reaches no victim, but an unprotected target exists
	// elsewhere, so parking the pirate there is illegal.
	decideErr(t, s, engine.Command{Player: 0, Type: CmdMovePirate,
		Data: mustJSON(t, map[string]any{"hex": seaEmpty})}, engine.ErrBadPlacement)

	// Placing on the target hex and naming the unprotected victim works.
	events := step(t, s, engine.Command{Player: 0, Type: CmdMovePirate,
		Data: mustJSON(t, map[string]any{"hex": seaTarget, "victim": engine.PlayerID(1)})})
	if !hasEvent(events, engine.EvCardStolen) {
		t.Error("expected to steal from unprotected ship owner 1")
	}
}

// TestFriendlyPirateFallbackPlaceAnywhere: when every reachable ship owner is
// protected, the pirate may move to any legal sea hex and steals from no one.
func TestFriendlyPirateFallbackPlaceAnywhere(t *testing.T) {
	seaA := board.Hex{Q: 2, R: 0}
	s := builtState(t, 3, seaA)
	s.RobberPending = true
	s.Config.FriendlyRobber = true
	shipVictim(t, s, seaA, 1, 1) // only a protected ship owner exists

	if pirateHasTarget(s, 0) {
		t.Fatal("setup: no unprotected pirate target should be reachable")
	}
	events := step(t, s, engine.Command{Player: 0, Type: CmdMovePirate,
		Data: mustJSON(t, map[string]any{"hex": seaA})})
	if hasEvent(events, engine.EvCardStolen) {
		t.Error("no card should be stolen from a protected ship owner")
	}
}

// TestFriendlyPirateIgnoresHiddenVP: pirate protection keys off public VP only,
// so a hidden VP card must not change it.
func TestFriendlyPirateIgnoresHiddenVP(t *testing.T) {
	seaA := board.Hex{Q: 2, R: 0}
	s := builtState(t, 3, seaA)
	s.RobberPending = true
	s.Config.FriendlyRobber = true
	shipVictim(t, s, seaA, 1, 1) // public VP 1 → protected

	protectedBefore := !pirateVictims(s, seaA, 0)[1]
	if !protectedBefore {
		t.Fatal("setup: 1-VP player should be protected")
	}
	s.Players[1].DevCards[engine.DevVictoryPoint] = 1 // total VP 2, public VP unchanged
	protectedAfter := !pirateVictims(s, seaA, 0)[1]
	if protectedAfter != protectedBefore {
		t.Error("hidden VP card changed pirate protection (information leak)")
	}
}
