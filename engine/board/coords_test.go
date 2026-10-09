package board

import "testing"

func TestAdjacentHexesShareTwoVerticesOneEdge(t *testing.T) {
	h := Hex{0, 0}
	for _, n := range h.Neighbors() {
		shared := map[Vertex]bool{}
		for _, v := range h.Vertices() {
			shared[v] = true
		}
		var count int
		for _, v := range n.Vertices() {
			if shared[v] {
				count++
			}
		}
		if count != 2 {
			t.Errorf("hex %v and neighbor %v share %d vertices, want 2", h, n, count)
		}

		edges := map[Edge]bool{}
		for _, e := range h.Edges() {
			edges[e] = true
		}
		var eCount int
		for _, e := range n.Edges() {
			if edges[e] {
				eCount++
			}
		}
		if eCount != 1 {
			t.Errorf("hex %v and neighbor %v share %d edges, want 1", h, n, eCount)
		}
	}
}

func TestVertexHexesRoundTrip(t *testing.T) {
	// Every corner of a hex must list that hex among its Hexes().
	for _, h := range HexesInRadius(2) {
		for _, v := range h.Vertices() {
			found := false
			for _, hh := range v.Hexes() {
				if hh == h {
					found = true
				}
			}
			if !found {
				t.Fatalf("vertex %v of hex %v does not list it in Hexes()", v, h)
			}
		}
	}
}

func TestVertexNeighborsSymmetric(t *testing.T) {
	v := Vertex{0, 0, N}
	for _, n := range v.Neighbors() {
		back := false
		for _, nn := range n.Neighbors() {
			if nn == v {
				back = true
			}
		}
		if !back {
			t.Errorf("neighbor %v of %v is not symmetric", n, v)
		}
	}
}

func TestVertexEdgesTouch(t *testing.T) {
	v := Vertex{2, -1, S}
	for _, e := range v.Edges() {
		if !e.Touches(v) {
			t.Errorf("edge %v does not touch %v", e, v)
		}
		o := e.Other(v)
		if o == v {
			t.Errorf("Other returned the same vertex")
		}
	}
}

func TestHexEdgesFormCycle(t *testing.T) {
	edges := Hex{0, 0}.Edges()
	for i := range edges {
		if !edges[i].Connects(edges[(i+1)%6]) {
			t.Errorf("edge %d does not connect to next", i)
		}
	}
}

func TestHexesInRadius(t *testing.T) {
	for radius, want := range map[int]int{0: 1, 1: 7, 2: 19, 3: 37} {
		if got := len(HexesInRadius(radius)); got != want {
			t.Errorf("radius %d → %d hexes, want %d", radius, got, want)
		}
	}
}
