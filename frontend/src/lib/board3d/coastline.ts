// Where the land stops, as closed loops.
//
// The land/water boundary in a hex grid is always a set of closed rings: three
// cells meet at each lattice corner, so a boundary corner has exactly two
// incident boundary edges. The tracing below therefore cannot be ambiguous or
// dead-end. `beachGeometry.ts` walks each ring and lays one continuous ribbon
// along it.
//
// The ribbon belongs to the water: it starts at the lattice line the two cells
// share and reaches seaward.
import type { BoardTile, Hex } from "@/lib/types";
import { DIRS, neighbor, hexKey, hexToWorld, cornerToWorld } from "./coords";

/**
 * Resource strings that render as water. `res` is a string on the wire.
 *
 * `lake` is not water. Fishermen floods a desert into a lake that the engine
 * keeps as land (`board.Land` is true: roads and settlements go round it, only
 * the robber is kept off), and `art/hexes/lake.blend` is a land slab at
 * circumradius 3.0 with the water inset. As water it would be scaled over its
 * own gutter, lose its gutter sand, and get an ocean beach.
 *
 * `fog` falls back to the sea tile (RESOURCE_FALLBACK), so it is here.
 */
export const WATER: ReadonlySet<string> = new Set([
  "sea",
  "sea_port",
  "sea_shoal",
  "sea_council",
  "fog",
]);

/**
 * The blend's name for each water terrain: the contract shared with
 * `tools/blender/lattice.py`'s `WATER_TERRAINS = {Ocean, Port, Shoal,
 * Council}`, the terrains it scales by `LATTICE_SCALE` with no gutter. A
 * terrain missing here is drawn at land scale with gutter sand and a beach.
 * Tested, so a new water terrain fails a test rather than growing a beach.
 */
export const WATER_TERRAINS: Readonly<Record<string, string>> = {
  Ocean: "sea",
  Port: "sea_port",
  Shoal: "sea_shoal",
  // The Explorers Council, a walled town built on the ocean's hull. On the
  // wire the hex is plain `sea` (only its file is overridden, by
  // `layers/explorers.ts`), so this changes nothing drawn today; it keeps the
  // two tables in agreement.
  Council: "sea_council",
};

/** A point in the board's XZ plane. Y is the beach's business, not the coast's. */
export type Vec2 = readonly [number, number];

/**
 * One edge of the coastline, in world space.
 *
 * `a` to `b` runs so consecutive edges chain end to start, and `n` is the unit
 * normal pointing at the water, the direction the sand reaches. A segment has
 * two normals and the wrong one lays the beach across the land.
 */
export interface CoastEdge {
  a: Vec2;
  b: Vec2;
  n: Vec2;
}

/** A closed ring of coast: the outline of one island, or of one inland sea. */
export type CoastLoop = CoastEdge[];

/** World XZ, rounded hard enough that two hexes' shared corner is one key. */
function pointKey(p: Vec2): string {
  return `${Math.round(p[0] * 1e4)}:${Math.round(p[1] * 1e4)}`;
}

/**
 * Which hexes the board draws as land, by `hexKey`. Also used for the gutter
 * sand (only land tiles have half a gutter) and the tile scale (only water
 * fills its cell).
 *
 * `land` names hexes a module repainted with a land model, which count as land
 * whatever their resource. The flooded Caravans oasis is the case: `lake` on
 * the wire, drawn as land. Without this it would get a beach, and its land
 * neighbours would each grow a shoreline facing it.
 */
export function landKeys(tiles: BoardTile[], land?: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const t of tiles) {
    const key = hexKey(t.hex);
    if (!WATER.has(t.res) || land?.has(key)) out.add(key);
  }
  return out;
}

export function solveCoastLoops(tiles: BoardTile[], land?: ReadonlySet<string>): CoastLoop[] {
  const solidKeys = landKeys(tiles, land);

  // The tile list does not reliably include the surrounding sea (the base
  // game has none). The ocean backdrop draws every omitted hex, so anything not
  // land is water.
  const isLand = (h: Hex): boolean => solidKeys.has(hexKey(h));

  // Sorted, so the same board always yields the same buffers.
  const solid = tiles
    .map((t) => t.hex)
    .filter((h) => solidKeys.has(hexKey(h)))
    .sort((a, b) => a.r - b.r || a.q - b.q);

  // Every land edge that faces water, keyed by its start. Corner d+1 to corner
  // d+2 is the edge facing neighbour d (edge 0 is the +x edge, between corners
  // 1 and 2); that order chains a lone hex's six edges into a ring unsorted.
  const outgoing = new Map<string, CoastEdge>();
  for (const hex of solid) {
    const [cx, , cz] = hexToWorld(hex);
    for (let dir = 0; dir < DIRS.length; dir++) {
      const other = neighbor(hex, dir);
      if (isLand(other)) continue;
      const [ax, , az] = cornerToWorld(hex, dir + 1);
      const [bx, , bz] = cornerToWorld(hex, dir + 2);
      const [ox, , oz] = hexToWorld(other);
      const len = Math.hypot(ox - cx, oz - cz);
      const a: Vec2 = [ax, az];
      outgoing.set(pointKey(a), { a, b: [bx, bz], n: [(ox - cx) / len, (oz - cz) / len] });
    }
  }

  const loops: CoastLoop[] = [];
  const walked = new Set<string>();
  for (const [start, first] of outgoing) {
    if (walked.has(start)) continue;
    const loop: CoastLoop = [];
    let edge: CoastEdge | undefined = first;
    let key = start;
    // Always closes: each boundary corner has one edge in and one out. The
    // visited set stops the walk.
    while (edge && !walked.has(key)) {
      walked.add(key);
      loop.push(edge);
      key = pointKey(edge.b);
      edge = outgoing.get(key);
    }
    loops.push(loop);
  }
  return loops;
}

/**
 * Whether the coast turns away from the water at this corner: a headland,
 * where the sand sweeps round the outside of the turn.
 *
 * The loop runs with water on the outside, so at a headland the water-facing
 * normal rotates the same way as the walk. The other case is a bay, where the
 * offsets meet inside and are mitred. Only `beachGeometry.ts` calls this.
 */
export function coastTurnsOut(into: Vec2, out: Vec2): boolean {
  return into[0] * out[1] - into[1] * out[0] > 0;
}
