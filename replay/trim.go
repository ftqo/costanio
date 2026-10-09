package replay

import "github.com/ftqo/costan.io/engine"

// Spatial reports whether an event puts a piece on the board, takes one off, or
// moves one: the events a viewer can see, as opposed to bookkeeping. It is the
// policy behind a trimmed replay, shared by cmd/costan-replay-trim and
// cmd/costan-attract-search.
//
// Module event types are string literals (the wire format) so this package
// doesn't have to import every expansion.
func Spatial(t engine.EventType) bool { return spatial[t] }

var spatial = map[engine.EventType]bool{
	// Base: the setup placements and the three build events.
	engine.EvSettlementPlace: true,
	engine.EvSetupCityPlace:  true,
	engine.EvRoadPlaced:      true,
	engine.EvSettlementBuilt: true,
	engine.EvCityBuilt:       true,
	engine.EvRoadBuilt:       true,
	// Base: the robber is a piece, and moving it is the most legible single
	// action in the game.
	engine.EvRobberMoved: true,

	// Islands: ships are roads that move, and the pirate is a second robber.
	"ship_built":   true,
	"ship_moved":   true,
	"pirate_moved": true,
	"island_chip":  true,

	// Knights: knights occupy vertices and move between them; walls, the
	// merchant and a metropolis all change what is drawn on one.
	"cak_knight_built":         true,
	"cak_knight_moved":         true,
	"cak_knight_promoted":      true,
	"cak_knight_activated":     true,
	"cak_knight_removed":       true,
	"cak_knight_displaced":     true,
	"cak_knight_relocated":     true,
	"cak_wall_built":           true,
	"cak_merchant_placed":      true,
	"cak_metropolis":           true,
	"cak_improved":             true,
	"cak_road_relocated":       true,
	"cak_barbarian_downgraded": true,

	// Caravans: camels are placed pieces.
	"tab_camel_placed": true,

	// Raiders: raiders land on and leave hexes, riders are placed, march
	// and are lost in battle.
	"raiders_landed":       true,
	"raiders_battle":       true,
	"raiders_treason":      true,
	"raiders_intrigue":     true,
	"raiders_rider_placed": true,
	"raiders_rider_moved":  true,
}

// Trim drops every frame whose event is not Spatial, in place, and reports how
// many of each type went.
//
// Safe because frames are not deltas: each carries the whole view after its
// event (see Frame), so the remaining frames are exactly what the engine made.
//
// keepLast keeps the final frame regardless, so the file ends on the finished
// board.
//
// Seq is left as is: it indexes the original log, and renumbering would make
// the frames look contiguous.
func Trim(f *File, keepLast bool) map[engine.EventType]int {
	dropped := map[engine.EventType]int{}
	kept := make([]Frame, 0, len(f.Frames))
	for i, fr := range f.Frames {
		if Spatial(fr.Type) || (keepLast && i == len(f.Frames)-1) {
			kept = append(kept, fr)
			continue
		}
		dropped[fr.Type]++
	}
	f.Frames = kept
	return dropped
}
