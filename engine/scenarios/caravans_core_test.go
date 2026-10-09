package scenarios

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// Caravans is the only module whose scoring action is taken by a seat that is
// not s.Cur: the vote opens as the finisher's turn ends and blocksTurnActions
// lets the next turn run on, so a camel lands mid-turn and moves VP totals and
// route lengths for another player.

// armPlacement puts caravan 0 one camel from completing an interior vertex and
// hands the placement to `placer` while `cur` holds the turn, as in a live game.
//
// It folds real events rather than assigning to State, so the tests exercise the
// live fold. It returns the interior vertex the pending camel will complete and
// the edge it goes on.
func armPlacement(t *testing.T, s *engine.State, placer, cur engine.PlayerID) (board.Vertex, board.Edge) {
	t.Helper()
	x, ok := InitCaravansExt(s)
	if !ok || !x.HasOasis {
		t.Fatal("setup: a procedural base+caravans board must have an oasis")
	}
	// First camel on caravan 0's spoke; the second extends it, and the vertex
	// the two share is the interior one that scores.
	first := x.Arrows[0]
	if first == (board.Edge{}) {
		t.Fatal("setup: caravan 0 has no spoke")
	}
	apply(t, s, engine.NewEvent(EvCamelPlaced, camelPlacedData{Caravan: 0, E: first}))
	fronts := (Caravans{}).caravanFrontEdges(caravansExtRO(s), s, 0)
	if len(fronts) == 0 {
		t.Fatal("setup: caravan 0 cannot be extended")
	}
	next := fronts[0]
	v := sharedVertex(next, first)

	// Open a vote and close it on the placer. EvCamelResolved with no payments
	// is the "nobody bid" outcome (camelReasonNobody), which moves no cards.
	apply(t, s, engine.NewEvent(EvCamelVote, camelVoteData{Finisher: placer}))
	apply(t, s, engine.NewEvent(EvCamelResolved, camelResolvedData{Placer: placer, Reason: camelReasonNobody}))
	s.Cur = cur
	return v, next
}

func apply(t *testing.T, s *engine.State, e engine.Event) {
	t.Helper()
	e.Seq = s.NextSeq
	if err := engine.Apply(s, e); err != nil {
		t.Fatalf("Apply(%s): %v", e.Type, err)
	}
}

// TestCamelPlacementWinWaitsForPlacerTurn: a camel is placed by the
// vote's winner, generally not the seat holding the turn, so it can carry a
// non-current seat over the target.
//
// A player who reaches the target off-turn waits for their own turn (the game
// ends when a player reaches 12 VP during their turn). Nothing addresses a camel
// completing someone else's victory, so this is our decision, recorded in
// docs/rules/scenarios.md: the win is banked and lands at the start of the
// placer's next turn. Play cannot carry on with someone else recorded as winner,
// because the banked seat is checked as soon as the turn reaches it.
func TestCamelPlacementWinWaitsForPlacerTurn(t *testing.T) {
	s, _ := newGame(t, "base+caravans", 5)
	const placer, cur = engine.PlayerID(0), engine.PlayerID(1)
	v, next := armPlacement(t, s, placer, cur)

	// The placer owns the vertex the pending camel completes, so the placement
	// is worth exactly one VP to them and to nobody else.
	s.Buildings[v] = engine.Building{Owner: placer}
	before := s.VP(placer) + VictoryVP(s, placer)
	s.Config.TargetVP = before + 1
	if VictoryVP(s, placer) != 0 {
		t.Fatalf("setup: placer has %d caravan VP before the camel, want 0", VictoryVP(s, placer))
	}

	events, err := engine.Decide(s, engine.Command{Player: placer, Type: CmdPlaceCamel,
		Data: raw(map[string]any{"caravan": 0, "e": next})})
	if err != nil {
		t.Fatalf("place camel: %v", err)
	}
	for _, e := range events {
		if e.Type == engine.EvGameFinished {
			t.Fatalf("the game ended on seat %d's camel while it was seat %d's turn", placer, cur)
		}
		if err := engine.Apply(s, e); err != nil {
			t.Fatal(err)
		}
	}
	if got := s.VP(placer) + VictoryVP(s, placer); got != s.Config.TargetVP {
		t.Fatalf("the camel took the placer to %d, want the target %d", got, s.Config.TargetVP)
	}
	if s.Phase == engine.PhaseFinished {
		t.Fatal("the game finished off the placer's turn")
	}

	// The turn passes to the placer, and the banked win lands as it does.
	s.Rolled = true
	finished := false
	for range len(s.Players) {
		evs, err := engine.Decide(s, engine.Command{Player: s.Cur, Type: engine.CmdEndTurn})
		if err != nil {
			t.Fatalf("end turn for seat %d: %v", s.Cur, err)
		}
		for _, e := range evs {
			if err := engine.Apply(s, e); err != nil {
				t.Fatal(err)
			}
			if e.Type != engine.EvGameFinished {
				continue
			}
			finished = true
			d := engine.DecodeEvent[engine.GameFinishedData](e)
			if d.Winner != placer {
				t.Fatalf("winner = seat %d, want the seat the camel carried over the line (%d)", d.Winner, placer)
			}
			if d.VP != s.Config.TargetVP {
				t.Fatalf("winning VP = %d, want %d", d.VP, s.Config.TargetVP)
			}
		}
		if finished {
			break
		}
		s.Rolled = true
	}
	if !finished {
		t.Fatal("banked win not awarded on the placer's turn")
	}
}

// TestNoWinOnAnotherSeatsCommand is the other half of the same
// rule: you win on your own turn, so a seat sitting out somebody else's command
// cannot be handed the game by it, however many points it has.
func TestNoWinOnAnotherSeatsCommand(t *testing.T) {
	s, _ := newGame(t, "base+caravans", 5)
	const bystander, cur = engine.PlayerID(0), engine.PlayerID(1)
	s.Cur = cur
	// Put the bystander over the line without any event, as in a game
	// carried across an engine upgrade. Setup leaves every seat on two
	// points, so upgrade one of the bystander's settlements to a city.
	for v, b := range s.Buildings {
		if b.Owner == bystander {
			s.Buildings[v] = engine.Building{Owner: bystander, City: true}
			break
		}
	}
	s.Config.TargetVP = s.VP(bystander) + VictoryVP(s, bystander)
	if v := s.VP(cur) + VictoryVP(s, cur); v >= s.Config.TargetVP {
		t.Fatalf("setup: current seat at %d VP, target %d", v, s.Config.TargetVP)
	}

	events, err := engine.Decide(s, engine.Command{Player: cur, Type: engine.CmdRollDice})
	if err != nil {
		t.Fatalf("roll: %v", err)
	}
	for _, e := range events {
		if e.Type == engine.EvGameFinished {
			d := engine.DecodeEvent[engine.GameFinishedData](e)
			t.Fatalf("roll by seat %d ended the game for seat %d", cur, d.Winner)
		}
	}
}

// TestCamelPlacementReawardsLongestRoad: a camel doubles a road sharing its path
// (routeLength), so placing one changes route lengths and the title must be
// recomputed in that batch. finalizeWith recomputes only for batches marked
// route-affecting; a later recompute could see a tie and set the title aside
// instead of awarding it.
func TestCamelPlacementReawardsLongestRoad(t *testing.T) {
	s, _ := newGame(t, "base+caravans", 5)
	const placer, cur = engine.PlayerID(0), engine.PlayerID(1)
	_, next := armPlacement(t, s, placer, cur)

	// Four of the placer's roads in a chain, the first on the camel's path.
	// Four is one short of the title; the camel's doubling makes five.
	chain := roadChain(t, s, next, 4)
	for _, e := range chain {
		s.Roads[e] = placer
	}
	if got := engine.LongestRouteLength(s, placer); got != 4 {
		t.Fatalf("setup: the placer's route is %d, want 4", got)
	}
	if s.LongestRoadHolder != engine.NoPlayer {
		t.Fatalf("setup: the title is already held by seat %d", s.LongestRoadHolder)
	}

	events, err := engine.Decide(s, engine.Command{Player: placer, Type: CmdPlaceCamel,
		Data: raw(map[string]any{"caravan": 0, "e": next})})
	if err != nil {
		t.Fatalf("place camel: %v", err)
	}
	for _, e := range events {
		if e.Type != engine.EvLongestRoad {
			continue
		}
		if got := engine.DecodeEvent[engine.TitleData](e).Holder; got != placer {
			t.Fatalf("longest road awarded to seat %d, want %d", got, placer)
		}
		return
	}
	// The length moved regardless, which players already see on the
	// scoreboard.
	for _, e := range events {
		if e.Type == EvCamelPlaced {
			if err := engine.Apply(s, e); err != nil {
				t.Fatal(err)
			}
		}
	}
	t.Fatalf("route went from 4 to %d with no longest_road event",
		engine.LongestRouteLength(s, placer))
}

// roadChain walks n connected land edges from `start`, avoiding the oasis
// perimeter and any vertex with a building (a foreign settlement would sever
// the route and the assertion would measure the board).
func roadChain(t *testing.T, s *engine.State, start board.Edge, n int) []board.Edge {
	t.Helper()
	x := caravansExtRO(s)
	perim := map[board.Edge]bool{}
	for _, pe := range x.Oasis.Edges() {
		perim[pe] = true
	}
	out := []board.Edge{start}
	used := map[board.Edge]bool{start: true}
	at := start.Other(sharedVertexWithSpoke(x, start))
	for len(out) < n {
		grew := false
		for _, e := range at.Edges() {
			if used[e] || perim[e] || !s.Board.LandEdge(e) {
				continue
			}
			nextV := e.Other(at)
			if _, taken := s.Buildings[nextV]; taken {
				continue
			}
			out = append(out, e)
			used[e] = true
			at = nextV
			grew = true
			break
		}
		if !grew {
			t.Fatalf("could not walk a chain of %d edges from %v (got %d)", n, start, len(out))
		}
	}
	return out
}

// sharedVertexWithSpoke is the end of `e` that touches caravan 0's first camel,
// so roadChain walks away from the oasis rather than back into it.
func sharedVertexWithSpoke(x *CaravansExt, e board.Edge) board.Vertex {
	return sharedVertex(e, x.Chains[0][0])
}
