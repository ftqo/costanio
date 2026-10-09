package engine

import (
	"testing"

	"github.com/ftqo/costan.io/engine/board"
)

// cleanPlay returns a 3p game in play, current player rolled, no interrupts,
// with all buildings and roads cleared for precise rule setups.
func cleanPlay(t *testing.T, seed uint64) *State {
	t.Helper()
	s := playReady(t, seed)
	s.Buildings = map[board.Vertex]Building{}
	s.Roads = map[board.Edge]PlayerID{}
	s.LongestRoadHolder = NoPlayer
	return s
}

// cleanPlayBig is cleanPlay on a 6-player (radius-3) board with more room.
func cleanPlayBig(t *testing.T, seed uint64) *State {
	t.Helper()
	s, _ := newGame(t, 6, seed)
	runSetup(t, s)
	step(t, s, Command{Player: 0, Type: CmdRollDice})
	for s.RobberPending || len(s.PendingDiscards) > 0 {
		cmd, ok := AutoCommand(s)
		if !ok {
			t.Fatal("stuck resolving interrupts")
		}
		step(t, s, cmd)
	}
	s.Buildings = map[board.Vertex]Building{}
	s.Roads = map[board.Edge]PlayerID{}
	s.LongestRoadHolder = NoPlayer
	return s
}

// TestLongestRoadLostWhenCutBelowFive: an opponent settlement that breaks the
// holder's road below 5 removes the title (and hands it to a sole challenger).
func TestLongestRoadLostWhenCutBelowFive(t *testing.T) {
	s := cleanPlay(t, 300)
	start := board.Vertex{Q: 0, R: 0, Side: board.N}
	edges := chainFrom(t, s, 0, start, 6) // player 0: a 6-road chain
	s.LongestRoadHolder = 0
	if longestRoadLength(s, 0) != 6 {
		t.Fatalf("setup: length %d", longestRoadLength(s, 0))
	}

	// An opponent settlement at an interior joint cuts the chain.
	joint := edges[2].A
	if !edges[3].Touches(joint) {
		joint = edges[2].B
	}
	s.Buildings[joint] = Building{Owner: 1}

	after := s.Clone()
	events := longestRoadEvents(after, longestRoadLength)
	if len(events) != 1 {
		t.Fatalf("expected a title change, got %+v", events)
	}
	d := decode[TitleData](events[0])
	if longestRoadLength(after, 0) >= 5 {
		t.Fatalf("player 0 still at %d after the cut, want < 5", longestRoadLength(after, 0))
	}
	if d.Holder != NoPlayer {
		t.Errorf("title should be set aside (no challenger ≥5), got holder %d", d.Holder)
	}
}

// TestLongestRoadTieAfterBreak: if a break leaves two challengers tied
// for the longest, no one holds the card.
func TestLongestRoadTieAfterBreak(t *testing.T) {
	s := cleanPlayBig(t, 301)
	// Build two separate 5-chains for players 1 and 2, and a 6-chain for the
	// holder (player 0) that we then break to 4.
	c0 := chainFrom(t, s, 0, board.Vertex{Q: 0, R: 0, Side: board.N}, 6)
	chainFrom(t, s, 1, board.Vertex{Q: -3, R: 3, Side: board.N}, 5)
	chainFrom(t, s, 2, board.Vertex{Q: 3, R: -3, Side: board.S}, 5)
	s.LongestRoadHolder = 0
	if longestRoadLength(s, 1) != 5 || longestRoadLength(s, 2) != 5 {
		t.Fatalf("challenger chains are %d and %d, want 5 and 5",
			longestRoadLength(s, 1), longestRoadLength(s, 2))
	}
	// Break player 0 down to 4 with two interior opponent buildings.
	s.Buildings[c0[1].A] = Building{Owner: 1}
	s.Buildings[c0[3].B] = Building{Owner: 2}
	if longestRoadLength(s, 0) >= 5 {
		t.Fatalf("holder at %d after the break, want < 5", longestRoadLength(s, 0))
	}
	events := longestRoadEvents(s.Clone(), longestRoadLength)
	if len(events) != 1 {
		t.Fatalf("expected a title change, got %+v", events)
	}
	if d := decode[TitleData](events[0]); d.Holder != NoPlayer {
		t.Errorf("tie among challengers should set the card aside, got holder %d", d.Holder)
	}
}

// TestRobberMustStealWhenVictimAvailable: you cannot decline the steal when an
// opponent with cards sits on the chosen hex.
func TestRobberMustStealWhenVictimAvailable(t *testing.T) {
	s, _ := newGame(t, 3, 302)
	runSetup(t, s)
	roll := mustEvent(EvDiceRolled, DiceRolledData{Player: 0, D1: 3, D2: 4})
	roll.Seq = s.NextSeq
	Apply(s, roll)

	// Find a hex where player 1 has a building and cards.
	s.Players[1].Hand = Hand{board.Ore: 1}
	var hex board.Hex
	found := false
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		if h == s.Board.Robber {
			continue
		}
		if robberVictims(s, h, 0)[1] {
			hex, found = h, true
			break
		}
	}
	if !found {
		t.Fatal("no hex holds a stealable player 1")
	}
	// Moving there without naming the victim is illegal.
	reject(t, s, Command{Player: 0, Type: CmdMoveRobber, Data: mustJSON(t, map[string]any{"hex": hex})}, ErrBadVictim)
}

// TestYearOfPlentyBankLimited: cannot draw a resource the bank is out of.
func TestYearOfPlentyBankLimited(t *testing.T) {
	s := playReady(t, 303)
	s.Players[0].DevCards[DevYearOfPlenty] = 1
	s.Bank[board.Ore] = 1 // only one ore left
	reject(t, s, Command{Player: 0, Type: CmdPlayDevCard,
		Data: mustJSON(t, map[string]any{"card": DevYearOfPlenty, "gain": Hand{board.Ore: 2}})}, ErrNoResources)
	// One ore plus a stocked resource is fine.
	step(t, s, Command{Player: 0, Type: CmdPlayDevCard,
		Data: mustJSON(t, map[string]any{"card": DevYearOfPlenty, "gain": Hand{board.Ore: 1, board.Wood: 1}})})
	if s.Players[0].Hand[board.Ore] < 1 || s.Players[0].Hand[board.Wood] < 1 {
		t.Errorf("year of plenty not granted: %v", s.Players[0].Hand)
	}
}

// TestLargestArmyTieKeepsHolder: a challenger must strictly exceed the holder's
// knight count to take Largest Army.
func TestLargestArmyTieKeepsHolder(t *testing.T) {
	s := playReady(t, 304)
	// Player 0 holds it with 3 knights.
	s.Players[0].KnightsPlayed = 3
	s.LargestArmyHolder = 0
	// Player 1 plays their 3rd knight (tie), which must not take it.
	s.Players[1].KnightsPlayed = 2
	s.Players[1].DevCards[DevKnight] = 1
	// Make it player 1's turn.
	s.Cur = 1
	events := step(t, s, Command{Player: 1, Type: CmdPlayDevCard, Data: mustJSON(t, map[string]any{"card": DevKnight})})
	for _, e := range events {
		if e.Type == EvLargestArmy {
			t.Errorf("tie (3 vs 3) must not move largest army: %+v", decode[TitleData](e))
		}
	}
	if s.LargestArmyHolder != 0 {
		t.Errorf("largest army moved on a tie: holder %d", s.LargestArmyHolder)
	}
}

// TestPieceLimits: a player cannot build past their road/settlement/city caps.
func TestPieceLimits(t *testing.T) {
	s := playReady(t, 304)
	p := s.Cur
	s.Players[p].Hand = Hand{board.Wood: 9, board.Brick: 9, board.Sheep: 9, board.Wheat: 9, board.Ore: 9}

	// Exhaust roads.
	s.Players[p].RoadsLeft = 0
	reject(t, s, Command{Player: p, Type: CmdBuildRoad, Data: mustJSON(t, map[string]any{"e": ownExtendEdge(t, s, p)})}, ErrNoPieces, ErrBadPlacement)

	// Exhaust cities; a city build must fail even on a valid own settlement.
	var ownSettlement board.Vertex
	for v, b := range s.Buildings {
		if b.Owner == p && !b.City {
			ownSettlement = v
		}
	}
	s.Players[p].CitiesLeft = 0
	reject(t, s, Command{Player: p, Type: CmdBuildCity, Data: mustJSON(t, map[string]any{"v": ownSettlement})}, ErrNoPieces)

	// Exhaust settlements; a settlement build must fail on an otherwise legal spot.
	spot := findSettlementSpot(s)
	s.Roads[roadFor(s, spot)] = p // give the spot an adjacent own road
	s.Players[p].SettlementsLeft = 0
	reject(t, s, Command{Player: p, Type: CmdBuildSettlement, Data: mustJSON(t, map[string]any{"v": spot})}, ErrNoPieces)
}

// TestSingleClaimantTakesBankRemainder: with the bank short and exactly one
// claimant, that claimant takes what's left (the multi-claimant rule withholds
// instead).
func TestSingleClaimantTakesBankRemainder(t *testing.T) {
	s, _ := newGame(t, 3, 306)
	runSetup(t, s)
	// Bank at 1 of some resource, and a roll producing it for one player
	// only: they take the last card.
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		tile, ok := s.Board.Tiles[h]
		if !ok || !tile.Res.Producing() || h == s.Board.Robber {
			continue
		}
		// Put a lone settlement of player 0 here, set bank of that resource to 1.
		v := h.Vertices()[0]
		if _, taken := s.Buildings[v]; taken {
			continue
		}
		for _, n := range v.Neighbors() {
			if _, taken := s.Buildings[n]; taken {
				goto next
			}
		}
		s.Buildings = map[board.Vertex]Building{v: {Owner: 0}}
		s.Bank[tile.Res] = 1
		{
			gains := distribute(s, tile.Number)
			for _, g := range gains {
				if g.Player == 0 && g.Gain[tile.Res] == 1 {
					return // correct: single claimant took the 1 remaining
				}
			}
			t.Fatalf("single claimant did not take the bank remainder for %v: %+v", tile.Res, gains)
		}
	next:
	}
	t.Fatal("no hex has a single claimant")
}
