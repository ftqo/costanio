package wagons

import (
	"slices"

	"github.com/ftqo/costan.io/engine"
	"github.com/ftqo/costan.io/engine/board"
)

func (Wagons) RaiderPaths(s *engine.State, h board.Hex) []board.Edge {
	x := extRO(s)
	var out []board.Edge
	for _, e := range h.Edges() {
		if s.Board.LandEdge(e) && !blockedEdgeOn(s.Board, x.Trade, e) {
			out = append(out, e)
		}
	}
	if x.tradeIndexAt(h) >= 0 {
		for _, v := range landCorners(s.Board, h) {
			out = append(out, board.NewEdge(v, plazaOf(h)))
		}
	}
	return out
}

func (Wagons) RaiderStartHexes(s *engine.State) []board.Hex {
	x := extRO(s)
	var out []board.Hex
	if x.HasTrade {
		for i, h := range x.Trade {
			if x.Roles[i] == RoleCastle || x.Roles[i] == RoleGlassworks {
				out = append(out, h)
			}
		}
	}
	return out
}

// PathBarbarians includes only live figures assigned to paths. Keys are stable
// figure ids, including captured holes in a combined game.
func PathBarbarians(s *engine.State) map[int]board.Edge {
	out := map[int]board.Edge{}
	if rs, shared := engine.SharedRaiders(s); shared {
		for i, r := range rs {
			if r.Alive && r.OnPath {
				out[i] = r.Edge
			}
		}
	} else {
		for i, e := range extRO(s).Barb {
			out[i] = e
		}
	}
	return out
}

func barbarianAt(s *engine.State, x *WagonsExt, edge board.Edge) int {
	if rs, shared := engine.SharedRaiders(s); shared {
		for i, r := range rs {
			if r.Alive && r.OnPath && r.Edge == edge {
				return i
			}
		}
		return -1
	}
	return x.barbarianOn(edge)
}

func sharedHomes(s *engine.State) []board.Edge {
	pop := engine.RaiderPopulation(s)
	var out []board.Edge
	for _, h := range pop.RaiderDestinations(s) {
		for _, e := range (Wagons{}).RaiderPaths(s, h) {
			if barbarianAt(s, extRO(s), e) < 0 && !slices.Contains(out, e) {
				out = append(out, e)
			}
		}
	}
	return out
}

func TriedBarbarian(s *engine.State, id int) bool {
	x := extRO(s)
	if _, shared := engine.SharedRaiders(s); shared {
		return id >= 0 && id < len(x.PathTried) && x.PathTried[id]
	}
	return id >= 0 && id < len(x.Tried) && x.Tried[id]
}
func BarbarianIDs(s *engine.State) []int {
	var out []int
	for i := range PathBarbarians(s) {
		out = append(out, i)
	}
	slices.Sort(out)
	return out
}
