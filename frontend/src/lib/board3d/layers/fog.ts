// An unrevealed hex: a blank slab, and a bank of faceted cloud sitting on it.
//
// Explorers masks every hex a fleet has not reached to the wire-only `fog`
// resource (`MaskBoard`), so the client does not know what is under one. The
// board must show there is a place there to sail to, without hinting at its
// terrain:
//
//   THE SLAB   A fog hex is LAND to every layer that asks (`fogTileArt`'s
//              `land`): the coast is traced round it and the known tiles beside
//              it keep their gutter. Drawn as water, a revealed land hex would
//              grow a coastline from nothing; four pool hexes in five are land
//              (each region is nine specials, three of them shoals, one sea in
//              sixteen and land for the rest), so land is the shape the reveal
//              contradicts least. What stands on the cell is not a tile,
//              though: a flat plate of cloud the size of the whole cell, gutter
//              included (`fogPlateGeometry`). The blank `generic` slab used to
//              be drawn there, and its grey rim and gutter showed between the
//              puffs and the shore as a ring traced round the bank.
//
//   THE CLOUD  Low-poly puffs over the plate: squashed, flat-shaded icosahedra,
//              opaque, lit by the board's rig and casting shadows, like every
//              prop on the tiles. Puffs bridge the gutter between two fog hexes
//              so the unexplored region reads as one bank, and stop short of
//              the cell edge elsewhere so the coast stays clear for ships.
//
//   THE SHORE  Being land, a fog hex has a stretch of the coast's ribbon, and
//              in sand it read as an island under the cloud. So that stretch is
//              drawn in the cloud's two materials (`FOG_SHORE_MATERIALS`; the
//              split is `planBeaches`'s), and low pads and billows roll out
//              over it on the hex's sea-facing edges (`planFogShore`), so the
//              bank meets the water as cloud. The ribbon is the same one a
//              revealed hex gets, so a reveal turns its shore to sand and no
//              known coast moves. The shore puffs keep `FOG_SHORE_CLEARANCE`
//              off every lattice edge a ship can sail, the fog hex's own
//              included.
//
// No leak: what a fog hex looks like depends only on which hexes are fogged
// (public, `ViewExt.fog`) and their coordinates. The puff layout is hashed off
// `(q, r)`, and the bridges read only whether a neighbour is fog. The cloud is
// opaque, so there is no alpha or camera-dependent shading to audit.
//
// The art: billows and floor pads are authored (`models/fog.glb`,
// `art/fog.blend`): five lobed cumulus billows and three feathered lens pads,
// each one closed mesh with its origin at its anchor, in the two cloud
// materials palette.json owns. This file decides where each puff goes and how
// big it is, and picks a variant per puff off the same public hash. The
// generated icosahedron (`fogPuffGeometry`) is the fallback when the kit has
// not loaded and is what the envelope tests measure; every kit variant stays
// inside its worst case, so the guarantees hold for the art too.
//
// Cost: one instanced draw per variant in use (at most eight, plus the shadow
// pass), static, cached with the board. Nothing runs per frame.
import * as THREE from "three";
import type { BoardTile, Hex } from "@/lib/types";
import { hexToWorld, hexKey, vertexToWorld, edgeToWorld, neighbor, LATTICE_SIZE } from "../coords";
import { hexVertices, hexEdges, vertexHexes, edgeHexes, vertexKey, edgeKey } from "@/lib/hexgeo";
import { HEX_SIZE, TILES } from "../manifest.generated";
import { SURFACE } from "../seating";
import { MIN_CAMERA_ELEVATION_DEG } from "../scene";
import { instanceGeometry, type Placement } from "../instancing";
import type { LoadedAsset } from "../loader";
import type { TileArt } from "./caravans";
import { landKeys } from "../coastline";
import { prism, type Top } from "../gapGeometry";
import { TOP_Y } from "../beachGeometry";

const SQRT3 = Math.sqrt(3);

/** The wire resource an unrevealed hex arrives as. See `MaskBoard`. */
export const FOG_RESOURCE = "fog";

/** The manifest key of the blank slab `fogTileArt` names for a fog hex. */
export const FOG_TILE = "generic";

// --- the puff ------------------------------------------------------------

/**
 * How flat a puff is: its height over its width.
 *
 * The camera is always above, and a round ball reads as a snowball; at 0.6
 * the stack reads as billows and stays low enough to clear the chips (see
 * `FOG_MAX_Y`).
 */
export const FOG_PUFF_SQUASH = 0.6;

/**
 * Where the puff's flat base is cut, as a fraction of its radius below centre.
 *
 * A puff sits on the slab or another puff, so cut flat its base is always
 * hidden, and it adds nothing to the gutter or the shadow pass.
 */
export const FOG_PUFF_BASE = 0.25;

/**
 * Facet level of the icosahedron. 1 is 80 faces, matching the shipped trees
 * and rocks at board distance; 0 (20 faces) reads as crystals, 2 as a smooth
 * ball.
 */
export const FOG_PUFF_DETAIL = 1;

/**
 * How far each shared corner of the icosahedron is pushed in or out, as a
 * fraction of the radius: enough that no two puffs match. The jitter is keyed
 * on the corner's position, so faces sharing a corner move it identically and
 * no crack opens.
 */
export const FOG_PUFF_JITTER = 0.05;

/**
 * The cloud's surface: off-white, matte, a touch cool.
 *
 * Lit, so the day rig makes it white and the night rig moonlit, like the snow
 * on the mountain tiles. Held at or under that snow (`Mat_Mountains_snow`,
 * 0.941/0.949/0.965 in palette.json), the brightest lit surface the board
 * ships and known not to cross either post-processed look's bloom threshold.
 */
export const FOG_CLOUD_COLOR: readonly [number, number, number] = [0.86, 0.875, 0.9];
export const FOG_CLOUD_ROUGHNESS = 0.95;

/**
 * How dark a puff's underside is against its top, and the tint it darkens
 * toward (a cloud's belly is cooler as well as darker). Multiplied into
 * `FOG_CLOUD_COLOR`, so the top of every puff is exactly that colour and never
 * brighter.
 */
export const FOG_BELLY = 0.7;
export const FOG_BELLY_TINT: readonly [number, number, number] = [0.88, 0.93, 1];

// --- the bank ------------------------------------------------------------

/** One puff's recipe in a hex's own frame: where, how big, how flat. */
export interface PuffSpec {
  /** Offset from the hex centre (or the edge or corner), world units. */
  x: number;
  z: number;
  /** Height of the puff's centre above the board floor. */
  y: number;
  /** Radius, half the width. The height is `squash` of it. */
  s: number;
  /** `FOG_PUFF_SQUASH` for a billow, `FOG_FLOOR_SQUASH` for a floor pad. */
  squash: number;
}

/**
 * How flat a floor pad is. The floor is what the billows stand on: one wide
 * pad per hex, so the slab shows cloud wherever two billows do not meet, plus
 * the pads bridging the gutters. Its own geometry, since a uniform scale of a
 * billow cannot be this flat.
 */
export const FOG_FLOOR_SQUASH = 0.2;

/** The floor pad under each fog hex, and the six toward its corners. */
export const FOG_FLOOR_RADIUS = 2.18;
export const FOG_CORNER_PAD_AT = 1.78;
export const FOG_CORNER_PAD_RADIUS = 0.72;

/** A gutter bridge's centre height and size, and a junction's. */
export const FOG_BRIDGE_Y = SURFACE.land - 0.04;
export const FOG_BRIDGE_RADIUS = 1.35;
export const FOG_JUNCTION_RADIUS = 0.95;

/**
 * The swell: a slow rise and fall of billow size across the board, so a few
 * hexes tower and their neighbours sag instead of every hex wearing the same
 * mound. About three hexes a wave.
 */
export const FOG_SWELL_LO = 0.8;
export const FOG_SWELL_HI = 1.2;
export const FOG_SWELL_SCALE = 15;

/**
 * The tallest anything in this file may reach.
 *
 * A cloud must not hide a neighbouring hex's number chip. A puff of top height
 * h hides (h - chip) / tan(elevation) behind it, and the camera never goes
 * below `MIN_CAMERA_ELEVATION_DEG`. `fogSightReach` computes this per puff,
 * and the test keeps the bank well short of the next chip.
 */
export const FOG_MAX_Y = 1.4;

/**
 * How close a puff may come to its own slab's edge, in world units.
 *
 * A ship explores by sailing up to a fog hex's edge, and the explore target is
 * drawn there, so the bank keeps the coastline and anything moored on it
 * clear. Bridges and junctions are the exception, covering only edges or
 * corners fogged on every side, where nothing can stand.
 */
export const FOG_EDGE_CLEARANCE = 0.25;

/** The slab's own apothem. The cell's is a gutter wider. */
export const FOG_SLAB_APOTHEM = (HEX_SIZE * SQRT3) / 2;

/**
 * A small hash of a hex and a slot, in [0, 1). Deterministic, platform-free,
 * and a function of public coordinates only (see the no-leak note at the top).
 */
export function fogHash(q: number, r: number, slot: number): number {
  let h =
    Math.imul(q | 0, 0x27d4eb2d) ^ Math.imul(r | 0, 0x165667b1) ^ Math.imul(slot + 1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** `fogHash` mapped to [-1, 1). */
function signed(q: number, r: number, slot: number): number {
  return fogHash(q, r, slot) * 2 - 1;
}

/**
 * Smooth value noise in [0, 1] over the board plane, from `fogHash` on a
 * coarse lattice. A function of world position only.
 */
export function fogSwell(x: number, z: number): number {
  const fx = x / FOG_SWELL_SCALE;
  const fz = z / FOG_SWELL_SCALE;
  const ix = Math.floor(fx);
  const iz = Math.floor(fz);
  const tx = fx - ix;
  const tz = fz - iz;
  const u = tx * tx * (3 - 2 * tx);
  const v = tz * tz * (3 - 2 * tz);
  const n = (a: number, b: number) => fogHash(a, b, 7);
  const top = n(ix, iz) * (1 - u) + n(ix + 1, iz) * u;
  const bottom = n(ix, iz + 1) * (1 - u) + n(ix + 1, iz + 1) * u;
  return top * (1 - v) + bottom * v;
}

/**
 * The billows that stand on one fog hex, in its own frame.
 *
 *   CORE    one big puff at the middle, the peak of the cluster.
 *   CROWN   three around it on a bearing turned per hex, lumping the top so
 *           it is not one dome and neighbours do not match.
 *   TUFTS   two smaller ones toward the rim, on bearings of their own, so the
 *           cluster is not the same trefoil on every hex.
 *   RIM     six low ones, one toward each edge, filling the cell out to its
 *           clearance.
 *
 * The core and crown ride the swell (`fogSwell`); the tufts and rim do not,
 * so a tall hex still falls away to its edge.
 */
export function hexPuffs(h: Hex): PuffSpec[] {
  const { q, r } = h;
  const out: PuffSpec[] = [];
  let slot = 0;
  const jit = (amount: number) => signed(q, r, slot++) * amount;
  const [wx, , wz] = hexToWorld(h);
  const m = FOG_SWELL_LO + (FOG_SWELL_HI - FOG_SWELL_LO) * fogSwell(wx, wz);
  const push = (angle: number, radius: number, y: number, s: number) => {
    const a = angle + jit(0.18);
    const rr = radius + jit(0.1);
    out.push({
      x: rr * Math.sin(a),
      z: -rr * Math.cos(a),
      y: y + jit(0.03),
      s: s * (1 + jit(0.16)),
      squash: FOG_PUFF_SQUASH,
    });
  };
  push(0, 0, SURFACE.land + 0.05, 1.3 * m);
  const turn = fogHash(q, r, 97) * ((Math.PI * 2) / 3);
  for (let i = 0; i < 3; i++)
    push(turn + (i * Math.PI * 2) / 3, 0.95, SURFACE.land + 0.02, 0.85 * m);
  for (let i = 0; i < 2; i++)
    push(fogHash(q, r, 90 + i) * Math.PI * 2, 1.45, SURFACE.land - 0.02, 0.55);
  // The rim: one low billow toward each edge (edge i's normal is at 30 + 60i
  // degrees), so the cloud fills the cell out to FOG_EDGE_CLEARANCE instead
  // of leaving a flat apron round the cluster that read as a band round the
  // bank.
  for (let i = 0; i < 6; i++) push(Math.PI / 6 + (i * Math.PI) / 3, 1.7, SURFACE.land - 0.04, 0.45);
  return out;
}

/**
 * The floor pads under one fog hex, in its own frame: one wide pad, and six
 * small ones on the corner bearings (corner i of a pointy-top hex is at 60i,
 * see `cornerToWorld`), which the round pad cannot reach.
 */
export function hexFloor(h: Hex): PuffSpec[] {
  const out: PuffSpec[] = [
    { x: 0, z: 0, y: SURFACE.land - 0.08, s: FOG_FLOOR_RADIUS, squash: FOG_FLOOR_SQUASH },
  ];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i;
    out.push({
      x: FOG_CORNER_PAD_AT * Math.sin(a),
      z: -FOG_CORNER_PAD_AT * Math.cos(a),
      y: SURFACE.land - 0.06,
      s: FOG_CORNER_PAD_RADIUS * (1 + signed(h.q, h.r, 800 + i) * 0.05),
      squash: FOG_FLOOR_SQUASH,
    });
  }
  return out;
}

/** Where a puff's outline ends, from the origin of its own frame, on the ground. */
export function puffReach(p: PuffSpec): number {
  return Math.hypot(p.x, p.z) + p.s * (1 + FOG_PUFF_JITTER);
}

/** The top of a puff above the board floor. */
export function puffTop(p: PuffSpec): number {
  return p.y + p.s * p.squash * (1 + FOG_PUFF_JITTER);
}

/**
 * How far out from the origin of its frame a puff can hide the board, at the
 * lowest the camera goes: its reach plus the sight-shadow of its top over
 * `over` (the height of the thing being protected).
 */
export function fogSightReach(p: PuffSpec, over: number): number {
  const lift = Math.max(0, puffTop(p) - over);
  return puffReach(p) + lift / Math.tan((MIN_CAMERA_ELEVATION_DEG * Math.PI) / 180);
}

/** The tiles the board has been told nothing about. */
export function fogTiles(tiles: readonly BoardTile[]): BoardTile[] {
  return tiles.filter((t) => t.res === FOG_RESOURCE);
}

/** A puff, placed in world space. `spec` is kept for the tests' measurements. */
export interface PlacedPuff extends Placement {
  spec: PuffSpec;
  /**
   * What it is standing for: a hex's own cloud, a bridge over a gutter, or
   * the bank rolling out over a fog hex's shore.
   */
  role: "hex" | "bridge" | "junction" | "shore";
  /**
   * Which authored shape it wears: an index into `FOG_BILLOW_PREFIXES` for a
   * billow, into `FOG_FLOOR_PREFIXES` for a floor pad. Off `fogHash`, so a
   * function of public coordinates only, like everything else here.
   */
  variant: number;
}

/**
 * Every billow on the board: `hexPuffs` for each fog hex, placed.
 */
export function planFog(tiles: readonly BoardTile[]): PlacedPuff[] {
  const out: PlacedPuff[] = [];
  for (const t of fogTiles(tiles)) {
    const [cx, , cz] = hexToWorld(t.hex);
    hexPuffs(t.hex).forEach((p, i) =>
      out.push({
        position: [cx + p.x, p.y, cz + p.z],
        rotationY: fogHash(t.hex.q, t.hex.r, 200 + i) * Math.PI * 2,
        scale: p.s,
        spec: p,
        role: "hex",
        variant: pick(fogHash(t.hex.q, t.hex.r, 300 + i), FOG_BILLOW_PREFIXES.length),
      }),
    );
  }
  return out;
}

/**
 * The floor of the bank, drawn in the flat geometry: what the billows stand on,
 * and what joins one fog hex's cloud to the next.
 *
 *   FLOOR    `hexFloor` for each fog hex.
 *   BRIDGE   one pad straddling the gutter of every edge both of whose hexes
 *            are fogged.
 *   JUNCTION one pad on every vertex all three of whose hexes are fogged,
 *            where three gutters meet.
 *
 * The bridges join separate clouds into one bank. Each is emitted once (keyed
 * by its edge or vertex) and looks only at whether its neighbours are fog,
 * which is public. An edge with a revealed hex on either side gets no bridge,
 * so the bank stops at the known coast, and the edges and corners bridges
 * cover are inland to the unexplored.
 */
export function planFogFloor(tiles: readonly BoardTile[]): PlacedPuff[] {
  const fogged = new Set(fogTiles(tiles).map((t) => hexKey(t.hex)));
  const isFog = (h: Hex) => fogged.has(hexKey(h));
  const out: PlacedPuff[] = [];
  const place = (
    [ox, oz]: [number, number],
    spec: PuffSpec,
    role: PlacedPuff["role"],
    seed: number,
  ) =>
    out.push({
      position: [ox + spec.x, spec.y, oz + spec.z],
      rotationY: fogHash(Math.round(ox * 10), Math.round(oz * 10), seed) * Math.PI * 2,
      scale: spec.s,
      spec,
      role,
      variant: pick(
        fogHash(Math.round(ox * 10), Math.round(oz * 10), seed + 1000),
        FOG_FLOOR_PREFIXES.length,
      ),
    });
  const bridge = (s: number): PuffSpec => ({
    x: 0,
    z: 0,
    y: FOG_BRIDGE_Y,
    s,
    squash: FOG_FLOOR_SQUASH,
  });
  const edgesDone = new Set<string>();
  const cornersDone = new Set<string>();
  for (const t of fogTiles(tiles)) {
    const [cx, , cz] = hexToWorld(t.hex);
    hexFloor(t.hex).forEach((pad, i) => place([cx, cz], pad, "hex", 500 + i));

    for (const e of hexEdges(t.hex)) {
      const key = edgeKey(e);
      if (edgesDone.has(key)) continue;
      edgesDone.add(key);
      const both = edgeHexes(e);
      if (both.length !== 2 || !both.every(isFog)) continue;
      const [mx, , mz] = edgeToWorld(e);
      place([mx, mz], bridge(FOG_BRIDGE_RADIUS), "bridge", 600);
    }

    for (const v of hexVertices(t.hex)) {
      const key = vertexKey(v);
      if (cornersDone.has(key)) continue;
      cornersDone.add(key);
      if (!vertexHexes(v).every(isFog)) continue;
      const [vx, , vz] = vertexToWorld(v);
      place([vx, vz], bridge(FOG_JUNCTION_RADIUS), "junction", 700);
    }
  }
  return out;
}

// --- the shore -------------------------------------------------------------

/**
 * The beach materials a fog hex's shore is drawn in instead of sand, by band:
 * the cloud's top on both. The wet band is the stretch between the crest and
 * the waterline, and in the belly material it showed above the water as a
 * blue rim traced round the bank; in the top material the cloud meets the sea
 * directly. In `fog.glb`, so palette.json owns it; `fogShoreMaterial` stands
 * in without the kit.
 */
export const FOG_SHORE_MATERIALS = {
  dry: "Mat_Fog_cloud",
  wet: "Mat_Fog_cloud",
} as const;

/**
 * How close a shore puff may come to any lattice edge a ship can stand on: the
 * fog hex's own sea-facing edge, and every edge of the water hex beyond it.
 * A ship explores from that edge and the explore target is drawn on it.
 */
export const FOG_SHORE_CLEARANCE = 0.45;

/** The lattice apothem: centre to the shared lattice line. */
const LATTICE_APOTHEM = (LATTICE_SIZE * SQRT3) / 2;

/**
 * How far out from the lattice line the shore puffs may reach: the ribbon's
 * nominal width (`BEACH_REACH`), so the cloud never spreads past where the
 * sand would have been and a one-hex strait stays as open as it is today.
 */
export const FOG_SHORE_REACH = 1.6;

/**
 * The puffs on one sea-facing edge, in a frame where +x runs along the edge
 * and +z points out to sea from the lattice line: two to four low floor pads
 * and up to two small billows, at hashed places and sizes so the bank's edge
 * is ragged and no two edges match (a row of equal puffs read as a beaded
 * outline).
 *
 * Each puff is put as far in as `FOG_SHORE_CLEARANCE` allows off the edge
 * itself, and slid along the edge no further than keeps that clearance off
 * the two edges of the water hex that leave its ends, where a ship can also
 * stand. Hashed off the fog hex and the edge's direction, public like the
 * rest.
 */
export function shoreEdgePuffs(q: number, r: number, dir: number): PuffSpec[] {
  const out: PuffSpec[] = [];
  let slot = 1200 + dir * 32;
  const u = () => fogHash(q, r, slot++);
  const place = (s: number, y: number, squash: number, at: number) => {
    const reach = s * (1 + FOG_PUFF_JITTER);
    const z = Math.min(FOG_SHORE_REACH - reach, FOG_SHORE_CLEARANCE + reach + 0.02 + u() * 0.12);
    // Distance from (x, z) to the water hex's side edges is
    // (apothem + z) / 2 - |x| sin 60; keep it clear by the puff's reach.
    const room = Math.max(0, (LATTICE_APOTHEM + z) / 2 - reach - FOG_SHORE_CLEARANCE) / (SQRT3 / 2);
    const x = Math.max(-room, Math.min(room, at));
    out.push({ x, z, y, s, squash });
  };
  const pads = 2 + Math.min(2, Math.floor(u() * 3));
  for (let i = 0; i < pads; i++) {
    const at = (pads === 1 ? 0 : -1 + (2 * i) / (pads - 1)) * 0.95 + (u() * 2 - 1) * 0.2;
    place(0.38 + u() * 0.14, 0.17, FOG_FLOOR_SQUASH, at);
  }
  const billows = Math.min(2, Math.floor(u() * 3));
  for (let i = 0; i < billows; i++)
    place(0.24 + u() * 0.14, 0.19, FOG_PUFF_SQUASH, (u() * 2 - 1) * 0.9);
  return out;
}

/**
 * The bank rolling out over a fog hex's shore: `shoreEdgePuffs` on every edge
 * of a fog hex whose neighbour is drawn as water, placed in world space.
 * Split by shape, `billows` for the billow geometry and `floor` for the pads,
 * so each joins its own draw.
 *
 * `land` is the board's land overrides (`landKeys`), so the edges that get
 * puffs are exactly the edges the ribbon runs along. `avoid` names water
 * hexes (by `hexKey`) that carry art of their own, a harbour or the Explorers
 * Council, which the puffs keep out of.
 *
 * No leak: this reads which hexes are fog and whether each non-fog neighbour
 * is land or water, both public, and hashes only the fog hex's coordinates.
 */
export function planFogShore(
  tiles: readonly BoardTile[],
  land?: ReadonlySet<string>,
  avoid?: ReadonlySet<string>,
): { billows: PlacedPuff[]; floor: PlacedPuff[] } {
  const billows: PlacedPuff[] = [];
  const floor: PlacedPuff[] = [];
  const fog = fogTiles(tiles);
  if (!fog.length) return { billows, floor };
  const solid = landKeys([...tiles], new Set([...(land ?? []), ...fogTileArt(tiles).land]));
  for (const t of fog) {
    const [cx, , cz] = hexToWorld(t.hex);
    for (let dir = 0; dir < 6; dir++) {
      const other = neighbor(t.hex, dir);
      const key = hexKey(other);
      if (solid.has(key) || avoid?.has(key)) continue;
      const [ox, , oz] = hexToWorld(other);
      const len = Math.hypot(ox - cx, oz - cz);
      const nx = (ox - cx) / len;
      const nz = (oz - cz) / len;
      // Along the edge: the normal turned a quarter.
      const ax = -nz;
      const az = nx;
      shoreEdgePuffs(t.hex.q, t.hex.r, dir).forEach((p, i) => {
        const d = LATTICE_APOTHEM + p.z;
        const placed: PlacedPuff = {
          position: [cx + nx * d + ax * p.x, p.y, cz + nz * d + az * p.x],
          rotationY: fogHash(t.hex.q, t.hex.r, 1400 + dir * 16 + i) * Math.PI * 2,
          scale: p.s,
          spec: p,
          role: "shore",
          variant: 0,
        };
        if (p.squash === FOG_FLOOR_SQUASH) {
          placed.variant = pick(
            fogHash(t.hex.q, t.hex.r, 1500 + dir * 16 + i),
            FOG_FLOOR_PREFIXES.length,
          );
          floor.push(placed);
        } else {
          placed.variant = pick(
            fogHash(t.hex.q, t.hex.r, 1600 + dir * 16 + i),
            FOG_BILLOW_PREFIXES.length,
          );
          billows.push(placed);
        }
      });
    }
  }
  return { billows, floor };
}

/**
 * The top of the cloud floor that stands in for a fog hex's slab: level with
 * the beach ribbon's crest (`TOP_Y`), so the plate runs into a fog hex's
 * cloud-coloured shore with no step (a step's lit side wall drew a fine line
 * round the bank). The two are the same material, so where the ribbon's lip
 * tucks under the plate the overlap cannot show. Under every puff's base, and
 * a hair under the known tiles' gutter (`SAND_Y`, 0.22), which ends at the
 * lattice line the plate starts from.
 */
export const FOG_PLATE_Y = TOP_Y;

/**
 * The floor under a fog hex: a flat hexagonal plate the size of the whole
 * lattice cell, gutter included, in the cloud's top material.
 *
 * It replaced the blank `generic` slab, whose grey rim and gutter showed
 * between the puffs and the shore and drew a ring round the bank. The cell is
 * still land to every other layer (`fogTileArt`'s `land`), so the coast, the
 * gutters of the known tiles beside it, and the reveal are unchanged; only
 * what stands on the cell is cloud from edge to edge.
 *
 * Unit-free: one geometry, instanced at each fog hex's centre. Generated, so
 * the build that instances it owns it.
 */
export function fogPlateGeometry(): THREE.BufferGeometry {
  const top: Top[] = [];
  // Counter-clockwise seen from above (see `prism`): corner 5 down to 0.
  for (let i = 5; i >= 0; i--) {
    const a = (Math.PI / 3) * i;
    top.push({ x: LATTICE_SIZE * Math.sin(a), z: -LATTICE_SIZE * Math.cos(a) });
  }
  return prism(top, FOG_PLATE_Y);
}

/**
 * How far a known hex's beach runs into the fog hex beside it, from the shared
 * lattice line. Both are land, so the coast is not traced between them and the
 * known hex had only its half of the gutter there: the cloud plate began at its
 * rim and the hex read as sliced off. This strip gives it a beach on that side
 * too. Inside every billow's floor pad edge (`FOG_FLOOR_RADIUS`, 2.18 from the
 * centre against a 2.72 apothem), so the bank sits on the sand's far side.
 */
export const FOG_LAND_BEACH_DEPTH = 0.55;

/** The strip's top: on the plate, a hair under the known tile's gutter (`SAND_Y`). */
export const FOG_LAND_BEACH_Y = FOG_PLATE_Y + 0.003;

/**
 * The beach a known land hex gets on each edge it shares with a fog hex: a
 * trapezoid on the fog hex's plate, from the lattice line `FOG_LAND_BEACH_DEPTH`
 * in, mitred at both ends so neighbouring strips on one fog hex meet cleanly.
 * One merged geometry in world space, or null when no fog hex touches known
 * land.
 *
 * `land` is the board's land overrides, as for `planFogShore`. No leak: it
 * reads only which hexes are fog and which known neighbours are land.
 */
export function planFogLandBeach(
  tiles: readonly BoardTile[],
  land?: ReadonlySet<string>,
): THREE.BufferGeometry | null {
  const fog = fogTiles(tiles);
  if (!fog.length) return null;
  const fogged = fogKeys(tiles);
  const solid = landKeys([...tiles], new Set([...(land ?? [])]));
  const inner = 1 - FOG_LAND_BEACH_DEPTH / LATTICE_APOTHEM;
  const parts: THREE.BufferGeometry[] = [];
  for (const t of fog) {
    const [cx, , cz] = hexToWorld(t.hex);
    // The plate's corners, in its own (counter-clockwise from above) order.
    const corners: Top[] = [];
    for (let i = 5; i >= 0; i--) {
      const a = (Math.PI / 3) * i;
      corners.push({ x: LATTICE_SIZE * Math.sin(a), z: -LATTICE_SIZE * Math.cos(a) });
    }
    for (let dir = 0; dir < 6; dir++) {
      const other = neighbor(t.hex, dir);
      const key = hexKey(other);
      if (fogged.has(key) || !solid.has(key)) continue;
      const [ox, , oz] = hexToWorld(other);
      const nx = ox - cx;
      const nz = oz - cz;
      // The edge facing the neighbour: the consecutive corner pair furthest along it.
      let best = 0;
      let bestDot = -Infinity;
      for (let i = 0; i < 6; i++) {
        const a = corners[i];
        const b = corners[(i + 1) % 6];
        const d = (a.x + b.x) * nx + (a.z + b.z) * nz;
        if (d > bestDot) {
          bestDot = d;
          best = i;
        }
      }
      const a = corners[best];
      const b = corners[(best + 1) % 6];
      // a -> b runs counter-clockwise, so the inset corners close it as b' -> a'.
      const quad: Top[] = [
        { x: cx + a.x, z: cz + a.z },
        { x: cx + b.x, z: cz + b.z },
        { x: cx + b.x * inner, z: cz + b.z * inner },
        { x: cx + a.x * inner, z: cz + a.z * inner },
      ];
      parts.push(prism(quad, FOG_LAND_BEACH_Y));
    }
  }
  if (!parts.length) return null;
  const pos: number[] = [];
  for (const g of parts) {
    pos.push(...(g.getAttribute("position").array as Float32Array));
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

/** Where `fogPlateGeometry` goes: one at each fog hex's centre. */
export function planFogPlates(tiles: readonly BoardTile[]): Placement[] {
  return fogTiles(tiles).map((t) => ({ position: hexToWorld(t.hex) }));
}

/** Every fog hex's key, for the layers that draw a fog hex differently. */
export function fogKeys(tiles: readonly BoardTile[]): Set<string> {
  return new Set(fogTiles(tiles).map((t) => hexKey(t.hex)));
}

const shoreMaterials = new Map<string, THREE.MeshStandardMaterial>();

/**
 * Stand-ins for `FOG_SHORE_MATERIALS` when the kit has not loaded: the
 * generated cloud's top colour, and that colour taken down to its belly.
 * Built once per tab, lit and opaque like the rest of the bank.
 */
export function fogShoreMaterial(
  kind: keyof typeof FOG_SHORE_MATERIALS,
): THREE.MeshStandardMaterial {
  const cached = shoreMaterials.get(kind);
  if (cached) return cached;
  const m = new THREE.MeshStandardMaterial({
    name: `${FOG_SHORE_MATERIALS[kind]}_shore`,
    flatShading: true,
    roughness: FOG_CLOUD_ROUGHNESS,
    metalness: 0,
  });
  m.color.setRGB(...FOG_CLOUD_COLOR, THREE.LinearSRGBColorSpace);
  shoreMaterials.set(kind, m);
  return m;
}

/**
 * A fog hex, as the same override a module uses to repaint a hex.
 *
 * `land` marks every fog hex as land whatever its resource, which traces the
 * coast round it, gives its known neighbours their gutter, and keeps it at
 * land scale. `layers/caravans.ts` documents the pair. It does not depend on
 * the manifest: the cell is drawn as a plate of cloud (`fogPlateGeometry`),
 * not a tile.
 *
 * `files` names the blank `generic` tile for each fog hex, so the other
 * overrides' turns are dropped there and a caller that draws terrain for
 * every hex still gets a blank, land-scaled slab rather than the sea. The
 * board does not draw it; it leaves fog hexes out of the terrain. Empty when
 * the manifest has no generic tile.
 *
 * `yaw` stays empty: nothing on the cell has a facing.
 */
export function fogTileArt(tiles: readonly BoardTile[]): TileArt {
  const files = new Map<string, string>();
  const land = new Set<string>();
  const entry = TILES[FOG_TILE];
  for (const t of fogTiles(tiles)) {
    if (entry) files.set(hexKey(t.hex), entry.file);
    land.add(hexKey(t.hex));
  }
  return { files, land, yaw: new Map() };
}

// --- the authored kit -----------------------------------------------------

/** The file the cloud kit ships in. Loaded by an Explorers board only. */
export const FOG_MODEL = "fog.glb";

/**
 * The five billows: lobed cumulus, base cut flat at y = -0.15 of a unit
 * radius and tops 0.57..0.60 (`FOG_PUFF_SQUASH` built in), so each is drawn at
 * a uniform scale of the puff's radius like the icosahedron.
 */
export const FOG_BILLOW_PREFIXES = [
  "Fog_billow_a",
  "Fog_billow_b",
  "Fog_billow_c",
  "Fog_billow_d",
  "Fog_billow_e",
] as const;

/** The three floor pads: flat feathered lenses, y -0.05..0.19 at unit radius. */
export const FOG_FLOOR_PREFIXES = ["Fog_floor_a", "Fog_floor_b", "Fog_floor_c"] as const;

/** `fogHash` in [0, 1) to an index in [0, n). */
function pick(h: number, n: number): number {
  return Math.min(n - 1, Math.floor(h * n));
}

/**
 * One kit variant as a single geometry, its two materials folded into vertex
 * colours: each face carries the palette colour of the material it was
 * authored in (`Mat_Fog_cloud` on top, `Mat_Fog_cloud_belly` on the
 * down-facing facets), so the variant draws in one call and palette.json still
 * owns both colours. Non-indexed with flat normals, for the facets.
 *
 * Null when the file carries no mesh under `prefix`. Generated per build, so
 * the build that instances it owns it and `disposeInstances` frees it.
 */
export function fogKitGeometry(asset: LoadedAsset, prefix: string): THREE.BufferGeometry | null {
  asset.scene.updateMatrixWorld(true);
  const positions: number[] = [];
  const colours: number[] = [];
  const v = new THREE.Vector3();
  asset.scene.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !mesh.name.startsWith(prefix)) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
    const pos = geo.getAttribute("position");
    // A mesh with material groups colours each range by its own material.
    const groups = geo.groups.length
      ? geo.groups
      : [{ start: 0, count: pos.count, materialIndex: 0 }];
    for (const g of groups) {
      const mat = mats[g.materialIndex ?? 0] as THREE.MeshStandardMaterial | undefined;
      const c = mat?.color ?? new THREE.Color(...FOG_CLOUD_COLOR);
      const end = Math.min(pos.count, g.start + g.count);
      for (let i = g.start; i < end; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
        positions.push(v.x, v.y, v.z);
        colours.push(c.r, c.g, c.b);
      }
    }
    if (geo !== mesh.geometry) geo.dispose();
  });
  if (positions.length === 0) return null;
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  out.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
  out.computeVertexNormals();
  return out;
}

let kitMaterial: THREE.MeshStandardMaterial | null = null;

/**
 * The kit's one material: white, so the vertex colours are the palette's,
 * lit and faceted like `fogMaterial`, and opaque. Built once per tab.
 */
export function fogKitMaterial(): THREE.MeshStandardMaterial {
  if (kitMaterial) return kitMaterial;
  kitMaterial = new THREE.MeshStandardMaterial({
    name: "Mat_Fog_cloud_kit",
    flatShading: true,
    vertexColors: true,
    roughness: FOG_CLOUD_ROUGHNESS,
    metalness: 0,
  });
  return kitMaterial;
}

/**
 * The whole bank drawn in the authored kit: one InstancedMesh per variant in
 * use, the billows from `planFog` and the pads from `planFogFloor`.
 *
 * Null when the kit is missing any variant; the caller then draws the
 * generated icosahedra. Geometries no placement uses are freed here.
 */
export function fogKitMeshes(
  asset: LoadedAsset,
  billows: readonly PlacedPuff[],
  floor: readonly PlacedPuff[],
): THREE.InstancedMesh[] | null {
  const billowGeo = FOG_BILLOW_PREFIXES.map((p) => fogKitGeometry(asset, p));
  const floorGeo = FOG_FLOOR_PREFIXES.map((p) => fogKitGeometry(asset, p));
  const all = [...billowGeo, ...floorGeo];
  if (all.some((g) => g === null)) {
    for (const g of all) g?.dispose();
    return null;
  }
  const out: THREE.InstancedMesh[] = [];
  const draw = (
    geos: (THREE.BufferGeometry | null)[],
    placed: readonly PlacedPuff[],
    name: string,
  ) =>
    geos.forEach((g, i) => {
      const at = placed.filter((p) => p.variant === i);
      if (at.length === 0) g!.dispose();
      else out.push(...instanceGeometry(g!, fogKitMaterial(), at, `${name}_${i}`));
    });
  draw(billowGeo, billows, "fog");
  draw(floorGeo, floor, "fog_floor");
  return out;
}

// --- geometry -------------------------------------------------------------

/**
 * One puff: a jittered, squashed icosahedron with its base cut flat and flat
 * normals, so every face is one shade under the board's light.
 *
 * Unit radius; a placement's uniform scale sizes it. Generated, so the build
 * that instances it owns it and `disposeInstances` frees it.
 */
export function fogPuffGeometry(squash = FOG_PUFF_SQUASH): THREE.BufferGeometry {
  // Non-indexed already: PolyhedronGeometry emits three corners per face.
  const ico = new THREE.IcosahedronGeometry(1, FOG_PUFF_DETAIL);
  const pos = ico.getAttribute("position");
  const moved = new Map<string, [number, number, number]>();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    // Keyed on the rounded position, so the corner every adjacent face shares
    // lands in exactly one place and the surface stays closed.
    const key = `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
    let p = moved.get(key);
    if (!p) {
      const k =
        1 + signed(Math.round(x * 997), Math.round(z * 991), Math.round(y * 983)) * FOG_PUFF_JITTER;
      p = [x * k, Math.max(-FOG_PUFF_BASE, y * k) * squash, z * k];
      moved.set(key, p);
    }
    pos.setXYZ(i, p[0], p[1], p[2]);
  }
  ico.deleteAttribute("uv");
  ico.deleteAttribute("normal");
  ico.computeVertexNormals();
  // Shade the underside and light the top in the vertex colours: from the
  // board's camera the sun is behind the viewer and every top facet takes
  // about the same light, so without this the bank is flat white. Per face
  // (all three corners take the face's mean height), so it steps facet by
  // facet.
  const colour = new Float32Array(pos.count * 3);
  const lo = -FOG_PUFF_BASE * squash;
  const hi = squash * (1 + FOG_PUFF_JITTER);
  for (let f = 0; f < pos.count; f += 3) {
    const y = (pos.getY(f) + pos.getY(f + 1) + pos.getY(f + 2)) / 3;
    const t = Math.min(1, Math.max(0, (y - lo) / (hi - lo)));
    const k = FOG_BELLY + (1 - FOG_BELLY) * t;
    for (let c = 0; c < 3; c++) {
      // Toward the tint as it darkens: at the top (k = 1) the factor is 1 in
      // every channel, so the top is the material's colour exactly.
      for (let ch = 0; ch < 3; ch++) {
        colour[(f + c) * 3 + ch] = k * (t + (1 - t) * FOG_BELLY_TINT[ch]);
      }
    }
  }
  ico.setAttribute("color", new THREE.BufferAttribute(colour, 3));
  return ico;
}

// --- the material ---------------------------------------------------------

let material: THREE.MeshStandardMaterial | null = null;

/**
 * The one cloud material, built on first use and kept for the life of the tab.
 *
 * A stock lit material with `flatShading`: the same shading model and rig as
 * the tiles' props, so the cloud follows day, night and the post-processed
 * looks without a per-look colour.
 */
export function fogMaterial(): THREE.MeshStandardMaterial {
  if (material) return material;
  const m = new THREE.MeshStandardMaterial({
    name: "Mat_Fog_cloud",
    flatShading: true,
    vertexColors: true,
    roughness: FOG_CLOUD_ROUGHNESS,
    metalness: 0,
  });
  m.color.setRGB(...FOG_CLOUD_COLOR, THREE.LinearSRGBColorSpace);
  material = m;
  return m;
}

/** Drop the cached materials. For tests, which build a fresh one per case. */
export function resetFogMaterial(): void {
  material?.dispose();
  material = null;
  kitMaterial?.dispose();
  kitMaterial = null;
  for (const m of shoreMaterials.values()) m.dispose();
  shoreMaterials.clear();
}
