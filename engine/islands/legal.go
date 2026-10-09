package islands

import (
	"sort"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// vertexKey/edgeLess give a deterministic ordering for ships and ship-move
// groups (the engine sorts, the redactor keeps it stable).
func vertexKey(v board.Vertex) [3]int { return [3]int{v.Q, v.R, int(v.Side)} }

func keyLess(a, b [3]int) bool {
	for i := range a {
		if a[i] != b[i] {
			return a[i] < b[i]
		}
	}
	return false
}

func edgeLess(a, b board.Edge) bool {
	if a.A != b.A {
		return keyLess(vertexKey(a.A), vertexKey(b.A))
	}
	return keyLess(vertexKey(a.B), vertexKey(b.B))
}

// seaEdges returns every unique (normalized) sea edge of the board, mirroring
// the engine's boardEdges iteration (which is unexported to this package).
func seaEdges(s *engine.State) []board.Edge {
	seen := make(map[board.Edge]bool)
	var out []board.Edge
	for h := range s.Board.Tiles {
		for _, e := range h.Edges() {
			ne := board.NewEdge(e.A, e.B)
			if seen[ne] {
				continue
			}
			seen[ne] = true
			if ne.Valid() && s.Board.SeaEdge(ne) {
				out = append(out, ne)
			}
		}
	}
	sort.Slice(out, func(i, j int) bool { return edgeLess(out[i], out[j]) })
	return out
}

// legalExtras reports the Islands positional targets for seat: in setup, the
// free starting-ship sea edges; in play, the ship-build edges and per-ship move
// destinations. Positional only: cost (CostShip) and the ShipsLeft cap stay
// with decideBuildShip/decideMoveShip, though the gating signal (ShipsLeft > 0,
// !MovedShip) is mirrored so the frontend can disable options. The one price it
// checks is a composed module's price on a ship move (Rivers' coin), since the
// client cannot know it. Every reported edge is accepted by the corresponding
// validator.
func (m Module) legalExtras(s *engine.State, seat engine.PlayerID) engine.LegalExtra {
	x := extRO(s)
	var ex engine.LegalExtra

	// Setup: only the free setup-ship sea edges touching the just-placed
	// settlement (mirror setupShipEvent exactly). No build/move targets here.
	if s.Phase == engine.PhaseSetup {
		if !s.NeedRoad || x.ShipsLeft[seat] == 0 {
			return ex
		}
		var ships []board.Edge
		for _, e := range seaEdges(s) {
			if !e.Touches(s.LastSettlement) {
				continue
			}
			if _, taken := x.Ships[e]; taken {
				continue
			}
			if _, taken := s.Roads[e]; taken {
				// A coastal edge is both land and sea, so another seat's setup
				// road can already hold it, and decidePlaceRoad rejects that
				// with ErrOccupied before setupShipEvent runs. The play branch
				// checks this via checkShipSpot.
				continue
			}
			// A module may close the edge to ships (a Rivers bridge site, which
			// every river's coastal outlet is). decidePlaceRoad asks
			// s.EdgeRefusal before setupShipEvent, so the offer must too.
			if s.EdgeRefusal(e, engine.RouteShip) != nil {
				continue
			}
			ships = append(ships, e)
		}
		ex.Ships = ships
		return ex
	}

	// A pending robber/pirate move blocks ship builds/moves; offer only the
	// legal pirate destinations (mirrors decideMovePirate's placement rule).
	if s.RobberPending {
		if configFrom(s.Config).Pirate {
			ex.PirateHexes = legalPirateHexes(s, seat)
		}
		return ex
	}

	// Play: ship-build edges (only while a piece is free, so the FE hides the
	// option when out of pieces).
	if x.ShipsLeft[seat] > 0 {
		for _, e := range seaEdges(s) {
			if m.checkShipSpot(s, x, e, seat, nil) == nil {
				ex.Ships = append(ex.Ships, e)
			}
		}
	}

	// Ship-move groups: only when no ship has moved yet this turn.
	if !x.MovedShip {
		var fromEdges []board.Edge
		for e, owner := range x.Ships {
			if owner != seat {
				continue
			}
			if x.BuiltTurn[e] {
				continue
			}
			if x.HasPirate && bordersHex(e, x.Pirate) {
				continue
			}
			if !m.shipOpen(s, x, e, seat) {
				continue
			}
			fromEdges = append(fromEdges, e)
		}
		sort.Slice(fromEdges, func(i, j int) bool { return edgeLess(fromEdges[i], fromEdges[j]) })
		for _, from := range fromEdges {
			var to []board.Edge
			for _, dst := range seaEdges(s) {
				if dst == from {
					continue
				}
				if m.checkShipSpot(s, x, dst, seat, &from) != nil {
					continue
				}
				// A priced move the owner cannot pay for (Rivers: a coin to
				// take a ship off a river edge) is refused by decideMoveShip,
				// so it is not offered. The client does not know this price, so
				// it must be filtered here.
				if s.RouteMoveRefusal(seat, from, dst, engine.RouteShip) != nil {
					continue
				}
				to = append(to, dst)
			}
			if len(to) > 0 {
				ex.ShipMoves = append(ex.ShipMoves, engine.ShipMoveTargets{From: from, To: to})
			}
		}
	}

	return ex
}
