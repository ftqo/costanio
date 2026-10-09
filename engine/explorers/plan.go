package explorers

import (
	"encoding/json"
	"slices"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// The planning surface. Bots and the client both need to know what a ship may
// do from where it stands, and neither should re-derive the rules. Every Job
// returned is one the module's Decide accepts right now, and Command turns a
// Job into the command that does it.

// JobKind is one thing a ship may do at a hex or a corner without spending a
// movement point.
type JobKind uint8

const (
	// JobDeliver hands a fish haul and every spice sack aboard to the Council.
	JobDeliver JobKind = iota
	// JobFound lands a settler as a settlement, spending the settler and the
	// ship.
	JobFound
	// JobLandCrew puts a crew on an uncaptured pirate lair, or on a spice farm
	// this player has not befriended (which takes the sack in exchange).
	JobLandCrew
	// JobTakeCrew picks one of the player's own surviving crews back up from a
	// captured lair.
	JobTakeCrew
	// JobLoadHaul takes a fish haul off a shoal.
	JobLoadHaul
)

// Job is one such action: which ship does it, and where.
type Job struct {
	Kind JobKind
	Ship int
	H    board.Hex
	V    board.Vertex
}

// Jobs is every zero-cost action seat may take right now, in a deterministic
// order: by ship id, then by kind, then by position. It is empty outside the
// seat's own Movement phase.
func Jobs(s *engine.State, seat engine.PlayerID) []Job {
	x := extRO(s)
	if err := requireMovement(s, x, seat); err != nil {
		return nil
	}
	var out []Job
	for _, sh := range ShipsOf(x, seat) {
		if sh.Hold.Haul > 0 || sh.Hold.Spice > 0 {
			if atCouncil(x, sh.E) {
				out = append(out, Job{Kind: JobDeliver, Ship: sh.ID})
			}
		}
		if sh.Hold.Settler > 0 {
			for _, v := range []board.Vertex{sh.E.A, sh.E.B} {
				if foundSpotOK(s, x, v, seat) == nil && s.Players[seat].SettlementsLeft > 0 {
					out = append(out, Job{Kind: JobFound, Ship: sh.ID, V: v})
				}
			}
		}
		for _, h := range reach(sh.E) {
			pool, ok := poolOf(x, h)
			if !ok || !x.Revealed[h] {
				continue
			}
			switch pool.Kind {
			case SpecialGold:
				if sh.Hold.Crew > 0 && !x.Captured[h] {
					out = append(out, Job{Kind: JobLandCrew, Ship: sh.ID, H: h})
				}
				if x.Captured[h] && x.LairCrew[h][seat] > 0 && add(sh.Hold, Cargo{Crew: 1}).Fits() {
					out = append(out, Job{Kind: JobTakeCrew, Ship: sh.ID, H: h})
				}
			case SpecialSpice:
				if sh.Hold.Crew > 0 && !x.FarmCrew[h][seat] &&
					add(sub(sh.Hold, Cargo{Crew: 1}), Cargo{Spice: 1}).Fits() {
					out = append(out, Job{Kind: JobLandCrew, Ship: sh.ID, H: h})
				}
			case SpecialShoal:
				if x.Hauls[h] && add(sh.Hold, Cargo{Haul: 1}).Fits() {
					out = append(out, Job{Kind: JobLoadHaul, Ship: sh.ID, H: h})
				}
			case SpecialNone:
			}
		}
	}
	return out
}

// Command is the command that performs job j for seat.
func Command(seat engine.PlayerID, j Job) engine.Command {
	switch j.Kind {
	case JobDeliver:
		return engine.Command{Player: seat, Type: CmdDeliver, Data: raw(map[string]any{"ship_id": j.Ship})}
	case JobFound:
		return engine.Command{Player: seat, Type: CmdFound, Data: raw(map[string]any{"ship_id": j.Ship, "v": j.V})}
	case JobLandCrew:
		return engine.Command{Player: seat, Type: CmdLandCrew, Data: raw(map[string]any{"ship_id": j.Ship, "h": j.H})}
	case JobTakeCrew:
		return engine.Command{Player: seat, Type: CmdTakeCrew, Data: raw(map[string]any{"ship_id": j.Ship, "h": j.H})}
	case JobLoadHaul:
		return engine.Command{Player: seat, Type: CmdLoadHaul, Data: raw(map[string]any{"ship_id": j.Ship, "h": j.H})}
	}
	return engine.Command{}
}

// reach is the (up to six) hexes either end of an edge touches.
func reach(e board.Edge) []board.Hex {
	var out []board.Hex
	for _, v := range []board.Vertex{e.A, e.B} {
		for _, h := range v.Hexes() {
			if !slices.Contains(out, h) {
				out = append(out, h)
			}
		}
	}
	sortHexes(out)
	return out
}

// ShipsOf is seat's ships, in id order. Read-only.
func ShipsOf(x *Ext, seat engine.PlayerID) []Ship {
	var ids []int
	for id, sh := range x.Ships {
		if sh.Owner == seat {
			ids = append(ids, id)
		}
	}
	slices.Sort(ids)
	out := make([]Ship, 0, len(ids))
	for _, id := range ids {
		out = append(out, x.Ships[id])
	}
	return out
}

// MPLeft is how far ship sh may still travel this turn.
func MPLeft(x *Ext, sh Ship) int { return mpLeft(x, sh) }

// Gold is seat's gold.
func Gold(x *Ext, seat engine.PlayerID) int {
	if int(seat) < 0 || int(seat) >= len(x.Seats) {
		return 0
	}
	return x.Seats[seat].Gold
}

// ShipsLeft, SettlersLeft and CrewsLeft are seat's remaining supplies.
func ShipsLeft(x *Ext, seat engine.PlayerID) int {
	return supply(x, seat, func(s Seat) int { return s.ShipsLeft })
}
func SettlersLeft(x *Ext, seat engine.PlayerID) int {
	return supply(x, seat, func(s Seat) int { return s.SettlersLeft })
}
func CrewsLeft(x *Ext, seat engine.PlayerID) int {
	return supply(x, seat, func(s Seat) int { return s.CrewsLeft })
}

// Unrevealed reports whether hex h is still face down.
//
// Exported for tests checking that other modules' cards respect the fog: the
// Merchant and Inventor build target lists from s.Board, the true board, so
// they must be checked against the fog.
func Unrevealed(x *Ext, h board.Hex) bool {
	_, pooled := poolOf(x, h)
	return pooled && !x.Revealed[h]
}

func supply(x *Ext, seat engine.PlayerID, f func(Seat) int) int {
	if int(seat) < 0 || int(seat) >= len(x.Seats) {
		return 0
	}
	return f(x.Seats[seat])
}

// PathToFog is the shortest legal run of movement points ending with a reveal:
// every step but the last lands on an edge touching no unexplored hex, and the
// last touches one. Empty when no reveal is reachable within the ship's
// remaining points.
//
// The breadth-first walk stops expanding at a fog-touching edge, because a
// discovery ends the ship's movement and walkPath refuses a route that carries
// on past one.
func PathToFog(s *engine.State, seat engine.PlayerID, ship int) []board.Edge {
	return searchPath(s, seat, ship, func(x *Ext, e board.Edge) bool { return len(fogAt(x, e)) > 0 })
}

// PathToCouncil is the shortest legal run ending at one of the Council hex's two
// anchors: where a fish haul and every spice sack are delivered.
func PathToCouncil(s *engine.State, seat engine.PlayerID, ship int) []board.Edge {
	return searchPath(s, seat, ship, atCouncil)
}

// PathToHarbour is the shortest legal run ending at one of seat's own harbour
// settlements: where a hold is filled and emptied, and the only place a piece
// moves from one ship to another.
func PathToHarbour(s *engine.State, seat engine.PlayerID, ship int) []board.Edge {
	return searchPath(s, seat, ship, func(x *Ext, e board.Edge) bool {
		_, at := shipAtHarbour(x, e, seat)
		return at
	})
}

// PathToFound is the shortest legal run ending where a settler aboard may be
// landed as a settlement.
func PathToFound(s *engine.State, seat engine.PlayerID, ship int) []board.Edge {
	return searchPath(s, seat, ship, func(x *Ext, e board.Edge) bool {
		if s.Players[seat].SettlementsLeft == 0 {
			return false
		}
		return foundSpotOK(s, x, e.A, seat) == nil || foundSpotOK(s, x, e.B, seat) == nil
	})
}

// PathToHaul is the shortest legal run ending beside a shoal carrying a fish
// haul the ship has room for.
func PathToHaul(s *engine.State, seat engine.PlayerID, ship int) []board.Edge {
	x := extRO(s)
	sh, ok := x.Ships[ship]
	if !ok || !add(sh.Hold, Cargo{Haul: 1}).Fits() {
		return nil
	}
	return searchPath(s, seat, ship, func(x *Ext, e board.Edge) bool {
		for _, h := range reach(e) {
			if x.Hauls[h] {
				return true
			}
		}
		return false
	})
}

// LoadJob is the cargo a ship standing at one of its owner's harbour settlements
// may take aboard from the basin, and the vertex it comes from. Empty when the
// ship is not at one, the basin is empty, or the hold has no room.
func LoadJob(s *engine.State, seat engine.PlayerID, ship int) (Cargo, bool) {
	x := extRO(s)
	sh, ok := x.Ships[ship]
	if !ok || sh.Owner != seat {
		return Cargo{}, false
	}
	v, at := shipAtHarbour(x, sh.E, seat)
	if !at {
		return Cargo{}, false
	}
	basin := x.Basins[v]
	// Largest piece first: a settler is what founds a settlement, and a hold
	// carrying one crew has no room left for it.
	for _, c := range []Cargo{{Settler: 1}, {Crew: 1}, {Haul: 1}, {Spice: 1}} {
		if sub(basin, c).Fits() && basin.Slots() >= c.Slots() && hasPiece(basin, c) && add(sh.Hold, c).Fits() {
			return c, true
		}
	}
	return Cargo{}, false
}

func hasPiece(c, want Cargo) bool {
	return c.Settler >= want.Settler && c.Haul >= want.Haul && c.Crew >= want.Crew && c.Spice >= want.Spice
}

// LoadCommand loads cargo from the basin the ship is standing at.
func LoadCommand(seat engine.PlayerID, ship int, c Cargo) engine.Command {
	return engine.Command{Player: seat, Type: CmdLoad,
		Data: raw(map[string]any{"ship_id": ship, "cargo": c})}
}

// BasinHoldings reports whether seat has anything waiting in a harbour basin.
func BasinHoldings(s *engine.State, seat engine.PlayerID) bool {
	x := extRO(s)
	for v, owner := range x.Harbours {
		if owner == seat && !x.Basins[v].Empty() {
			return true
		}
	}
	return false
}

// PathTo is the shortest legal run ending on an edge touching hex h: how a ship
// reaches a lair to storm, a farm to befriend or a shoal to work.
func PathTo(s *engine.State, seat engine.PlayerID, ship int, h board.Hex) []board.Edge {
	return searchPath(s, seat, ship, func(_ *Ext, e board.Edge) bool { return touchesHex(e, h) })
}

// searchPath is the shared breadth-first walk, and it plans further than one
// turn.
//
// Bounding the search at the ship's remaining movement points means a ship
// farther from the fog than it can travel in one turn is never offered a move,
// and the map stops opening up. So the walk is unbounded (to a depth no board
// reaches) and the result is truncated to what the ship can afford. That is
// safe because the walk never expands past a fog-touching edge, so a reveal can
// only be the last step and no prefix contains one.
//
// The prefix is then shortened until it ends somewhere with room, since a ship
// may pass a full edge but not stop on one.
const maxSearchDepth = 64

func searchPath(s *engine.State, seat engine.PlayerID, ship int, done func(*Ext, board.Edge) bool) []board.Edge {
	x := extRO(s)
	sh, ok := x.Ships[ship]
	if !ok || sh.Owner != seat {
		return nil
	}
	budget := mpLeft(x, sh)
	if budget == 0 {
		return nil
	}
	full := walkToward(s, x, sh, ship, done)
	if len(full) == 0 {
		return nil
	}
	for n := min(budget, len(full)); n > 0; n-- {
		if roomOn(x, full[n-1], ship) {
			return full[:n]
		}
	}
	return nil
}

// walkToward is the unbounded half: the shortest route from the ship to the
// first edge `done` accepts, ignoring how far the ship can go this turn.
func walkToward(s *engine.State, x *Ext, sh Ship, ship int, done func(*Ext, board.Edge) bool) []board.Edge {
	type node struct {
		e    board.Edge
		path []board.Edge
	}
	seen := map[board.Edge]bool{sh.E: true}
	queue := []node{{e: sh.E}}
	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		if len(cur.path) >= maxSearchDepth {
			continue
		}
		for _, e := range nextEdges(s, x, cur.e) {
			if seen[e] {
				continue
			}
			seen[e] = true
			path := append(slices.Clone(cur.path), e)
			if done(x, e) {
				return path
			}
			if len(fogAt(x, e)) > 0 {
				continue // a discovery ends movement: nothing continues past it
			}
			queue = append(queue, node{e: e, path: path})
		}
	}
	return nil
}

// nextEdges is every sailable edge one movement point away from e, in a stable
// order.
func nextEdges(s *engine.State, x *Ext, e board.Edge) []board.Edge {
	var out []board.Edge
	for _, v := range []board.Vertex{e.A, e.B} {
		for _, n := range v.Edges() {
			if n == e || !n.Valid() || !sailable(s, x, n) || slices.Contains(out, n) {
				continue
			}
			out = append(out, n)
		}
	}
	slices.SortFunc(out, func(a, b board.Edge) int {
		if edgeLess(a, b) {
			return -1
		}
		return 1
	})
	return out
}

// MoveCommand is the command that walks ship `ship` along path.
func MoveCommand(seat engine.PlayerID, ship int, path []board.Edge) engine.Command {
	return engine.Command{Player: seat, Type: CmdMoveShip,
		Data: raw(map[string]any{"ship_id": ship, "path": path})}
}

// ShipBuildSpots is every sea edge beside one of seat's harbour settlements a
// ship may be built on right now.
func ShipBuildSpots(s *engine.State, seat engine.PlayerID) []board.Edge {
	return shipBuildSpots(s, extRO(s), seat)
}

// HarbourUpgrades is every settlement of seat's that may become a harbour
// settlement: its own, coastal, and not one already.
func HarbourUpgrades(s *engine.State, seat engine.PlayerID) []board.Vertex {
	return legalExtras(s, seat).Harbours
}

// BattleReadyShips is every ship of seat's that may roll at an opponent's pirate
// ship: it has not moved this turn and stands at a corner of the pirate's hex.
func BattleReadyShips(s *engine.State, seat engine.PlayerID) []int {
	return battleReady(extRO(s), seat)
}

// CargoRoom reports where seat may put a newly bought piece: a harbour
// settlement basin with room, or a ship with room that touches one. It returns
// the command payload rather than a position, because "at a ship" and "at a
// harbour settlement" are different addresses for the same slot.
func CargoRoom(s *engine.State, seat engine.PlayerID, settler bool) (json.RawMessage, bool) {
	x := extRO(s)
	piece := Cargo{Crew: 1}
	if settler {
		piece = Cargo{Settler: 1}
	}
	for _, sh := range ShipsOf(x, seat) {
		if _, at := shipAtHarbour(x, sh.E, seat); at && add(sh.Hold, piece).Fits() {
			return raw(map[string]any{"settler": settler, "at_ship": true, "ship_id": sh.ID}), true
		}
	}
	var verts []board.Vertex
	for v, owner := range x.Harbours {
		if owner == seat {
			verts = append(verts, v)
		}
	}
	slices.SortFunc(verts, func(a, b board.Vertex) int {
		if vertexLess(a, b) {
			return -1
		}
		return 1
	})
	for _, v := range verts {
		if add(x.Basins[v], piece).Fits() {
			return raw(map[string]any{"settler": settler, "at_ship": false, "v": v}), true
		}
	}
	return nil, false
}

// CrewTargets is every revealed hex a crew of seat's may still be landed on: an
// uncaptured pirate lair, or a spice farm this seat has not befriended.
//
// Farms come first. A crew on a farm buys a spice sack and a permanent
// advantage; a crew on a lair buys nothing until the third lands, and the
// supply is nine for the whole game, so spreading crews over lairs wastes them.
func CrewTargets(s *engine.State, seat engine.PlayerID) []board.Hex {
	x := extRO(s)
	var farms, lairs []board.Hex
	for _, p := range x.Pool {
		if !x.Revealed[p.H] {
			continue
		}
		switch p.Kind {
		case SpecialGold:
			if !x.Captured[p.H] {
				lairs = append(lairs, p.H)
			}
		case SpecialSpice:
			if crews := x.FarmCrew[p.H]; int(seat) < len(crews) && !crews[seat] {
				farms = append(farms, p.H)
			}
		case SpecialNone, SpecialShoal:
		}
	}
	sortHexes(farms)
	// Lairs by how many crews already stand on them, most first, so crews
	// concentrate on a lair until it falls rather than spreading one per lair.
	sortHexes(lairs)
	slices.SortStableFunc(lairs, func(a, b board.Hex) int { return crewsOn(x, b) - crewsOn(x, a) })
	return append(farms, lairs...)
}

// crewsOn is how many crews of all seats stand on hex h.
func crewsOn(x *Ext, h board.Hex) int {
	n := 0
	for _, c := range x.LairCrew[h] {
		n += c
	}
	return n
}

// InMovement reports whether seat's turn has entered its Movement phase.
func InMovement(s *engine.State) bool { return extRO(s).Movement }

// FishRolled reports whether this Movement phase has used its one fishing die.
func FishRolled(s *engine.State) bool { return extRO(s).FishRolled }

// CrewWorthBuying reports whether another crew has anywhere useful to go.
//
// A supply question, not reachability: nine crews is the whole game, a crew on
// a lair is gone until the lair falls, and a lair needs three. Buying whenever
// affordable ends with crews standing one per lair and ships ferrying them
// instead of exploring.
//
// A crew is worth buying when there is a farm to befriend, a lair one crew
// short of falling, or no crew in transit and a lair to start. Otherwise the
// wool and ore are better spent elsewhere.
func CrewWorthBuying(s *engine.State, seat engine.PlayerID) bool {
	x := extRO(s)
	inTransit := 0
	for _, sh := range ShipsOf(x, seat) {
		inTransit += sh.Hold.Crew
	}
	for v, owner := range x.Harbours {
		if owner == seat {
			inTransit += x.Basins[v].Crew
		}
	}
	lair := false
	for _, p := range x.Pool {
		if !x.Revealed[p.H] {
			continue
		}
		switch p.Kind {
		case SpecialSpice:
			if crews := x.FarmCrew[p.H]; int(seat) < len(crews) && !crews[seat] {
				return true
			}
		case SpecialGold:
			if x.Captured[p.H] {
				continue
			}
			lair = true
			if crewsOn(x, p.H)+inTransit+1 >= LairCrews {
				return true
			}
		case SpecialNone, SpecialShoal:
		}
	}
	return lair && inTransit == 0
}

// FoundingSpots reports whether seat has anywhere to land a settler: a revealed
// land corner that passes the distance rule and this seat's build gates.
func FoundingSpots(s *engine.State, seat engine.PlayerID) bool {
	x := extRO(s)
	if s.Players[seat].SettlementsLeft == 0 {
		return false
	}
	for _, p := range x.Pool {
		if !x.Revealed[p.H] || !s.Board.Land(p.H) {
			continue
		}
		for _, v := range p.H.Vertices() {
			if foundSpotOK(s, x, v, seat) == nil {
				return true
			}
		}
	}
	return false
}

// FishWorthRolling reports whether the fishing die can land anything: at least
// one revealed shoal with no haul and no pirate ship on it, and a haul left in
// the supply.
//
// The roll is free but writes an event, so a bot should not roll every turn
// before any shoal is found. See docs/rules/explorers.md on the fish mission.
func FishWorthRolling(s *engine.State) bool {
	x := extRO(s)
	if x.HaulsLeft == 0 {
		return false
	}
	for _, p := range x.Pool {
		if p.Kind != SpecialShoal || !x.Revealed[p.H] || x.Hauls[p.H] {
			continue
		}
		if x.HasPirate && x.Pirate == p.H {
			continue
		}
		return true
	}
	return false
}

// PiratePending reports whether an activation is owed, and by whom.
func PiratePending(s *engine.State) (engine.PlayerID, bool) {
	x := extRO(s)
	return x.PirateBy, x.PiratePending
}

// TrackPos is seat's position on mission track t.
func TrackPos(x *Ext, seat engine.PlayerID, t int) int {
	if int(seat) < 0 || int(seat) >= len(x.Seats) || t < 0 || t >= TrackCount {
		return 0
	}
	return x.Seats[seat].Track[t]
}
