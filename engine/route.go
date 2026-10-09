package engine

import "github.com/ftqo/costan.io/engine/board"

// RouteKind classifies a segment of a player's route network. A route may
// change kind (road to ship, or back) only at a vertex holding the player's
// own building; kinds a module adds get that rule for free.
type RouteKind uint8

const (
	RouteRoad RouteKind = iota
	RouteShip
)

// RouteSegment is one edge of a route network: what it is, and how many
// segments it counts for in the longest route (1, or 2 for a road a camel
// walks alongside).
type RouteSegment struct {
	Kind   RouteKind
	Weight int
}

// RouteNet is a player's route network as the engine is about to walk it. The
// engine seeds it with the player's roads at weight 1 and passes it to each
// module's RouteEdges hook in ruleset order; a module adds edges it owns (Islands
// ships) or reweights existing ones (Caravans' camel-doubled roads). One walk over
// the result then measures the longest route, so contributions compose: two
// camel-doubled roads plus three ships is 7, not max(5, 4).
//
// Contributions must not depend on hook order. Reweighting must key on what the
// edge is (Kind, board position), not which module added it, and be idempotent.
type RouteNet struct {
	Edges map[board.Edge]RouteSegment
}

// Add puts e into the network as kind k at weight 1. An edge already present
// keeps its segment: base roads are seeded first, so a module finding its edge
// taken has a legality bug.
func (n *RouteNet) Add(e board.Edge, k RouteKind) {
	if _, ok := n.Edges[e]; ok {
		return
	}
	n.Edges[e] = RouteSegment{Kind: k, Weight: 1}
}

// SetWeight sets how many segments edge e counts for. A no-op when e is not
// in the network, so a module may reweight by board position without first
// checking ownership.
func (n *RouteNet) SetWeight(e board.Edge, w int) {
	seg, ok := n.Edges[e]
	if !ok {
		return
	}
	seg.Weight = w
	n.Edges[e] = seg
}

// routeGraph is a RouteNet compiled for the longest-path DFS in the same shape
// as roadGraph: local edge indices, a reused []bool visited set, and per-edge
// kind and weight alongside.
type routeGraph struct {
	edges   []board.Edge
	kinds   []RouteKind
	weights []int
	adj     map[board.Vertex][]int32
	visited []bool
}

func compileRouteNet(n *RouteNet) *routeGraph {
	g := &routeGraph{adj: make(map[board.Vertex][]int32)}
	for e, seg := range n.Edges {
		idx := int32(len(g.edges))
		g.edges = append(g.edges, e)
		g.kinds = append(g.kinds, seg.Kind)
		g.weights = append(g.weights, seg.Weight)
		g.adj[e.A] = append(g.adj[e.A], idx)
		g.adj[e.B] = append(g.adj[e.B], idx)
	}
	if len(g.edges) == 0 {
		return nil
	}
	g.visited = make([]bool, len(g.edges))
	return g
}

// longest is the mixed-kind longest simple path over the compiled network:
// opponent buildings and module blockers (enemy knights) cut the path at their
// vertex, and a change of kind needs the player's own building at the junction.
// The path length is the sum of the segment weights.
func (g *routeGraph) longest(s *State, p PlayerID) int {
	best := 0
	var dfs func(at board.Vertex, prev RouteKind, started bool, length int)
	dfs = func(at board.Vertex, prev RouteKind, started bool, length int) {
		if length > best {
			best = length
		}
		b, hasB := s.Buildings[at]
		if hasB && b.Owner != p {
			return
		}
		if s.vertexBlocked(at, p) {
			return
		}
		// A building joins its owner's networks (road chain to ship chain)
		// only while standing. A Raiders building with no unconquered
		// neighbour is laid on its side: it still blocks opponents but no
		// longer joins its owner's segments. See Hooks.BuildingInert.
		ownBuilding := hasB && b.Owner == p && !BuildingIsInert(s, at)
		for _, idx := range g.adj[at] {
			if g.visited[idx] {
				continue
			}
			k := g.kinds[idx]
			if started && k != prev && !ownBuilding {
				continue
			}
			g.visited[idx] = true
			dfs(g.edges[idx].Other(at), k, true, length+g.weights[idx])
			g.visited[idx] = false
		}
	}
	for at := range g.adj {
		dfs(at, RouteRoad, false, 0)
	}
	return best
}

// longestRouteLength measures p's longest route across base roads and every
// module contribution. With no route hooks the network is the road graph and
// the base walker answers.
func longestRouteLength(s *State, p PlayerID) int {
	var edgeHooks, weightHooks []func(*State, PlayerID, *RouteNet)
	for _, m := range s.Modules() {
		hs := m.Hooks()
		if h := hs.RouteEdges; h != nil {
			edgeHooks = append(edgeHooks, h)
		}
		if h := hs.RouteWeights; h != nil {
			weightHooks = append(weightHooks, h)
		}
	}
	if len(edgeHooks) == 0 && len(weightHooks) == 0 {
		return longestRoadLength(s, p)
	}
	net := &RouteNet{Edges: make(map[board.Edge]RouteSegment)}
	for e, owner := range s.Roads {
		if owner == p {
			net.Add(e, RouteRoad)
		}
	}
	// Two passes because a reweight must see every module's edges, and a
	// module sorting before Islands ("caravans") would otherwise reweight a
	// network with no ships yet. See Hooks.RouteWeights.
	for _, h := range edgeHooks {
		h(s, p, net)
	}
	for _, h := range weightHooks {
		h(s, p, net)
	}
	g := compileRouteNet(net)
	if g == nil {
		return 0
	}
	return g.longest(s, p)
}
