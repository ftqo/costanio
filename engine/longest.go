package engine

import "github.com/ftqo/costan.io/engine/board"

// roadGraph is a player's road subgraph compiled for the longest-path DFS: each
// owned edge gets a small local index, and adj maps every touched vertex to the
// local indices of its incident owned edges, so the DFS uses a reused []bool
// and slice walks instead of map lookups.
type roadGraph struct {
	edges   []board.Edge
	adj     map[board.Vertex][]int32
	visited []bool
}

// buildRoadGraph compiles player p's road subgraph. Returns nil if p has no
// roads (the caller then reports length 0 without a DFS).
func buildRoadGraph(s *State, p PlayerID) *roadGraph {
	g := &roadGraph{adj: make(map[board.Vertex][]int32)}
	for e, owner := range s.Roads {
		if owner != p {
			continue
		}
		idx := int32(len(g.edges))
		g.edges = append(g.edges, e)
		g.adj[e.A] = append(g.adj[e.A], idx)
		g.adj[e.B] = append(g.adj[e.B], idx)
	}
	if len(g.edges) == 0 {
		return nil
	}
	g.visited = make([]bool, len(g.edges))
	return g
}

// longestRoadLength is the player's longest simple path of roads, in edges.
// Opponent buildings cut paths at their vertex.
func longestRoadLength(s *State, p PlayerID) int {
	g := buildRoadGraph(s, p)
	if g == nil {
		return 0
	}
	return g.longest(s, p)
}

// longest runs the DFS over the compiled graph. Separated from the build so a
// caller computing several players can size-check without rebuilding helpers.
func (g *roadGraph) longest(s *State, p PlayerID) int {
	best := 0
	var dfs func(at board.Vertex, length int)
	dfs = func(at board.Vertex, length int) {
		if length > best {
			best = length
		}
		// An opponent building, or a module blocker such as an enemy knight,
		// breaks the route through this intersection.
		if b, ok := s.Buildings[at]; ok && b.Owner != p {
			return
		}
		if s.vertexBlocked(at, p) {
			return
		}
		for _, idx := range g.adj[at] {
			if g.visited[idx] {
				continue
			}
			g.visited[idx] = true
			dfs(g.edges[idx].Other(at), length+1)
			g.visited[idx] = false
		}
	}
	// Start a DFS from each distinct vertex with an owned edge; the adjacency
	// map already deduplicates vertices, so each junction is a start once.
	for at := range g.adj {
		dfs(at, 0)
	}
	return best
}

// longestRoadEvents recomputes the title on a state where the candidate
// events were already applied, and returns a title-change event if needed.
// routeLen is the length function (base roads, or a module override that
// includes ships).
func longestRoadEvents(after *State, routeLen func(*State, PlayerID) int) []Event {
	const minRoad = 5
	holder := after.LongestRoadHolder

	// Compute each player's route length once (the holder's included).
	bestLen, bestPlayer, tied := 0, NoPlayer, false
	holderLen := 0
	for p := range after.Players {
		l := routeLen(after, PlayerID(p))
		if holder == PlayerID(p) {
			holderLen = l
		}
		if l > bestLen {
			bestLen, bestPlayer, tied = l, PlayerID(p), false
		} else if l == bestLen {
			tied = true
		}
	}

	switch {
	case holder != NoPlayer && holderLen >= minRoad:
		// The holder loses the moment someone is strictly longer. If the new
		// leaders tie with each other, the title is set aside (NoPlayer) until
		// exactly one player has the longest road.
		if bestLen > holderLen {
			if tied {
				return []Event{mustEvent(EvLongestRoad, TitleData{Holder: NoPlayer})}
			}
			return []Event{mustEvent(EvLongestRoad, TitleData{Holder: bestPlayer})}
		}
	case holder != NoPlayer: // holder fell below 5
		if bestLen >= minRoad && !tied {
			return []Event{mustEvent(EvLongestRoad, TitleData{Holder: bestPlayer})}
		}
		return []Event{mustEvent(EvLongestRoad, TitleData{Holder: NoPlayer})}
	default:
		if bestLen >= minRoad && !tied {
			return []Event{mustEvent(EvLongestRoad, TitleData{Holder: bestPlayer})}
		}
	}
	return nil
}

// longestRoadDisabled reports whether any active module has removed the Longest
// Road award from this game (Wagons). See Hooks.NoLongestRoad.
func longestRoadDisabled(s *State) bool {
	for _, m := range s.Modules() {
		if m.Hooks().NoLongestRoad {
			return true
		}
	}
	return false
}

// LongestRoadAward reports whether the Longest Road award is in play at all.
//
// Exported for the scoreboard, player rail and bots, which read
// LongestRoadHolder and would otherwise need to know which rulesets remove the
// title. A property of the ruleset; it never changes mid-game.
func (s *State) LongestRoadAward() bool { return !longestRoadDisabled(s) }

// LongestRoadLength is the length of p's longest continuous route.
//
// Exported for evaluators that need the distance to the title, not just who
// holds it.
func (s *State) LongestRoadLength(p PlayerID) int { return longestRoadLength(s, p) }
