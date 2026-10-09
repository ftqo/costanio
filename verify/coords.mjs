// Hex geometry, ported from engine/board/coords.go.
//
// Axial coordinates, pointy-top hexes. Every vertex is canonically the North or
// South corner of exactly one hex, so shared vertices have a single identity
// with no normalization table.
//
// Hexes, vertices and edges are plain objects here, and are keyed by string
// wherever Go used them as map keys. Order matters everywhere the generator
// iterates, so the ports keep Go's iteration order exactly.

export const N = 0;
export const S = 1;

export const hex = (q, r) => ({ q, r });
export const hexKey = (h) => `${h.q},${h.r}`;
export const vert = (q, r, side) => ({ q, r, side });
export const vertKey = (v) => `${v.q},${v.r},${v.side}`;
export const edgeKey = (e) => `${vertKey(e.a)}|${vertKey(e.b)}`;

export function vertexLess(a, b) {
  if (a.q !== b.q) return a.q < b.q;
  if (a.r !== b.r) return a.r < b.r;
  return a.side < b.side;
}

export function vertexEq(a, b) {
  return a.q === b.q && a.r === b.r && a.side === b.side;
}

/** NewEdge normalizes the pair so A < B. */
export function newEdge(a, b) {
  return vertexLess(b, a) ? { a: b, b: a } : { a, b };
}

const hexDirs = [
  [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
];

export function neighbors(h) {
  return hexDirs.map(([dq, dr]) => hex(h.q + dq, h.r + dr));
}

/** The hex's six corners, clockwise from the top. */
export function hexVertices(h) {
  const { q, r } = h;
  return [
    vert(q, r, N),         // top
    vert(q + 1, r - 1, S), // north-east
    vert(q, r + 1, N),     // south-east
    vert(q, r, S),         // bottom
    vert(q - 1, r + 1, N), // south-west
    vert(q, r - 1, S),     // north-west
  ];
}

export function hexEdges(h) {
  const v = hexVertices(h);
  return v.map((_, i) => newEdge(v[i], v[(i + 1) % 6]));
}

/** The (up to) three hexes touching a vertex. */
export function vertexHexes(v) {
  if (v.side === N) {
    return [hex(v.q, v.r), hex(v.q, v.r - 1), hex(v.q + 1, v.r - 1)];
  }
  return [hex(v.q, v.r), hex(v.q, v.r + 1), hex(v.q - 1, v.r + 1)];
}

/** The hexes an edge separates: those shared by both endpoints. */
export function edgeHexes(e) {
  const out = [];
  for (const ha of vertexHexes(e.a)) {
    for (const hb of vertexHexes(e.b)) {
      if (ha.q === hb.q && ha.r === hb.r) out.push(ha);
    }
  }
  return out;
}

export function edgeOther(e, v) {
  return vertexEq(e.a, v) ? e.b : e.a;
}

/** abs, exported so the generator port shares one definition. */
export const abs = (n) => (n < 0 ? -n : n);

/**
 * Every hex within cube-distance `radius` of the origin, in Go's iteration
 * order (q ascending, then r ascending). The generator indexes tiles by
 * position in this list, so the order is part of the derivation.
 */
export function hexesInRadius(radius) {
  const out = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = -radius; r <= radius; r++) {
      const x = q, y = -q - r, z = r;
      if (abs(x) <= radius && abs(y) <= radius && abs(z) <= radius) out.push(hex(q, r));
    }
  }
  return out;
}

/** radiusFor maps player count to board radius: 19, 37 or 61 hexes. */
export function radiusFor(players) {
  if (players <= 4) return 2;
  if (players <= 6) return 3;
  return 4;
}

/** sortEdges: the generator's deterministic edge order (generate.go). */
export function sortEdges(edges) {
  const less = (a, b) =>
    !vertexEq(a.a, b.a) ? vertexLess(a.a, b.a) : vertexLess(a.b, b.b);
  // Go uses an insertion sort here; any correct sort agrees, because `less` is
  // a strict total order over a set of distinct edges.
  edges.sort((a, b) => (less(a, b) ? -1 : less(b, a) ? 1 : 0));
  return edges;
}
