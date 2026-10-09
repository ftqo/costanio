package engine

import (
	"github.com/ftqo/costan.io/engine/board"
)

func decidePlaceSettlement(s *State, cmd Command) ([]Event, error) {
	if s.Phase != PhaseSetup {
		return nil, ErrWrongPhase
	}
	if setupOwnedByModule(s) {
		// The module is running the draft and places its own piece kinds; the
		// base command means something else there. See Hooks.OwnsSetup.
		return nil, ErrUnknownCommand
	}
	if cmd.Player != s.Cur {
		return nil, ErrNotYourTurn
	}
	if s.NeedRoad {
		return nil, ErrWrongPhase // settlement already placed; road expected
	}
	d, err := decodeCmd[SettlementPlacedData](cmd.Data)
	if err != nil {
		return nil, err
	}
	v := d.V
	if err := checkSettlementSpot(s, v); err != nil {
		return nil, err
	}

	place := EvSettlementPlace
	if s.SetupRound == 1 && s.setupRound2City() {
		place = EvSetupCityPlace
	}
	events := []Event{mustEvent(place, SettlementPlacedData{Player: cmd.Player, V: v})}
	if s.SetupRound == 1 {
		var gain Hand
		for _, h := range v.Hexes() {
			// Only the five bankable resources pay out; gold/sea/lake/fog do
			// not index into a Hand.
			if t, ok := s.Board.Tiles[h]; ok && t.Res.Producing() {
				gain[t.Res]++
			}
		}
		if gain.Count() > 0 {
			events = append(events, mustEvent(EvStartingRes, StartingResData{Player: cmd.Player, Gain: gain}))
		}
		// Modules grant their own terrain's starting yield (Islands gold owes a
		// pick) that the base five-resource grant skips.
		for _, m := range s.Modules() {
			if h := m.Hooks().SetupGrant; h != nil {
				events = append(events, h(s, cmd.Player, v)...)
			}
		}
	}
	return events, nil
}

// checkSettlementSpot enforces: on the board, unoccupied, distance rule, and
// not module-blocked (knights, fog).
func checkSettlementSpot(s *State, v board.Vertex) error {
	if v.Side > board.S || !s.Board.LandVertex(v) {
		return ErrBadPlacement
	}
	if _, ok := s.Buildings[v]; ok {
		return ErrOccupied
	}
	if s.vertexBlocked(v, NoPlayer) {
		return ErrBadPlacement
	}
	// A module may bar new construction here while existing pieces stay
	// (a Raiders hex saturated by raiders bars its six corners). See
	// Hooks.BlocksNewConstruction.
	if s.NewConstructionBlocked(v) {
		return ErrBadPlacement
	}
	for _, n := range v.Neighbors() {
		if _, ok := s.Buildings[n]; ok {
			return ErrTooClose
		}
	}
	return nil
}

func decidePlaceRoad(s *State, cmd Command) ([]Event, error) {
	if s.Phase != PhaseSetup {
		return nil, ErrWrongPhase
	}
	if setupOwnedByModule(s) {
		return nil, ErrUnknownCommand // see Hooks.OwnsSetup
	}
	if cmd.Player != s.Cur {
		return nil, ErrNotYourTurn
	}
	if !s.NeedRoad {
		return nil, ErrWrongPhase // settlement must come first
	}
	d, err := decodeCmd[struct {
		E    board.Edge `json:"e"`
		Ship bool       `json:"ship"` // place a ship instead of a road (Islands coastal start)
	}](cmd.Data)
	if err != nil {
		return nil, err
	}
	e := board.NewEdge(d.E.A, d.E.B)
	if !e.Valid() {
		return nil, ErrBadPlacement
	}
	if _, ok := s.Roads[e]; ok {
		return nil, ErrOccupied
	}
	if s.edgeBlockedByModule(e) {
		return nil, ErrOccupied // a ship already holds this coastal edge
	}
	// A setup connector obeys the same closed-edge rules as a built one: a
	// Rivers bridge site takes no road (and no bridge in setup), and a
	// Raiders conquered hex bars a new road but not a ship.
	kind := RouteRoad
	if d.Ship {
		kind = RouteShip
	}
	if err := s.EdgeRefusal(e, kind); err != nil {
		return nil, err
	}
	if !d.Ship && s.newRoadBlocked(e) {
		return nil, ErrBadPlacement // a module bars a new road here (Raiders conquest)
	}
	if !e.Touches(s.LastSettlement) {
		return nil, ErrBadPlacement // setup connector must serve the new settlement
	}

	var events []Event
	if d.Ship {
		// A coastal start may open by sea: the module emits a free ship and the
		// base advances the draft. (A coastal edge borders both land and sea, so
		// road-vs-ship is the player's explicit choice, not inferred.)
		ship, ok := s.setupShipEvent(e, cmd.Player)
		if !ok {
			return nil, ErrBadPlacement
		}
		events = append(events, ship, mustEvent(EvSetupAdvanced, struct{}{}))
	} else {
		if !s.Board.LandEdge(e) {
			return nil, ErrBadPlacement
		}
		events = append(events, mustEvent(EvRoadPlaced, RoadPlacedData{Player: cmd.Player, E: e}))
	}
	// Last connector of the snake starts the first real turn.
	if s.SetupRound == 1 && s.Cur == 0 {
		events = append(events, mustEvent(EvTurnStarted, TurnStartedData{Player: 0}))
	}
	return events, nil
}

// setupRound2City reports whether any active module makes the round-2 setup
// placement a city instead of a settlement (Knights).
func (s *State) setupRound2City() bool {
	for _, m := range s.Modules() {
		if m.Hooks().SetupRound2City {
			return true
		}
	}
	return false
}

// setupShipEvent asks modules to place a coastal setup ship on a non-land edge.
func (s *State) setupShipEvent(e board.Edge, p PlayerID) (Event, bool) {
	for _, m := range s.Modules() {
		if h := m.Hooks().SetupShipEvent; h != nil {
			if ev, ok := h(s, e, p); ok {
				return ev, true
			}
		}
	}
	return Event{}, false
}
