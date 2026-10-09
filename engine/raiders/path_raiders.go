package raiders

import (
	"encoding/json"
	"slices"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

// UnmarshalJSON resets the new board fields before overlaying a recorded blob.
// Older logs omit them and must retain their independent populations.
func (e *Ext) UnmarshalJSON(data []byte) error {
	type plain Ext
	e.Shared = false
	e.PathFigures = nil
	e.PathQueue = nil
	e.PathEdges = nil
	return json.Unmarshal(data, (*plain)(e))
}

const CmdPickPath engine.CommandType = "raiders_pick_path"
const EvPathPlaced engine.EventType = "raiders_path_placed"
const PendPath = "raiders_path"

type pathPlacedData struct {
	Player engine.PlayerID `json:"player"`
	ID     int             `json:"id"`
	Hex    board.Hex       `json:"hex"`
	E      board.Edge      `json:"e"`
}

func (e *Ext) populationHexes() []board.Hex {
	if e.Shared {
		return e.Land
	}
	return e.Coast
}
func (e *Ext) syncCounts() {
	if !e.Shared {
		return
	}
	for i, h := range e.Coast {
		e.RaiderCount[i] = e.RaidersOn(h)
	}
}
func (e *Ext) addFigure(h board.Hex) int {
	id := len(e.PathFigures)
	e.PathFigures = append(e.PathFigures, engine.PathRaider{Hex: h, Alive: true})
	e.syncCounts()
	return id
}
func (e *Ext) queueFigure(h board.Hex, p engine.PlayerID) {
	e.PathQueue = append(e.PathQueue, e.addFigure(h))
	e.PathSeat = p
}
func (e *Ext) removeFigure(h board.Hex) bool {
	for i, r := range e.PathFigures {
		if r.Alive && r.Hex == h {
			e.PathFigures[i].Alive = false
			e.syncCounts()
			return true
		}
	}
	return false
}
func (e *Ext) freeRaiderPaths(s *engine.State, h board.Hex) []board.Edge {
	g := engine.RaiderGeometry(s)
	if g == nil {
		return nil
	}
	var out []board.Edge
	for _, path := range g.RaiderPaths(s, h) {
		occupied := false
		for _, r := range e.PathFigures {
			if r.Alive && r.OnPath && r.Edge == path {
				occupied = true
				break
			}
		}
		if !occupied {
			out = append(out, path)
		}
	}
	return out
}
func (e *Ext) refreshPaths(s *engine.State) {
	e.PathEdges = nil
	for len(e.PathQueue) > 0 {
		r := e.PathFigures[e.PathQueue[0]]
		if r.Alive {
			e.PathEdges = e.freeRaiderPaths(s, r.Hex)
		}
		if len(e.PathEdges) > 0 {
			return
		}
		// Only a hex whose paths are full leaves its new figure in the centre.
		e.PathQueue = e.PathQueue[1:]
	}
}
func (Module) decidePath(s *engine.State, c engine.Command) ([]engine.Event, error) {
	x := extRO(s)
	if s.Phase != engine.PhasePlay || len(x.PathQueue) == 0 {
		return nil, engine.ErrWrongPhase
	}
	if c.Player != x.PathSeat {
		return nil, engine.ErrNotYourTurn
	}
	if len(s.PendingDiscards) > 0 {
		return nil, engine.ErrDiscardPending
	}
	d, err := engine.DecodeCommand[struct {
		E board.Edge `json:"e"`
	}](c.Data)
	if err != nil {
		return nil, err
	}
	edge := board.NewEdge(d.E.A, d.E.B)
	if !slices.Contains(x.PathEdges, edge) {
		return nil, engine.ErrBadPlacement
	}
	id := x.PathQueue[0]
	return []engine.Event{engine.NewEvent(EvPathPlaced, pathPlacedData{Player: c.Player, ID: id, Hex: x.PathFigures[id].Hex, E: edge})}, nil
}
func (Module) PathRaiders(s *engine.State) ([]engine.PathRaider, bool) {
	x := extRO(s)
	return x.PathFigures, x.Shared
}
func (Module) RaiderDestinations(s *engine.State) []board.Hex { return extRO(s).unconqueredCoast() }
func (Module) RelocatePathRaider(s *engine.State, p engine.PlayerID, id int, h board.Hex, edge board.Edge) ([]engine.Event, error) {
	x := extRO(s)
	if !x.Shared || id < 0 || id >= len(x.PathFigures) || !x.PathFigures[id].Alive || !x.PathFigures[id].OnPath {
		return nil, engine.ErrBadCommand
	}
	if !slices.Contains(x.unconqueredCoast(), h) || !slices.Contains(x.freeRaiderPaths(s, h), edge) {
		return nil, engine.ErrBadPlacement
	}
	return []engine.Event{engine.NewEvent(EvPathPlaced, pathPlacedData{Player: p, ID: id, Hex: h, E: edge})}, nil
}

// TradeHexAllowed keeps the Wagons trade hexes on the main landmass and off the
// castle. The castle is read from this module's board ext when it is already
// stored ("raiders" sorts before "wagons", so it always is by the time Wagons
// asks), and derived otherwise, which costs a watercourse derivation under
// Rivers.
func (Module) TradeHexAllowed(s *engine.State, h board.Hex) bool {
	if e, ok := s.Ext[Name].(*Ext); ok && e.HasCastle {
		return slices.Contains(e.Land, h) && h != e.Castle
	}
	land := mainLandmass(s.Board)
	castle, ok := castleHex(s.Board, land, castleAvoid(s))
	return slices.Contains(land, h) && (!ok || h != castle)
}
