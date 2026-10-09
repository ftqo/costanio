package raiders

import (
	"slices"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// ViewExt is the scenario's per-viewer view.
//
// Nothing is redacted: development cards resolve on purchase, gold and
// prisoners are public counters, and raiders and riders stand on the board. The
// only hidden thing, which resource a 7 took, travels on an event with a
// Visible list and a redactor.
//
// The returned value shares no map, slice or pointer with the live ext; it is
// serialised later on another goroutine while the actor folds the next command
// (see engine.Viewable). Every reference field is copied.
//
// The viewer-dependent part is the offer: where this seat's riders may move and
// which picks the open pending asks of it. A spectator gets none of it.
func (e *Ext) ViewExt(viewer engine.PlayerID) any {
	v := map[string]any{
		"coast":        slices.Clone(e.Coast),
		"raider_count": slices.Clone(e.RaiderCount),
		"supply":       e.Supply,
		"riders":       e.ridersView(),
		"riders_left":  slices.Clone(e.RidersLeft),
		"prisoners":    slices.Clone(e.Prisoners),
		"gold":         slices.Clone(e.Gold),
		// The size of the deck's four stacks, so a client need not hardcode a
		// rules constant. The discards reshuffle and no card is ever held, so
		// publishing it leaks nothing.
		"deck": []int{
			e.Deck[CardMuster], e.Deck[CardSwiftRider],
			e.Deck[CardTreason], e.Deck[CardIntrigue],
		},
		"riders_per_seat": ridersPerSeat,
		"gold_buys_left":  max(0, goldBuysPerTurn-e.Buys),
	}
	// A nullable hex, matching islands.ExtView.Pirate and the Caravans oasis. A
	// bare board.Hex cannot say "no castle": {q:0,r:0} would be identical to a
	// real castle at the board centre.
	if e.HasCastle {
		h := e.Castle
		v["castle"] = &h
		v["castle_paths"] = e.castlePaths()
	}
	// The conquered hexes, spelled out so the client does not re-implement the
	// rule (three raiders saturate a hex).
	var conq []board.Hex
	for _, h := range e.populationHexes() {
		if e.Conquered(h) {
			conq = append(conq, h)
		}
	}
	if len(conq) > 0 {
		v["conquered"] = conq
	}
	// The rider offer: which of the viewer's riders may still move this turn
	// and where each may end. Derivable from this ext alone, which is why Moved
	// is cleared by an event rather than a turn stamp.
	if viewer >= 0 {
		if moves := e.movesFor(viewer); len(moves) > 0 {
			v["rider_moves"] = moves
		}
	}
	if e.Pend.Kind != PendNone {
		pend := map[string]any{"kind": e.Pend.Kind, "seat": e.Pend.Seat}
		if len(e.Pend.Numbers) > 0 {
			pend["numbers"] = slices.Clone(e.Pend.Numbers)
		}
		// The pick lists reach only the seat being asked. Everyone else is told
		// that a decision is open and whose it is.
		if viewer >= 0 && viewer == e.Pend.Seat {
			if len(e.Pend.Hexes) > 0 {
				pend["hexes"] = slices.Clone(e.Pend.Hexes)
			}
			if len(e.Pend.Edges) > 0 {
				pend["edges"] = slices.Clone(e.Pend.Edges)
			}
			if e.Pend.Kind == PendTreason {
				pend["treason_from"] = e.occupiedCoast()
				pend["treason_to"] = e.unconqueredCoast()
				// The plan's length, which the command must match exactly.
				// Taken from the engine (treasonCount) rather than re-derived
				// from the two lists, since a destination may not also be a
				// source.
				pend["treason_count"] = e.Pend.Count
			}
		}
		v["pend"] = pend
	}
	if e.Shared {
		v["shared_paths"] = true
		v["relocation_hexes"] = e.unconqueredCoast()
		v["path_figures"] = slices.Clone(e.PathFigures)
	}
	if len(e.PathQueue) > 0 && e.PathQueue[0] >= 0 && e.PathQueue[0] < len(e.PathFigures) {
		pend := map[string]any{"kind": PendPath, "seat": e.PathSeat, "hex": e.PathFigures[e.PathQueue[0]].Hex}
		if viewer == e.PathSeat {
			pend["edges"] = slices.Clone(e.PathEdges)
		}
		v["pend"] = pend
	}
	return v
}

// ridersView is every rider on the board, in path order, as a flat list. Built
// from a sorted key walk so the bytes are stable from frame to frame.
func (e *Ext) ridersView() []riderAt {
	eds := make([]board.Edge, 0, len(e.RiderAt))
	for ed := range e.RiderAt {
		eds = append(eds, ed)
	}
	sortEdges(eds)
	out := make([]riderAt, 0, len(eds))
	for _, ed := range eds {
		out = append(out, riderAt{Player: e.RiderAt[ed], E: ed})
	}
	return out
}

// ViewExtRevealed is the spectator view of a finished game. Raiders withholds
// nothing per seat, so it is the spectator view unchanged, but it is
// implemented because the replay path asks for it.
func (e *Ext) ViewExtRevealed() any { return e.ViewExt(engine.NoPlayer) }
