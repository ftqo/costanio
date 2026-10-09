package engine

import "github.com/ftqo/costan.io/engine/board"

// PathRaider is one neutral figure. Its slice index is its stable identity;
// captured figures remain as empty slots so a pending move cannot name another.
type PathRaider struct {
	Hex    board.Hex  `json:"hex"`
	Edge   board.Edge `json:"edge"`
	Alive  bool       `json:"alive"`
	OnPath bool       `json:"on_path"`
}

// RaiderPathGeometry supplies the wagon graph without coupling modules.
type RaiderPathGeometry interface {
	RaiderPaths(s *State, h board.Hex) []board.Edge
	RaiderStartHexes(s *State) []board.Hex
}

// SharedRaiderPopulation owns both conquest and path occupancy.
type SharedRaiderPopulation interface {
	PathRaiders(s *State) ([]PathRaider, bool)
	RelocatePathRaider(s *State, p PlayerID, id int, h board.Hex, e board.Edge) ([]Event, error)
	RaiderDestinations(s *State) []board.Hex
}

func RaiderGeometry(s *State) RaiderPathGeometry {
	for _, m := range s.Modules() {
		if g, ok := m.(RaiderPathGeometry); ok {
			return g
		}
	}
	return nil
}

func RaiderPopulation(s *State) SharedRaiderPopulation {
	for _, m := range s.Modules() {
		if g, ok := m.(SharedRaiderPopulation); ok {
			return g
		}
	}
	return nil
}

func SharedRaiders(s *State) ([]PathRaider, bool) {
	if p := RaiderPopulation(s); p != nil {
		return p.PathRaiders(s)
	}
	return nil, false
}

// TradeHexEligibility keeps a scenario's exclusive hex out of wagon trade sites.
type TradeHexEligibility interface {
	TradeHexAllowed(s *State, h board.Hex) bool
}

func TradeHexAllowed(s *State, h board.Hex) bool {
	for _, m := range s.Modules() {
		if p, ok := m.(TradeHexEligibility); ok && !p.TradeHexAllowed(s, h) {
			return false
		}
	}
	return true
}
