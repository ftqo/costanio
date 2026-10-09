package engine

import (
	"errors"
	"math/rand/v2"
	"testing"

	"github.com/ftqo/costan.io/engine/board"
)

// The seams added for Explorers, tested here against synthetic modules: this
// package registers no expansion, and a seam must work for every module.

const (
	seamStageName = "testseamstage"
	seamDraftName = "testseamdraft"
	seamGateName  = "testseamgate"
	seamStripName = "testseamstrip"
)

// seamStage closes building and trading while its flag is up, and nothing else.
type seamStage struct{}

var seamStageClosed bool

func (seamStage) Name() string                                    { return seamStageName }
func (seamStage) SetupBoard(*board.Board, GameConfig, *rand.Rand) {}
func (seamStage) Decide(*State, Command) ([]Event, bool, error)   { return nil, false, nil }
func (seamStage) Apply(*State, Event) (bool, error)               { return false, nil }
func (seamStage) Hooks() Hooks {
	return Hooks{BlocksBuildTrade: func(*State) bool { return seamStageClosed }}
}

// seamDraft takes over the setup draft and answers for it.
type seamDraft struct{}

var seamDraftOwns bool

func (seamDraft) Name() string                                    { return seamDraftName }
func (seamDraft) SetupBoard(*board.Board, GameConfig, *rand.Rand) {}
func (seamDraft) Decide(*State, Command) ([]Event, bool, error)   { return nil, false, nil }
func (seamDraft) Apply(*State, Event) (bool, error)               { return false, nil }
func (seamDraft) Hooks() Hooks {
	return Hooks{
		OwnsSetup: func(*State) bool { return seamDraftOwns },
		AutoSetup: func(s *State) (Command, bool) {
			if !seamDraftOwns {
				return Command{}, false
			}
			return Command{Player: s.Cur, Type: "testseam_place"}, true
		},
	}
}

// seamGate bars one named vertex and one named edge, for one named seat.
type seamGate struct{}

var (
	seamGateVertex board.Vertex
	seamGateEdge   board.Edge
	seamGateSeat   = NoPlayer
)

func (seamGate) Name() string                                    { return seamGateName }
func (seamGate) SetupBoard(*board.Board, GameConfig, *rand.Rand) {}
func (seamGate) Decide(*State, Command) ([]Event, bool, error)   { return nil, false, nil }
func (seamGate) Apply(*State, Event) (bool, error)               { return false, nil }
func (seamGate) Hooks() Hooks {
	return Hooks{
		BuildBlockedVertex: func(_ *State, v board.Vertex, p PlayerID) bool {
			return p == seamGateSeat && v == seamGateVertex
		},
		BuildBlockedEdge: func(_ *State, e board.Edge, p PlayerID) bool {
			return p == seamGateSeat && e == seamGateEdge
		},
	}
}

// seamStrip removes the city and the Longest Route from the game.
type seamStrip struct{}

func (seamStrip) Name() string                                    { return seamStripName }
func (seamStrip) SetupBoard(*board.Board, GameConfig, *rand.Rand) {}
func (seamStrip) Decide(*State, Command) ([]Event, bool, error)   { return nil, false, nil }
func (seamStrip) Apply(*State, Event) (bool, error)               { return false, nil }
func (seamStrip) Hooks() Hooks {
	return Hooks{NoCities: func(*State) bool { return true }, NoLongestRoad: true}
}

func init() {
	RegisterModule(seamStageName, func() Module { return seamStage{} })
	RegisterModule(seamDraftName, func() Module { return seamDraft{} })
	RegisterModule(seamGateName, func() Module { return seamGate{} })
	RegisterModule(seamStripName, func() Module { return seamStrip{} })
}

// seamPlay runs a game to the start of the first turn, with the dice rolled and
// a full hand, so a seam test is about the seam.
func seamPlay(t *testing.T, ruleset string) *State {
	t.Helper()
	evs, err := New(GameConfig{Players: 3, Ruleset: ruleset, DiceMode: DiceFair, BoardMode: board.BoardFair}, SeedsFrom(9))
	if err != nil {
		t.Fatalf("new %s: %v", ruleset, err)
	}
	s, err := Replay(evs)
	if err != nil {
		t.Fatal(err)
	}
	for range 200 {
		if s.Phase != PhaseSetup {
			break
		}
		cmd, ok := AutoCommand(s)
		if !ok {
			t.Fatal("setup stalled")
		}
		out, err := Decide(s, cmd)
		if err != nil {
			t.Fatalf("%s: %v", cmd.Type, err)
		}
		for _, e := range out {
			if err := Apply(s, e); err != nil {
				t.Fatal(err)
			}
		}
	}
	if s.Phase != PhasePlay {
		t.Fatalf("setup did not finish: %v", s.Phase)
	}
	roll := mustEvent(EvDiceRolled, DiceRolledData{Player: s.Cur, D1: 3, D2: 5})
	roll.Seq = s.NextSeq
	if err := Apply(s, roll); err != nil {
		t.Fatal(err)
	}
	for p := range s.Players {
		s.Players[p].Hand = Hand{board.Wood: 5, board.Brick: 5, board.Sheep: 5, board.Wheat: 5, board.Ore: 5}
	}
	return s
}

// TestBlocksBuildTradeScope. A separate hook
// from BlocksTurnActions so that ending the turn still works.
func TestBlocksBuildTradeScope(t *testing.T) {
	seamStageClosed = false
	defer func() { seamStageClosed = false }()
	s := seamPlay(t, seamStageName)
	seat := s.Cur
	roads := s.LegalRoads(seat)
	if len(roads) == 0 {
		t.Fatal("no legal road")
	}
	build := Command{Player: seat, Type: CmdBuildRoad, Data: cmdData(t, map[string]any{"e": roads[0]})}
	trade := Command{Player: seat, Type: CmdBankTrade, Data: cmdData(t, map[string]any{"give": board.Wood, "get": board.Ore})}
	for _, c := range []Command{build, trade} {
		if _, err := Decide(s, c); err != nil {
			t.Fatalf("%s with the gate open: %v", c.Type, err)
		}
	}
	seamStageClosed = true
	for _, c := range []Command{build, trade} {
		if _, err := Decide(s, c); err == nil {
			t.Errorf("%s was accepted with the gate closed", c.Type)
		} else if !errors.Is(err, ErrBuildingOver) {
			t.Errorf("%s refused with %v, want ErrBuildingOver", c.Type, err)
		}
	}
	if _, err := Decide(s, Command{Player: seat, Type: CmdEndTurn}); err != nil {
		t.Errorf("the turn could not be ended with the gate closed: %v", err)
	}
}

// TestOwnsSetupRefusesBaseDraft.
func TestOwnsSetupRefusesBaseDraft(t *testing.T) {
	seamDraftOwns = false
	defer func() { seamDraftOwns = false }()
	evs, err := New(GameConfig{Players: 3, Ruleset: seamDraftName, DiceMode: DiceFair, BoardMode: board.BoardFair}, SeedsFrom(4))
	if err != nil {
		t.Fatal(err)
	}
	s, err := Replay(evs)
	if err != nil {
		t.Fatal(err)
	}
	spots := allLegalSettlementSpots(s)
	if len(spots) == 0 {
		t.Fatal("no legal settlement spot")
	}
	place := Command{Player: 0, Type: CmdPlaceSettlement, Data: cmdData(t, map[string]any{"v": spots[0]})}
	if _, err := Decide(s, place); err != nil {
		t.Fatalf("the base draft with the hook off: %v", err)
	}
	cmd, ok := AutoCommand(s)
	if !ok || cmd.Type != CmdPlaceSettlement {
		t.Fatalf("the auto command with the hook off is %v (%v), want a base placement", cmd.Type, ok)
	}

	seamDraftOwns = true
	if _, err := Decide(s, place); !errors.Is(err, ErrUnknownCommand) {
		t.Errorf("the base draft with the hook on was refused with %v, want ErrUnknownCommand", err)
	}
	if _, err := Decide(s, Command{Player: 0, Type: CmdPlaceRoad,
		Data: cmdData(t, map[string]any{"e": spots[0].Edges()[0]})}); !errors.Is(err, ErrUnknownCommand) {
		t.Errorf("the base setup road with the hook on was refused with %v, want ErrUnknownCommand", err)
	}
	cmd, ok = AutoCommand(s)
	if !ok || cmd.Type != "testseam_place" {
		t.Fatalf("the auto command with the hook on is %v (%v), want the module's own", cmd.Type, ok)
	}
}

// TestBuildBlockedPerSeat: unlike BlocksVertex, these
// hooks depend on the seat.
func TestBuildBlockedPerSeat(t *testing.T) {
	seamGateSeat = NoPlayer
	defer func() { seamGateSeat = NoPlayer }()
	s := seamPlay(t, seamGateName)
	seat := s.Cur
	roads := s.LegalRoads(seat)
	if len(roads) == 0 {
		t.Fatal("no legal road")
	}
	seamGateEdge = roads[0]
	seamGateSeat = seat
	if got := s.LegalRoads(seat); len(got) == len(roads) {
		t.Error("the barred edge is still offered to the seat it is barred for")
	}
	if _, err := Decide(s, Command{Player: seat, Type: CmdBuildRoad,
		Data: cmdData(t, map[string]any{"e": seamGateEdge})}); err == nil {
		t.Error("a road was built on an edge the module bars for this seat")
	}
	// Another seat is unaffected: the same edge, a different player.
	other := PlayerID((int(seat) + 1) % len(s.Players))
	if blocked := s.buildBlockedEdge(seamGateEdge, other); blocked {
		t.Error("the edge is barred for a seat the module did not name")
	}

	// The vertex half, asked of a spot legal by the seat-independent rule
	// (BlocksVertex), since this hook adds the per-seat answer.
	spots := allLegalSettlementSpots(s)
	if len(spots) == 0 {
		t.Fatal("the board has no legal settlement spot at all")
	}
	seamGateVertex = spots[0]
	if !s.buildBlockedVertex(seamGateVertex, seat) {
		t.Error("the named vertex is not barred for the seat it was named for")
	}
	if s.buildBlockedVertex(seamGateVertex, other) {
		t.Error("the vertex is barred for a seat the module did not name")
	}
	for _, v := range s.LegalSettlements(seat) {
		if v == seamGateVertex {
			t.Error("the barred vertex is still offered to the seat it is barred for")
		}
	}
	if _, err := Decide(s, Command{Player: seat, Type: CmdBuildSettlement,
		Data: cmdData(t, map[string]any{"v": seamGateVertex})}); err == nil {
		t.Error("a settlement was built on a vertex the module bars for this seat")
	}
}

// TestNoCitiesNoLongestRoad.
func TestNoCitiesNoLongestRoad(t *testing.T) {
	s := seamPlay(t, seamStripName)
	seat := s.Cur
	var own board.Vertex
	for v, b := range s.Buildings {
		if b.Owner == seat && !b.City {
			own = v
			break
		}
	}
	if own == (board.Vertex{}) {
		t.Fatal("the seat has no settlement")
	}
	if _, err := Decide(s, Command{Player: seat, Type: CmdBuildCity,
		Data: cmdData(t, map[string]any{"v": own})}); !errors.Is(err, ErrUnknownCommand) {
		t.Errorf("a city upgrade was refused with %v, want ErrUnknownCommand", err)
	}
	if got := s.LegalCities(seat); len(got) != 0 {
		t.Errorf("%d city upgrades offered in a ruleset with no cities", len(got))
	}
	// The route: build a long chain and require the title to stay unclaimed.
	for range 12 {
		roads := s.LegalRoads(seat)
		if len(roads) == 0 {
			break
		}
		out, err := Decide(s, Command{Player: seat, Type: CmdBuildRoad,
			Data: cmdData(t, map[string]any{"e": roads[0]})})
		if err != nil {
			break
		}
		for _, e := range out {
			if e.Type == EvLongestRoad {
				t.Fatal("a longest_road event was emitted in a ruleset with no such card")
			}
			if err := Apply(s, e); err != nil {
				t.Fatal(err)
			}
		}
		s.Players[seat].Hand = Hand{board.Wood: 9, board.Brick: 9}
	}
	if s.LongestRoadHolder != NoPlayer {
		t.Errorf("the Longest Route was awarded to seat %d", s.LongestRoadHolder)
	}
}

// TestExplorerSeamsInertElsewhere: every module registered today
// answers the new hooks the way the code behaved before they existed. The
// synthetic modules above are excluded.
func TestExplorerSeamsInertElsewhere(t *testing.T) {
	synthetic := map[string]bool{
		seamStageName: true, seamDraftName: true, seamGateName: true, seamStripName: true,
		seamAfterName: true, seamEarlyName: true, seamAdjustName: true, seamSuppressName: true,
	}
	for _, name := range RegisteredModuleNames() {
		if synthetic[name] || name == "explorers" {
			continue
		}
		factory := moduleRegistry[name]
		h := factory().Hooks()
		if h.OwnsSetup != nil {
			t.Errorf("module %q sets OwnsSetup", name)
		}
		if h.AutoSetup != nil {
			t.Errorf("module %q sets AutoSetup", name)
		}
		if h.BlocksBuildTrade != nil {
			t.Errorf("module %q sets BlocksBuildTrade", name)
		}
		if h.BuildBlockedVertex != nil {
			t.Errorf("module %q sets BuildBlockedVertex", name)
		}
		if h.BuildBlockedEdge != nil {
			t.Errorf("module %q sets BuildBlockedEdge", name)
		}
		if h.NoCities != nil {
			t.Errorf("module %q sets NoCities", name)
		}
		if h.NoLongestRoad {
			t.Errorf("module %q sets NoLongestRoad", name)
		}
	}
}

func cmdData(t *testing.T, v any) []byte {
	t.Helper()
	return cmd(0, "x", v).Data
}
