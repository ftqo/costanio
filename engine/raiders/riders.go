package raiders

import (
	"slices"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// Riders enter the board only from a card. They cost no resources to place,
// which is why Muster is more than half the deck: buying development cards is
// how you raise an army.
//
// A path holds at most one rider. Riders and roads share paths freely and
// neither blocks the other. Riders never affect the distance rule, block a
// settlement or break a road, so this module registers no OccupiesEdge or
// BlocksVertex hook.

// decidePlaceRider answers the Muster and Swift Rider pendings.
func (m Module) decidePlaceRider(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	x := extRO(s)
	if x.Pend.Seat != cmd.Player {
		return nil, engine.ErrNotYourTurn
	}
	var card Card
	switch x.Pend.Kind {
	case PendMuster:
		card = CardMuster
	case PendSwift:
		card = CardSwiftRider
	default:
		return nil, engine.ErrWrongPhase
	}
	d, err := engine.DecodeCommand[struct {
		E board.Edge `json:"e"`
	}](cmd.Data)
	if err != nil {
		return nil, err
	}
	e := board.NewEdge(d.E.A, d.E.B)
	if !e.Valid() || !slices.Contains(x.Pend.Edges, e) {
		return nil, engine.ErrBadPlacement
	}
	if x.RidersLeft[cmd.Player] == 0 {
		return nil, ErrNoRiders
	}
	return []engine.Event{engine.NewEvent(EvRiderPlaced,
		riderPlacedData{Player: cmd.Player, E: e, Card: card})}, nil
}

// decideDecline answers an optional pending: Swift Rider ("you may place one of
// your riders"). Muster and Treason are not optional, so this refuses them.
func (m Module) decideDecline(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	x := extRO(s)
	if x.Pend.Kind != PendSwift || x.Pend.Seat != cmd.Player {
		return nil, engine.ErrWrongPhase
	}
	return []engine.Event{engine.NewEvent(EvDeclined,
		declinedData{Player: cmd.Player, Card: CardSwiftRider})}, nil
}

// riderReach is every path a rider on `from` may end its move on, within
// `steps` paths.
//
// Ruling: movement passes through everything (riders, roads, settlements,
// cities, conquered hexes, raiders, rivers). A destination is barred only if it
// already holds a rider or is one of the castle hex's six paths; without the
// second, a rider owing its castle move could step one path round the ring and
// stay there. A castle path may still be crossed.
//
// So the walk is a breadth-first search over paths sharing a vertex, restricted
// to paths with an adjacent hex on the main landmass (see riderPath). Returned
// ascending so the client's offer and Auto's pick are stable.
func (e *Ext) riderReach(from board.Edge, steps int) []board.Edge {
	if steps <= 0 {
		return nil
	}
	castle := map[board.Edge]bool{}
	for _, ed := range e.castlePaths() {
		castle[ed] = true
	}
	dist := map[board.Edge]int{from: 0}
	frontier := []board.Edge{from}
	var out []board.Edge
	for d := 0; d < steps && len(frontier) > 0; d++ {
		var next []board.Edge
		for _, cur := range frontier {
			for _, v := range []board.Vertex{cur.A, cur.B} {
				for _, ed := range v.Edges() {
					if _, seen := dist[ed]; seen || !e.riderPath(ed) {
						continue
					}
					dist[ed] = d + 1
					next = append(next, ed)
					if _, taken := e.RiderAt[ed]; !taken && !castle[ed] {
						out = append(out, ed)
					}
				}
			}
		}
		frontier = next
	}
	sortEdges(out)
	return out
}

// RiderMoves is one movable rider and where it may go, for the client and the
// bots. It mirrors engine.ShipMoveTargets in shape.
type RiderMoves struct {
	From board.Edge   `json:"from"`
	To   []board.Edge `json:"to"`
	// Hurry lists the destinations reachable only by paying the grain, so a
	// client can price the move before offering it.
	Hurry []board.Edge `json:"hurry,omitempty"`
	// MustLeave marks a rider standing on a castle path with somewhere to go.
	// The turn cannot end while one of these is still there.
	MustLeave bool `json:"must_leave,omitempty"`
}

// MovesFor lists seat's riders that may still move this turn, with their
// destinations. Read-only; safe to call from a bot or a view builder.
func MovesFor(s *engine.State, seat engine.PlayerID) []RiderMoves {
	if !active(s) {
		return nil
	}
	return extRO(s).movesFor(seat)
}

func (e *Ext) movesFor(seat engine.PlayerID) []RiderMoves {
	castle := map[board.Edge]bool{}
	for _, ed := range e.castlePaths() {
		castle[ed] = true
	}
	var mine []board.Edge
	for ed, owner := range e.RiderAt {
		if owner == seat && !e.hasMoved(ed) {
			mine = append(mine, ed)
		}
	}
	sortEdges(mine)
	out := make([]RiderMoves, 0, len(mine))
	for _, ed := range mine {
		base := e.riderReach(ed, riderMove)
		full := e.riderReach(ed, riderMoveHurry)
		var hurry []board.Edge
		for _, t := range full {
			if !slices.Contains(base, t) {
				hurry = append(hurry, t)
			}
		}
		out = append(out, RiderMoves{From: ed, To: base, Hurry: hurry, MustLeave: castle[ed] && len(base) > 0})
	}
	return out
}

// stuckAtCastle reports whether seat still has a rider on a castle path that
// could move and has not.
//
// After moving, none of your riders may be on a path adjacent to the castle
// hex, so ending the turn is refused while one is there.
//
// Decision: if a castle rider has no legal destination (every path within its
// allowance holds a rider), it stays and the turn may end. The rules are
// silent; removing the piece or freezing the turn would punish a seat for
// placements it does not control.
func (e *Ext) stuckAtCastle(seat engine.PlayerID) (board.Edge, bool) {
	if seat < 0 || !e.HasCastle {
		return board.Edge{}, false
	}
	for _, ed := range e.castlePaths() {
		// Check presence first: a missed map lookup yields seat 0, a real seat,
		// so `RiderAt[ed] == seat` alone would report a rider for player 0 on
		// every empty castle path.
		owner, ok := e.RiderAt[ed]
		if !ok || owner != seat {
			continue
		}
		if e.hasMoved(ed) {
			continue
		}
		if len(e.riderReach(ed, riderMove)) > 0 {
			return ed, true
		}
	}
	return board.Edge{}, false
}

// decideMoveRider moves one of the player's own riders, once.
//
// Base allowance is 3 paths. Paying 1 grain raises that one rider to 5 paths;
// three riders cost three grain.
func (m Module) decideMoveRider(s *engine.State, cmd engine.Command) ([]engine.Event, error) {
	// An ordinary actionable turn: blocksTurnActions does not gate on a castle
	// rider that must leave, so the seat may still build, trade and move. Only
	// the pass is refused, in decideEndTurn.
	if err := engine.RequireActionableTurn(s, cmd.Player); err != nil {
		return nil, err
	}
	x := extRO(s)
	d, err := engine.DecodeCommand[struct {
		From  board.Edge `json:"from"`
		To    board.Edge `json:"to"`
		Hurry bool       `json:"hurry,omitempty"`
	}](cmd.Data)
	if err != nil {
		return nil, err
	}
	from := board.NewEdge(d.From.A, d.From.B)
	to := board.NewEdge(d.To.A, d.To.B)
	// Presence of the rider is checked first inside riderMove1, for the
	// zero-value reason spelled out in stuckAtCastle.
	if d.Hurry {
		var cost engine.Hand
		cost[board.Wheat] = 1
		if !s.Players[cmd.Player].Hand.Has(cost) {
			return nil, engine.ErrNoResources
		}
	}
	ev, err := riderMove1(s, x, cmd.Player, from, to, d.Hurry)
	if err != nil {
		return nil, err
	}
	return []engine.Event{ev}, nil
}

// riderMove1 is the positional half of a rider move, shared by the grain move
// above and the fish-paid hurry below: the rider is the seat's, has not moved,
// and `to` is within its allowance.
func riderMove1(s *engine.State, x *Ext, seat engine.PlayerID, from, to board.Edge, hurry bool) (engine.Event, error) {
	if !from.Valid() || !to.Valid() || from == to {
		return engine.Event{}, engine.ErrBadPlacement
	}
	if owner, ok := x.RiderAt[from]; !ok || owner != seat {
		return engine.Event{}, engine.ErrBadPlacement
	}
	if x.hasMoved(from) {
		return engine.Event{}, ErrRiderMoved
	}
	steps := riderMove
	if hurry {
		steps = riderMoveHurry
	}
	if !slices.Contains(x.riderReach(from, steps), to) {
		return engine.Event{}, engine.ErrBadPlacement
	}
	return engine.NewEvent(EvRiderMoved,
		riderMovedData{Player: seat, From: from, To: to, Hurry: hurry}), nil
}

// freeRiderHurry is the Fishermen substitution for the grain: 2 fish move a
// piece up to five edges as if 1 grain were paid. Raiders' marching piece is
// the rider, so it applies to one rider move, once, up to five paths. The
// caller (engine/scenarios' spend) charges the fish only after this validates, so an
// illegal move costs nothing.
func (m Module) freeRiderHurry(s *engine.State, p engine.PlayerID, from, to board.Edge) (engine.Event, error) {
	if !active(s) {
		return engine.Event{}, engine.ErrBadCommand
	}
	if err := engine.RequireActionableTurn(s, p); err != nil {
		return engine.Event{}, err
	}
	ev, err := riderMove1(s, extRO(s), p, board.NewEdge(from.A, from.B), board.NewEdge(to.A, to.B), true)
	if err != nil {
		return engine.Event{}, err
	}
	d := engine.DecodeEvent[riderMovedData](ev)
	d.Fish = true
	return engine.NewEvent(EvRiderMoved, d), nil
}
