package islands

import (
	"encoding/json"
	"errors"
	"reflect"
	"slices"
	"testing"

	"github.com/ftqo/costan.io/engine"
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

// newGame builds an Islands game and drives it into the play phase with the
// engine's auto-pass logic, collecting the log for replay checks.
func newGame(t *testing.T, seed uint64) (*engine.State, []engine.Event) {
	t.Helper()
	log, err := engine.New(engine.GameConfig{Players: 3, Ruleset: "base+islands"}, engine.SeedsFrom(seed))
	if err != nil {
		t.Fatal(err)
	}
	s := engine.Empty()
	for _, e := range log {
		if err := engine.Apply(s, e); err != nil {
			t.Fatal(err)
		}
	}
	for s.Phase == engine.PhaseSetup {
		cmd, ok := engine.AutoCommand(s)
		if !ok {
			t.Fatal("setup stuck")
		}
		log = append(log, step(t, s, cmd)...)
	}
	// Drain any starting gold picks owed by a round-2 settlement bordering gold,
	// so tests begin from a clean (unblocked) play state.
	for len(ext(s).PendingGold) > 0 {
		cmd, ok := engine.AutoCommand(s)
		if !ok {
			break
		}
		log = append(log, step(t, s, cmd)...)
	}
	return s, log
}

func step(t *testing.T, s *engine.State, cmd engine.Command) []engine.Event {
	t.Helper()
	events, err := engine.Decide(s, cmd)
	if err != nil {
		t.Fatalf("Decide(%s by %d): %v", cmd.Type, cmd.Player, err)
	}
	for _, e := range events {
		if err := engine.Apply(s, e); err != nil {
			t.Fatalf("Apply(%s): %v", e.Type, err)
		}
	}
	return events
}

// rolledState rolls for the current player and then resolves whatever the roll
// owed (robber move, discards, gold picks) with the engine's own auto commands,
// so every caller starts from the same clean post-roll state on any seed. It
// never skips: it resolves or fails.
func rolledState(t *testing.T, seed uint64) (*engine.State, []engine.Event) {
	t.Helper()
	s, log := newGame(t, seed)
	cmd := engine.Command{Player: s.Cur, Type: engine.CmdRollDice}
	events, err := engine.Decide(s, cmd)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range events {
		if err := engine.Apply(s, e); err != nil {
			t.Fatal(err)
		}
	}
	log = append(log, events...)
	for i := 0; interrupted(s); i++ {
		if i >= 64 {
			t.Fatalf("interrupt after roll unresolved in 64 auto commands "+
				"(robber=%v discards=%d gold=%d)", s.RobberPending, len(s.PendingDiscards), len(ext(s).PendingGold))
		}
		auto, ok := engine.AutoCommand(s)
		if !ok {
			t.Fatalf("no auto command resolves the post-roll interrupt "+
				"(robber=%v discards=%d gold=%d)", s.RobberPending, len(s.PendingDiscards), len(ext(s).PendingGold))
		}
		log = append(log, step(t, s, auto)...)
	}
	if !s.Rolled || s.Phase != engine.PhasePlay {
		t.Fatalf("rolledState: phase=%v rolled=%v, want a rolled play turn", s.Phase, s.Rolled)
	}
	return s, log
}

// interrupted reports whether anything is owed before the current player may
// act freely.
func interrupted(s *engine.State) bool {
	return s.RobberPending || len(s.PendingDiscards) > 0 || len(ext(s).PendingGold) > 0
}

// coastalSpot finds a sea edge with a land endpoint and returns the edge plus
// that land vertex.
func coastalSpot(t *testing.T, s *engine.State) (board.Edge, board.Vertex) {
	t.Helper()
	return coastalSpotWhere(t, s, nil)
}

// coastalSpotWhere is coastalSpot restricted to spots `want` accepts (nil
// accepts all), for tests that need more than a coastal edge. It searches the
// board rather than relying on which spot comes first.
func coastalSpotWhere(t *testing.T, s *engine.State, want func(board.Edge, board.Vertex) bool) (board.Edge, board.Vertex) {
	t.Helper()
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		if !s.Board.IsSea(h) {
			continue
		}
		for _, e := range h.Edges() {
			// A coastal edge: land on one side, sea on the other. A sea hex's
			// edge with a land endpoint is not enough: a strait between two sea
			// hexes has land at both ends and takes no road.
			if !s.Board.LandEdge(e) {
				continue
			}
			// Nothing built at either end, so the spot is unanchored until the
			// caller anchors it (TestBuildShipValidation's "disconnected" case
			// depends on this).
			if _, taken := s.Buildings[e.A]; taken {
				continue
			}
			if _, taken := s.Buildings[e.B]; taken {
				continue
			}
			for _, v := range []board.Vertex{e.A, e.B} {
				if !s.Board.LandVertex(v) {
					continue
				}
				if _, taken := s.Roads[e]; taken {
					continue
				}
				if _, taken := ext(s).Ships[e]; taken {
					continue
				}
				if want != nil && !want(e, v) {
					continue
				}
				return e, v
			}
		}
	}
	// Every Islands board is carved so land meets sea; if no free coastal edge
	// survives setup, the board generator regressed.
	t.Fatal("no free coastal spot: every coastal edge is taken or has a building at an end")
	return board.Edge{}, board.Vertex{}
}

func TestSetupBoardCarvesSea(t *testing.T) {
	s, _ := newGame(t, 1)
	seas := 0
	for _, tile := range s.Board.Tiles {
		if tile.Res == board.Sea {
			seas++
		}
	}
	if seas == 0 {
		t.Fatal("no sea tiles")
	}
	if !s.Board.Land(s.Board.Robber) {
		t.Error("robber on water")
	}
	for _, h := range s.Board.Harbors {
		for _, v := range h.Verts {
			if !s.Board.LandVertex(v) {
				t.Errorf("harbor vertex %v unreachable from land", v)
			}
		}
	}
	// Determinism.
	s2, _ := newGame(t, 1)
	if !reflect.DeepEqual(s.Board, s2.Board) {
		t.Error("islands board not deterministic")
	}
}

func TestBuildShip(t *testing.T) {
	s, _ := rolledState(t, 2)
	e, v := coastalSpot(t, s)
	p := s.Cur
	s.Buildings[v] = engine.Building{Owner: p}
	s.Players[p].Hand = CostShip

	step(t, s, engine.Command{Player: p, Type: CmdBuildShip, Data: mustJSON(t, map[string]any{"e": e})})

	x := ext(s)
	if x.Ships[e] != p || x.ShipsLeft[p] != MaxShips-1 {
		t.Errorf("ship state: %v left %v", x.Ships, x.ShipsLeft)
	}
	if s.Players[p].Hand.Count() != 0 {
		t.Errorf("cost not paid: %v", s.Players[p].Hand)
	}
	if !x.BuiltTurn[e] {
		t.Error("built-this-turn not tracked")
	}

	// Cannot build the same edge again, even with funds.
	s.Players[p].Hand = CostShip
	if _, err := engine.Decide(s, engine.Command{Player: p, Type: CmdBuildShip, Data: mustJSON(t, map[string]any{"e": e})}); !errors.Is(err, engine.ErrOccupied) {
		t.Errorf("duplicate ship err = %v", err)
	}
}

func TestBuildShipValidation(t *testing.T) {
	s, _ := rolledState(t, 3)
	e, v := coastalSpot(t, s)
	p := s.Cur
	s.Players[p].Hand = CostShip

	// No connection: nothing of ours at either endpoint.
	if _, err := engine.Decide(s, engine.Command{Player: p, Type: CmdBuildShip, Data: mustJSON(t, map[string]any{"e": e})}); !errors.Is(err, engine.ErrBadPlacement) {
		t.Errorf("disconnected ship err = %v", err)
	}
	// Opponent building does not anchor our ship.
	s.Buildings[v] = engine.Building{Owner: p + 1}
	if _, err := engine.Decide(s, engine.Command{Player: p, Type: CmdBuildShip, Data: mustJSON(t, map[string]any{"e": e})}); !errors.Is(err, engine.ErrBadPlacement) {
		t.Errorf("opponent-anchored ship err = %v", err)
	}
	// Land-locked edges are not ship spots.
	delete(s.Buildings, v)
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		if !s.Board.Land(h) {
			continue
		}
		for _, le := range h.Edges() {
			if !s.Board.SeaEdge(le) {
				s.Buildings[le.A] = engine.Building{Owner: p}
				if _, err := engine.Decide(s, engine.Command{Player: p, Type: CmdBuildShip, Data: mustJSON(t, map[string]any{"e": le})}); !errors.Is(err, ErrNotSeaEdge) {
					t.Errorf("inland ship err = %v", err)
				}
				delete(s.Buildings, le.A)
				return
			}
		}
	}
}

func TestMoveShipRules(t *testing.T) {
	s, _ := rolledState(t, 4)
	e, v := coastalSpot(t, s)
	p := s.Cur
	s.Buildings[v] = engine.Building{Owner: p}
	s.Players[p].Hand = CostShip
	step(t, s, engine.Command{Player: p, Type: CmdBuildShip, Data: mustJSON(t, map[string]any{"e": e})})

	// Can't move a ship the turn it was built.
	var target board.Edge
	found := false
	for _, ve := range v.Edges() {
		if ve != e && s.Board.SeaEdge(ve) {
			if _, taken := s.Roads[ve]; !taken {
				if _, taken := ext(s).Ships[ve]; !taken {
					target, found = ve, true
					break
				}
			}
		}
	}
	if !found {
		t.Fatalf("no second free sea edge at anchor %v", v)
	}
	_, err := engine.Decide(s, engine.Command{Player: p, Type: CmdMoveShip, Data: mustJSON(t, map[string]any{"from": e, "to": target})})
	if !errors.Is(err, ErrShipJustBuilt) {
		t.Fatalf("same-turn move err = %v", err)
	}

	// Next turn cycle it becomes movable.
	step(t, s, engine.Command{Player: p, Type: engine.CmdEndTurn})
	for s.Cur != p {
		cmd, ok := engine.AutoCommand(s)
		if !ok {
			t.Fatal("stuck cycling turns")
		}
		step(t, s, cmd)
	}
	if !s.Rolled {
		cmd := engine.Command{Player: p, Type: engine.CmdRollDice}
		evs, err := engine.Decide(s, cmd)
		if err != nil {
			t.Fatal(err)
		}
		for _, ev := range evs {
			engine.Apply(s, ev)
		}
		for s.RobberPending || len(s.PendingDiscards) > 0 || len(ext(s).PendingGold) > 0 {
			cmd, ok := engine.AutoCommand(s)
			if !ok {
				t.Fatal("stuck resolving interrupts")
			}
			step(t, s, cmd)
		}
	}

	step(t, s, engine.Command{Player: p, Type: CmdMoveShip, Data: mustJSON(t, map[string]any{"from": e, "to": target})})
	x := ext(s)
	if _, still := x.Ships[e]; still {
		t.Error("ship did not leave origin")
	}
	if x.Ships[target] != p || !x.MovedShip {
		t.Errorf("ship not at target: %v moved=%v", x.Ships, x.MovedShip)
	}
	// Only one move per turn.
	_, err = engine.Decide(s, engine.Command{Player: p, Type: CmdMoveShip, Data: mustJSON(t, map[string]any{"from": target, "to": e})})
	if !errors.Is(err, ErrShipAlreadyMoved) {
		t.Errorf("second move err = %v", err)
	}
}

func TestPirate(t *testing.T) {
	s, _ := newGame(t, 5)
	p := s.Cur

	// Manufacture a 7: set robber pending directly via a forced dice event.
	roll := engine.NewEvent(engine.EvDiceRolled, engine.DiceRolledData{Player: p, D1: 3, D2: 4})
	roll.Seq = s.NextSeq
	if err := engine.Apply(s, roll); err != nil {
		t.Fatal(err)
	}
	if !s.RobberPending {
		t.Fatal("robber not pending")
	}

	// A victim's ship next to a sea hex.
	e, v := coastalSpot(t, s)
	victim := (p + 1) % engine.PlayerID(len(s.Players))
	s.Buildings[v] = engine.Building{Owner: victim}
	x := ext(s)
	x.Ships[e] = victim
	s.Players[victim].Hand = engine.Hand{board.Ore: 1}
	// Pin the thief's hand too, so the assertions below depend on the steal
	// alone and not on what the setup placements produced on this board.
	s.Players[p].Hand = engine.Hand{}

	var seaHex board.Hex
	for _, h := range board.EdgeHexes(e) {
		if s.Board.IsSea(h) {
			seaHex = h
		}
	}

	events := step(t, s, engine.Command{Player: p, Type: CmdMovePirate,
		Data: mustJSON(t, map[string]any{"hex": seaHex, "victim": victim})})

	if !x.HasPirate || x.Pirate != seaHex {
		t.Errorf("pirate at %v (set=%v)", x.Pirate, x.HasPirate)
	}
	if s.RobberPending {
		t.Error("robber still pending after pirate move")
	}
	if s.Players[p].Hand[board.Ore] != 1 || s.Players[victim].Hand.Count() != 0 {
		t.Errorf("steal failed: thief %v victim %v", s.Players[p].Hand, s.Players[victim].Hand)
	}
	var stolen *engine.Event
	for i := range events {
		if events[i].Type == engine.EvCardStolen {
			stolen = &events[i]
		}
	}
	if stolen == nil || len(stolen.Visible) != 2 {
		t.Errorf("steal event visibility: %+v", stolen)
	}

	// The pirate blocks ship building on its waters.
	s.Rolled = true
	free := board.Edge{}
	okFree := false
	for _, pe := range seaHex.Edges() {
		if _, taken := x.Ships[pe]; !taken {
			free, okFree = pe, true
			break
		}
	}
	if okFree {
		s.Buildings[free.A] = engine.Building{Owner: p}
		s.Players[p].Hand = CostShip
		if _, err := engine.Decide(s, engine.Command{Player: p, Type: CmdBuildShip, Data: mustJSON(t, map[string]any{"e": free})}); !errors.Is(err, ErrPirateBlocks) {
			t.Errorf("pirate-adjacent build err = %v", err)
		}
	}
}

// TestPirateRobberExclusiveOnSeven: a 7 lets you move either the robber or the
// pirate, not both; resolving one clears the pending state.
func TestPirateRobberExclusiveOnSeven(t *testing.T) {
	// Path A: move the pirate, then the robber is no longer movable.
	s, _ := newGame(t, 60)
	forceSeven(t, s)
	seaHex := anySeaHex(t, s, s.Cur)
	step(t, s, engine.Command{Player: s.Cur, Type: CmdMovePirate, Data: mustJSON(t, map[string]any{"hex": seaHex})})
	if s.RobberPending {
		t.Fatal("moving the pirate did not clear the 7")
	}
	land := anyOtherLand2(t, s)
	if _, err := engine.Decide(s, engine.Command{Player: s.Cur, Type: engine.CmdMoveRobber, Data: mustJSON(t, map[string]any{"hex": land})}); err == nil {
		t.Error("robber should not be movable after the pirate already resolved the 7")
	}

	// Path B: move the robber, then the pirate is no longer movable.
	s2, _ := newGame(t, 61)
	forceSeven(t, s2)
	// Empty opponents' hands so the robber move forces no steal.
	for p := range s2.Players {
		if engine.PlayerID(p) != s2.Cur {
			s2.Players[p].Hand = engine.Hand{}
		}
	}
	land2 := anyOtherLand2(t, s2)
	step(t, s2, engine.Command{Player: s2.Cur, Type: engine.CmdMoveRobber, Data: mustJSON(t, map[string]any{"hex": land2})})
	sea2 := anySeaHex(t, s2, s2.Cur)
	if _, err := engine.Decide(s2, engine.Command{Player: s2.Cur, Type: CmdMovePirate, Data: mustJSON(t, map[string]any{"hex": sea2})}); err == nil {
		t.Error("pirate should not be movable after the robber already resolved the 7")
	}
}

func forceSeven(t *testing.T, s *engine.State) {
	t.Helper()
	roll := engine.NewEvent(engine.EvDiceRolled, engine.DiceRolledData{Player: s.Cur, D1: 3, D2: 4})
	roll.Seq = s.NextSeq
	if err := engine.Apply(s, roll); err != nil {
		t.Fatal(err)
	}
	for len(s.PendingDiscards) > 0 {
		cmd, ok := engine.AutoCommand(s)
		if !ok {
			t.Fatal("stuck on discards")
		}
		step(t, s, cmd)
	}
	if !s.RobberPending {
		t.Fatal("robber not pending after a 7")
	}
}

func anySeaHex(t *testing.T, s *engine.State, mover engine.PlayerID) board.Hex {
	t.Helper()
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		if s.Board.IsSea(h) && h != ext(s).Pirate {
			return h
		}
	}
	t.Fatal("no sea hex free of the pirate")
	return board.Hex{}
}

func anyOtherLand2(t *testing.T, s *engine.State) board.Hex {
	t.Helper()
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		if s.Board.Land(h) && h != s.Board.Robber {
			return h
		}
	}
	t.Fatal("no land hex free of the robber")
	return board.Hex{}
}

func TestGoldFlow(t *testing.T) {
	s, _ := newGame(t, 6)
	p := s.Cur

	// Plant a gold hex with a known number and a settlement of the next player
	// on it, then roll that number via a forced event and hook call.
	var goldHex board.Hex
	found := false
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		if s.Board.Land(h) && h != s.Board.Robber {
			goldHex, found = h, true
			break
		}
	}
	if !found {
		t.Fatal("no land hex")
	}
	s.Board.Tiles[goldHex] = board.Tile{Res: board.Gold, Number: 5}
	owner := (p + 1) % engine.PlayerID(len(s.Players))
	// Clear any setup buildings already touching this hex, then place a lone
	// city so exactly two picks are owed.
	for _, gv := range goldHex.Vertices() {
		delete(s.Buildings, gv)
	}
	vtx := goldHex.Vertices()[0]
	s.Buildings[vtx] = engine.Building{Owner: owner, City: true}

	events := (Module{}).onDiceRolled(s, 2, 3)
	if len(events) != 1 || events[0].Type != EvGoldOwed {
		t.Fatalf("gold events = %+v", events)
	}
	events[0].Seq = s.NextSeq
	if err := engine.Apply(s, events[0]); err != nil {
		t.Fatal(err)
	}
	x := ext(s)
	if x.PendingGold[owner] != 2 { // city = two picks
		t.Fatalf("owed = %v", x.PendingGold)
	}

	// Pending gold blocks normal turn actions.
	s.Rolled = true
	if _, err := engine.Decide(s, engine.Command{Player: p, Type: engine.CmdEndTurn}); !errors.Is(err, engine.ErrModulePending) {
		t.Errorf("end turn during gold err = %v", err)
	}
	// Wrong pick size rejected.
	if _, err := engine.Decide(s, engine.Command{Player: owner, Type: CmdChooseGold,
		Data: mustJSON(t, map[string]any{"gain": engine.Hand{board.Ore: 1}})}); !errors.Is(err, ErrBadGoldPick) {
		t.Errorf("short pick err = %v", err)
	}

	bankOre := s.Bank[board.Ore]
	step(t, s, engine.Command{Player: owner, Type: CmdChooseGold,
		Data: mustJSON(t, map[string]any{"gain": engine.Hand{board.Ore: 2}})})
	if s.Players[owner].Hand[board.Ore] < 2 || s.Bank[board.Ore] != bankOre-2 {
		t.Errorf("gold not granted: hand %v", s.Players[owner].Hand)
	}
	if len(x.PendingGold) != 0 {
		t.Errorf("pending gold remains: %v", x.PendingGold)
	}
	// And the turn unblocks.
	if _, err := engine.Decide(s, engine.Command{Player: p, Type: engine.CmdEndTurn}); err != nil {
		t.Errorf("end turn after gold err = %v", err)
	}
}

func TestSetupGrantOwesGoldForBorderingSettlement(t *testing.T) {
	s, _ := newGame(t, 7)
	var goldV *board.Vertex
	for h, tile := range s.Board.Tiles {
		if tile.Res == board.Gold {
			v := h.Vertices()[0]
			goldV = &v
			break
		}
	}
	if goldV == nil {
		// The carve guarantees gold on every generated Islands board, so its
		// absence is a generation regression.
		t.Fatal("no gold tile on this board")
	}
	ev := setupGrant(s, 0, *goldV)
	if len(ev) != 1 || ev[0].Type != EvGoldOwed {
		t.Fatalf("expected a gold grant for a gold-bordering settlement, got %v", ev)
	}
	d := engine.DecodeEvent[goldOwedData](ev[0])
	if len(d.Owed) != 1 || d.Owed[0].Player != 0 || d.Owed[0].Count < 1 {
		t.Errorf("gold owed wrong: %+v", d.Owed)
	}
}

func TestSetupShipOnCoastalStart(t *testing.T) {
	log, err := engine.New(engine.GameConfig{Players: 3, Ruleset: "base+islands"}, engine.SeedsFrom(7))
	if err != nil {
		t.Fatal(err)
	}
	s := engine.Empty()
	for _, e := range log {
		if err := engine.Apply(s, e); err != nil {
			t.Fatal(err)
		}
	}
	for s.Phase == engine.PhaseSetup {
		if s.NeedRoad {
			// Find a sea-bordering edge touching the new settlement to open by sea.
			var seaE *board.Edge
			for _, e := range s.LastSettlement.Edges() {
				if _, taken := s.Roads[e]; taken {
					continue
				}
				if _, taken := ext(s).Ships[e]; taken {
					continue
				}
				if s.Board.SeaEdge(e) {
					ee := e
					seaE = &ee
					break
				}
			}
			if seaE != nil {
				p := s.Cur
				shipsBefore := ext(s).ShipsLeft[p]
				handBefore := s.Players[p].Hand
				step(t, s, engine.Command{Player: p, Type: engine.CmdPlaceRoad,
					Data: mustJSON(t, map[string]any{"e": *seaE, "ship": true})})
				if ext(s).Ships[*seaE] != p {
					t.Fatalf("setup ship not placed at %v: %v", *seaE, ext(s).Ships)
				}
				if ext(s).ShipsLeft[p] != shipsBefore-1 {
					t.Errorf("ships-left not decremented: %d -> %d", shipsBefore, ext(s).ShipsLeft[p])
				}
				if s.Players[p].Hand != handBefore {
					t.Errorf("setup ship was not free: hand changed %v -> %v", handBefore, s.Players[p].Hand)
				}
				if s.NeedRoad {
					t.Error("setup did not advance after the ship")
				}
				return
			}
		}
		cmd, ok := engine.AutoCommand(s)
		if !ok {
			t.Fatal("setup stuck")
		}
		step(t, s, cmd)
	}
	t.Fatal("setup never offered a coastal sea edge")
}

func TestAutoResolvesGold(t *testing.T) {
	s, _ := newGame(t, 7)
	x := ext(s)
	x.PendingGold[1] = 2
	s.Rolled = true

	cmd, ok := engine.AutoCommand(s)
	if !ok || cmd.Type != CmdChooseGold || cmd.Player != 1 {
		t.Fatalf("auto = %+v ok=%v", cmd, ok)
	}
	step(t, s, cmd)
	if len(x.PendingGold) != 0 {
		t.Errorf("auto pick did not clear pending: %v", x.PendingGold)
	}
}

func TestIslandChipAndVictory(t *testing.T) {
	s, _ := rolledState(t, 8)
	p := s.Cur
	islands := s.Board.Islands()

	// The chip fires on a player's first building on an island, so the test
	// needs an island p has never touched. The carve does not promise a second
	// island, so construct the precondition: pick an island with room for two
	// settlements and clear p off it.
	target, spot := foreignIsland(t, s, p, islands)
	x := ext(s)
	for v, b := range s.Buildings {
		if b.Owner == p && islandOf(v, islands) == target {
			delete(s.Buildings, v)
		}
	}
	if x.Reached[p] != nil {
		delete(x.Reached[p], target)
	}

	// Sail there: plant a connecting own road segment so the settlement build
	// passes base adjacency, then build.
	s.Roads[spot.Edges()[0]] = p
	s.Players[p].Hand = engine.CostSettlement
	before := ext(s).IslandVP[p]
	events := step(t, s, engine.Command{Player: p, Type: engine.CmdBuildSettlement,
		Data: mustJSON(t, map[string]any{"v": spot})})

	chipSeen := false
	for _, e := range events {
		if e.Type == EvIslandChip {
			chipSeen = true
		}
	}
	if !chipSeen {
		t.Fatalf("no island chip in %+v", events)
	}
	if ext(s).IslandVP[p] != before+2 {
		t.Errorf("island VP = %d, want +2", ext(s).IslandVP[p])
	}

	// Same island again: no second chip.
	var second board.Vertex
	found := false
	for h, id := range islands {
		if id != islandOf(spot, islands) {
			continue
		}
		for _, v := range h.Vertices() {
			if v == spot {
				continue
			}
			if err := canSettle(s, v); err == nil {
				second, found = v, true
				break
			}
		}
		if found {
			break
		}
	}
	if !found {
		// The island was chosen with room for two; failing here means "only the
		// first one scores" went untested.
		t.Fatal("no second legal spot on the island we just settled")
	}
	s.Roads[second.Edges()[0]] = p
	s.Players[p].Hand = engine.CostSettlement
	evs := step(t, s, engine.Command{Player: p, Type: engine.CmdBuildSettlement,
		Data: mustJSON(t, map[string]any{"v": second})})
	for _, e := range evs {
		if e.Type == EvIslandChip {
			t.Error("second settlement on the same island earned another chip")
		}
	}
}

// foreignIsland picks an island with at least two settleable vertices and
// returns its id plus the first of them. Callers clear the player off it, which
// is what makes the island "foreign" for chip purposes.
func foreignIsland(t *testing.T, s *engine.State, p engine.PlayerID, islands map[board.Hex]int) (int, board.Vertex) {
	t.Helper()
	// Deterministic order: map iteration is randomised, and picking a different
	// island each run would make the test flaky.
	ids := make([]int, 0, len(islands))
	seen := map[int]bool{}
	for _, id := range islands {
		if !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	slices.Sort(ids)
	for _, id := range ids {
		var spots []board.Vertex
		for _, h := range board.HexesInRadius(s.Board.Radius) {
			if islands[h] != id || !s.Board.Land(h) {
				continue
			}
			for _, v := range h.Vertices() {
				if canSettleIgnoring(s, v, p) && !slices.Contains(spots, v) {
					spots = append(spots, v)
				}
			}
		}
		slices.SortFunc(spots, cmpVertex)
		// Two settlements must both be legal, so they may not be neighbours.
		for i, a := range spots {
			nb := a.Neighbors()
			for _, b := range spots[i+1:] {
				if !slices.Contains(nb[:], b) {
					return id, a
				}
			}
		}
	}
	t.Fatal("no island has room for two settlements")
	return -1, board.Vertex{}
}

// canSettleIgnoring is canSettle with p's own buildings treated as absent: the
// caller is about to remove them.
func canSettleIgnoring(s *engine.State, v board.Vertex, p engine.PlayerID) bool {
	if !s.Board.LandVertex(v) {
		return false
	}
	if _, taken := s.Buildings[v]; taken {
		return false // occupied by anyone, p included: pick a genuinely empty spot
	}
	for _, n := range v.Neighbors() {
		if b, taken := s.Buildings[n]; taken && b.Owner != p {
			return false
		}
	}
	return true
}

func cmpVertex(a, b board.Vertex) int {
	if a.Q != b.Q {
		return a.Q - b.Q
	}
	if a.R != b.R {
		return a.R - b.R
	}
	return int(a.Side) - int(b.Side)
}

func islandOf(v board.Vertex, islands map[board.Hex]int) int {
	for _, h := range v.Hexes() {
		if id, ok := islands[h]; ok {
			return id
		}
	}
	return -1
}

// canSettle mirrors the base settlement spot check (distance + occupancy).
func canSettle(s *engine.State, v board.Vertex) error {
	if !s.Board.LandVertex(v) {
		return errors.New("water")
	}
	if _, ok := s.Buildings[v]; ok {
		return errors.New("occupied")
	}
	for _, n := range v.Neighbors() {
		if _, ok := s.Buildings[n]; ok {
			return errors.New("too close")
		}
	}
	return nil
}

func TestMixedRouteLength(t *testing.T) {
	s, _ := newGame(t, 9)
	p := engine.PlayerID(0)
	s.Buildings = map[board.Vertex]engine.Building{}
	s.Roads = map[board.Edge]engine.PlayerID{}
	x := ext(s)
	x.Ships = map[board.Edge]engine.PlayerID{}

	// A road chain of 2 into a building, then 3 ships out of it.
	e, v := coastalSpot(t, s)
	s.Buildings[v] = engine.Building{Owner: p}
	x.Ships[e] = p
	at := e.Other(v)
	ships := 1
	for ships < 3 {
		extended := false
		for _, ne := range at.Edges() {
			if _, taken := x.Ships[ne]; taken || !s.Board.SeaEdge(ne) {
				continue
			}
			x.Ships[ne] = p
			at = ne.Other(at)
			ships++
			extended = true
			break
		}
		if !extended {
			break
		}
	}
	roads := 0
	rAt := v
	for roads < 2 {
		extended := false
		for _, ne := range rAt.Edges() {
			if _, taken := s.Roads[ne]; taken {
				continue
			}
			if _, taken := x.Ships[ne]; taken {
				continue
			}
			if !s.Board.LandEdge(ne) {
				continue
			}
			s.Roads[ne] = p
			rAt = ne.Other(rAt)
			roads++
			extended = true
			break
		}
		if !extended {
			break
		}
	}

	want := ships + roads
	if got := engine.LongestRouteLength(s, p); got != want {
		t.Errorf("mixed route = %d, want %d (ships %d roads %d)", got, want, ships, roads)
	}

	// Without the junction building, road and ship segments don't join.
	delete(s.Buildings, v)
	if got := engine.LongestRouteLength(s, p); got >= want && roads > 0 && ships > 0 {
		t.Errorf("route without junction building = %d, want < %d", got, want)
	}
}

// TestLongestRouteLengthIslands checks engine.LongestRouteLength with the
// Islands RouteEdges hook active: a ship chain longer than any road is counted
// and beats the roads-only LongestRoadLength. It also confirms the helper
// matches what the longest-route award credits (decide.go calls the same
// helper).
func TestLongestRouteLengthIslands(t *testing.T) {
	s, _ := newGame(t, 9)
	p := engine.PlayerID(0)
	s.Buildings = map[board.Vertex]engine.Building{}
	s.Roads = map[board.Edge]engine.PlayerID{}
	x := ext(s)
	x.Ships = map[board.Edge]engine.PlayerID{}

	// A ship chain of length >= 5 anchored at a coastal building, no roads.
	e, v := coastalSpot(t, s)
	s.Buildings[v] = engine.Building{Owner: p}
	x.Ships[e] = p
	at := e.Other(v)
	ships := 1
	for ships < 5 {
		extended := false
		for _, ne := range at.Edges() {
			if _, taken := x.Ships[ne]; taken || !s.Board.SeaEdge(ne) {
				continue
			}
			x.Ships[ne] = p
			at = ne.Other(at)
			ships++
			extended = true
			break
		}
		if !extended {
			break
		}
	}
	if ships < 5 {
		t.Fatalf("only %d ships could be chained", ships)
	}

	hook := engine.LongestRouteLength(s, p)
	if hook != ships {
		t.Fatalf("ship route = %d, want %d", hook, ships)
	}
	if road := engine.LongestRoadLength(s, p); engine.LongestRouteLength(s, p) <= road {
		t.Errorf("route %d not greater than roads-only %d", engine.LongestRouteLength(s, p), road)
	}

	// Cross-check the award: the helper's ruleset-wide best matches the seat the
	// engine would credit with the longest route (decide.go calls the same helper).
	best, bestP := 0, engine.NoPlayer
	for i := range s.Players {
		if l := engine.LongestRouteLength(s, engine.PlayerID(i)); l > best {
			best, bestP = l, engine.PlayerID(i)
		}
	}
	if bestP != p || best != ships {
		t.Errorf("award cross-check: best seat %d len %d, want seat %d len %d", bestP, best, p, ships)
	}
}

func TestMapEligibility(t *testing.T) {
	// The all-land beginner map plays base, but cannot host islands.
	if err := engine.ValidatePresetRuleset("beginner", 4, "base"); err != nil {
		t.Errorf("beginner+base: %v", err)
	}
	if err := engine.ValidatePresetRuleset("beginner", 4, "base+islands"); err == nil {
		t.Error("beginner map has no sea; islands should be rejected")
	}

	// A map carrying Islands' own terrain requires the Islands module. That
	// terrain is gold, not sea (engine.RegisterTerrain names Gold, and Lake for
	// Fishermen; sea is ordinary water any map may author), so the fixture is a
	// seed whose carve turned islets gold.
	s, _ := newGame(t, 10) // procedural islands board: 2 gold islets
	gold := 0
	for _, tile := range s.Board.Tiles {
		if tile.Res == board.Gold {
			gold++
		}
	}
	if gold == 0 {
		t.Fatal("fixture board has no gold")
	}
	if err := engine.ValidateMap(s.Board, "base"); err == nil {
		t.Error("gold terrain without islands should be rejected")
	}
	if err := engine.ValidateMap(s.Board, "base+islands"); err != nil {
		t.Errorf("islands map with islands: %v", err)
	}
}

func TestIslandsReplayEqualsLive(t *testing.T) {
	s, log := newGame(t, 10)

	// Play a handful of auto turns to accumulate module events.
	for i := 0; i < 40 && s.Phase != engine.PhaseFinished; i++ {
		cmd, ok := engine.AutoCommand(s)
		if !ok {
			break
		}
		log = append(log, step(t, s, cmd)...)
	}

	replayed, err := engine.Replay(log)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(s, replayed) {
		t.Errorf("islands replay diverged\nlive:     %+v\nreplayed: %+v", s, replayed)
	}
}

// TestSettlementAtShipEndpoint guards the core Islands colonization rule: a
// settlement may be founded at a vertex reached only by the player's own ship
// route, with no adjacent road.
func TestSettlementAtShipEndpoint(t *testing.T) {
	s, _ := rolledState(t, 2)
	p := s.Cur
	s.Buildings = map[board.Vertex]engine.Building{}
	s.Roads = map[board.Edge]engine.PlayerID{}
	x := ext(s)
	x.Ships = map[board.Edge]engine.PlayerID{}

	// A sea edge with a free, distance-rule-OK land endpoint.
	var e board.Edge
	var v board.Vertex
	found := false
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		if !s.Board.IsSea(h) {
			continue
		}
		for _, ed := range h.Edges() {
			for _, cand := range []board.Vertex{ed.A, ed.B} {
				if canSettle(s, cand) == nil {
					e, v, found = ed, cand, true
					break
				}
			}
			if found {
				break
			}
		}
		if found {
			break
		}
	}
	if !found {
		t.Fatal("no coastal sea edge with a settleable far vertex")
	}

	x.Ships[e] = p // our ship touches v; no roads exist anywhere
	s.Players[p].Hand = engine.CostSettlement

	if _, err := engine.Decide(s, engine.Command{Player: p, Type: engine.CmdBuildSettlement,
		Data: mustJSON(t, map[string]any{"v": v})}); err != nil {
		t.Fatalf("settlement at ship endpoint rejected: %v", err)
	}
}

// TestLegalSettlementsIncludeShipEndpoints is the legal-set counterpart: the
// active player's offered settlement spots must include a ship-only endpoint.
func TestLegalSettlementsIncludeShipEndpoints(t *testing.T) {
	s, _ := rolledState(t, 2)
	p := s.Cur
	s.Buildings = map[board.Vertex]engine.Building{}
	s.Roads = map[board.Edge]engine.PlayerID{}
	x := ext(s)
	x.Ships = map[board.Edge]engine.PlayerID{}

	var e board.Edge
	var v board.Vertex
	found := false
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		if !s.Board.IsSea(h) {
			continue
		}
		for _, ed := range h.Edges() {
			for _, cand := range []board.Vertex{ed.A, ed.B} {
				if canSettle(s, cand) == nil {
					e, v, found = ed, cand, true
					break
				}
			}
			if found {
				break
			}
		}
		if found {
			break
		}
	}
	if !found {
		t.Fatal("no coastal sea edge with a settleable far vertex")
	}

	x.Ships[e] = p
	if slices.Contains(s.LegalSettlements(p), v) {
		return
	}
	t.Fatalf("ship endpoint %v not offered as a legal settlement", v)
}
