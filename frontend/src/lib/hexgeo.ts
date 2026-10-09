// Pointy-top axial hex geometry. Mirrors engine/board/coords.go: a Vertex is the
// North (top) or South (bottom) corner of its hex; size = circumradius.
import type { Hex, Vertex, Edge, Resource } from "./types";

const SQRT3 = Math.sqrt(3);

export interface Pt {
  x: number;
  y: number;
}

export function hexCenter(h: Hex, size: number): Pt {
  return {
    x: size * SQRT3 * (h.q + h.r / 2),
    y: size * 1.5 * h.r,
  };
}

/** A vertex is the top (N) or bottom (S) corner of hex (q,r). */
export function vertexPt(v: Vertex, size: number): Pt {
  const c = hexCenter({ q: v.q, r: v.r }, size);
  return { x: c.x, y: c.y + (v.side === 2 ? 0 : v.side === 0 ? -size : size) };
}

/** Six corner points of a pointy-top hex, clockwise from the top. */
export function hexCorners(h: Hex, size: number): Pt[] {
  const c = hexCenter(h, size);
  const pts: Pt[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 90);
    pts.push({ x: c.x + size * Math.cos(a), y: c.y + size * Math.sin(a) });
  }
  return pts;
}

export function hexPolygon(h: Hex, size: number): string {
  return hexCorners(h, size)
    .map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(" ");
}

export function edgeEnds(e: Edge, size: number): [Pt, Pt] {
  return [vertexPt(e.a, size), vertexPt(e.b, size)];
}

export function edgeMid(e: Edge, size: number): Pt {
  const [a, b] = edgeEnds(e, size);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
  str: string;
}

/** Bounding box that fits all tiles (plus margin for corners/harbors). */
export function boardViewBox(tiles: { hex: Hex }[], size: number, margin = size * 1.4): ViewBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const t of tiles) {
    const c = hexCenter(t.hex, size);
    minX = Math.min(minX, c.x);
    minY = Math.min(minY, c.y);
    maxX = Math.max(maxX, c.x);
    maxY = Math.max(maxY, c.y);
  }
  const x = minX - margin;
  const y = minY - margin;
  const w = maxX - minX + margin * 2;
  const h = maxY - minY + margin * 2;
  return { x, y, w, h, str: `${x.toFixed(1)} ${y.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}` };
}

export function vertexKey(v: Vertex): string {
  return `${v.q},${v.r},${v.side}`;
}
export function edgeKey(e: Edge): string {
  return `${vertexKey(e.a)}|${vertexKey(e.b)}`;
}

// ---- grid identity (ported from engine/board/coords.go) ----

function vertexLess(a: Vertex, b: Vertex): boolean {
  if (a.q !== b.q) return a.q < b.q;
  if (a.r !== b.r) return a.r < b.r;
  return a.side < b.side;
}

/** Normalize an edge so a < b, matching the server's NewEdge. */
export function makeEdge(a: Vertex, b: Vertex): Edge {
  return vertexLess(b, a) ? { a: b, b: a } : { a, b };
}

/** The (up to) three hexes touching a vertex (mirrors Vertex.Hexes in coords.go). */
export function vertexHexes(v: Vertex): Hex[] {
  if (v.side === 0)
    return [
      { q: v.q, r: v.r },
      { q: v.q, r: v.r - 1 },
      { q: v.q + 1, r: v.r - 1 },
    ];
  return [
    { q: v.q, r: v.r },
    { q: v.q, r: v.r + 1 },
    { q: v.q - 1, r: v.r + 1 },
  ];
}

/**
 * The one or two hexes an edge borders (mirrors board.EdgeHexes in
 * engine/board/generate.go): the hexes both of its endpoints touch.
 *
 * One hex means the edge is on the rim of the enumerated grid; with two, the
 * pair says whether the edge is coastal (one land, one sea).
 */
export function edgeHexes(e: Edge): Hex[] {
  const bs = vertexHexes(e.b);
  return vertexHexes(e.a).filter((ha) => bs.some((hb) => hb.q === ha.q && hb.r === ha.r));
}

/** The hex's six corners, clockwise from the top (matches Hex.Vertices). */
export function hexVertices(h: Hex): Vertex[] {
  const { q, r } = h;
  return [
    { q, r, side: 0 },
    { q: q + 1, r: r - 1, side: 1 },
    { q, r: r + 1, side: 0 },
    { q, r, side: 1 },
    { q: q - 1, r: r + 1, side: 0 },
    { q, r: r - 1, side: 1 },
  ];
}

export function hexEdges(h: Hex): Edge[] {
  const v = hexVertices(h);
  return v.map((vi, i) => makeEdge(vi, v[(i + 1) % 6]));
}

/** All unique vertices and edges across the given tiles (build targets). */
export function enumerateGrid(tiles: { hex: Hex }[]): { vertices: Vertex[]; edges: Edge[] } {
  const vMap = new Map<string, Vertex>();
  const eMap = new Map<string, Edge>();
  for (const t of tiles) {
    for (const v of hexVertices(t.hex)) vMap.set(vertexKey(v), v);
    for (const e of hexEdges(t.hex)) eMap.set(edgeKey(e), e);
  }
  return { vertices: [...vMap.values()], edges: [...eMap.values()] };
}

// ---- harbor (port) label placement ----

/** Move `from` away from `awayFrom` by `dist` (a normalized step). */
function pushAway(from: Pt, awayFrom: Pt, dist: number): Pt {
  const dx = from.x - awayFrom.x;
  const dy = from.y - awayFrom.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: from.x + (dx / len) * dist, y: from.y + (dy / len) * dist };
}

export interface HarborLayout {
  pts: Pt[]; // the two corner (dock) vertex positions you build to
  out: Pt; // label center
}

/**
 * Lay out harbor labels seaward of their coast edges.
 *
 * A harbor sits on the edge between a land hex and a sea hex, and its label is
 * pushed into the water. A lone port is pushed toward its sea hex's centre. When
 * two ports share a sea hex that would stack their labels, so each instead
 * hugs its own edge.
 */
export function harborLayouts(
  harbors: { verts: Vertex[] }[],
  isLand: (h: Hex) => boolean,
  fallbackCenter: Pt,
  size: number,
): HarborLayout[] {
  const base = harbors.map((h) => {
    const pts = h.verts.map((v) => vertexPt(v, size));
    const mid: Pt = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    // The (up to) two hexes sharing this edge: those touched by both vertices.
    const shared = vertexHexes(h.verts[0]).filter((a) =>
      vertexHexes(h.verts[1]).some((b) => b.q === a.q && b.r === a.r),
    );
    const land = shared.find((a) => isLand(a));
    // The sea side is the shared hex that isn't the land anchor.
    const sea = shared.find((a) => !(land && a.q === land.q && a.r === land.r));
    const anchor = land ? hexCenter(land, size) : fallbackCenter;
    return { pts, mid, anchor, seaKey: sea ? hexKey(sea) : null };
  });

  // How many harbors land on each sea hex.
  const perSea = new Map<string, number>();
  for (const b of base) if (b.seaKey) perSea.set(b.seaKey, (perSea.get(b.seaKey) ?? 0) + 1);

  return base.map((b) => {
    const shares = b.seaKey != null && (perSea.get(b.seaKey) ?? 0) > 1;
    // Solo: long push toward the sea-hex centre. Shared: a short push hugging
    // the label's own edge so neighbours don't converge.
    const dist = size * (shares ? 0.15 : 0.7);
    return { pts: b.pts, out: pushAway(b.mid, b.anchor, dist) };
  });
}

const TERRAIN_FILL: Record<string, string> = {
  wood: "var(--color-green)",
  brick: "var(--color-orange)",
  sheep: "var(--color-sheep)",
  wheat: "var(--color-yellow)",
  ore: "var(--color-ore)",
  gold: "var(--color-gold)",
  sea: "var(--color-sea)",
  lake: "var(--color-lake)",
  fog: "var(--color-fog)",
  none: "var(--color-desert)", // desert
  land: "var(--color-land)", // generic land, resource randomized at game start
  border: "var(--color-land-border)", // impassable foreign land (off-board neighbour), muted
};
export function terrainFill(res: string): string {
  return TERRAIN_FILL[res] ?? "var(--color-tile-unknown)";
}

// Land tints for shape previews. Shape-board land has no resolved resource, so
// it is coloured deterministically by position and the same map always looks
// the same.
const LAND_TINTS = [
  "var(--color-land-tint-1)",
  "var(--color-land-tint-2)",
  "var(--color-land-tint-3)",
  "var(--color-land-tint-4)",
  "var(--color-land-tint-5)",
  "var(--color-land-tint-6)",
];

export function landTint(h: Hex): string {
  const n = ((h.q * 73856093) ^ (h.r * 19349663)) >>> 0;
  return LAND_TINTS[n % LAND_TINTS.length];
}

// Fill for a shape-preview tile: a deterministic tint for generic land, and the
// shared terrain colors (sea/gold/lake/desert/resources) for everything else.
export function previewFill(res: Resource, h: Hex): string {
  return res === "land" ? landTint(h) : terrainFill(res);
}

export const SEAT_COLORS = [
  "var(--color-red)",
  "var(--color-blue)",
  "var(--color-amber)",
  "var(--color-purple)",
  "var(--color-green)",
  "var(--color-orange)",
  "var(--color-fishermen)",
  "var(--color-rose)",
  "var(--color-caravans)",
  "var(--color-slate)",
];
export function seatColor(seat: number): string {
  return SEAT_COLORS[((seat % SEAT_COLORS.length) + SEAT_COLORS.length) % SEAT_COLORS.length];
}

/** Probability pips for a number token (5 for 6/8 down to 1 for 2/12). */
export function pips(num: number): number {
  return num === 0 ? 0 : 6 - Math.abs(7 - num);
}

/** All hexes with cube-distance <= radius (ported from engine/board/coords.go). */
export function hexesInRadius(radius: number): Hex[] {
  const out: Hex[] = [];
  for (let q = -radius; q <= radius; q++) {
    for (let r = -radius; r <= radius; r++) {
      if (Math.abs(q) <= radius && Math.abs(-q - r) <= radius && Math.abs(r) <= radius) {
        out.push({ q, r });
      }
    }
  }
  return out;
}

export function hexKey(h: Hex): string {
  return `${h.q},${h.r}`;
}

/**
 * The three vertices one edge away, ported from engine/board/coords.go's
 * `Vertex.Neighbors`.
 *
 * Pure geometry: each north vertex joins three souths and never another north.
 * Lets the menu tell a spot that can never take a settlement from one that
 * cannot yet.
 */
export function vertexNeighbors(v: Vertex): [Vertex, Vertex, Vertex] {
  if (v.side === 0)
    return [
      { q: v.q + 1, r: v.r - 1, side: 1 }, // via NE edge
      { q: v.q, r: v.r - 1, side: 1 }, // via NW edge
      { q: v.q + 1, r: v.r - 2, side: 1 }, // straight up
    ];
  return [
    { q: v.q, r: v.r + 1, side: 0 }, // via SE edge
    { q: v.q - 1, r: v.r + 1, side: 0 }, // via SW edge
    { q: v.q - 1, r: v.r + 2, side: 0 }, // straight down
  ];
}
