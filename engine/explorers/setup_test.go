package explorers

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// apply folds a command's events into s, failing the test on a refusal.
func apply(t *testing.T, s *engine.State, cmd engine.Command) []engine.Event {
	t.Helper()
	evs, err := engine.Decide(s, cmd)
	if err != nil {
		t.Fatalf("%s by seat %d: %v", cmd.Type, cmd.Player, err)
	}
	for _, e := range evs {
		if err := engine.Apply(s, e); err != nil {
			t.Fatalf("apply %s: %v", e.Type, err)
		}
	}
	return evs
}

// runSetup drives the three-round draft with the module's own auto-setup, which
// is the same path a timed-out seat and a bot fall back to.
func runSetup(t *testing.T, s *engine.State) {
	t.Helper()
	for range 200 {
		if s.Phase != engine.PhaseSetup {
			return
		}
		cmd, ok := engine.AutoCommand(s)
		if !ok {
			t.Fatalf("setup stalled at round %d, seat %d", mustExt(t, s).Round, s.Cur)
		}
		apply(t, s, cmd)
	}
	t.Fatal("setup did not finish in 200 commands")
}

// TestSetupRoundOrder: harbour settlements in turn order,
// settlements in reverse order, then a road plus a settler-loaded ship in turn
// order. Every player opens with 3 VP of the 17, one road, one loaded ship and
// 2 gold, and starting resources come from the settlement only.
func TestSetupRoundOrder(t *testing.T) {
	for _, players := range []int{2, 3, 4, 6} {
		s := newGame(t, players, 11)
		var x *Ext

		var order [][2]int // (round, seat) in the order they were served
		for range 400 {
			if s.Phase != engine.PhaseSetup {
				break
			}
			x = mustExt(t, s)
			order = append(order, [2]int{x.Round, int(s.Cur)})
			cmd, ok := engine.AutoCommand(s)
			if !ok {
				t.Fatalf("%d players: setup stalled at round %d seat %d", players, x.Round, s.Cur)
			}
			apply(t, s, cmd)
		}
		if s.Phase != engine.PhasePlay {
			t.Fatalf("%d players: setup did not finish (phase %v)", players, s.Phase)
		}
		if len(order) != 3*players {
			t.Fatalf("%d players: %d setup placements, want %d", players, len(order), 3*players)
		}
		for i := range players {
			if want := [2]int{0, i}; order[i] != want {
				t.Errorf("%d players: placement %d was %v, want %v", players, i, order[i], want)
			}
			if want := [2]int{1, players - 1 - i}; order[players+i] != want {
				t.Errorf("%d players: placement %d was %v, want %v", players, players+i, order[players+i], want)
			}
			if want := [2]int{2, i}; order[2*players+i] != want {
				t.Errorf("%d players: placement %d was %v, want %v", players, 2*players+i, order[2*players+i], want)
			}
		}

		x = mustExt(t, s)
		for p := range players {
			seat := engine.PlayerID(p)
			if got := x.Seats[p].Gold; got != StartingGold {
				t.Errorf("%d players: seat %d opened with %d gold, want %d", players, p, got, StartingGold)
			}
			if got := engine.WinThreshold(s, seat); got != TargetVP {
				t.Errorf("%d players: seat %d needs %d VP, want %d", players, p, got, TargetVP)
			}
			// 3 VP: one settlement (1) and one harbour settlement (1 base + 1).
			vp := s.VP(seat) + victoryCheck(s, seat)
			if vp != 3 {
				t.Errorf("%d players: seat %d opened on %d VP, want 3", players, p, vp)
			}
			if got := s.Players[p].RoadsLeft; got != engine.MaxRoads-1 {
				t.Errorf("%d players: seat %d has %d roads left, want %d", players, p, got, engine.MaxRoads-1)
			}
			ships := 0
			for _, sh := range x.Ships {
				if sh.Owner == seat {
					ships++
					if sh.Hold.Settler != 1 {
						t.Errorf("%d players: seat %d's starting ship carries %+v, want one settler", players, p, sh.Hold)
					}
					if !s.Board.SeaEdge(sh.E) {
						t.Errorf("%d players: seat %d's starting ship is not on a sea edge", players, p)
					}
				}
			}
			if ships != 1 {
				t.Errorf("%d players: seat %d has %d ships, want 1", players, p, ships)
			}
			if x.Seats[p].SettlersLeft != MaxSettlers-1 {
				t.Errorf("%d players: seat %d has %d settlers left", players, p, x.Seats[p].SettlersLeft)
			}
			if x.Seats[p].HarboursLeft != MaxHarbours-1 {
				t.Errorf("%d players: seat %d has %d harbour settlements left", players, p, x.Seats[p].HarboursLeft)
			}
		}
		harbours := 0
		for range x.Harbours {
			harbours++
		}
		if harbours != players {
			t.Errorf("%d players: %d harbour settlements on the board", players, harbours)
		}
	}
}

// TestSetupBuildingsOnHomeIsland.
func TestSetupBuildingsOnHomeIsland(t *testing.T) {
	s := newGame(t, 4, 19)
	runSetup(t, s)
	x := mustExt(t, s)
	for v := range s.Buildings {
		if !onHomeIsland(x, v) {
			t.Errorf("building at %v is not on the home island", v)
		}
		for _, n := range v.Neighbors() {
			if _, taken := s.Buildings[n]; taken {
				t.Errorf("buildings at %v and %v break the distance rule", v, n)
			}
		}
	}
	for v := range x.Harbours {
		if !coastal(s, x, v) {
			t.Errorf("harbour settlement at %v has no water beside it", v)
		}
	}
}

// TestBaseSetupCommandsRefused. Without this the
// base place_settlement would put down a piece the module's three rounds know
// nothing about.
func TestBaseSetupCommandsRefused(t *testing.T) {
	s := newGame(t, 3, 4)
	x := mustExt(t, s)
	v := setupHarbourSpots(s, x)[0]
	for _, cmd := range []engine.Command{
		{Player: 0, Type: engine.CmdPlaceSettlement, Data: raw(map[string]any{"v": v})},
		{Player: 0, Type: engine.CmdPlaceRoad, Data: raw(map[string]any{"e": board.NewEdge(v, v.Neighbors()[0])})},
	} {
		if _, err := engine.Decide(s, cmd); err == nil {
			t.Errorf("%s was accepted during an Explorers setup draft", cmd.Type)
		}
	}
}

// TestSetupRoundsRefuseWrongCommand: each round takes exactly one kind of
// placement.
func TestSetupRoundsRefuseWrongCommand(t *testing.T) {
	s := newGame(t, 2, 6)
	x := mustExt(t, s)
	v := setupHarbourSpots(s, x)[0]
	if _, err := engine.Decide(s, engine.Command{
		Player: 0, Type: CmdPlaceSettlement, Data: raw(map[string]any{"v": v}),
	}); err == nil {
		t.Error("a plain settlement was accepted in round 0")
	}
	if _, err := engine.Decide(s, engine.Command{
		Player: 1, Type: CmdPlaceHarbour, Data: raw(map[string]any{"v": v}),
	}); err == nil {
		t.Error("seat 1 placed in seat 0's round")
	}
	apply(t, s, engine.Command{Player: 0, Type: CmdPlaceHarbour, Data: raw(map[string]any{"v": v})})
	if got := mustExt(t, s).Round; got != 0 || s.Cur != 1 {
		t.Fatalf("after seat 0's harbour: round %d, seat %d; want round 0, seat 1", got, s.Cur)
	}
}

// TestNoDevelopmentDeckNoCitiesNoRobber: the subtractions, as rules rather than
// as board features.
func TestNoDevelopmentDeckNoCitiesNoRobber(t *testing.T) {
	s := newGame(t, 3, 8)
	runSetup(t, s)
	apply(t, s, engine.Command{Player: 0, Type: engine.CmdRollDice})
	if _, err := engine.Decide(s, engine.Command{Player: 0, Type: engine.CmdBuyDevCard}); err == nil {
		t.Error("a development card was bought in an Explorers game")
	}
	// A city upgrade needs a settlement of the player's; the refusal must come
	// from the rules and not from the board being empty.
	var own board.Vertex
	for v, b := range s.Buildings {
		if b.Owner == 0 {
			own = v
			break
		}
	}
	s.Players[0].Hand = engine.Hand{board.Ore: 3, board.Wheat: 2}
	if _, err := engine.Decide(s, engine.Command{
		Player: 0, Type: engine.CmdBuildCity, Data: raw(map[string]any{"v": own}),
	}); err == nil {
		t.Error("a settlement was upgraded to a city in an Explorers game")
	}
	if s.Board.RobberOnBoard() {
		t.Error("the robber is on the board")
	}
}
