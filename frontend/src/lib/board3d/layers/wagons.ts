// Wagons: the wagons on their intersections, the barbarians on their paths, and
// the three trade hexes.
//
// A trade hex draws a market town on its seaward half, on its own ground: one
// of forty-eight tiles, `tiles/trade_<ground>_<dir>.glb`, chosen by the hex's
// terrain and the world direction its seaward half faces (see
// `tradeTileOverrides`). It keeps its resource and number chip (see the
// Decision in docs/rules/wagons.md), so the town is composed onto each ground
// (a brick trade hex still reads as hills, with its kiln), and each direction
// is its own file because the chip does not turn with a tile. The forty-eight
// are recipe-built (`make compose-tiles`, art/recipes/trade_*.json) from two
// town layouts, six lake towns and each ground's hero spots
// (art/trade/parts/).
//
// The plaza is not a board vertex: it is addressed as the trade hex's own
// coordinate with a third `side` value that `vertexToWorld` does not handle,
// so `plazaToWorld` puts it at the hex centre, where the tile draws the plaza.
import {
  wagonsExt,
  type FullView,
  type Edge,
  type Hex,
  type Resource,
  type Vertex,
  type WagonsTradeHex,
} from "@/lib/types";
import { edgeKey, vertexKey } from "@/lib/hexgeo";
import {
  DIRS,
  hexKey,
  hexToWorld,
  neighbor,
  vertexToWorld,
  edgeToWorld,
  edgeRotationY,
} from "../coords";
import { landKeys } from "../coastline";
import { TILES } from "../manifest.generated";
import { MODULE_SCALE } from "../pieceArt";
import type { Placement } from "../instancing";
import type { TileArt } from "./caravans";

/** Node-name prefix in wagons.glb. Bed, canopy, wheels, hubs, tongue and tailcloth are one. */
export const WAGON_PREFIX = "Wagon_";

/**
 * Node-name prefix in barbarians.glb.
 *
 * The figure, not the Knights fleet's `Ship_barbarian`. One file, two
 * expansions: Raiders musters up to three on a coastal hex, this stands one on
 * a road edge.
 */
export const PATH_BARBARIAN_PREFIX = "Barbarian_";

/**
 * The world position of a plaza, which is the centre of its trade hex.
 *
 * `vertexToWorld` reads `side` as north or south and offsets by a lattice
 * radius, so it would put a plaza a lattice radius south. See the note at the
 * top.
 */
export function plazaToWorld(v: Vertex) {
  return hexToWorld({ q: v.q, r: v.r });
}

/** Is this vertex a plaza rather than one of the board's own two corner sides? */
export function isPlaza(v: Vertex): boolean {
  return v.side > 1;
}

/** Position a vertex whether it is a board corner or a plaza. */
export function anyVertexToWorld(v: Vertex) {
  return isPlaza(v) ? plazaToWorld(v) : vertexToWorld(v);
}

/**
 * The trade hexes, in the order the engine derived them.
 *
 * [] for a board with no cape triple, where the module is inert. The wire says
 * so with `has_trade`, like the Caravans oasis.
 */
export function tradeHexes(view: FullView): WagonsTradeHex[] {
  const ext = wagonsExt(view);
  if (!ext?.has_trade) return [];
  return ext.trade ?? [];
}

/**
 * The ground each resource's trade town is composed on: the resource's own
 * tile's terrain, by the name the recipes use (`trade_<ground>_<dir>`). A trade
 * hex on any other resource (gold, which Wagons never deals) draws its plain
 * terrain rather than a town on the wrong ground.
 */
export const TRADE_GROUNDS: Partial<Record<Resource, string>> = {
  brick: "hills",
  wood: "forest",
  sheep: "pasture",
  wheat: "fields",
  ore: "mountains",
  none: "desert",
  swamp: "swamp",
  lake: "lake",
};

/** The seaward directions in `DIRS` order, as the tile keys spell them. */
export const TRADE_DIRECTIONS = ["e", "se", "sw", "w", "nw", "ne"] as const;

/** The manifest key for one ground and one `DIRS` index. */
export function tradeTileKey(ground: string, dir: number): string {
  return `trade_${ground}_${TRADE_DIRECTIONS[dir]}`;
}

/**
 * The same forty-eight keys, spelled out, for the reason in `rivers.ts`: keys
 * are built with `tradeTileKey`, and `loader.test.ts`'s reachability guard
 * counts only literals. `wagons.test.ts` holds this list to the derivation.
 */
export const TRADE_TILES: readonly string[] = [
  "trade_hills_e",
  "trade_hills_se",
  "trade_hills_sw",
  "trade_hills_w",
  "trade_hills_nw",
  "trade_hills_ne",
  "trade_forest_e",
  "trade_forest_se",
  "trade_forest_sw",
  "trade_forest_w",
  "trade_forest_nw",
  "trade_forest_ne",
  "trade_pasture_e",
  "trade_pasture_se",
  "trade_pasture_sw",
  "trade_pasture_w",
  "trade_pasture_nw",
  "trade_pasture_ne",
  "trade_fields_e",
  "trade_fields_se",
  "trade_fields_sw",
  "trade_fields_w",
  "trade_fields_nw",
  "trade_fields_ne",
  "trade_mountains_e",
  "trade_mountains_se",
  "trade_mountains_sw",
  "trade_mountains_w",
  "trade_mountains_nw",
  "trade_mountains_ne",
  "trade_desert_e",
  "trade_desert_se",
  "trade_desert_sw",
  "trade_desert_w",
  "trade_desert_nw",
  "trade_desert_ne",
  "trade_swamp_e",
  "trade_swamp_se",
  "trade_swamp_sw",
  "trade_swamp_w",
  "trade_swamp_nw",
  "trade_swamp_ne",
  "trade_lake_e",
  "trade_lake_se",
  "trade_lake_sw",
  "trade_lake_w",
  "trade_lake_nw",
  "trade_lake_ne",
];

/**
 * The `DIRS` index a trade hex's seaward half faces, or null.
 *
 * A trade hex is a cape (`capeOutward` in engine/wagons/board.go): land with
 * exactly three consecutive non-land neighbours, its three seaward edges
 * (`seawardEdges`). The direction is the middle one, whose neighbours on
 * either side are also not land.
 *
 * "Land" is what the board draws as land (`landKeys`), and a hex not in the
 * tile list is sea (a base board ships no sea tiles). If the neighbourhood is
 * not a clean cape (a frame the engine does not deal), this falls back to the
 * summed direction of the surrounding water, snapped to the nearest edge, and
 * to null when there is no water, so the hex draws its own terrain.
 */
export function tradeSeawardDir(hex: Hex, land: ReadonlySet<string>): number | null {
  const water = DIRS.map((_, i) => !land.has(hexKey(neighbor(hex, i))));
  const count = water.filter(Boolean).length;
  if (count === 3) {
    for (let i = 0; i < 6; i++) {
      if (water[(i + 5) % 6] && water[i] && water[(i + 1) % 6]) return i;
    }
  }
  if (count === 0) return null;
  let sx = 0;
  let sz = 0;
  water.forEach((w, i) => {
    if (!w) return;
    const [x, , z] = hexToWorld(DIRS[i]);
    sx += x;
    sz += z;
  });
  if (Math.hypot(sx, sz) < 1e-9) return null;
  let best = 0;
  let bestDot = -Infinity;
  DIRS.forEach((d, i) => {
    const [x, , z] = hexToWorld(d);
    const dot = x * sx + z * sz;
    if (dot > bestDot) {
      bestDot = dot;
      best = i;
    }
  });
  return best;
}

/**
 * Tile-art overrides for the trade hexes: each one draws the market town on
 * its own ground, for the direction its seaward half faces.
 *
 * `files` names the tile, and `land` includes the hex. A trade hex is already
 * land by resource, so `land` is a second guard: the town is on a land slab
 * and must not be scaled up to fill its cell like water.
 *
 * `yaw` stays empty, which is why there are six files per ground. The number
 * chip does not turn with a tile (`layers/chips.ts`) and a trade hex keeps its
 * chip, so one town yawed onto its seaward half would put houses under the
 * chip on two bearings in six. Each file is composed for its bearing at
 * `TILE_ROTATION_Y` with the chip's keep-clear disc empty, like the river
 * tiles.
 *
 * Only hexes this board draws as land, on a ground a town exists for, with a
 * tile in the manifest: otherwise the hex draws its own terrain rather than a
 * hole or a 404.
 */
export function tradeTileOverrides(view: FullView): TileArt {
  const files = new Map<string, string>();
  const land = new Set<string>();
  const trade = tradeHexes(view);
  const tiles = view.board?.tiles ?? [];
  if (trade.length === 0 || tiles.length === 0) return { files, land, yaw: new Map() };
  const solid = landKeys(tiles);
  const resource = new Map(tiles.map((t) => [hexKey(t.hex), t.res]));
  for (const t of trade) {
    const key = hexKey(t.hex);
    if (!solid.has(key)) continue;
    const res = resource.get(key);
    const ground = res ? TRADE_GROUNDS[res] : undefined;
    if (!ground) continue;
    const dir = tradeSeawardDir(t.hex, solid);
    if (dir === null) continue;
    const entry = TILES[tradeTileKey(ground, dir)];
    if (!entry) continue;
    files.set(key, entry.file);
    land.add(key);
  }
  return { files, land, yaw: new Map() };
}

/** The tile files this board's trade hexes draw. */
export function tradeTileFiles(view: FullView): string[] {
  return [...new Set(tradeTileOverrides(view).files.values())];
}

/** A wagon on an intersection, with its owner and the bearing it faces. */
export interface WagonPlacement extends Placement {
  key: string;
  owner: number;
}

/**
 * Ring radii for several wagons sharing one intersection, in authored units.
 *
 * Any number may stand on one corner ("wagons never block anything and are
 * never blocked"). The numbers are checked against the shipped geometry in
 * `wagonArt.test.ts`: two side by side need only their widths, three at 120
 * degrees need the circumscribed circle, and four on perpendicular bearings
 * bind at r > (length + width) / 2.
 *
 * A lone wagon sits on the vertex itself, at radius 0.
 *
 * Authored units, so every use is multiplied by `MODULE_SCALE.wagon` (1.5), as
 * `tools/blender/gen/wagons.py` specifies. Unscaled, four wagons needing 0.705
 * would sit at 0.47 and overlap.
 */
const RING_RADIUS = [0, 0.22, 0.38, 0.47];

/**
 * How far a wagon must stand from a building on its corner to be seen.
 *
 * The ring above is sized for wagons clearing each other, but a city is drawn
 * 1.52 x 1.36 against a wagon's 0.58 across, so treating it as one more wagon
 * left the wagon inside the city (where every wagon starts the game).
 *
 * With a building there, each wagon's radius is at least the building's
 * extent along that wagon's bearing (both are square to the board, see
 * `PIECE_FACING`) plus the wagon's tail and a gap. Drawn units, measured off
 * the shipped meshes at `PIECE_SCALE` and `MODULE_SCALE.wagon` by
 * `wagonArt.test.ts`.
 */
export const BUILDING_HALF_EXTENT = {
  settlement: [0.47, 0.44],
  city: [0.76, 0.68],
} as const;
/** The wagon's drawn length behind its origin (it faces +x). */
export const WAGON_TAIL = 0.415;
const BUILDING_GAP = 0.06;

function clearOfBuilding(city: boolean, bearing: number): number {
  const [hx, hz] = BUILDING_HALF_EXTENT[city ? "city" : "settlement"];
  return (
    hx * Math.abs(Math.cos(bearing)) + hz * Math.abs(Math.sin(bearing)) + WAGON_TAIL + BUILDING_GAP
  );
}

/**
 * Every wagon on the board, seat-tinted, ringed where several share a corner.
 *
 * Each wagon in a ring is yawed outward along its own radius, which is what
 * `wagonArt.test.ts`'s four-wagon case measures: two on perpendicular bearings
 * miss when the near end of one clears the half-width of the other. The art
 * faces +x, so the bearing is the angle.
 *
 * Ordered by seat within a junction so the ring does not reshuffle between
 * frames.
 */
export function planWagons(view: FullView): WagonPlacement[] {
  const ext = wagonsExt(view);
  if (!ext?.started) return [];
  const byVertex = new Map<string, { player: number; v: Vertex }[]>();
  for (const w of ext.wagons ?? []) {
    const k = vertexKey(w.v);
    const at = byVertex.get(k);
    if (at) at.push(w);
    else byVertex.set(k, [w]);
  }
  // Corners with a settlement or city on them. A wagon starts on its owner's
  // city and stops on buildings all game, and at radius 0 it would be inside
  // the building.
  const built = new Map((view.buildings ?? []).map((b) => [vertexKey(b.v), b.city]));
  const out: WagonPlacement[] = [];
  for (const group of byVertex.values()) {
    const seats = [...group].sort((a, b) => a.player - b.player);
    // The building takes the centre and the wagons ring it as if it were one
    // more of them, so a lone wagon sits beside the house.
    const house = built.has(vertexKey(seats[0].v)) ? 1 : 0;
    const slots = seats.length + house;
    const n = Math.min(slots, RING_RADIUS.length);
    const authored = RING_RADIUS[n - 1] ?? RING_RADIUS[RING_RADIUS.length - 1];
    const radius = authored * MODULE_SCALE.wagon;
    seats.forEach((w, i) => {
      const [x, y, z] = anyVertexToWorld(w.v);
      // Bearings spread evenly round the junction, starting due east so a lone
      // wagon (radius 0, bearing 0) faces the board's reference direction like
      // every other +x-facing piece. With a building there, slot 0 is the
      // building's.
      const bearing = slots > 1 ? (2 * Math.PI * (i + house)) / slots : 0;
      const city = built.get(vertexKey(w.v));
      const r = city === undefined ? radius : Math.max(radius, clearOfBuilding(city, bearing));
      out.push({
        position: [x + r * Math.cos(bearing), y, z + r * Math.sin(bearing)],
        rotationY: bearing,
        key: `wagon:${w.player}`,
        owner: w.player,
      });
    });
  }
  return out;
}

/** A barbarian standing on a path. */
export interface PathBarbarianPlacement extends Placement {
  key: string;
}

/**
 * The three barbarians, each lying along the path it squats on.
 *
 * `edgeRotationY` (an axis) rather than a bearing: a barbarian blocks the path
 * rather than travelling it, so it has no far end to face.
 *
 * Keyed by index rather than edge, because a barbarian moves (a 7, a Knight
 * and a successful drive-off all relocate it), and a position-based key would
 * make each move look like one piece vanishing and another appearing.
 */
export function planPathBarbarians(view: FullView): PathBarbarianPlacement[] {
  const ext = wagonsExt(view);
  if (!ext?.has_trade) return [];
  const out: PathBarbarianPlacement[] = [];
  (ext.barbarians ?? []).forEach((e: Edge, i: number) => {
    // A zero edge is a barbarian the derivation could not place (only on a
    // board with no legal path left); drawing it would put a figure at the
    // origin.
    if (!e || (e.a.q === 0 && e.a.r === 0 && e.b.q === 0 && e.b.r === 0)) return;
    out.push({
      position: edgeToWorld(e),
      rotationY: edgeRotationY(e),
      key: `wagon-barbarian:${ext.barbarian_ids?.[i] ?? i}`,
    });
  });
  return out;
}

/** The set of edges a barbarian stands on, for a road renderer that dims them. */
export function barbarianEdges(view: FullView): ReadonlySet<string> {
  const ext = wagonsExt(view);
  return new Set((ext?.barbarians ?? []).map((e) => edgeKey(e)));
}
