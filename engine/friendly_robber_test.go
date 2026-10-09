package engine

import (
	"testing"

	"github.com/ftqo/costan.io/engine/board"
)

// robberStage builds a 6-player clean board in the play phase with the robber
// pending for player 0, and returns two land hexes that share no vertices so
// buildings placed on them never bleed into each other's victim sets.
func robberStage(t *testing.T, seed uint64) (*State, board.Hex, board.Hex) {
	t.Helper()
	s := cleanPlayBig(t, seed)
	s.RobberPending = true
	s.PendingDiscards = nil

	var land []board.Hex
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		if s.Board.Land(h) && h != s.Board.Robber {
			land = append(land, h)
		}
	}
	for i := range land {
		for j := range land {
			if i == j || !disjointHexes(land[i], land[j]) {
				continue
			}
			return s, land[i], land[j]
		}
	}
	t.Fatal("no two disjoint land hexes on this seed")
	return nil, board.Hex{}, board.Hex{}
}

func disjointHexes(a, b board.Hex) bool {
	seen := map[board.Vertex]bool{}
	for _, v := range a.Vertices() {
		seen[v] = true
	}
	for _, v := range b.Vertices() {
		if seen[v] {
			return false
		}
	}
	return true
}

// makeUnprotected puts a settlement+city (3 public VP, above the threshold) for
// owner on hex h and hands them cards, so they are a legal steal target.
func makeUnprotected(s *State, h board.Hex, owner PlayerID) {
	vs := h.Vertices()
	s.Buildings[vs[0]] = Building{Owner: owner}
	s.Buildings[vs[1]] = Building{Owner: owner, City: true}
	s.Players[owner].Hand = Hand{board.Ore: 2}
}

// makeProtected puts a lone settlement (1 public VP, at/under threshold) for
// owner on hex h and hands them cards. Under the toggle they cannot be robbed.
func makeProtected(s *State, h board.Hex, owner PlayerID) {
	s.Buildings[h.Vertices()[0]] = Building{Owner: owner}
	s.Players[owner].Hand = Hand{board.Ore: 2}
}

// TestFriendlyRobberExcludesProtectedVictim: a low-public-VP player is a victim
// with the toggle off, but vanishes from the victim set with it on.
func TestFriendlyRobberExcludesProtectedVictim(t *testing.T) {
	s, hex, _ := robberStage(t, 400)
	makeProtected(s, hex, 1)

	s.Config.FriendlyRobber = false
	if !robberVictims(s, hex, 0)[1] {
		t.Fatal("toggle off: player 1 should be a victim")
	}
	s.Config.FriendlyRobber = true
	if robberVictims(s, hex, 0)[1] {
		t.Error("toggle on: protected (1 VP) player 1 must not be a victim")
	}
}

// TestFriendlyRobberForcesRobbableHex: with an unprotected target reachable,
// the robber may not go on a protected-only hex; you must rob the target.
func TestFriendlyRobberForcesRobbableHex(t *testing.T) {
	s, protHex, targetHex := robberStage(t, 401)
	makeProtected(s, protHex, 1)
	makeUnprotected(s, targetHex, 2)
	s.Config.FriendlyRobber = true

	if s.PublicVPWithModules(1) > 2 {
		t.Fatalf("setup: player 1 public VP %d, want <=2", s.PublicVPWithModules(1))
	}
	if s.PublicVPWithModules(2) <= 2 {
		t.Fatalf("setup: player 2 public VP %d, want >2", s.PublicVPWithModules(2))
	}

	// The protected-only hex has no eligible victim, but a target exists
	// elsewhere, so placing there is illegal.
	reject(t, s, Command{Player: 0, Type: CmdMoveRobber,
		Data: mustJSON(t, map[string]any{"hex": protHex})}, ErrBadPlacement)

	// Placing on the target hex and naming the unprotected victim works.
	events := step(t, s, Command{Player: 0, Type: CmdMoveRobber,
		Data: mustJSON(t, map[string]any{"hex": targetHex, "victim": PlayerID(2)})})
	stole := false
	for _, e := range events {
		if e.Type == EvCardStolen && decode[CardStolenData](e).Victim == 2 {
			stole = true
		}
	}
	if !stole {
		t.Error("expected to steal from unprotected player 2")
	}
}

// TestFriendlyRobberFallbackPlaceAnywhere: when every reachable player is
// protected, the robber may go on any legal hex and steals from no one.
func TestFriendlyRobberFallbackPlaceAnywhere(t *testing.T) {
	s, hex, _ := robberStage(t, 402)
	makeProtected(s, hex, 1) // the only player with buildings/cards, and protected
	s.Config.FriendlyRobber = true

	if friendlyRobberHasTarget(s, 0) {
		t.Fatal("setup: no unprotected target should be reachable")
	}
	events := step(t, s, Command{Player: 0, Type: CmdMoveRobber,
		Data: mustJSON(t, map[string]any{"hex": hex})})
	for _, e := range events {
		if e.Type == EvCardStolen {
			t.Error("no card should be stolen from a protected player")
		}
	}
}

// TestFriendlyRobberIgnoresHiddenVP: protection keys off public VP only. A
// hidden VP card must not change whether a player is protected, or the rule
// would leak hidden information.
func TestFriendlyRobberIgnoresHiddenVP(t *testing.T) {
	s, hex, _ := robberStage(t, 403)
	makeProtected(s, hex, 1) // 1 public VP
	s.Config.FriendlyRobber = true

	protectedBefore := !robberVictims(s, hex, 0)[1]

	// Give player 1 a hidden VP card: total VP is now 2, but public VP is
	// unchanged, so their protection status must be identical.
	s.Players[1].DevCards[DevVictoryPoint] = 1
	if s.VP(1) == s.PublicVPWithModules(1) {
		t.Fatal("setup: hidden VP card did not change total VP")
	}
	protectedAfter := !robberVictims(s, hex, 0)[1]

	if protectedBefore != protectedAfter {
		t.Error("hidden VP card changed protection (information leak)")
	}
}
