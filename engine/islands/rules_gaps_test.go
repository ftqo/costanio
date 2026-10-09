package islands

import (
	"errors"
	"slices"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"

	// Knights, so "base+islands+cak" resolves and its BlocksVertex hook (the
	// enemy knight) is live for the ship-continuity tests below.
	_ "github.com/ftqo/costan.io/engine/knights"
)

// knightEvent mirrors cak's unexported knightData JSON shape, as
// bot/blocker_test.go does: knights.EvKnightBuilt is exported but its payload type
// is not, and applying the event is the simplest way to put an enemy knight on
// a vertex.
type knightEvent struct {
	Player engine.PlayerID `json:"player"`
	V      board.Vertex    `json:"v"`
	Free   bool            `json:"free"`
	Level  int             `json:"level"`
}

// applyAt stamps an injected event with the sequence the log expects.
// engine.NewEvent leaves Seq zero, and Apply refuses an out-of-order event.
func applyAt(s *engine.State, e engine.Event) error {
	e.Seq = s.NextSeq
	return engine.Apply(s, e)
}

// islandsKnightsGame is newGame for the combined ruleset. It stops at the start of
// the first real turn, before the roll, which is where both callers want it.
func islandsKnightsGame(t *testing.T, seed uint64) *engine.State {
	t.Helper()
	log, err := engine.New(engine.GameConfig{Players: 3, Ruleset: engine.CanonicalRuleset("base+islands+cak")}, engine.SeedsFrom(seed))
	if err != nil {
		t.Fatal(err)
	}
	s := engine.Empty()
	for _, e := range log {
		if err := engine.Apply(s, e); err != nil {
			t.Fatal(err)
		}
	}
	for s.Phase == engine.PhaseSetup || len(extRO(s).PendingGold) > 0 {
		cmd, ok := engine.AutoCommand(s)
		if !ok {
			t.Fatal("setup stuck")
		}
		step(t, s, cmd)
	}
	return s
}

// shipChainSpot finds v0 -(e1)- v1 -(e2)- v2: two sea edges meeting at a bare
// vertex, with a free land vertex at the far end to hang a building on. That
// middle vertex is where a knight gets to decide whether the chain continues.
func shipChainSpot(t *testing.T, s *engine.State) (v0 board.Vertex, e1, e2 board.Edge) {
	t.Helper()
	for _, e := range seaEdges(s) {
		for _, a := range []board.Vertex{e.A, e.B} {
			b := e.Other(a)
			if _, taken := s.Buildings[a]; taken {
				continue
			}
			if _, taken := s.Buildings[b]; taken {
				continue
			}
			if _, taken := s.Roads[e]; taken {
				continue
			}
			for _, ne := range b.Edges() {
				if ne == e || !ne.Valid() || !s.Board.SeaEdge(ne) {
					continue
				}
				if _, taken := s.Roads[ne]; taken {
					continue
				}
				far := ne.Other(b)
				if _, taken := s.Buildings[far]; taken {
					continue
				}
				return a, e, ne
			}
		}
	}
	t.Fatal("no free two-edge sea chain on this board")
	return board.Vertex{}, board.Edge{}, board.Edge{}
}

// TestEnemyKnightBlocksShipContinuity: a knight blocks an opponent's road
// continuity through its intersection like a settlement
// (docs/rules/knights.md), and the same applies to ships, so ship build
// legality agrees with routeLength, which consults VertexBlocked.
func TestEnemyKnightBlocksShipContinuity(t *testing.T) {
	s := islandsKnightsGame(t, 11)
	p := s.Cur
	enemy := engine.PlayerID((int(p) + 1) % len(s.Players))
	v0, e1, e2 := shipChainSpot(t, s)

	x := ext(s)
	s.Buildings[v0] = engine.Building{Owner: p}
	x.Ships[e1] = p
	mid := e1.Other(v0)

	if err := (Module{}).checkShipSpot(s, x, e2, p, nil); err != nil {
		t.Fatalf("continuing our own ship chain should be legal, got %v", err)
	}

	if err := applyAt(s, engine.NewEvent("cak_knight_built",
		knightEvent{Player: enemy, V: mid, Free: true, Level: 1})); err != nil {
		t.Fatal(err)
	}
	if !s.VertexBlocked(mid, p) {
		t.Fatal("test setup: the injected knight does not block the middle vertex")
	}
	if err := (Module{}).checkShipSpot(s, x, e2, p, nil); !errors.Is(err, engine.ErrBadPlacement) {
		t.Errorf("ship through an enemy knight: got %v, want ErrBadPlacement", err)
	}
	// The legal set comes from the same validator, so the frontend must not
	// offer it either.
	for _, e := range s.LegalTargetsFor(p).Ships {
		if e == e2 {
			t.Error("legalExtras still offers the edge past an enemy knight")
		}
	}
}

// TestOwnKnightDoesNotBlockShipContinuity: BlocksVertex is true only for an
// opponent's knight, so blocking every knight would fail here.
func TestOwnKnightDoesNotBlockShipContinuity(t *testing.T) {
	s := islandsKnightsGame(t, 11)
	p := s.Cur
	v0, e1, e2 := shipChainSpot(t, s)

	x := ext(s)
	s.Buildings[v0] = engine.Building{Owner: p}
	x.Ships[e1] = p
	mid := e1.Other(v0)

	if err := applyAt(s, engine.NewEvent("cak_knight_built",
		knightEvent{Player: p, V: mid, Free: true, Level: 1})); err != nil {
		t.Fatal(err)
	}
	if err := (Module{}).checkShipSpot(s, x, e2, p, nil); err != nil {
		t.Errorf("our own knight must not block our own ship chain, got %v", err)
	}
}

// TestFreeShipPlaceableBeforeRolling: Road Building builds "2 roads, 2 ships,
// or 1 ship and 1 road" (docs/rules/islands.md) and has no roll requirement, so
// the free ship is exempt from the roll like the free road.
func TestFreeShipPlaceableBeforeRolling(t *testing.T) {
	s, _ := newGame(t, 7)
	if s.Phase != engine.PhasePlay || s.Rolled {
		t.Fatalf("newGame(7) is past the first roll (phase=%v rolled=%v)", s.Phase, s.Rolled)
	}
	e, v := coastalSpot(t, s)
	p := s.Cur
	s.Buildings[v] = engine.Building{Owner: p}
	s.Players[p].Hand = engine.Hand{} // the card pays, not the hand

	cmd := engine.Command{Player: p, Type: CmdBuildShip, Data: mustJSON(t, map[string]any{"e": e})}
	if _, err := engine.Decide(s, cmd); err == nil {
		t.Fatal("a ship with no free builds and no roll must be rejected")
	} else if !errors.Is(err, engine.ErrMustRoll) {
		t.Fatalf("without the card: got %v, want ErrMustRoll", err)
	}

	s.FreeRoads = 2
	if _, err := engine.Decide(s, cmd); err != nil {
		t.Fatalf("Road Building's free ship before the roll: %v", err)
	}
}

// TestFreeShipStillWaitsBehindInterrupts: the exemption is from the roll, not
// from the robber or a discard. Free roads wait behind those (freeRoadPlaceable
// goes through requireUninterruptedTurn) and the ship must too.
func TestFreeShipStillWaitsBehindInterrupts(t *testing.T) {
	s, _ := newGame(t, 7)
	if s.Phase != engine.PhasePlay || s.Rolled {
		t.Fatalf("newGame(7) is past the first roll (phase=%v rolled=%v)", s.Phase, s.Rolled)
	}
	e, v := coastalSpot(t, s)
	p := s.Cur
	s.Buildings[v] = engine.Building{Owner: p}
	s.Players[p].Hand = engine.Hand{}
	s.FreeRoads = 2
	s.RobberPending = true

	// The error is ErrMustRoll rather than ErrRobberPending because
	// requireActionableTurn tests the roll first, which matches the base free
	// road in the same state. What matters is that the build is refused.
	cmd := engine.Command{Player: p, Type: CmdBuildShip, Data: mustJSON(t, map[string]any{"e": e})}
	if _, err := engine.Decide(s, cmd); err == nil {
		t.Fatal("free ship placed with the robber still pending")
	}
	road := engine.Command{Player: p, Type: engine.CmdBuildRoad, Data: mustJSON(t, map[string]any{"e": e})}
	if _, err := engine.Decide(s, road); err == nil {
		t.Fatal("test premise: the base free road is not refused here either")
	}
}

// TestSetupShipsSkipRoadOccupiedEdges: a coastal edge is both land and sea, so
// another seat's setup road can already sit on an edge touching the settlement
// being connected, and decidePlaceRoad rejects it with ErrOccupied. legalExtras
// must not offer such an edge for a setup ship.
func TestSetupShipsSkipRoadOccupiedEdges(t *testing.T) {
	log, err := engine.New(engine.GameConfig{Players: 3, Ruleset: "base+islands"}, engine.SeedsFrom(3))
	if err != nil {
		t.Fatal(err)
	}
	s := engine.Empty()
	for _, e := range log {
		if err := engine.Apply(s, e); err != nil {
			t.Fatal(err)
		}
	}
	// Place the draft's first settlement on the coast, so it has sea edges for
	// a ship, chosen from the legal targets rather than left to auto-pass.
	placed := false
	for _, v := range s.LegalSettlements(s.Cur) {
		coastal := false
		for _, e := range v.Edges() {
			if s.Board.SeaEdge(e) && s.Board.LandEdge(e) {
				coastal = true
			}
		}
		if coastal {
			step(t, s, engine.Command{Player: s.Cur, Type: engine.CmdPlaceSettlement,
				Data: mustJSON(t, engine.SettlementPlacedData{V: v})})
			placed = true
			break
		}
	}
	if !placed {
		t.Fatal("no coastal starting settlement is legal")
	}
	if !s.NeedRoad {
		t.Fatal("setup never asked for a connector")
	}
	p := s.Cur

	offered := s.LegalTargetsFor(p).Ships
	if len(offered) == 0 {
		t.Fatal("setup settlement has no free ship edge")
	}
	// Park an opponent's road on the first offered edge and re-ask.
	blocked := offered[0]
	s.Roads[blocked] = engine.PlayerID((int(p) + 1) % len(s.Players))

	for _, e := range s.LegalTargetsFor(p).Ships {
		if e == blocked {
			t.Fatal("setup ships still offer an edge a road already holds")
		}
	}
	// The validator does refuse it, so offering it would be wrong.
	cmd := engine.Command{Player: p, Type: engine.CmdPlaceRoad,
		Data: mustJSON(t, map[string]any{"e": blocked, "ship": true})}
	if _, err := engine.Decide(s, cmd); !errors.Is(err, engine.ErrOccupied) {
		t.Fatalf("placing a setup ship on a road edge: got %v, want ErrOccupied", err)
	}
}

// TestFreeShipOfferedBeforeRolling is the legal-set half of
// TestFreeShipPlaceableBeforeRolling: the validator accepts Road Building's
// free ship before the roll, so LegalTargetsFor must offer it alongside the
// free roads.
func TestFreeShipOfferedBeforeRolling(t *testing.T) {
	s, _ := newGame(t, 7)
	if s.Phase != engine.PhasePlay || s.Rolled {
		t.Fatalf("newGame(7) is past the first roll (phase=%v rolled=%v)", s.Phase, s.Rolled)
	}
	e, v := coastalSpot(t, s)
	p := s.Cur
	s.Buildings[v] = engine.Building{Owner: p}
	s.Players[p].Hand = engine.Hand{}

	if lt := s.LegalTargetsFor(p); slices.Contains(lt.Ships, e) {
		t.Fatal("premise: with no free build and no roll, no ship may be offered")
	}
	s.FreeRoads = 2
	lt := s.LegalTargetsFor(p)
	if !slices.Contains(lt.Ships, e) {
		t.Fatalf("Road Building's free ship is legal before the roll but %v was not offered (ships offered: %v)", e, lt.Ships)
	}
	if len(lt.ShipMoves) != 0 {
		t.Errorf("a free build does not unlock a ship MOVE before the roll, got %v", lt.ShipMoves)
	}
	for _, off := range lt.Ships {
		cmd := engine.Command{Player: p, Type: CmdBuildShip, Data: mustJSON(t, map[string]any{"e": off})}
		if _, err := engine.Decide(s, cmd); err != nil {
			t.Errorf("offered free ship %v is refused: %v", off, err)
		}
	}

	// It still waits behind an interrupt, as the validator does.
	s.RobberPending = true
	if lt := s.LegalTargetsFor(p); len(lt.Ships) != 0 {
		t.Errorf("free ship offered with the robber pending: %v", lt.Ships)
	}
}
