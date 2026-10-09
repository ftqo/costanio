package engine

import (
	"errors"
	"testing"

	"github.com/ftqo/costan.io/engine/board"
)

func TestDevDeckComposition(t *testing.T) {
	// Index order: Knight, VP, RoadBuilding, YearOfPlenty, Monopoly.
	cases := []struct {
		players int
		want    DevHand
	}{
		{4, DevHand{14, 5, 2, 2, 2}}, // base game = 25 cards
		{6, DevHand{20, 8, 2, 2, 2}}, // 5-6 player bracket = 34 cards (+6 knight, +3 VP)
	}
	for _, c := range cases {
		if got := DevDeckFor(c.players); got != c.want {
			t.Errorf("DevDeckFor(%d) = %v, want %v", c.players, got, c.want)
		}
	}
}

func TestBuyDevCard(t *testing.T) {
	s := playState(t, 30)
	s.Players[0].Hand = CostDevCard
	deckBefore := s.DevDeck.Count()

	events := step(t, s, Command{Player: 0, Type: CmdBuyDevCard})
	if len(events) != 1 || events[0].Type != EvDevCardBought {
		t.Fatalf("events = %+v", events)
	}
	if len(events[0].Visible) != 1 || events[0].Visible[0] != 0 {
		t.Errorf("buy visible to %v, want [0]", events[0].Visible)
	}
	if s.DevDeck.Count() != deckBefore-1 {
		t.Errorf("deck = %d, want %d", s.DevDeck.Count(), deckBefore-1)
	}
	if s.Players[0].NewDevCards.Count() != 1 || s.Players[0].DevCards.Count() != 0 {
		t.Errorf("cards: new=%v playable=%v", s.Players[0].NewDevCards, s.Players[0].DevCards)
	}
	if s.Players[0].Hand.Count() != 0 {
		t.Errorf("cost not paid: %v", s.Players[0].Hand)
	}

	// Locked this turn.
	d := decode[DevCardBoughtData](events[0])
	if d.Card != DevVictoryPoint {
		_, err := Decide(s, Command{Player: 0, Type: CmdPlayDevCard, Data: mustJSON(t, map[string]any{"card": d.Card})})
		if !errors.Is(err, ErrNoSuchCard) {
			t.Errorf("same-turn play err = %v", err)
		}
	}

	// Unlocks next time the turn comes around.
	step(t, s, Command{Player: 0, Type: CmdEndTurn})
	for s.Cur != 0 {
		step(t, s, Command{Player: s.Cur, Type: CmdRollDice})
		drainInterrupts(t, s)
		step(t, s, Command{Player: s.Cur, Type: CmdEndTurn})
	}
	if s.Players[0].DevCards.Count() != 1 {
		t.Errorf("card did not unlock: %v", s.Players[0].DevCards)
	}
}

// drainInterrupts resolves any 7-roll fallout with auto commands.
func drainInterrupts(t *testing.T, s *State) {
	t.Helper()
	for len(s.PendingDiscards) > 0 || s.RobberPending {
		cmd, ok := AutoCommand(s)
		if !ok {
			t.Fatal("stuck resolving interrupts")
		}
		step(t, s, cmd)
	}
}

func TestBuyDevCardRequiresFunds(t *testing.T) {
	s := playState(t, 31)
	s.Players[0].Hand = Hand{}
	if _, err := Decide(s, Command{Player: 0, Type: CmdBuyDevCard}); !errors.Is(err, ErrNoResources) {
		t.Errorf("err = %v", err)
	}
}

func TestDeckExhaustion(t *testing.T) {
	s := playState(t, 32)
	s.DevDeck = DevHand{}
	s.Players[0].Hand = CostDevCard
	if _, err := Decide(s, Command{Player: 0, Type: CmdBuyDevCard}); !errors.Is(err, ErrDeckEmpty) {
		t.Errorf("err = %v", err)
	}
}

func TestKnightAndLargestArmy(t *testing.T) {
	s := playState(t, 33)
	s.Players[0].DevCards[DevKnight] = 3
	s.Players[1].Hand = Hand{board.Ore: 1} // a stealable card somewhere

	for i := range 3 {
		events := step(t, s, Command{Player: 0, Type: CmdPlayDevCard, Data: mustJSON(t, map[string]any{"card": DevKnight})})
		if events[0].Type != EvKnightPlayed {
			t.Fatalf("events = %+v", events)
		}
		if !s.RobberPending {
			t.Fatal("knight should trigger the robber")
		}
		step(t, s, Command{Player: 0, Type: CmdMoveRobber, Data: mustJSON(t, robberPayload(s, 0))})
		// One dev card per turn: once the knight's robber resolves, a second
		// dev card is still barred.
		if i == 0 {
			_, err := Decide(s, Command{Player: 0, Type: CmdPlayDevCard, Data: mustJSON(t, map[string]any{"card": DevKnight})})
			if !errors.Is(err, ErrDevAlreadyPlayed) {
				t.Errorf("second dev err = %v", err)
			}
		}
		// Cycle the turn back to player 0.
		drainInterrupts(t, s)
		if !s.Rolled {
			step(t, s, Command{Player: 0, Type: CmdRollDice})
			drainInterrupts(t, s)
		}
		step(t, s, Command{Player: 0, Type: CmdEndTurn})
		for s.Cur != 0 {
			step(t, s, Command{Player: s.Cur, Type: CmdRollDice})
			drainInterrupts(t, s)
			step(t, s, Command{Player: s.Cur, Type: CmdEndTurn})
		}
	}

	if s.Players[0].KnightsPlayed != 3 {
		t.Errorf("knights played = %d", s.Players[0].KnightsPlayed)
	}
	if s.LargestArmyHolder != 0 {
		t.Errorf("largest army = %d, want 0", s.LargestArmyHolder)
	}
	if got := s.PublicVP(0); got < 2 {
		t.Errorf("public VP with army = %d", got)
	}
}

func TestKnightBeforeRollAllowed(t *testing.T) {
	s := playState(t, 34)
	// Advance to a fresh turn so nothing is rolled.
	step(t, s, Command{Player: 0, Type: CmdEndTurn})
	s.Players[1].DevCards[DevKnight] = 1

	step(t, s, Command{Player: 1, Type: CmdPlayDevCard, Data: mustJSON(t, map[string]any{"card": DevKnight})})
	// Cannot roll while the knight's robber is unresolved.
	if _, err := Decide(s, Command{Player: 1, Type: CmdRollDice}); !errors.Is(err, ErrRobberPending) {
		t.Errorf("roll during robber err = %v", err)
	}
	step(t, s, Command{Player: 1, Type: CmdMoveRobber, Data: mustJSON(t, robberPayload(s, 1))})
	step(t, s, Command{Player: 1, Type: CmdRollDice})
}

func TestRoadBuilding(t *testing.T) {
	s := playState(t, 35)
	s.Players[0].DevCards[DevRoadBuilding] = 1
	s.Players[0].Hand = Hand{} // roads must be free

	step(t, s, Command{Player: 0, Type: CmdPlayDevCard, Data: mustJSON(t, map[string]any{"card": DevRoadBuilding})})
	if s.FreeRoads != 2 {
		t.Fatalf("free roads = %d", s.FreeRoads)
	}
	built := 0
	for built < 2 {
		var next *board.Edge
		for e, owner := range s.Roads {
			if owner != 0 {
				continue
			}
			for _, v := range []board.Vertex{e.A, e.B} {
				for _, ne := range v.Edges() {
					if _, taken := s.Roads[ne]; !taken && s.Board.LandEdge(ne) && s.roadConnects(ne, 0) {
						ne := ne
						next = &ne
					}
				}
			}
		}
		if next == nil {
			t.Fatalf("no room to extend player 0's roads after %d of 2 free roads", built)
		}
		step(t, s, Command{Player: 0, Type: CmdBuildRoad, Data: mustJSON(t, map[string]any{"e": *next})})
		built++
	}
	if s.FreeRoads != 0 {
		t.Errorf("free roads after building = %d", s.FreeRoads)
	}
	if s.Players[0].Hand.Count() != 0 {
		t.Error("free roads should cost nothing")
	}
}

// TestRoadBuildingPreRoll: Road Building may be played before rolling, and its
// free roads must then be placeable (decideBuild must not demand the roll for
// them).
func TestRoadBuildingPreRoll(t *testing.T) {
	// connRoad finds a legal connecting land edge for p whether or not the dice
	// have been rolled (LegalRoads offers nothing pre-roll).
	connRoad := func(s *State, p PlayerID) (board.Edge, bool) {
		for _, h := range board.HexesInRadius(s.Board.Radius) {
			for _, v := range h.Vertices() {
				for _, e := range v.Edges() {
					if _, taken := s.Roads[e]; taken {
						continue
					}
					if e.Valid() && s.Board.LandEdge(e) && s.roadConnects(e, p) {
						return e, true
					}
				}
			}
		}
		return board.Edge{}, false
	}

	// Build a pre-roll play turn (setup done, dice not yet rolled).
	var s *State
	for seed := uint64(1); seed < 60; seed++ {
		cand, _ := newGame(t, 3, seed)
		runSetup(t, cand)
		if cand.Phase == PhasePlay && !cand.Rolled && cand.Cur == 0 {
			if roads := cand.LegalRoads(0); len(roads) >= 2 {
				s = cand
				break
			}
		}
	}
	if s == nil {
		// The search budget ran out. A skip here reads exactly like a pass.
		t.Fatal("no seed in 1..59 yields a pre-roll turn with >=2 legal roads")
	}
	if s.Rolled {
		t.Fatal("precondition: turn should not be rolled yet")
	}

	s.Players[0].DevCards[DevRoadBuilding] = 1
	s.Players[0].Hand = Hand{} // roads must be genuinely free

	// A normal paid road must still require a roll first.
	if e, ok := connRoad(s, 0); ok {
		_, err := Decide(s, Command{Player: 0, Type: CmdBuildRoad,
			Data: mustJSON(t, map[string]any{"e": e})})
		if !errors.Is(err, ErrMustRoll) {
			t.Fatalf("paid road pre-roll err = %v, want ErrMustRoll", err)
		}
	}

	// Play Road Building before rolling.
	step(t, s, Command{Player: 0, Type: CmdPlayDevCard,
		Data: mustJSON(t, map[string]any{"card": DevRoadBuilding})})
	if s.FreeRoads != 2 {
		t.Fatalf("free roads = %d, want 2", s.FreeRoads)
	}
	if s.Rolled {
		t.Fatal("playing the card must not roll the dice")
	}

	// Place both free roads without ever rolling.
	for i := range 2 {
		roads := s.LegalRoads(0)
		if len(roads) == 0 {
			t.Fatalf("no legal free road on iteration %d", i)
		}
		step(t, s, Command{Player: 0, Type: CmdBuildRoad,
			Data: mustJSON(t, map[string]any{"e": roads[0]})})
		if s.Rolled {
			t.Fatal("placing a free road must not roll the dice")
		}
	}
	if s.FreeRoads != 0 {
		t.Errorf("free roads after placement = %d, want 0", s.FreeRoads)
	}
	if s.Players[0].Hand.Count() != 0 {
		t.Errorf("free roads should cost nothing, hand = %v", s.Players[0].Hand)
	}

	// With the free roads spent, a further road again requires rolling.
	if e, ok := connRoad(s, 0); ok {
		_, err := Decide(s, Command{Player: 0, Type: CmdBuildRoad,
			Data: mustJSON(t, map[string]any{"e": e})})
		if !errors.Is(err, ErrMustRoll) {
			t.Fatalf("paid road after free roads err = %v, want ErrMustRoll", err)
		}
	}
}

func TestYearOfPlentyAndMonopoly(t *testing.T) {
	s := playState(t, 36)
	s.Players[0].DevCards[DevYearOfPlenty] = 1
	before := totalCards(s)

	step(t, s, Command{Player: 0, Type: CmdPlayDevCard,
		Data: mustJSON(t, map[string]any{"card": DevYearOfPlenty, "gain": Hand{board.Ore: 2}})})
	if s.Players[0].Hand[board.Ore] < 2 {
		t.Errorf("year of plenty hand = %v", s.Players[0].Hand)
	}
	if totalCards(s) != before {
		t.Error("cards not conserved")
	}

	// Monopoly next turn cycle (one dev per turn).
	step(t, s, Command{Player: 0, Type: CmdEndTurn})
	for s.Cur != 0 {
		step(t, s, Command{Player: s.Cur, Type: CmdRollDice})
		drainInterrupts(t, s)
		step(t, s, Command{Player: s.Cur, Type: CmdEndTurn})
	}
	step(t, s, Command{Player: 0, Type: CmdRollDice})
	drainInterrupts(t, s)

	s.Players[0].DevCards[DevMonopoly] = 1
	s.Players[1].Hand[board.Wheat] = 3
	s.Players[2].Hand[board.Wheat] = 1
	mine := s.Players[0].Hand[board.Wheat]
	beforeMono := totalCards(s)

	step(t, s, Command{Player: 0, Type: CmdPlayDevCard,
		Data: mustJSON(t, map[string]any{"card": DevMonopoly, "res": board.Wheat})})
	if s.Players[0].Hand[board.Wheat] != mine+4 {
		t.Errorf("monopoly take = %d, want +4", s.Players[0].Hand[board.Wheat]-mine)
	}
	if s.Players[1].Hand[board.Wheat] != 0 || s.Players[2].Hand[board.Wheat] != 0 {
		t.Error("victims kept wheat")
	}
	if totalCards(s) != beforeMono {
		t.Error("cards not conserved")
	}
}

func TestVPCardWinsOnYourTurn(t *testing.T) {
	s := playState(t, 37)
	s.Config.TargetVP = 3 // 2 setup settlements + 1 VP card
	s.Players[0].Hand = CostDevCard
	s.DevDeck = DevHand{DevVictoryPoint: 1} // forced draw

	events := step(t, s, Command{Player: 0, Type: CmdBuyDevCard})
	last := events[len(events)-1]
	if last.Type != EvGameFinished {
		t.Fatalf("expected immediate VP win, got %+v", events)
	}
	if s.Phase != PhaseFinished || s.Winner != 0 {
		t.Errorf("state = %s winner %d", s.Phase, s.Winner)
	}
	if s.VP(0) < 3 {
		t.Errorf("VP = %d", s.VP(0))
	}
}
