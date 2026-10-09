package islands

import (
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// TestLegalShipsSubsetOfValidator: every sea edge reported as a legal
// ship-build target must pass checkShipSpot, so the board never offers an
// illegal ship spot.
func TestLegalShipsSubsetOfValidator(t *testing.T) {
	s, _ := rolledState(t, 2)
	e, v := coastalSpot(t, s)
	p := s.Cur
	s.Buildings[v] = engine.Building{Owner: p}
	x := ext(s)

	ships := s.LegalTargetsFor(p).Ships
	if len(ships) == 0 {
		t.Fatal("expected at least one legal ship edge once a coastal building exists")
	}
	for _, e := range ships {
		if err := (Module{}).checkShipSpot(s, x, e, p, nil); err != nil {
			t.Errorf("reported ship edge %v fails checkShipSpot: %v", e, err)
		}
		if !s.Board.SeaEdge(e) {
			t.Errorf("reported ship edge %v is not a sea edge", e)
		}
	}

	// The anchoring coastal edge must be offered.
	found := false
	for _, le := range ships {
		if le == e {
			found = true
		}
	}
	if !found {
		t.Errorf("coastal edge %v at our building not reported legal", e)
	}

	// Building a ship there removes it from the legal set.
	s.Players[p].Hand = CostShip
	step(t, s, engine.Command{Player: p, Type: CmdBuildShip, Data: mustJSON(t, map[string]any{"e": e})})
	for _, le := range s.LegalTargetsFor(p).Ships {
		if le == e {
			t.Errorf("occupied edge %v still reported as a legal ship spot", e)
		}
	}
}

// TestLegalShipsEmptyWhenNoPieces: with ShipsLeft==0 the build set is empty, so
// the frontend hides the option.
func TestLegalShipsEmptyWhenNoPieces(t *testing.T) {
	s, _ := rolledState(t, 2)
	_, v := coastalSpot(t, s)
	p := s.Cur
	s.Buildings[v] = engine.Building{Owner: p}
	if len(s.LegalTargetsFor(p).Ships) == 0 {
		t.Fatal("expected ship edges with a coastal building")
	}
	ext(s).ShipsLeft[p] = 0
	if got := s.LegalTargetsFor(p).Ships; len(got) != 0 {
		t.Errorf("ships reported with no pieces left: %v", got)
	}
}

// TestLegalShipsExcludesPirateAdjacent: a sea edge bordering the pirate is never
// reported (ErrPirateBlocks).
func TestLegalShipsExcludesPirateAdjacent(t *testing.T) {
	s, _ := rolledState(t, 2)
	e, v := coastalSpot(t, s)
	p := s.Cur
	s.Buildings[v] = engine.Building{Owner: p}
	x := ext(s)

	// Place the pirate on a sea hex bordering the coastal edge e.
	var seaHex board.Hex
	for _, h := range board.EdgeHexes(e) {
		if s.Board.IsSea(h) {
			seaHex = h
		}
	}
	x.Pirate = seaHex
	x.HasPirate = true

	for _, le := range s.LegalTargetsFor(p).Ships {
		if bordersHex(le, seaHex) {
			t.Errorf("pirate-adjacent edge %v reported as a legal ship spot", le)
		}
		// Every reported edge still passes the validator.
		if err := (Module{}).checkShipSpot(s, x, le, p, nil); err != nil {
			t.Errorf("reported ship edge %v fails checkShipSpot: %v", le, err)
		}
	}
}

// TestLegalShipMovesSubset: every (from,to) pair reported as a legal ship move
// is accepted by decideMoveShip, and a destination not in the set is rejected.
func TestLegalShipMovesSubset(t *testing.T) {
	s, _ := rolledState(t, 4)
	e, v := coastalSpot(t, s)
	p := s.Cur
	s.Buildings[v] = engine.Building{Owner: p}
	x := ext(s)
	// Plant a movable ship directly (not built this turn).
	x.Ships[e] = p

	moves := s.LegalTargetsFor(p).ShipMoves
	if len(moves) == 0 {
		t.Fatalf("planted ship at %v has no legal destinations", e)
	}
	for _, grp := range moves {
		for _, to := range grp.To {
			if _, err := engine.Decide(s, engine.Command{Player: p, Type: CmdMoveShip,
				Data: mustJSON(t, map[string]any{"from": grp.From, "to": to})}); err != nil {
				t.Errorf("reported ship move %v->%v rejected by decideMoveShip: %v", grp.From, to, err)
			}
		}
		// Moving a ship onto itself is never legal and never in the set.
		if _, err := engine.Decide(s, engine.Command{Player: p, Type: CmdMoveShip,
			Data: mustJSON(t, map[string]any{"from": grp.From, "to": grp.From})}); err == nil {
			t.Errorf("from==to move %v unexpectedly accepted", grp.From)
		}
		for _, to := range grp.To {
			if to == grp.From {
				t.Errorf("from==to %v wrongly reported as a legal move", to)
			}
		}
	}
}

// TestLegalShipMovesEmptyWhenMoved: once a ship has moved this turn, no further
// moves are offered.
func TestLegalShipMovesEmptyWhenMoved(t *testing.T) {
	s, _ := rolledState(t, 4)
	e, v := coastalSpot(t, s)
	p := s.Cur
	s.Buildings[v] = engine.Building{Owner: p}
	x := ext(s)
	x.Ships[e] = p
	if len(s.LegalTargetsFor(p).ShipMoves) == 0 {
		t.Fatalf("planted ship at %v is not movable", e)
	}
	x.MovedShip = true
	if got := s.LegalTargetsFor(p).ShipMoves; len(got) != 0 {
		t.Errorf("ship moves reported after a move this turn: %v", got)
	}
}

// TestLegalShipMovesExcludesBuiltThisTurn: a ship built this turn contributes no
// move group.
func TestLegalShipMovesExcludesBuiltThisTurn(t *testing.T) {
	s, _ := rolledState(t, 4)
	e, v := coastalSpot(t, s)
	p := s.Cur
	s.Buildings[v] = engine.Building{Owner: p}
	x := ext(s)
	x.Ships[e] = p
	x.BuiltTurn[e] = true
	for _, grp := range s.LegalTargetsFor(p).ShipMoves {
		if grp.From == e {
			t.Errorf("ship built this turn %v wrongly reported as movable", e)
		}
	}
}

// TestLegalShipsNotCurrentPlayer: a non-current player gets no ship targets.
func TestLegalShipsNotCurrentPlayer(t *testing.T) {
	s, _ := rolledState(t, 2)
	e, v := coastalSpot(t, s)
	p := s.Cur
	s.Buildings[v] = engine.Building{Owner: p}
	ext(s).Ships[e] = p
	other := (p + 1) % engine.PlayerID(len(s.Players))
	lt := s.LegalTargetsFor(other)
	if len(lt.Ships) != 0 || len(lt.ShipMoves) != 0 {
		t.Errorf("non-current player has ship targets: ships=%v moves=%v", lt.Ships, lt.ShipMoves)
	}
}

// TestLegalSetupShips: at setup with NeedRoad, legal.Ships are exactly the sea
// edges touching LastSettlement that setupShipEvent accepts, disjoint from the
// land roads.
func TestLegalSetupShips(t *testing.T) {
	// Drive a fresh game to a setup state where a road/ship is needed.
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
	// Advance setup until a settlement was just placed and a road/ship is owed.
	for s.Phase == engine.PhaseSetup && !s.NeedRoad {
		cmd, ok := engine.AutoCommand(s)
		if !ok {
			t.Fatal("setup stuck before NeedRoad")
		}
		step(t, s, cmd)
	}
	if s.Phase != engine.PhaseSetup || !s.NeedRoad {
		t.Fatal("setup never reached NeedRoad")
	}
	p := s.Cur

	lt := s.LegalTargetsFor(p)
	// Every reported setup ship edge is a sea edge touching LastSettlement that
	// setupShipEvent would accept.
	for _, e := range lt.Ships {
		if !s.Board.SeaEdge(e) {
			t.Errorf("setup ship edge %v not a sea edge", e)
		}
		if !e.Touches(s.LastSettlement) {
			t.Errorf("setup ship edge %v does not touch the settlement", e)
		}
		if _, ok := setupShipEvent(s, e, p); !ok {
			t.Errorf("setup ship edge %v not accepted by setupShipEvent", e)
		}
	}
	// Roads and ships overlap, only on coastal edges. A coastal edge borders
	// land and sea, so it is eligible for a road or a ship
	// (docs/rules/islands.md) and holds whichever the player picks, which is
	// why decidePlaceRoad takes an explicit `ship` flag. The invariant is that
	// every edge in both lists is coastal, not that the lists are disjoint.
	roadSet := map[board.Edge]bool{}
	for _, r := range lt.Roads {
		roadSet[r] = true
	}
	for _, e := range lt.Ships {
		if roadSet[e] && !(s.Board.LandEdge(e) && s.Board.SeaEdge(e)) {
			t.Errorf("edge %v reported as both road and ship but is not coastal", e)
		}
	}
	// And the set matches exactly the touching, free sea edges.
	want := map[board.Edge]bool{}
	x := ext(s)
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		for _, e := range h.Edges() {
			ne := board.NewEdge(e.A, e.B)
			if !s.Board.SeaEdge(ne) || !ne.Touches(s.LastSettlement) {
				continue
			}
			if _, taken := x.Ships[ne]; taken {
				continue
			}
			want[ne] = true
		}
	}
	got := map[board.Edge]bool{}
	for _, e := range lt.Ships {
		got[e] = true
	}
	if len(want) != len(got) {
		t.Errorf("setup ship set size mismatch: want %d got %d", len(want), len(got))
	}
	for e := range want {
		if !got[e] {
			t.Errorf("setup ship edge %v expected but missing", e)
		}
	}
}
