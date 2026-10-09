package knights

import (
	"errors"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
	"github.com/ftqo/costan.io/engine/scenarios"
)

// newCaravansGame is newGame for base+cak+caravans: the one Knights pairing in
// which the robber has a hex it may never enter.
func newCaravansGame(t *testing.T, seed uint64) *engine.State {
	t.Helper()
	log, err := engine.New(engine.GameConfig{Players: 3, Ruleset: engine.CanonicalRuleset("base+cak+caravans")}, engine.SeedsFrom(seed))
	if err != nil {
		t.Fatal(err)
	}
	s, err := engine.Replay(log)
	if err != nil {
		t.Fatal(err)
	}
	for s.Phase == engine.PhaseSetup {
		cmd, ok := engine.AutoCommand(s)
		if !ok {
			t.Fatal("setup stuck")
		}
		step(t, s, cmd)
	}
	return s
}

// TestBishopAndChaseAvoidOasis: the Knights ways of moving
// the robber are robber moves like any other, so the Caravans oasis ban holds
// for them too, in the legal set and at the validator.
func TestBishopAndChaseAvoidOasis(t *testing.T) {
	s := newCaravansGame(t, 5)
	rolled(t, s)
	p := s.Cur
	oasis, ok := scenarios.OasisOf(s)
	if !ok {
		t.Fatal("no oasis")
	}
	ext(s).Attacks = 1 // the robber is in play
	// Put the robber next to the oasis, with an active knight on a corner it
	// shares with the robber's hex, so the chase is legal and the oasis is the
	// nearest hex it could be pushed to.
	var robberHex board.Hex
	var kv board.Vertex
	found := false
	for _, v := range oasis.Vertices() {
		for _, h := range v.Hexes() {
			if h != oasis && s.Board.Land(h) {
				robberHex, kv, found = h, v, true
			}
		}
	}
	if !found {
		t.Fatal("no land hex beside the oasis")
	}
	s.Board.Robber = robberHex
	x := ext(s)
	x.Knights[kv] = Knight{Owner: p, Level: 1, Active: true}

	giveCard(s, p, CardBishop)
	lt := s.LegalTargetsFor(p)
	if len(lt.ProgressTargets[string(CardBishop)].Hexes) == 0 {
		t.Fatal("no Bishop hexes offered")
	}
	for _, h := range lt.ProgressTargets[string(CardBishop)].Hexes {
		if h == oasis {
			t.Fatal("Bishop offers the oasis")
		}
	}
	if len(lt.ChaseRobberHexes) == 0 {
		t.Fatal("no chase hexes offered")
	}
	for _, h := range lt.ChaseRobberHexes {
		if h == oasis {
			t.Fatal("the knight chase offers the oasis")
		}
	}
	rich := richCard(s, p)
	if _, err := engine.Decide(rich, engine.Command{Player: p, Type: CmdPlayProgress,
		Data: rawJSON(map[string]any{"card": CardBishop, "hex": oasis})}); !errors.Is(err, engine.ErrBadPlacement) {
		t.Fatalf("Bishop onto the oasis: err %v, want ErrBadPlacement", err)
	}
	if _, err := engine.Decide(s, engine.Command{Player: p, Type: CmdChaseRobber,
		Data: rawJSON(map[string]any{"v": kv, "hex": oasis})}); !errors.Is(err, engine.ErrBadPlacement) {
		t.Fatalf("chase onto the oasis: err %v, want ErrBadPlacement", err)
	}
}
