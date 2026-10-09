// Package board provides hex-grid geometry and board generation. Pure: stdlib only.
//
// Axial coordinates, pointy-top hexes. Every vertex is canonically the North
// (top) or South (bottom) corner of exactly one hex, which gives shared
// vertices a single identity without normalization tables.
package board

import "sync"

type Hex struct {
	Q int `json:"q"`
	R int `json:"r"`
}

type Side uint8

const (
	N Side = iota
	S
)

type Vertex struct {
	Q    int  `json:"q"`
	R    int  `json:"r"`
	Side Side `json:"side"`
}

// Edge is an unordered pair of adjacent vertices, normalized so A < B.
type Edge struct {
	A Vertex `json:"a"`
	B Vertex `json:"b"`
}

func vertexLess(a, b Vertex) bool {
	if a.Q != b.Q {
		return a.Q < b.Q
	}
	if a.R != b.R {
		return a.R < b.R
	}
	return a.Side < b.Side
}

func NewEdge(a, b Vertex) Edge {
	if vertexLess(b, a) {
		a, b = b, a
	}
	return Edge{a, b}
}

var hexDirs = [6]Hex{{1, 0}, {1, -1}, {0, -1}, {-1, 0}, {-1, 1}, {0, 1}}

func (h Hex) Neighbors() [6]Hex {
	var out [6]Hex
	for i, d := range hexDirs {
		out[i] = Hex{h.Q + d.Q, h.R + d.R}
	}
	return out
}

// Vertices returns the hex's six corners in clockwise order from the top.
func (h Hex) Vertices() [6]Vertex {
	q, r := h.Q, h.R
	return [6]Vertex{
		{q, r, N},         // top
		{q + 1, r - 1, S}, // north-east
		{q, r + 1, N},     // south-east
		{q, r, S},         // bottom
		{q - 1, r + 1, N}, // south-west
		{q, r - 1, S},     // north-west
	}
}

func (h Hex) Edges() [6]Edge {
	v := h.Vertices()
	var out [6]Edge
	for i := range v {
		out[i] = NewEdge(v[i], v[(i+1)%6])
	}
	return out
}

// Hexes returns the (up to) three hexes that touch the vertex.
func (v Vertex) Hexes() [3]Hex {
	if v.Side == N {
		return [3]Hex{{v.Q, v.R}, {v.Q, v.R - 1}, {v.Q + 1, v.R - 1}}
	}
	return [3]Hex{{v.Q, v.R}, {v.Q, v.R + 1}, {v.Q - 1, v.R + 1}}
}

// Neighbors returns the three vertices one edge away.
func (v Vertex) Neighbors() [3]Vertex {
	if v.Side == N {
		return [3]Vertex{
			{v.Q + 1, v.R - 1, S}, // via NE edge
			{v.Q, v.R - 1, S},     // via NW edge
			{v.Q + 1, v.R - 2, S}, // straight up
		}
	}
	return [3]Vertex{
		{v.Q, v.R + 1, N},     // via SE edge
		{v.Q - 1, v.R + 1, N}, // via SW edge
		{v.Q - 1, v.R + 2, N}, // straight down
	}
}

// Edges returns the three edges incident to the vertex.
func (v Vertex) Edges() [3]Edge {
	n := v.Neighbors()
	return [3]Edge{NewEdge(v, n[0]), NewEdge(v, n[1]), NewEdge(v, n[2])}
}

// Valid reports whether the edge connects two adjacent vertices with sane
// sides, i.e. it is a real edge of the grid.
func (e Edge) Valid() bool {
	if e.A.Side > S || e.B.Side > S {
		return false
	}
	for _, n := range e.A.Neighbors() {
		if n == e.B {
			return true
		}
	}
	return false
}

// Touches reports whether the edge is incident to the vertex.
func (e Edge) Touches(v Vertex) bool { return e.A == v || e.B == v }

// Other returns the edge's endpoint that is not v.
func (e Edge) Other(v Vertex) Vertex {
	if e.A == v {
		return e.B
	}
	return e.A
}

// Connects reports whether two edges share an endpoint.
func (e Edge) Connects(o Edge) bool {
	return e.Touches(o.A) || e.Touches(o.B)
}

// hexesInRadiusCache memoizes HexesInRadius, a pure function of radius called
// in hot loops. Callers must treat the cached slices as read-only.
var hexesInRadiusCache sync.Map // radius int -> []Hex

// HexesInRadius returns all hexes with cube-distance ≤ radius from origin,
// in deterministic order. The returned slice is shared and must not be mutated.
func HexesInRadius(radius int) []Hex {
	if v, ok := hexesInRadiusCache.Load(radius); ok {
		if hexes, ok := v.([]Hex); ok {
			return hexes
		}
	}
	var out []Hex
	for q := -radius; q <= radius; q++ {
		for r := -radius; r <= radius; r++ {
			if x, y, z := q, -q-r, r; abs(x) <= radius && abs(y) <= radius && abs(z) <= radius {
				out = append(out, Hex{q, r})
			}
		}
	}
	actual, _ := hexesInRadiusCache.LoadOrStore(radius, out)
	if hexes, ok := actual.([]Hex); ok {
		return hexes
	}
	return out
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}
