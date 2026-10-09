package bot

import "github.com/ftqo/costan.io/engine/board"

// vertexInfo is the static, board-derived data for one vertex. Nothing here
// changes during a game (geometry, tiles, numbers, harbors are fixed); the
// robber, buildings, and roads are read live from engine.State, never cached.
type vertexInfo struct {
	hexes     [3]board.Hex
	pips      int
	resPips   [6]int
	harbor    *board.Harbor
	neighbors [3]board.Vertex
	edges     [3]board.Edge
	landE     [3]bool // edges[i] takes a road (board.LandEdge)
	seaE      [3]bool // edges[i] takes a ship (board.SeaEdge)
	idx       int32   // position in boardInfo.vertices, for scratch indexing
}

// boardInfo is the per-board cache, built once when a bot is primed.
//
// The BFS scratch is reused across calls because reachability runs once per
// player per scored candidate (a per-call map tripled evaluation cost). A
// generation counter avoids clearing it between calls. That makes boardInfo
// single-goroutine; each bot owns one and the game actor is the sole caller
// (see game/actor.go).
type boardInfo struct {
	vertices  []board.Vertex
	landEdges []board.Edge
	vert      map[board.Vertex]*vertexInfo
	hexVerts  map[board.Hex][]board.Vertex

	seenGen   []int32 // scratch: gen stamp per vertex index
	gen       int32
	cur, next []int32 // scratch: BFS frontiers, as vertex indices
}

// bfsReset stamps a new generation, invalidating the scratch from the last call.
func (bi *boardInfo) bfsReset() {
	bi.gen++
	bi.cur = bi.cur[:0]
	bi.next = bi.next[:0]
}

// mark records that vertex idx has been reached this generation, reporting
// false if it was already seen.
func (bi *boardInfo) mark(idx int32) bool {
	if bi.seenGen[idx] == bi.gen {
		return false
	}
	bi.seenGen[idx] = bi.gen
	return true
}

func newBoardInfo(b *board.Board) *boardInfo {
	bi := &boardInfo{
		vert:     map[board.Vertex]*vertexInfo{},
		hexVerts: map[board.Hex][]board.Vertex{},
	}
	seenV := map[board.Vertex]bool{}
	seenE := map[board.Edge]bool{}
	for _, h := range board.HexesInRadius(b.Radius) {
		vs := h.Vertices()
		vslice := make([]board.Vertex, len(vs))
		copy(vslice, vs[:])
		bi.hexVerts[h] = vslice
		for _, v := range vs {
			if seenV[v] {
				continue
			}
			seenV[v] = true
			bi.vertices = append(bi.vertices, v)

			vi := &vertexInfo{idx: int32(len(bi.vertices) - 1)}
			vi.hexes = v.Hexes()
			for _, hh := range vi.hexes {
				if t, ok := b.Tiles[hh]; ok && t.Res.Producing() {
					p := pips(t.Number)
					vi.pips += p
					vi.resPips[t.Res] += p
				}
			}
			if hb, ok := b.HarborAt(v); ok {
				h2 := hb
				vi.harbor = &h2
			}
			vi.neighbors = v.Neighbors()
			vi.edges = v.Edges()
			for i, e := range vi.edges {
				if e.Valid() {
					vi.landE[i] = b.LandEdge(e)
					vi.seaE[i] = b.SeaEdge(e)
				}
			}
			bi.vert[v] = vi

			for _, e := range vi.edges {
				if !e.Valid() || seenE[e] || !b.LandEdge(e) {
					continue
				}
				seenE[e] = true
				bi.landEdges = append(bi.landEdges, e)
			}
		}
	}
	bi.seenGen = make([]int32, len(bi.vertices))
	bi.cur = make([]int32, 0, 32)
	bi.next = make([]int32, 0, 32)
	return bi
}
