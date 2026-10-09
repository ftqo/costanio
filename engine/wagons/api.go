package wagons

import (
	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// Read-only surface for the bots, the scoreboard and the client-facing layers,
// so nothing outside this package keeps a second copy of the movement rules.
// Nothing returned may be mutated.

// Step is one path a wagon may take out of an intersection, priced.
type Step struct {
	To board.Vertex `json:"to"`
	E  board.Edge   `json:"e"`
	// Spoke is a path between a plaza and one of its trade hex's land corners.
	Spoke bool `json:"spoke"`
	// MP is what the path costs in movement points, barbarian included.
	MP int `json:"mp"`
	// Toll is the gold it pays, and Paid is who to. NoPlayer when it is free.
	Toll int             `json:"toll"`
	Paid engine.PlayerID `json:"paid"`
}

// StepsFrom lists every path out of v, priced for p, whether or not p can
// afford it. Returns nil when Wagons is not active or the board is not dealt.
func StepsFrom(s *engine.State, p engine.PlayerID, v board.Vertex) []Step {
	if !hasWagons(s) || s.Board == nil {
		return nil
	}
	x := extRO(s)
	if !x.HasTrade {
		return nil
	}
	var out []Step
	for _, st := range steps(s, x, v) {
		mp, toll, to := price(s, x, p, st)
		out = append(out, Step{To: st.To, E: st.E, Spoke: st.Spoke, MP: mp, Toll: toll, Paid: to})
	}
	return out
}

// LegalSteps is the subset of StepsFrom(p's wagon) that p can pay for now: the
// path out of its movement points and the toll out of its gold. It is exactly
// what the engine accepts.
func LegalSteps(s *engine.State, p engine.PlayerID) []Step {
	if !hasWagons(s) {
		return nil
	}
	x := extRO(s)
	if !x.HasTrade || !x.Started || int(p) >= len(x.Wagon) {
		return nil
	}
	var out []Step
	for _, st := range reachable(s, x, p) {
		mp, toll, to := price(s, x, p, st)
		out = append(out, Step{To: st.To, E: st.E, Spoke: st.Spoke, MP: mp, Toll: toll, Paid: to})
	}
	return out
}

// MovePhase reports whether p is in an open movement phase right now: the
// wagons are out, it is p's actionable turn, and p has neither moved to a plaza
// nor declined.
func MovePhase(s *engine.State, p engine.PlayerID) bool {
	if !hasWagons(s) {
		return false
	}
	x := extRO(s)
	if !x.HasTrade || !x.Started || x.MoveDone || x.TurnSeat != p {
		return false
	}
	return engine.RequireActionableTurn(s, p) == nil
}

// OwesBarbarian reports whether p must move a barbarian right now, and which
// one (-1 when p may choose).
func OwesBarbarian(s *engine.State, p engine.PlayerID) (int, bool) {
	if !hasWagons(s) {
		return -1, false
	}
	x := extRO(s)
	if x.BarbSeat != p || len(s.PendingDiscards) > 0 {
		return -1, false
	}
	return x.BarbIdx, true
}

// BarbarianHomes lists every path a barbarian may legally be moved to.
func BarbarianHomes(s *engine.State) []board.Edge {
	if !hasWagons(s) || s.Board == nil {
		return nil
	}
	x := extRO(s)
	if !x.HasTrade {
		return nil
	}
	return barbarianHomes(s, x)
}

// Plazas returns the three plaza intersections, in trade-hex order. Empty when
// the board carries no trade hexes.
func Plazas(s *engine.State) []board.Vertex {
	if !hasWagons(s) {
		return nil
	}
	x := extRO(s)
	if !x.HasTrade {
		return nil
	}
	out := make([]board.Vertex, 0, tradeHexCount)
	for _, h := range x.Trade {
		out = append(out, plazaOf(h))
	}
	return out
}

// Destination is where a seat's wagon is heading: the plaza that accepts its
// cargo, or, for an empty wagon, every plaza (any of them will deal a load).
// A list, so callers measure distance against the whole set.
func Destination(s *engine.State, p engine.PlayerID) []board.Vertex {
	if !hasWagons(s) {
		return nil
	}
	x := extRO(s)
	if !x.HasTrade || int(p) >= len(x.Cargo) {
		return nil
	}
	cargo := x.Cargo[p]
	var out []board.Vertex
	for i, h := range x.Trade {
		if cargo == CargoNone || hexAccepts(x, i, cargo) {
			out = append(out, plazaOf(h))
		}
	}
	return out
}

// Distances is the movement-point cost from `from` to every intersection a
// wagon could reach, ignoring the per-turn allowance but respecting what p can
// pay: a toll road is impassable to a seat with no gold. A Dijkstra over the same
// graph and prices the engine charges, so a planned route is one the engine
// accepts step by step.
func Distances(s *engine.State, p engine.PlayerID, from board.Vertex) map[board.Vertex]int {
	dist := map[board.Vertex]int{}
	if !hasWagons(s) || s.Board == nil {
		return dist
	}
	x := extRO(s)
	if !x.HasTrade {
		return dist
	}
	gold := 0
	if int(p) < len(x.Gold) {
		gold = goldAt(s, x, p)
	}
	dist[from] = 0
	pq := vertexHeap{{v: from}}
	for len(pq) > 0 {
		cur := pq.pop()
		if d, ok := dist[cur.v]; ok && d < cur.cost {
			continue
		}
		for _, st := range steps(s, x, cur.v) {
			mp, toll, _ := price(s, x, p, st)
			if toll > gold {
				continue // a toll that cannot be paid makes the path impassable
			}
			next := cur.cost + mp
			if d, ok := dist[st.To]; !ok || next < d {
				dist[st.To] = next
				pq.push(vertexCost{v: st.To, cost: next})
			}
		}
	}
	return dist
}

type vertexCost struct {
	v    board.Vertex
	cost int
}

// vertexHeap is a small typed min-heap rather than container/heap, avoiding
// boxing on every push and pop (called three times per bot turn over the whole
// board) and the unchecked type assertions on Pop.
type vertexHeap []vertexCost

func (h *vertexHeap) push(v vertexCost) {
	*h = append(*h, v)
	for i := len(*h) - 1; i > 0; {
		parent := (i - 1) / 2
		if (*h)[parent].cost <= (*h)[i].cost {
			break
		}
		(*h)[parent], (*h)[i] = (*h)[i], (*h)[parent]
		i = parent
	}
}

func (h *vertexHeap) pop() vertexCost {
	old := *h
	top := old[0]
	n := len(old) - 1
	old[0] = old[n]
	*h = old[:n]
	for i := 0; ; {
		l, r, small := 2*i+1, 2*i+2, i
		if l < n && (*h)[l].cost < (*h)[small].cost {
			small = l
		}
		if r < n && (*h)[r].cost < (*h)[small].cost {
			small = r
		}
		if small == i {
			break
		}
		(*h)[i], (*h)[small] = (*h)[small], (*h)[i]
		i = small
	}
	return top
}

// Gold, Level, CargoOf and Delivered are the per-seat readouts the scoreboard
// and the bots need without reaching into the ext.
func Gold(s *engine.State, p engine.PlayerID) int  { return goldAt(s, extRO(s), p) }
func Level(s *engine.State, p engine.PlayerID) int { return seatInt(extRO(s).Level, p) }

// Delivered is p's delivered cargo tokens, which is p's victory points from
// this scenario's deliveries.
func Delivered(s *engine.State, p engine.PlayerID) int { return seatInt(extRO(s).Landed, p) }

// CargoOf is what p's wagon is carrying, or CargoNone.
func CargoOf(s *engine.State, p engine.PlayerID) uint8 {
	x := extRO(s)
	if int(p) >= len(x.Cargo) || p < 0 {
		return CargoNone
	}
	return x.Cargo[p]
}

// WagonAt is where p's wagon stands, and whether it is on the board at all.
func WagonAt(s *engine.State, p engine.PlayerID) (board.Vertex, bool) {
	x := extRO(s)
	if !x.Started || int(p) >= len(x.Wagon) || p < 0 {
		return board.Vertex{}, false
	}
	return x.Wagon[p], x.OnBoard[p]
}

// UpgradeCost is what p's next wagon level costs, and whether there is one.
func UpgradeCost(s *engine.State, p engine.PlayerID) (engine.Hand, bool) {
	x := extRO(s)
	if int(p) >= len(x.Level) || p < 0 || x.Level[p] >= maxLevel {
		return engine.Hand{}, false
	}
	return upgradeCost(x.Level[p]), true
}

// SwiftHeld is how many playable Swift Journeys p holds.
func SwiftHeld(s *engine.State, p engine.PlayerID) int { return seatInt(extRO(s).Swift, p) }

// MovementLeft is how many movement points p's current action has: what is left
// of an open one, or the full allowance at p's level when none is open yet.
// Zero when the movement is over. It is the budget LegalSteps prices against.
func MovementLeft(s *engine.State, p engine.PlayerID) int {
	if !hasWagons(s) {
		return 0
	}
	x := extRO(s)
	if !x.HasTrade || !x.Started || x.MoveDone || p < 0 || int(p) >= len(x.Level) {
		return 0
	}
	return openMP(s, x, p)
}

// Allowance is the full allowance a fresh movement action opens with at p's
// current level: what a Swift Journey's second trip starts with.
func Allowance(s *engine.State, p engine.PlayerID) int {
	if !hasWagons(s) {
		return 0
	}
	return allowance(s, seatInt(extRO(s).Level, p))
}

// BoostMP is what the once-per-action grain (or fish) purchase adds.
const BoostMP = boostMP

func seatInt(xs []int, p engine.PlayerID) int {
	if p < 0 || int(p) >= len(xs) {
		return 0
	}
	return xs[p]
}

// Active reports whether the Wagons module is in this game's ruleset.
func Active(s *engine.State) bool { return hasWagons(s) }
