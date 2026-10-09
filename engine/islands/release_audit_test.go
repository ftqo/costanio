package islands

import (
	"errors"
	"testing"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// These pin rules from docs/rules/islands.md that hold by construction but were
// not otherwise tested, so a regression in any of them would go unnoticed.

// TestShipPriceAndSupply pins the literals. Other tests use
// CostShip and MaxShips-1, which would pass with any value.
func TestShipPriceAndSupply(t *testing.T) {
	want := engine.Hand{}
	want[board.Wood] = 1
	want[board.Sheep] = 1
	if CostShip != want {
		t.Errorf("a ship costs 1 lumber + 1 wool, got %v", CostShip)
	}
	if MaxShips != 15 {
		t.Errorf("each player has 15 ships, got %d", MaxShips)
	}
	for p, n := range freshExt(4).ShipsLeft {
		if n != 15 {
			t.Errorf("seat %d starts with %d ships, want 15", p, n)
		}
	}
}

// TestPirateBlocksMovingAShipOntoItsWater pins the "to" half of the symmetric
// pirate block (no moving a ship to or from its water). The "from" half has its
// own test; this half is enforced through checkShipSpot, shared with the build
// path, so a move-only regression needs its own test.
func TestPirateBlocksMovingAShipOntoItsWater(t *testing.T) {
	s := builtState(t, 2, board.Hex{Q: 1, R: 0}, board.Hex{Q: 1, R: -1}, board.Hex{Q: 2, R: -1}, board.Hex{Q: 2, R: 0}, board.Hex{Q: 0, R: 1})
	p := s.Cur
	x := ext(s)
	// A coastal vertex with two sea edges, and a sea hex that borders the
	// destination but not the source.
	for _, h := range board.HexesInRadius(2) {
		for _, v := range h.Vertices() {
			if !s.Board.LandVertex(v) {
				continue
			}
			for _, from := range v.Edges() {
				for _, to := range v.Edges() {
					if from == to || !s.Board.SeaEdge(from) || !s.Board.SeaEdge(to) {
						continue
					}
					for _, ph := range board.EdgeHexes(to) {
						if !s.Board.IsSea(ph) || bordersHex(from, ph) {
							continue
						}
						s.Buildings = map[board.Vertex]engine.Building{v: {Owner: p}}
						x.Ships = map[board.Edge]engine.PlayerID{from: p}
						move := engine.Command{Player: p, Type: CmdMoveShip, Data: mustJSON(t, map[string]any{"from": from, "to": to})}

						x.HasPirate = false
						if _, err := engine.Decide(s, move); err != nil {
							t.Fatalf("control: with no pirate the move %v->%v must be legal, got %v", from, to, err)
						}
						x.HasPirate, x.Pirate = true, ph
						if _, err := engine.Decide(s, move); !errors.Is(err, ErrPirateBlocks) {
							t.Fatalf("moving a ship onto the pirate's water: got %v, want ErrPirateBlocks", err)
						}
						return
					}
				}
			}
		}
	}
	t.Fatal("no coastal vertex with two sea edges and a destination-only pirate hex on this board")
}

// TestGoldSettlementPayoutAndRobber pins the settlement arm of onDiceRolled
// and the robber exclusion on a gold hex.
func TestGoldSettlementPayoutAndRobber(t *testing.T) {
	s := builtState(t, 2, board.Hex{Q: 2, R: 0})
	gold := board.Hex{Q: -1, R: 0}
	s.Board.Tiles[gold] = board.Tile{Res: board.Gold, Number: 8}
	v := gold.Vertices()[0]
	s.Buildings[v] = engine.Building{Owner: 1}

	owed := func() int {
		evs := (Module{}).onDiceRolled(s, 4, 4)
		n := 0
		for _, e := range evs {
			for _, o := range engine.DecodeEvent[goldOwedData](e).Owed {
				if o.Player == 1 {
					n += o.Count
				}
			}
		}
		return n
	}
	if got := owed(); got != 1 {
		t.Errorf("a settlement on a rolled gold hex owes 1 pick, got %d", got)
	}
	s.Buildings[v] = engine.Building{Owner: 1, City: true}
	if got := owed(); got != 2 {
		t.Errorf("a city on a rolled gold hex owes 2 picks, got %d", got)
	}
	s.Board.Robber = gold
	if got := owed(); got != 0 {
		t.Errorf("a gold hex under the robber pays nothing, got %d", got)
	}
}

// TestPirateCannotRobACoastalSettlement pins "a coastal settlement next to that
// hex is not a target; only a ship is".
func TestPirateCannotRobACoastalSettlement(t *testing.T) {
	sea := board.Hex{Q: 1, R: 0}
	s := builtState(t, 2, sea)
	s.RobberPending = true
	victim := engine.PlayerID(1)
	s.Players[victim].Hand = engine.Hand{board.Wheat: 3}
	s.Buildings[sea.Vertices()[0]] = engine.Building{Owner: victim, City: true}

	if v := pirateVictims(s, sea, 0); len(v) != 0 {
		t.Fatalf("a building beside the pirate made its owner a victim: %v", v)
	}
	decideErr(t, s, engine.Command{Player: 0, Type: CmdMovePirate,
		Data: mustJSON(t, map[string]any{"hex": sea, "victim": victim})}, engine.ErrBadVictim)

	// Control: the same player with a ship on that water is a victim.
	for _, e := range sea.Edges() {
		if s.Board.SeaEdge(e) {
			ext(s).Ships[e] = victim
			break
		}
	}
	if !pirateVictims(s, sea, 0)[victim] {
		t.Fatal("control: a ship beside the pirate must make its owner a victim")
	}
}

// TestDistanceRuleCrossesWater pins "two settlements on neighbouring islands
// separated by one narrow channel are still one edge apart and still conflict".
// The edge between them lies between two sea hexes; the settlement is anchored
// by a ship, so only the distance rule can refuse it.
func TestDistanceRuleCrossesWater(t *testing.T) {
	s := builtState(t, 2, board.Hex{Q: 0, R: 1}, board.Hex{Q: 1, R: 0})
	p := s.Cur
	var channel board.Edge
	found := false
	channelHex := board.Hex{Q: 0, R: 1}
	for _, e := range channelHex.Edges() {
		e = board.NewEdge(e.A, e.B)
		hs := board.EdgeHexes(e)
		if len(hs) == 2 && s.Board.IsSea(hs[0]) && s.Board.IsSea(hs[1]) &&
			s.Board.LandVertex(e.A) && s.Board.LandVertex(e.B) {
			channel, found = e, true
			break
		}
	}
	if !found {
		t.Fatal("no one-edge channel between two land vertices on this board")
	}
	a, b := channel.A, channel.B
	s.Players[p].Hand = engine.Hand{board.Wood: 1, board.Brick: 1, board.Sheep: 1, board.Wheat: 1}
	ext(s).Ships[channel] = p // anchors b (and a)
	build := engine.Command{Player: p, Type: engine.CmdBuildSettlement, Data: mustJSON(t, map[string]any{"v": b})}

	if _, err := engine.Decide(s, build); err != nil {
		t.Fatalf("control: with the far shore empty the settlement is legal, got %v", err)
	}
	s.Buildings[a] = engine.Building{Owner: 1}
	if _, err := engine.Decide(s, build); err == nil {
		t.Fatal("a settlement one edge from another across a channel was accepted")
	}
}

// TestClosedRouteStaysClosedWhenCut pins "a closed route stays closed even
// after an opponent cuts it": two ships joining two of our buildings, and an
// opponent settling the intersection between them. Neither ship becomes open.
func TestClosedRouteStaysClosedWhenCut(t *testing.T) {
	s := builtState(t, 2, board.Hex{Q: 1, R: 0}, board.Hex{Q: 1, R: -1}, board.Hex{Q: 2, R: -1}, board.Hex{Q: 2, R: 0})
	p := s.Cur
	x := ext(s)
	// A path A -e1- m -e2- B of sea edges over three land vertices.
	for _, e1 := range seaEdges(s) {
		for _, m := range []board.Vertex{e1.A, e1.B} {
			a := e1.Other(m)
			if !s.Board.LandVertex(a) || !s.Board.LandVertex(m) {
				continue
			}
			for _, e2 := range m.Edges() {
				e2 = board.NewEdge(e2.A, e2.B)
				b := e2.Other(m)
				if e2 == e1 || !s.Board.SeaEdge(e2) || !s.Board.LandVertex(b) || b == a {
					continue
				}
				s.Buildings = map[board.Vertex]engine.Building{a: {Owner: p}, b: {Owner: p}}
				x.Ships = map[board.Edge]engine.PlayerID{e1: p, e2: p}
				m0 := Module{}
				if m0.shipOpen(s, x, e1, p) || m0.shipOpen(s, x, e2, p) {
					t.Fatal("premise: a route joining two buildings is closed")
				}
				s.Buildings[m] = engine.Building{Owner: 1}
				if m0.shipOpen(s, x, e1, p) || m0.shipOpen(s, x, e2, p) {
					t.Fatal("an opponent settling partway along a closed route opened it")
				}
				return
			}
		}
	}
	t.Fatal("no three-vertex coastal ship path on this board")
}
