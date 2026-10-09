package engine

import "github.com/ftqo/costan.io/engine/board"

func decideBuild(s *State, cmd Command) ([]Event, error) {
	p := cmd.Player
	if err := requireBuildTurn(s, p); err != nil {
		// Road Building's free roads may be placed when the turn is not otherwise
		// actionable (e.g. before rolling; the card has no roll requirement). Every
		// other build needs a fully actionable turn, and the free road still needs the
		// robber/discard interrupts cleared.
		if cmd.Type != CmdBuildRoad || !freeRoadPlaceable(s, p) {
			return nil, err
		}
	}
	ps := s.Players[p]

	switch cmd.Type {
	case CmdBuildRoad:
		d, err := decodeCmd[BuiltData](cmd.Data)
		if err != nil || d.E == nil {
			return nil, ErrBadCommand
		}
		e := board.NewEdge(d.E.A, d.E.B)
		if !e.Valid() || !s.Board.LandEdge(e) {
			return nil, ErrBadPlacement
		}
		if _, ok := s.Roads[e]; ok {
			return nil, ErrOccupied
		}
		if s.edgeBlockedByModule(e) {
			return nil, ErrOccupied // a ship already holds this coastal edge
		}
		// A module may close an edge to roads outright (a Rivers bridge site): the
		// edge is empty, but shut.
		if err := s.EdgeRefusal(e, RouteRoad); err != nil {
			return nil, err
		}
		if s.newRoadBlocked(e) {
			// Not ErrOccupied: nothing stands here, but a module has closed the edge to
			// new roads (a Raiders conquered hex); under Islands a ship may still be built
			// there. Three predicates are asked, richest first: EdgeRefusal returns the
			// module's own error, BlocksNewRoad is a bool mapped to ErrBadPlacement, and
			// buildBlockedEdge is the only one that depends on who is building (an
			// Explorers fog edge, an uncaptured lair).
			return nil, ErrBadPlacement
		}
		if s.buildBlockedEdge(e, p) {
			return nil, ErrBadPlacement // a module bars this seat here (fog, a lair)
		}
		if !s.roadConnects(e, p) {
			return nil, ErrBadPlacement
		}
		if ps.RoadsLeft == 0 {
			return nil, noPieces(PieceRoad)
		}
		free := s.FreeRoads > 0 // road-building roads are spent first
		if !free && !ps.Hand.Has(CostRoad) {
			return nil, noResources(CostRoad, ps.Hand)
		}
		return []Event{mustEvent(EvRoadBuilt, BuiltData{Player: p, E: &e, Free: free})}, nil

	case CmdBuildSettlement:
		d, err := decodeCmd[BuiltData](cmd.Data)
		if err != nil || d.V == nil {
			return nil, ErrBadCommand
		}
		v := *d.V
		if err := checkSettlementSpot(s, v); err != nil {
			return nil, err
		}
		if s.buildBlockedVertex(v, p) {
			return nil, ErrBadPlacement // a module bars this seat here (a spice farm)
		}
		if !s.hasAdjacentRoute(v, p) {
			return nil, ErrBadPlacement
		}
		if ps.SettlementsLeft == 0 {
			return nil, noPieces(PieceSettlement)
		}
		if !ps.Hand.Has(CostSettlement) {
			return nil, noResources(CostSettlement, ps.Hand)
		}
		return []Event{mustEvent(EvSettlementBuilt, BuiltData{Player: p, V: &v})}, nil

	case CmdBuildCity:
		if citiesDisabled(s) {
			return nil, ErrUnknownCommand
		}
		d, err := decodeCmd[BuiltData](cmd.Data)
		if err != nil || d.V == nil {
			return nil, ErrBadCommand
		}
		v := *d.V
		b, ok := s.Buildings[v]
		if !ok || b.Owner != p || b.City {
			return nil, ErrBadPlacement
		}
		// A module may bar this settlement from becoming a city: an Explorers harbour
		// settlement has taken the other branch of the pairing's one-way upgrade.
		if err := s.BlocksCityUpgrade(v, p); err != nil {
			return nil, err
		}
		// A module may pin the next upgrade to a specific vertex (a Knights
		// laid-on-side city).
		for _, m := range s.Modules() {
			if h := m.Hooks().MustUpgradeFirst; h != nil {
				if must, ok := h(s, p); ok && must != v {
					return nil, ErrBadPlacement
				}
			}
		}
		if ps.CitiesLeft == 0 {
			return nil, noPieces(PieceCity)
		}
		if !ps.Hand.Has(CostCity) {
			return nil, noResources(CostCity, ps.Hand)
		}
		return []Event{mustEvent(EvCityBuilt, BuiltData{Player: p, V: &v})}, nil
	default: // other command types intentionally unhandled here
	}
	return nil, ErrUnknownCommand
}

// RoadConnectsExcluding reports whether road e would connect to p's network
// with the edge `removed` treated as absent. The Knights Diplomat frees one of
// the player's roads and rebuilds it in the same action, so the rebuilt road
// must connect without the freed one.
func (s *State) RoadConnectsExcluding(e board.Edge, p PlayerID, removed board.Edge) bool {
	for _, v := range []board.Vertex{e.A, e.B} {
		if b, ok := s.Buildings[v]; ok {
			if b.Owner == p {
				return true
			}
			continue
		}
		if s.vertexBlocked(v, p) {
			continue
		}
		for _, ve := range v.Edges() {
			if ve != e && ve != removed && roadOwned(s, ve, p) {
				return true
			}
		}
	}
	return false
}

// roadConnects: an endpoint holds one of the player's buildings, or an
// unblocked endpoint joins one of the player's roads. Opponent buildings and
// module blockers like enemy knights block continuation through their vertex.
func (s *State) roadConnects(e board.Edge, p PlayerID) bool {
	for _, v := range []board.Vertex{e.A, e.B} {
		if b, ok := s.Buildings[v]; ok {
			if b.Owner == p {
				return true
			}
			continue // opponent building blocks this endpoint
		}
		if s.vertexBlocked(v, p) {
			continue
		}
		for _, ve := range v.Edges() {
			if ve != e && roadOwned(s, ve, p) {
				return true
			}
		}
	}
	return false
}

// freeRoadPlaceable reports whether p may place a Road Building free road while
// the turn is not otherwise actionable (e.g. before rolling): p's own play turn
// with no robber, discard or module interrupt outstanding, but no roll
// required. LegalTargetsFor uses the same predicate.
func freeRoadPlaceable(s *State, p PlayerID) bool {
	return s.FreeRoads > 0 && requireUninterruptedTurn(s, p) == nil
}

// citiesDisabled reports whether a module has removed the city from this
// ruleset. See Hooks.NoCities.
func citiesDisabled(s *State) bool {
	for _, m := range s.Modules() {
		if h := m.Hooks().NoCities; h != nil && h(s) {
			return true
		}
	}
	return false
}

func (s *State) vertexBlocked(v board.Vertex, p PlayerID) bool {
	for _, m := range s.Modules() {
		if h := m.Hooks().BlocksVertex; h != nil && h(s, v, p) {
			return true
		}
	}
	return false
}

// roadOwned guards against the zero-value PlayerID ambiguity of map lookups.
func roadOwned(s *State, e board.Edge, p PlayerID) bool {
	owner, ok := s.Roads[e]
	return ok && owner == p
}

func (s *State) hasAdjacentRoad(v board.Vertex, p PlayerID) bool {
	for _, e := range v.Edges() {
		if roadOwned(s, e, p) {
			return true
		}
	}
	return false
}
