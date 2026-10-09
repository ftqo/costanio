package raiders

import (
	"cmp"
	"slices"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// The conquest announcement.
//
// Conquest is derived (see conquest.go), so no rule needs a "this hex fell"
// event, but the log does. After every batch that could change it, the module
// compares the conquest the log has announced against the conquest the state
// derives and emits one public raiders_conquest naming the difference: hexes
// conquered and liberated, and every building switched off or back on, with the
// points involved.
//
// The announced set is fold state (Ext.Announced / Ext.AnnouncedLost), written
// only by that event's fold and read only here. No rule consults it, so the
// announcement never decides conquest. The fold recomputes the set from the
// state rather than the payload, so a building removed by another rule (a
// Knights downgrade) simply drops out.

// EvConquest is the announcement. Public; appended by AfterEvents.
const EvConquest engine.EventType = "raiders_conquest"

// lostBuilding is one building conquest switched off (or back on): its owner,
// where it stands, and what it is worth, which is what the seat lost.
type lostBuilding struct {
	Player engine.PlayerID `json:"player"`
	V      board.Vertex    `json:"v"`
	City   bool            `json:"city,omitempty"`
	// VP is the points the building stops (or starts again) counting: 1 for a
	// settlement, 2 for a city. The same numbers victory subtracts.
	VP int `json:"vp"`
}

type conquestData struct {
	Conquered []board.Hex    `json:"conquered,omitempty"`
	Liberated []board.Hex    `json:"liberated,omitempty"`
	Lost      []lostBuilding `json:"lost,omitempty"`
	Restored  []lostBuilding `json:"restored,omitempty"`
}

// conquestEventTypes are the events that can move a hex's conquest. The same
// list registerEvents gives the route recompute, for the same reason.
var conquestEventTypes = []engine.EventType{EvLanded, EvBattle, EvTreason, EvIntrigue, EvPathPlaced}

func cmpVertex(a, b board.Vertex) int {
	return cmp.Or(cmp.Compare(a.Q, b.Q), cmp.Compare(a.R, b.R), cmp.Compare(a.Side, b.Side))
}

// conqueredNow is every conquered hex, in board order.
func (e *Ext) conqueredNow() []board.Hex {
	var out []board.Hex
	for _, h := range e.populationHexes() {
		if e.Conquered(h) {
			out = append(out, h)
		}
	}
	return out
}

// lostNow is every building conquest has switched off, in vertex order.
func lostNow(s *engine.State) []board.Vertex {
	var out []board.Vertex
	for v := range s.Buildings {
		if (Module{}).buildingInert(s, v) {
			out = append(out, v)
		}
	}
	slices.SortFunc(out, cmpVertex)
	return out
}

// foldAnnounced records the conquest the state now derives as announced.
func (e *Ext) foldAnnounced(s *engine.State) {
	e.Announced = e.conqueredNow()
	e.AnnouncedLost = lostNow(s)
}

func buildingAt(s *engine.State, v board.Vertex) lostBuilding {
	b := s.Buildings[v]
	vp := 1
	if b.City {
		vp = 2
	}
	return lostBuilding{Player: b.Owner, V: v, City: b.City, VP: vp}
}

// announceConquest is the AfterEvents pass. It runs only on a batch carrying
// an event that can move conquest, so the ordinary batch pays nothing.
func (Module) announceConquest(after *engine.State, events []engine.Event) []engine.Event {
	if !slices.ContainsFunc(events, func(e engine.Event) bool {
		return slices.Contains(conquestEventTypes, e.Type)
	}) {
		return nil
	}
	x, ok := StateExt(after)
	if !ok || after.Board == nil {
		return nil
	}
	var d conquestData
	now := x.conqueredNow()
	for _, h := range now {
		if !slices.Contains(x.Announced, h) {
			d.Conquered = append(d.Conquered, h)
		}
	}
	for _, h := range x.Announced {
		if !slices.Contains(now, h) {
			d.Liberated = append(d.Liberated, h)
		}
	}
	lost := lostNow(after)
	for _, v := range lost {
		if !slices.Contains(x.AnnouncedLost, v) {
			d.Lost = append(d.Lost, buildingAt(after, v))
		}
	}
	for _, v := range x.AnnouncedLost {
		// A building that is no longer standing at all was removed by some
		// other rule, not stood back up: it drops out of the set silently.
		if _, standing := after.Buildings[v]; standing && !slices.Contains(lost, v) {
			d.Restored = append(d.Restored, buildingAt(after, v))
		}
	}
	if d.Conquered == nil && d.Liberated == nil && d.Lost == nil && d.Restored == nil {
		// Only the silent drop above can leave the sets out of step with
		// nothing to announce, and the next announcement recomputes both from
		// the state.
		return nil
	}
	return []engine.Event{engine.NewEvent(EvConquest, d)}
}
