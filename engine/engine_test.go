package engine

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/ftqo/costan.io/engine/board"
)

func mustJSON(t *testing.T, v any) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

// step runs a command through Decide+Apply, failing the test on error.
func step(t *testing.T, s *State, cmd Command) []Event {
	t.Helper()
	events, err := Decide(s, cmd)
	if err != nil {
		t.Fatalf("Decide(%s by %d): %v", cmd.Type, cmd.Player, err)
	}
	for _, e := range events {
		if err := Apply(s, e); err != nil {
			t.Fatalf("Apply(%s): %v", e.Type, err)
		}
	}
	return events
}

func newGame(t *testing.T, players int, seed uint64) (*State, []Event) {
	t.Helper()
	events, err := New(GameConfig{Players: players}, SeedsFrom(seed))
	if err != nil {
		t.Fatal(err)
	}
	s := Empty()
	for _, e := range events {
		if err := Apply(s, e); err != nil {
			t.Fatal(err)
		}
	}
	return s, events
}

// findSettlementSpot returns a legal settlement vertex.
func findSettlementSpot(s *State) board.Vertex {
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, v := range h.Vertices() {
			if checkSettlementSpot(s, v) == nil {
				return v
			}
		}
	}
	panic("no settlement spot available")
}

// roadFor returns a free land edge touching v.
func roadFor(s *State, v board.Vertex) board.Edge {
	for _, e := range v.Edges() {
		if _, taken := s.Roads[e]; !taken && s.Board.LandEdge(e) {
			return e
		}
	}
	panic("no road spot available")
}

// runSetup plays the snake draft to completion.
func runSetup(t *testing.T, s *State) {
	t.Helper()
	for s.Phase == PhaseSetup {
		p := s.Cur
		v := findSettlementSpot(s)
		step(t, s, Command{Player: p, Type: CmdPlaceSettlement, Data: mustJSON(t, map[string]any{"v": v})})
		e := roadFor(s, v)
		step(t, s, Command{Player: p, Type: CmdPlaceRoad, Data: mustJSON(t, map[string]any{"e": e})})
	}
}

func TestNewGameInitialState(t *testing.T) {
	s, events := newGame(t, 4, 1)
	if len(events) != 2 {
		t.Fatalf("initial events = %d, want 2", len(events))
	}
	if s.Phase != PhaseSetup || s.Cur != 0 || len(s.Players) != 4 {
		t.Errorf("state = phase %s cur %d players %d", s.Phase, s.Cur, len(s.Players))
	}
	for _, r := range board.Resources {
		if s.Bank[r] != 19 {
			t.Errorf("bank[%d] = %d, want 19", r, s.Bank[r])
		}
	}
}

func TestNewGameValidation(t *testing.T) {
	if _, err := New(GameConfig{Players: 11}, SeedsFrom(1)); err == nil {
		t.Error("11 players should fail")
	}
	if _, err := New(GameConfig{Players: 1}, SeedsFrom(1)); err == nil {
		t.Error("1 player should fail")
	}
	// 2 is the floor, not below it: 1v1 is supported.
	if _, err := New(GameConfig{Players: 2}, SeedsFrom(1)); err != nil {
		t.Errorf("2 players should be accepted: %v", err)
	}
	if _, err := New(GameConfig{Players: 3, Ruleset: "islands"}, SeedsFrom(1)); err == nil {
		t.Error("unknown ruleset should fail")
	}
}

func TestNewGameScalesComponents(t *testing.T) {
	for _, tc := range []struct {
		players, bank, knights int
	}{
		{3, 19, 14}, {6, 24, 20}, {8, 29, 26}, {10, 34, 32},
	} {
		events, err := New(GameConfig{Players: tc.players}, SeedsFrom(9))
		if err != nil {
			t.Fatalf("players=%d: %v", tc.players, err)
		}
		s, err := Replay(events)
		if err != nil {
			t.Fatal(err)
		}
		if s.Bank[board.Wood] != tc.bank {
			t.Errorf("players=%d bank=%d, want %d", tc.players, s.Bank[board.Wood], tc.bank)
		}
		if s.DevDeck[DevKnight] != tc.knights {
			t.Errorf("players=%d knights=%d, want %d", tc.players, s.DevDeck[DevKnight], tc.knights)
		}
		if want := board.RadiusFor(tc.players); s.Board.Radius != want {
			t.Errorf("players=%d radius=%d, want %d", tc.players, s.Board.Radius, want)
		}
	}
}

func TestNewGameWithPreset(t *testing.T) {
	events, err := New(GameConfig{Players: 4, Preset: "beginner"}, SeedsFrom(9))
	if err != nil {
		t.Fatal(err)
	}
	s, _ := Replay(events)
	if len(s.Board.Tiles) != 19 {
		t.Fatalf("tiles = %d", len(s.Board.Tiles))
	}
	// The beginner map is fixed: desert center, ore-10 in the top-left.
	if s.Board.Tiles[board.Hex{Q: 0, R: 0}].Res != board.ResNone {
		t.Error("desert should be the center hex")
	}
	if tile := s.Board.Tiles[board.Hex{Q: 0, R: -2}]; tile.Res != board.Ore || tile.Number != 10 {
		t.Errorf("top-left = %+v, want ore 10", tile)
	}
	if _, err := New(GameConfig{Players: 5, Preset: "beginner"}, SeedsFrom(9)); err == nil {
		t.Error("beginner preset should reject 5 players")
	}
}

func TestSetupSnakeOrder(t *testing.T) {
	s, _ := newGame(t, 3, 2)
	var order []PlayerID
	for s.Phase == PhaseSetup {
		order = append(order, s.Cur)
		v := findSettlementSpot(s)
		step(t, s, Command{Player: s.Cur, Type: CmdPlaceSettlement, Data: mustJSON(t, map[string]any{"v": v})})
		step(t, s, Command{Player: s.Cur, Type: CmdPlaceRoad, Data: mustJSON(t, map[string]any{"e": roadFor(s, v)})})
	}
	want := []PlayerID{0, 1, 2, 2, 1, 0}
	if len(order) != len(want) {
		t.Fatalf("order = %v, want %v", order, want)
	}
	for i := range want {
		if order[i] != want[i] {
			t.Fatalf("order = %v, want %v", order, want)
		}
	}
	if s.Phase != PhasePlay || s.Cur != 0 {
		t.Errorf("after setup: phase %s cur %d", s.Phase, s.Cur)
	}
}

func TestSetupRules(t *testing.T) {
	s, _ := newGame(t, 3, 3)
	v := findSettlementSpot(s)

	// Wrong player.
	_, err := Decide(s, Command{Player: 1, Type: CmdPlaceSettlement, Data: mustJSON(t, map[string]any{"v": v})})
	if !errors.Is(err, ErrNotYourTurn) {
		t.Errorf("wrong player err = %v", err)
	}
	// Road before settlement.
	_, err = Decide(s, Command{Player: 0, Type: CmdPlaceRoad, Data: mustJSON(t, map[string]any{"e": roadFor(s, v)})})
	if !errors.Is(err, ErrWrongPhase) {
		t.Errorf("early road err = %v", err)
	}

	step(t, s, Command{Player: 0, Type: CmdPlaceSettlement, Data: mustJSON(t, map[string]any{"v": v})})

	// Adjacent settlement violates the distance rule (next player's attempt).
	step(t, s, Command{Player: 0, Type: CmdPlaceRoad, Data: mustJSON(t, map[string]any{"e": roadFor(s, v)})})
	adj := v.Neighbors()[0]
	_, err = Decide(s, Command{Player: 1, Type: CmdPlaceSettlement, Data: mustJSON(t, map[string]any{"v": adj})})
	if !errors.Is(err, ErrTooClose) && !errors.Is(err, ErrBadPlacement) {
		t.Errorf("adjacent settlement err = %v", err)
	}
	// Same vertex occupied.
	_, err = Decide(s, Command{Player: 1, Type: CmdPlaceSettlement, Data: mustJSON(t, map[string]any{"v": v})})
	if !errors.Is(err, ErrTooClose) && !errors.Is(err, ErrOccupied) {
		t.Errorf("occupied settlement err = %v", err)
	}
}

func TestSetupDetachedRoadRejected(t *testing.T) {
	s, _ := newGame(t, 3, 4)
	v := findSettlementSpot(s)
	step(t, s, Command{Player: 0, Type: CmdPlaceSettlement, Data: mustJSON(t, map[string]any{"v": v})})

	// A road that doesn't touch the new settlement.
	var far board.Edge
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, e := range h.Edges() {
			if !e.Touches(v) && s.Board.LandEdge(e) {
				far = e
			}
		}
	}
	_, err := Decide(s, Command{Player: 0, Type: CmdPlaceRoad, Data: mustJSON(t, map[string]any{"e": far})})
	if !errors.Is(err, ErrBadPlacement) {
		t.Errorf("detached setup road err = %v", err)
	}
}

func TestSecondSettlementGrantsResources(t *testing.T) {
	s, _ := newGame(t, 3, 5)
	totalBefore := s.Bank.Count()
	runSetup(t, s)

	granted := 0
	for p := range s.Players {
		granted += s.Players[p].Hand.Count()
	}
	if granted == 0 {
		t.Error("no starting resources granted")
	}
	if s.Bank.Count()+granted != totalBefore {
		t.Errorf("cards not conserved: bank %d + hands %d != %d", s.Bank.Count(), granted, totalBefore)
	}
}

func TestRollAndDistribute(t *testing.T) {
	s, _ := newGame(t, 3, 6)
	runSetup(t, s)

	if _, err := Decide(s, Command{Player: 1, Type: CmdRollDice}); !errors.Is(err, ErrNotYourTurn) {
		t.Errorf("wrong roller err = %v", err)
	}
	// Build before rolling is rejected.
	_, err := Decide(s, Command{Player: 0, Type: CmdEndTurn})
	if !errors.Is(err, ErrMustRoll) {
		t.Errorf("end before roll err = %v", err)
	}

	events := step(t, s, Command{Player: 0, Type: CmdRollDice})
	d := decode[DiceRolledData](events[0])
	if d.D1 < 1 || d.D1 > 6 || d.D2 < 1 || d.D2 > 6 {
		t.Errorf("dice = %d,%d", d.D1, d.D2)
	}
	if !s.Rolled {
		t.Error("Rolled not set")
	}
	if _, err := Decide(s, Command{Player: 0, Type: CmdRollDice}); !errors.Is(err, ErrAlreadyRolled) {
		t.Errorf("double roll err = %v", err)
	}
}

func TestDistributionMatchesTokens(t *testing.T) {
	s, _ := newGame(t, 3, 7)
	runSetup(t, s)

	for roll := 2; roll <= 12; roll++ {
		if roll == 7 {
			continue
		}
		gains := distribute(s, roll)
		// Cross-check against a naive recount.
		want := map[PlayerID]int{}
		for h, tile := range s.Board.Tiles {
			if tile.Number != roll || h == s.Board.Robber || tile.Res == board.ResNone {
				continue
			}
			for _, v := range h.Vertices() {
				if b, ok := s.Buildings[v]; ok {
					n := 1
					if b.City {
						n = 2
					}
					want[b.Owner] += n
				}
			}
		}
		got := map[PlayerID]int{}
		for _, g := range gains {
			got[g.Player] = g.Gain.Count()
		}
		for p, n := range want {
			if got[p] != n {
				t.Errorf("roll %d: player %d gets %d, want %d", roll, p, got[p], n)
			}
		}
	}
}

func TestBankShortageRule(t *testing.T) {
	s, _ := newGame(t, 3, 8)
	runSetup(t, s)

	// Find a number with two distinct claimants of one resource, if the board
	// has one; otherwise synthesize: set bank to 0 and verify nobody gains.
	for r := range s.Bank {
		s.Bank[r] = 0
	}
	for roll := 2; roll <= 12; roll++ {
		if roll == 7 {
			continue
		}
		for _, g := range distribute(s, roll) {
			// Single claimants may take a remainder (0 here), so any gain > 0 is a bug.
			if g.Gain.Count() > 0 {
				t.Errorf("roll %d: gain from empty bank: %+v", roll, g)
			}
		}
	}
}

func TestSevenForcesDiscardAndRobber(t *testing.T) {
	s, _ := newGame(t, 3, 9)
	runSetup(t, s)

	// Give player 1 a big hand and force a 7 by direct event application.
	s.Players[1].Hand = Hand{board.Wood: 5, board.Brick: 4}
	roll := mustEvent(EvDiceRolled, DiceRolledData{Player: 0, D1: 3, D2: 4})
	roll.Seq = s.NextSeq
	if err := Apply(s, roll); err != nil {
		t.Fatal(err)
	}
	req := mustEvent(EvDiscardsReq, DiscardsReqData{Required: []PlayerDiscard{{Player: 1, Count: 4}}})
	req.Seq = s.NextSeq
	if err := Apply(s, req); err != nil {
		t.Fatal(err)
	}

	if !s.RobberPending {
		t.Error("robber not pending after 7")
	}
	// Robber can't move while discards pending.
	hex := anyOtherHex(s)
	_, err := Decide(s, Command{Player: 0, Type: CmdMoveRobber, Data: mustJSON(t, map[string]any{"hex": hex})})
	if !errors.Is(err, ErrDiscardPending) {
		t.Errorf("robber during discard err = %v", err)
	}
	// Wrong-size discard rejected.
	_, err = Decide(s, Command{Player: 1, Type: CmdDiscardCards, Data: mustJSON(t, map[string]any{"cards": Hand{board.Wood: 1}})})
	if !errors.Is(err, ErrBadDiscard) {
		t.Errorf("short discard err = %v", err)
	}
	// Player without requirement can't discard.
	_, err = Decide(s, Command{Player: 2, Type: CmdDiscardCards, Data: mustJSON(t, map[string]any{"cards": Hand{}})})
	if !errors.Is(err, ErrNoDiscardNeeded) {
		t.Errorf("uninvolved discard err = %v", err)
	}

	step(t, s, Command{Player: 1, Type: CmdDiscardCards, Data: mustJSON(t, map[string]any{"cards": Hand{board.Wood: 3, board.Brick: 1}})})
	if s.Players[1].Hand.Count() != 5 {
		t.Errorf("hand after discard = %d, want 5", s.Players[1].Hand.Count())
	}

	// Now the robber moves; same hex is illegal.
	_, err = Decide(s, Command{Player: 0, Type: CmdMoveRobber, Data: mustJSON(t, map[string]any{"hex": s.Board.Robber})})
	if !errors.Is(err, ErrBadPlacement) {
		t.Errorf("same-hex robber err = %v", err)
	}
	step(t, s, Command{Player: 0, Type: CmdMoveRobber, Data: mustJSON(t, robberPayload(s, 0))})
	if s.RobberPending {
		t.Error("robber still pending")
	}
}

// anyOtherHex returns a land hex that isn't the robber's.
func anyOtherHex(s *State) board.Hex {
	for h := range s.Board.Tiles {
		if h != s.Board.Robber {
			return h
		}
	}
	panic("unreachable")
}

// robberPayload picks a legal robber destination and victim for the mover.
func robberPayload(s *State, mover PlayerID) map[string]any {
	for h := range s.Board.Tiles {
		if h == s.Board.Robber {
			continue
		}
		victims := robberVictims(s, h, mover)
		if len(victims) == 0 {
			return map[string]any{"hex": h}
		}
		for v := range victims {
			return map[string]any{"hex": h, "victim": v}
		}
	}
	panic("no robber destination")
}

func TestStealHiddenVisibility(t *testing.T) {
	s, _ := newGame(t, 3, 10)
	runSetup(t, s)
	s.Players[1].Hand = Hand{board.Ore: 1}

	// Force the robber pending state.
	roll := mustEvent(EvDiceRolled, DiceRolledData{Player: 0, D1: 3, D2: 4})
	roll.Seq = s.NextSeq
	if err := Apply(s, roll); err != nil {
		t.Fatal(err)
	}

	// Find a hex with player 1 adjacent.
	var target board.Hex
	found := false
	for h := range s.Board.Tiles {
		if h == s.Board.Robber {
			continue
		}
		if robberVictims(s, h, 0)[1] {
			target, found = h, true
			break
		}
	}
	if !found {
		t.Fatal("no hex lets player 0 steal from player 1")
	}

	thiefOreBefore := s.Players[0].Hand[board.Ore]
	events := step(t, s, Command{Player: 0, Type: CmdMoveRobber, Data: mustJSON(t, map[string]any{"hex": target, "victim": PlayerID(1)})})
	var stolen *Event
	for i := range events {
		if events[i].Type == EvCardStolen {
			stolen = &events[i]
		}
	}
	if stolen == nil {
		t.Fatal("no steal event")
	}
	if len(stolen.Visible) != 2 || stolen.Visible[0] != 0 || stolen.Visible[1] != 1 {
		t.Errorf("steal visible to %v, want [0 1]", stolen.Visible)
	}
	// Player 1 only had a single ore, so that is what must move.
	if s.Players[0].Hand[board.Ore] != thiefOreBefore+1 || s.Players[1].Hand.Count() != 0 {
		t.Errorf("steal not applied: thief %v victim %v", s.Players[0].Hand, s.Players[1].Hand)
	}
}

func TestBuildingRules(t *testing.T) {
	s, _ := newGame(t, 3, 11)
	runSetup(t, s)
	step(t, s, Command{Player: 0, Type: CmdRollDice})
	settleRoll(t, s, nil)

	// No resources → all builds fail.
	s.Players[0].Hand = Hand{}
	v := findSettlementSpot(s)
	_, err := Decide(s, Command{Player: 0, Type: CmdBuildSettlement, Data: mustJSON(t, map[string]any{"v": v})})
	if !errors.Is(err, ErrNoResources) && !errors.Is(err, ErrBadPlacement) {
		t.Errorf("poor settlement err = %v", err)
	}

	// Fund a road extending player 0's network.
	s.Players[0].Hand = CostRoad
	var from board.Vertex
	for bv, b := range s.Buildings {
		if b.Owner == 0 {
			from = bv
		}
	}
	var target board.Edge
	ok := false
	for _, e := range from.Edges() {
		if _, taken := s.Roads[e]; !taken && s.Board.LandEdge(e) {
			target, ok = e, true
			break
		}
	}
	if !ok {
		t.Fatalf("no free land edge next to player 0's settlement at %v", from)
	}
	step(t, s, Command{Player: 0, Type: CmdBuildRoad, Data: mustJSON(t, map[string]any{"e": target})})
	if s.Players[0].Hand.Count() != 0 {
		t.Errorf("road cost not paid: %v", s.Players[0].Hand)
	}
	if owner, okk := s.Roads[target]; !okk || owner != 0 {
		t.Error("road not on board")
	}

	// Disconnected road rejected even with funds.
	s.Players[0].Hand = CostRoad
	var detached board.Edge
	found := false
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, e := range h.Edges() {
			if _, taken := s.Roads[e]; taken || !s.Board.LandEdge(e) {
				continue
			}
			if !s.roadConnects(e, 0) {
				detached, found = e, true
			}
		}
	}
	if found {
		_, err = Decide(s, Command{Player: 0, Type: CmdBuildRoad, Data: mustJSON(t, map[string]any{"e": detached})})
		if !errors.Is(err, ErrBadPlacement) {
			t.Errorf("detached road err = %v", err)
		}
	}

	// City upgrade on own settlement.
	s.Players[0].Hand = CostCity
	step(t, s, Command{Player: 0, Type: CmdBuildCity, Data: mustJSON(t, map[string]any{"v": from})})
	if b := s.Buildings[from]; !b.City || b.Owner != 0 {
		t.Errorf("city not built: %+v", b)
	}
	// City on opponent settlement rejected.
	s.Players[0].Hand = CostCity
	var oppV board.Vertex
	for bv, b := range s.Buildings {
		if b.Owner == 1 && !b.City {
			oppV = bv
		}
	}
	_, err = Decide(s, Command{Player: 0, Type: CmdBuildCity, Data: mustJSON(t, map[string]any{"v": oppV})})
	if !errors.Is(err, ErrBadPlacement) {
		t.Errorf("opponent city err = %v", err)
	}
}

func TestVictory(t *testing.T) {
	s, _ := newGame(t, 3, 12)
	runSetup(t, s)
	step(t, s, Command{Player: 0, Type: CmdRollDice})
	settleRoll(t, s, nil)

	// Player 0 has 2 settlements (2 VP). Upgrade both to cities (4 VP) and
	// drop the target so the next build wins.
	s.Config.TargetVP = 5
	var spots []board.Vertex
	for v, b := range s.Buildings {
		if b.Owner == 0 {
			spots = append(spots, v)
		}
	}
	for _, v := range spots {
		s.Players[0].Hand = CostCity
		step(t, s, Command{Player: 0, Type: CmdBuildCity, Data: mustJSON(t, map[string]any{"v": v})})
	}
	if s.Phase == PhaseFinished {
		t.Fatal("game ended too early")
	}

	// Build toward a 5th point: settlement needs an adjacent own road two deep.
	s.Players[0].Hand = Hand{board.Wood: 10, board.Brick: 10, board.Sheep: 5, board.Wheat: 5}
	for s.Phase != PhaseFinished {
		built := false
		for _, h := range board.HexesInRadius(s.Board.Radius) {
			for _, v := range h.Vertices() {
				if checkSettlementSpot(s, v) != nil || !s.hasAdjacentRoad(v, 0) {
					continue
				}
				step(t, s, Command{Player: 0, Type: CmdBuildSettlement, Data: mustJSON(t, map[string]any{"v": v})})
				built = true
				break
			}
			if built {
				break
			}
		}
		if built {
			continue
		}
		// Extend the road network.
		extended := false
		for e, owner := range s.Roads {
			if owner != 0 {
				continue
			}
			for _, v := range []board.Vertex{e.A, e.B} {
				for _, ne := range v.Edges() {
					if _, taken := s.Roads[ne]; taken || !s.Board.LandEdge(ne) || !s.roadConnects(ne, 0) {
						continue
					}
					step(t, s, Command{Player: 0, Type: CmdBuildRoad, Data: mustJSON(t, map[string]any{"e": ne})})
					extended = true
					break
				}
				if extended {
					break
				}
			}
			if extended {
				break
			}
		}
		if !extended {
			t.Fatalf("board exhausted before player 0 reached victory (VP %d)", s.PublicVP(0))
		}
	}

	if s.Winner != 0 {
		t.Errorf("winner = %d, want 0", s.Winner)
	}
	if _, err := Decide(s, Command{Player: 1, Type: CmdRollDice}); !errors.Is(err, ErrGameFinished) {
		t.Errorf("post-game command err = %v", err)
	}
}

func TestReplayEqualsLiveState(t *testing.T) {
	s, log := newGame(t, 3, 13)
	runSetup2 := func() {
		for s.Phase == PhaseSetup {
			p := s.Cur
			v := findSettlementSpot(s)
			cmd := Command{Player: p, Type: CmdPlaceSettlement, Data: mustJSON(t, map[string]any{"v": v})}
			evs, err := Decide(s, cmd)
			if err != nil {
				t.Fatal(err)
			}
			for _, e := range evs {
				Apply(s, e)
			}
			log = append(log, evs...)
			cmd = Command{Player: p, Type: CmdPlaceRoad, Data: mustJSON(t, map[string]any{"e": roadFor(s, v)})}
			evs, err = Decide(s, cmd)
			if err != nil {
				t.Fatal(err)
			}
			for _, e := range evs {
				Apply(s, e)
			}
			log = append(log, evs...)
		}
	}
	runSetup2()

	replayed, err := Replay(log)
	if err != nil {
		t.Fatal(err)
	}
	assertStatesEqual(t, s, replayed)
}
