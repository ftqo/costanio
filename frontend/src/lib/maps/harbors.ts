import type { Board, Edge, Harbor, Hex, Resource, Vertex } from "@/lib/types";
import { hexEdges, edgeKey, vertexHexes, hexKey } from "@/lib/hexgeo";

const isLand = (board: Board) => {
  const set = new Set<string>();
  for (const t of board.tiles) if (t.res !== "sea" && t.res !== "border") set.add(hexKey(t.hex));
  return (h: Hex) => set.has(hexKey(h));
};

/** The (up to two) hexes sharing an edge: those touched by both endpoints. */
function edgeHexes(e: Edge): Hex[] {
  const a = vertexHexes(e.a),
    b = vertexHexes(e.b);
  return a.filter((x) => b.some((y) => y.q === x.q && y.r === x.r));
}

/** Coastal edges: an edge with exactly one adjacent land hex (faces sea or the boundary). */
export function coastEdges(board: Board): Edge[] {
  const land = isLand(board);
  const seen = new Map<string, Edge>();
  for (const t of board.tiles) {
    if (t.res === "sea") continue;
    for (const e of hexEdges(t.hex)) {
      const hexes = edgeHexes(e);
      const n = hexes.filter(land).length;
      if (n === 1) seen.set(edgeKey(e), e);
    }
  }
  return [...seen.values()];
}

/**
 * The water hex a harbour's dock stands on: the single non-land hex beside its
 * edge. A harbour is an edge on the wire, but its dock occupies the seaward
 * hex, so two harbours must never share that hex. Mirrors Go's
 * `Board.HarborSeaHex`.
 *
 * Null when the edge has no single water side (both land, e.g. a stale
 * harbour after the water was painted over, or both water).
 */
export function edgeSeaHex(board: Board, e: Edge): Hex | null {
  const land = isLand(board);
  const sea = edgeHexes(e).filter((h) => !land(h));
  return sea.length === 1 ? sea[0] : null;
}

/**
 * Keys of the water hexes already claimed by a dock, ignoring the harbour on
 * `except`, so cycling a harbour never clashes with itself.
 */
export function claimedSeaHexes(board: Board, except?: Edge): Set<string> {
  const out = new Set<string>();
  for (const h of board.harbors) {
    const e: Edge = { a: h.verts[0], b: h.verts[1] };
    if (except && harborOnEdge(h, except)) continue;
    const sea = edgeSeaHex(board, e);
    if (sea) out.add(hexKey(sea));
  }
  return out;
}

/**
 * Whether a new harbour may be placed on this coastal edge: it needs a water
 * side not already taken by another dock. An edge that already carries a
 * harbour always passes, so it can be cycled or cleared.
 */
export function canPlaceHarbor(board: Board, e: Edge): boolean {
  if (board.harbors.some((h) => harborOnEdge(h, e))) return true;
  const sea = edgeSeaHex(board, e);
  return sea !== null && !claimedSeaHexes(board, e).has(hexKey(sea));
}

function vEq(x: Vertex, y: Vertex) {
  return x.q === y.q && x.r === y.r && x.side === y.side;
}

function harborOnEdge(h: Harbor, e: Edge): boolean {
  const [v0, v1] = h.verts;
  return (vEq(v0, e.a) && vEq(v1, e.b)) || (vEq(v0, e.b) && vEq(v1, e.a));
}

/** What the harbor palette can paint onto a coast edge. */
export type HarborBrush = { ratio: 3; res: "none" } | { ratio: 2; res: Resource } | "erase";

/**
 * Set the harbor on an edge directly, rather than cycling to it. Painting the
 * type an edge already carries clears it, and "erase" always clears.
 * Immutable. A palette makes every port type one click instead of up to seven.
 */
export function setHarbor(harbors: Harbor[], e: Edge, brush: HarborBrush): Harbor[] {
  const idx = harbors.findIndex((h) => harborOnEdge(h, e));
  const rest = idx < 0 ? harbors : harbors.filter((_, i) => i !== idx);
  if (brush === "erase") return rest;
  const cur = idx < 0 ? null : harbors[idx];
  if (cur && cur.ratio === brush.ratio && cur.res === brush.res) return rest; // toggle off
  const verts: Vertex[] = [e.a, e.b];
  return [...rest, { verts, ratio: brush.ratio, res: brush.res }];
}
