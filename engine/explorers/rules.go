package explorers

import (
	"slices"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// The predicates the rules are made of. Everything here is read-only in s and
// x: Decide, the hooks and the legal-target builder share them, so the offer a
// client sees and the validator agree.

// sailable reports whether a ship may sit on edge e.
//
// Fog counts as open water. A ship sails toward the unknown and reveals it on
// arrival; if this consulted an unrevealed hex's true terrain, the legal-target
// list would tell the player which face-down hexes are sea.
//
// A destination borders at most one fog hex: a ship reaches e from an edge
// sharing an endpoint with it, a corner of both of e's hexes, so a second fog
// hex there would have been revealed a move earlier. Nothing here depends on
// that, since sailable answers yes whenever either hex is fog.
func sailable(s *engine.State, x *Ext, e board.Edge) bool {
	for _, h := range board.EdgeHexes(e) {
		if isFog(x, h) || s.Board.IsSea(h) {
			return true
		}
	}
	return false
}

// roomOn reports whether a ship may end its movement on edge e. Up to two ships
// share an edge, in any mix of owners; a ship may pass through a full one.
func roomOn(x *Ext, e board.Edge, moving int) bool {
	n := 0
	for _, sh := range x.Ships {
		if sh.E == e && sh.ID != moving {
			n++
		}
	}
	return n < ShipsPerEdge
}

// vertexTouchesFog reports whether v is a corner of any unrevealed hex. Nothing
// builds on such a vertex, and a ship that reaches one reveals the hex.
func vertexTouchesFog(x *Ext, v board.Vertex) bool {
	for _, h := range v.Hexes() {
		if isFog(x, h) {
			return true
		}
	}
	return false
}

// fogAt is every unrevealed hex either end of edge e touches, in ascending
// axial order. That is the order reveals resolve and the chit stack is
// consumed, so it is part of the published derivation.
func fogAt(x *Ext, e board.Edge) []board.Hex {
	seen := map[board.Hex]bool{}
	var out []board.Hex
	for _, v := range []board.Vertex{e.A, e.B} {
		for _, h := range v.Hexes() {
			if seen[h] || !isFog(x, h) {
				continue
			}
			seen[h] = true
			out = append(out, h)
		}
	}
	sortHexes(out)
	return out
}

// buildableHex reports whether player p may build a road or a settlement
// touching hex h.
//
//   - An unrevealed hex closes every edge and corner it shares.
//   - A gold field is closed to everybody until its pirate lair is captured.
//   - A spice farm is closed to everybody who has not landed a crew on it. This
//     is per player, which is why its hook takes a seat
//     (engine.Hooks.BuildBlockedVertex).
func buildableHex(x *Ext, h board.Hex, p engine.PlayerID) bool {
	pool, ok := poolOf(x, h)
	if !ok {
		return true // the home island, home waters, the rim
	}
	if !x.Revealed[h] {
		return false
	}
	switch pool.Kind {
	case SpecialGold:
		return x.Captured[h]
	case SpecialSpice:
		crews := x.FarmCrew[h]
		return int(p) >= 0 && int(p) < len(crews) && crews[p]
	case SpecialNone, SpecialShoal:
		return true
	}
	return true
}

// unrevealedVertex reports whether v is a corner of a hex still face down.
//
// Only the fog part of buildableHex: cak+explorers rule D bars a knight from an
// intersection next to an undiscovered hex and says nothing about lairs or
// farms. See engine.Hooks.UnrevealedVertex.
func unrevealedVertex(x *Ext, v board.Vertex) bool {
	for _, h := range v.Hexes() {
		if _, pooled := poolOf(x, h); pooled && !x.Revealed[h] {
			return true
		}
	}
	return false
}

func buildableVertex(x *Ext, v board.Vertex, p engine.PlayerID) bool {
	for _, h := range v.Hexes() {
		if !buildableHex(x, h, p) {
			return false
		}
	}
	return true
}

func buildableEdge(x *Ext, e board.Edge, p engine.PlayerID) bool {
	return buildableVertex(x, e.A, p) && buildableVertex(x, e.B, p)
}

// hasHarbourAt reports whether p owns a harbour settlement at v.
func hasHarbourAt(x *Ext, v board.Vertex, p engine.PlayerID) bool {
	owner, ok := x.Harbours[v]
	return ok && owner == p
}

// shipAtHarbour is the harbour settlement of p one of ship e's ends stands on,
// if any. It is the only place cargo crosses between a hold and a basin, and
// the only way a piece moves between ships (both touch the same harbour
// settlement; one unloads, the other loads).
func shipAtHarbour(x *Ext, e board.Edge, p engine.PlayerID) (board.Vertex, bool) {
	for _, v := range []board.Vertex{e.A, e.B} {
		if hasHarbourAt(x, v, p) {
			return v, true
		}
	}
	return board.Vertex{}, false
}

// touchesHex reports whether either end of edge e is a corner of hex h. It is
// the reach test for every job a ship does at a hex: landing a crew, taking a
// sack, loading a haul, founding a settlement.
func touchesHex(e board.Edge, h board.Hex) bool {
	for _, v := range []board.Vertex{e.A, e.B} {
		hexes := v.Hexes()
		if slices.Contains(hexes[:], h) {
			return true
		}
	}
	return false
}

// atCouncil reports whether either end of e is one of the Council hex's two
// anchors. A ship docks when it is, and delivering is what docking is for.
func atCouncil(x *Ext, e board.Edge) bool {
	for _, a := range x.Anchors {
		if e.A == a || e.B == a {
			return true
		}
	}
	return false
}

// villages is how many copies of village v player p holds, 0, 1 or 2.
func villages(x *Ext, p engine.PlayerID, v Village) int {
	n := 0
	for region := range RegionCount {
		if x.Seats[p].Villages[v][region] {
			n++
		}
	}
	return n
}

// shipMP is how far one of p's ships may travel this turn: 4 base, plus 1 or 2
// from Swift Voyage, plus the 2 one wool buys once per ship, capped at 8.
func shipMP(x *Ext, sh Ship) int {
	return min(ShipMP+villages(x, sh.Owner, VillageSwift)+sh.Bonus, MaxMP)
}

// mpLeft is what a ship has not spent. A ship whose movement ended (it revealed
// a hex, or its owner started another ship) has none.
func mpLeft(x *Ext, sh Ship) int {
	if sh.Done {
		return 0
	}
	return max(shipMP(x, sh)-sh.Used, 0)
}

// chaseHits is every die face that drives the pirate off for p, ascending.
//
// A village chases the pirate away on a 6 or the number shown on its hex; crews
// on both Pirate Bonus hexes chase on 4, 5 or 6. The number is a face, not a
// threshold: the north village shows a 5 and the south a 4, so north alone
// chases on 5 or 6, south alone on 4 or 6, and both on 4, 5 and 6. Reading it
// as "or higher" would make the south village alone as good as both.
func chaseHits(x *Ext, p engine.PlayerID) []int {
	var out []int
	if x.Seats[p].Villages[VillagePirate][RegionSouth] {
		out = append(out, 4)
	}
	if x.Seats[p].Villages[VillagePirate][RegionNorth] {
		out = append(out, 5)
	}
	return append(out, 6)
}

// chaseWins reports whether one chase die showing roll drives the pirate off
// for p.
func chaseWins(x *Ext, p engine.PlayerID, roll int) bool {
	return slices.Contains(chaseHits(x, p), roll)
}

// pirateHexLegal reports whether the pirate ship may stand on hex h: any
// revealed sea hex, fish shoals included, except one adjacent to the home
// island.
//
// The rim is legal: ours is made of real sea hexes with real routes.
//
// The test is adjacency, not home-waters membership. Home waters is every
// interior hex adjacent to the island (spec step 3), but the island sits at the
// west of the interior, so some rim hexes also touch it and must be excluded.
func pirateHexLegal(s *engine.State, x *Ext, h board.Hex) bool {
	if isFog(x, h) || !s.Board.IsSea(h) {
		return false
	}
	if slices.Contains(x.Waters, h) {
		return false
	}
	for _, n := range h.Neighbors() {
		if slices.Contains(x.Home, n) {
			return false
		}
	}
	return true
}

// legalPirateHexes is every hex a pirate activation may choose, in board order.
func legalPirateHexes(s *engine.State, x *Ext, mover engine.PlayerID) []board.Hex {
	var out []board.Hex
	for _, h := range board.HexesInRadius(s.Board.Radius) {
		if pirateHexLegal(s, x, h) && pirateLeaves(x, h) {
			out = append(out, h)
		}
	}
	return out
}

// pirateLeaves reports whether an activation by mover may end on hex h, as far
// as where the last pirate ship stood is concerned. Every activation goes to a
// different hex:
//
//   - your own pirate ship on the board moves "to a different sea hex";
//   - an opponent's is returned and yours goes "on a different sea hex";
//   - a won chase activates yours as a 7 would, so the chased ship's hex is
//     closed to it too.
//
// There is no exception; the Knights Bishop simply activates the pirate ship
// and follows the same rules (TestBishopActivatesPirate).
func pirateLeaves(x *Ext, h board.Hex) bool {
	if x.HasPirate && h == x.Pirate {
		return false
	}
	if !x.HasPirate && x.Chased && h == x.Vacated {
		return false
	}
	return true
}

// pirateVictims is every seat the pirate on hex h may rob: a seat other than
// the mover with a ship on one of that hex's edges. Only ships matter, not
// buildings.
//
// An edge of the hex, not an end at one of its corners: the corner test is
// battle-readiness, and using it here would rob ships lying beside the hex.
func pirateVictims(x *Ext, h board.Hex, mover engine.PlayerID) map[engine.PlayerID]bool {
	out := map[engine.PlayerID]bool{}
	for _, sh := range x.Ships {
		if sh.Owner != mover && slices.Contains(board.EdgeHexes(sh.E), h) {
			out[sh.Owner] = true
		}
	}
	return out
}

// tributeDue reports whether ship sh owes a gold for using the edges of an
// opponent's pirate hex on this path, and whether it has already paid this
// turn.
//
// Tribute is on movement, never construction: 1 gold for each ship that moves
// onto, off or along any edge of that hex, once per ship per turn, after which
// it may use those edges freely. The pirate's owner never pays.
func tributeDue(x *Ext, sh Ship, path []board.Edge) bool {
	if !x.HasPirate || x.PirateOwner == sh.Owner || x.Tribute[sh.ID] {
		return false
	}
	if touchesHex(sh.E, x.Pirate) && bordersPirate(x, sh.E) {
		return true
	}
	for _, e := range path {
		if bordersPirate(x, e) {
			return true
		}
	}
	return false
}

// bordersPirate reports whether edge e is one of the pirate hex's own edges.
func bordersPirate(x *Ext, e board.Edge) bool {
	return slices.Contains(board.EdgeHexes(e), x.Pirate)
}

// battleReady is every ship of p that may roll at the pirate: it has not moved
// yet this turn and one of its ends is a corner of the pirate ship's hex.
func battleReady(x *Ext, p engine.PlayerID) []int {
	if !x.HasPirate || x.PirateOwner == p {
		return nil
	}
	var out []int
	for id, sh := range x.Ships {
		if sh.Owner == p && !sh.Moved && !sh.Fought && touchesHex(sh.E, x.Pirate) {
			out = append(out, id)
		}
	}
	slices.Sort(out)
	return out
}

// missionLeader is the seat holding track t's bonus tile: the one farthest
// along, and on a stacked leading space the marker at the bottom (it got there
// first). NoPlayer when nobody has left the start space.
func missionLeader(x *Ext, t int) engine.PlayerID {
	best, bestPos, bestArrived := engine.NoPlayer, 0, 0
	for i := range x.Seats {
		pos := x.Seats[i].Track[t]
		if pos == 0 {
			continue
		}
		arrived := x.Seats[i].Arrived[t]
		if best == engine.NoPlayer || pos > bestPos || (pos == bestPos && arrived < bestArrived) {
			best, bestPos, bestArrived = engine.PlayerID(i), pos, arrived
		}
	}
	return best
}

// MissionVP is what p's three markers and the tiles they hold are worth.
//
// The position is clamped rather than indexed directly. advance() never moves a
// marker past space 7, but this is read from views over a possibly
// snapshot-decoded Ext, and a bad field should give a wrong score rather than a
// panic. ruletest's reflection sweep fuzzes every int field and calls into
// here.
func MissionVP(x *Ext, p engine.PlayerID) int {
	if int(p) < 0 || int(p) >= len(x.Seats) {
		return 0
	}
	vp := 0
	for t := range TrackCount {
		vp += trackVP(x.Seats[p].Track[t])
		if missionLeader(x, t) == p {
			vp += BonusTileVP
		}
	}
	return vp
}

func trackVP(pos int) int {
	return TrackVP[min(max(pos, 0), TrackSpaces)]
}

// coastal reports whether vertex v touches at least one sea hex: the test for
// upgrading to a harbour settlement, which every starting harbour settlement
// passes since the island is ringed by home waters.
//
// Fog counts, as for sailable, so the server's offers never reveal an
// unrevealed hex's terrain.
func coastal(s *engine.State, x *Ext, v board.Vertex) bool {
	for _, h := range v.Hexes() {
		if isFog(x, h) || s.Board.IsSea(h) {
			return true
		}
	}
	return false
}

// onHomeIsland reports whether every land hex at v belongs to the home island.
// Setup places both starting buildings there.
func onHomeIsland(x *Ext, v board.Vertex) bool {
	for _, h := range v.Hexes() {
		if slices.Contains(x.Home, h) {
			return true
		}
	}
	return false
}
