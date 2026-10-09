package raiders

import (
	"slices"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// Conquest, and what it switches off.
//
// A coastal hex holding three raiders is conquered. This is derived, never
// stored (see Ext.Conquered), and so is a conquered building: un-conquering one
// hex can restore several buildings at once, and state that is never stored
// cannot be inconsistent.

// hexInert: a conquered hex produces nothing, on any roll. So does the castle,
// which carries no chip the players can see and is never conquered.
func (Module) hexInert(s *engine.State, h board.Hex) bool {
	x := extRO(s)
	if x.HasCastle && h == x.Castle {
		return true
	}
	return x.Conquered(h)
}

// buildingInert: a settlement or city adjacent to no unconquered hex (every
// neighbour conquered, sea, or off the board) is itself conquered. It is laid
// on its side and left in place.
//
// A conquered building is worth 0 VP (see victory), produces nothing, draws no
// fish, cannot use its harbour, and no longer joins its owner's segments.
//
// Ruling: it still exists and still blocks. An opponent's conquered settlement
// still breaks your road for Longest Road and no one may build through its
// intersection, so this is a predicate rather than a removal, and the module
// registers no BlocksVertex.
//
// A building touching any interior hex can never be conquered, since interior
// hexes never are; only the coastal fringe is at risk.
func (Module) buildingInert(s *engine.State, v board.Vertex) bool {
	if _, ok := s.Buildings[v]; !ok {
		return false
	}
	x := extRO(s)
	touches := false
	for _, h := range v.Hexes() {
		if !s.Board.Land(h) {
			continue
		}
		touches = true
		if !x.Conquered(h) {
			return false
		}
	}
	return touches
}

// blocksNewConstruction: a conquered hex refuses every new build on its six
// intersections: a settlement, a city upgrade, and under Knights a knight or a
// city wall. The pieces already there stay, and a knight may still move onto
// one of these corners; moving is not building.
func (Module) blocksNewConstruction(s *engine.State, v board.Vertex) bool {
	x := extRO(s)
	for _, h := range v.Hexes() {
		if x.Conquered(h) {
			return true
		}
	}
	return false
}

// blocksNewRoad: a conquered hex refuses a new road on any of its six paths.
// Existing roads stay.
//
// Under Islands a ship may still be built on those edges (the coast is where
// you retreat to). This hook is consulted only by the base road build, not
// Islands' ship build.
func (Module) blocksNewRoad(s *engine.State, e board.Edge) bool {
	x := extRO(s)
	return slices.ContainsFunc(board.EdgeHexes(e), x.Conquered)
}

// victory is this scenario's contribution to a seat's score: prisoner points
// minus the buildings conquest has switched off.
//
// Two prisoners are worth 1 VP (three under Knights). A single prisoner is
// worth nothing, including for leader tests (the old boot under Fishermen,
// Master Merchant and Wedding under Knights). Integer division does this, and
// since this hook feeds PublicVPWithModules every leader test reads the same
// number.
//
// The subtraction is here because PublicVP counts every building a seat owns
// and the conquered ones are worth 0; doing it in VictoryCheck reaches the win
// check, scoreboard, friendly-robber shield and every module's leader rule at
// once.
//
// No Largest Army (no knight cards) and no development-card VP (nothing is
// held). Longest Road is unchanged.
func (Module) victory(s *engine.State, p engine.PlayerID) int {
	x := extRO(s)
	per := prisonersPerVP
	if hasKnights(s) {
		per = prisonersPerVPKnights
	}
	vp := 0
	if int(p) < len(x.Prisoners) {
		vp = x.Prisoners[p] / per
	}
	for v, b := range s.Buildings {
		if b.Owner != p {
			continue
		}
		if !(Module{}).buildingInert(s, v) {
			continue
		}
		if b.City {
			vp -= 2
		} else {
			vp--
		}
	}
	return vp
}

// Prisoners is how many prisoners seat p holds. Exported for the scoreboard and
// the bots.
func Prisoners(s *engine.State, p engine.PlayerID) int {
	x := extRO(s)
	if int(p) >= len(x.Prisoners) || p < 0 {
		return 0
	}
	return x.Prisoners[p]
}

// GoldOf is how much gold seat p holds. Public, like every seat's total.
func GoldOf(s *engine.State, p engine.PlayerID) int {
	x := extRO(s)
	if int(p) >= len(x.Gold) || p < 0 {
		return 0
	}
	return x.Gold[p]
}
