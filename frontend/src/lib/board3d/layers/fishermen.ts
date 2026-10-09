// Fishermen: the weirs that mark a fishing ground, and the ground's number.
//
// A fishing ground is a coastal notch: a sea hex touching the island over two
// or three contiguous corners (engine/scenarios/fishermen.go, `deriveGrounds`). It
// pays whoever has built on those corners when its number comes up, so the
// board shows which corners are in it and what number turns it over, with two
// separate families (a third, the shallows, shows where the ground is; see
// `planFishingGrounds`):
//
//  1. A weir per corner. Settlements are built on corners, so the marker
//     belongs there rather than in the middle of the notch.
//  2. One number chip at the sea hex's centre, not on the weir. Every other
//     numbered hex puts its chip in its middle, and players read the board by
//     scanning chips. The weir art has no numeral geometry or chip socket.
import { fishExt, type FullView, type Vertex, type Hex } from "@/lib/types";
import { vertexKey } from "@/lib/hexgeo";
import { hexKey, hexToWorld, vertexToWorld, type Vec3 } from "../coords";
import { SURFACE } from "../seating";
import { CHIPS } from "../manifest.generated";
import { chipKey, type ChipPlacement } from "./chips";
import type { Placement } from "../instancing";

/** Node-name prefix in fishing.glb. Stakes, net and floats are one marker. */
export const WEIR_PREFIX = "Weir_";

/**
 * The direction the weir art faces before any turn, in the board's world axes.
 *
 * The marker is a fence line off to one side of its origin, with a landward
 * and a seaward face. Blender authors it along +y and the glTF export maps
 * Blender (x, y, z) onto world (x, z, -y), so +y lands on -z (away from the
 * viewer). `weirBearingY` turns that onto the notch.
 *
 * Checked against the shipped file in `fishermen.test.ts`, since a re-author
 * that moved the net across the origin would flip every weir.
 */
export const WEIR_FACES: readonly [number, number] = [0, -1];

/**
 * The Y rotation that turns the weir's face onto `(dx, dz)`.
 *
 * A rotation of `a` about Y sends -z to (-sin a, -cos a) (three.js turns +x
 * toward -z for a positive angle; see `edgeRotationY`), so the bearing is
 * `atan2(-dx, -dz)`.
 *
 * Zero is a real answer (a notch due north of its corner), so callers must not
 * treat it as "no rotation known".
 */
export function weirBearingY(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

/** One fishing ground, as `FishExt.grounds` carries it. */
export interface Ground {
  v: Vertex[];
  number: number;
  /** The sea hex the ground is the notch of. See `groundHex`. */
  hex?: Hex;
}

/**
 * The sea hex a ground is the notch of, or null.
 *
 * Read from the wire, not derived. The engine builds each ground by walking
 * one sea hex's corner ring (`shoreRun`) and publishes that hex. Inferring it
 * from the corners is ambiguous for a two-corner ground: two adjacent corners
 * of a hex are also corners of the hex across the edge, and in a one-hex-wide
 * strait (common on Islands boards) both are water. Do not add a fallback
 * inference.
 *
 * Null only for a server older than the field, which draws no weirs and no
 * ground chips.
 */
export function groundHex(g: Ground): Hex | null {
  return g.hex ?? null;
}

/** A weir, ready to draw: on a corner, turned to face the water it fishes. */
export interface WeirPlacement extends Placement {
  key: string;
}

/**
 * One weir per corner of every fishing ground.
 *
 * Each weir faces its own sea hex: the notch lies on a different side of each
 * corner, so a marker square to the board would stand on dry land or off the
 * board at some corners.
 *
 * A ground whose sea hex cannot be resolved draws nothing: a misplaced marker
 * names a corner that does not pay.
 */
export function planWeirs(view: FullView): WeirPlacement[] {
  const grounds = fishExt(view)?.grounds ?? [];
  const out: WeirPlacement[] = [];
  for (const g of grounds) {
    const sea = groundHex(g);
    if (!sea) continue;
    const [sx, , sz] = hexToWorld(sea);
    for (const v of g.v) {
      const [vx, , vz] = vertexToWorld(v);
      out.push({
        position: [vx, 0, vz],
        rotationY: weirBearingY(sx - vx, sz - vz),
        key: `weir:${vertexKey(v)}`,
      });
    }
  }
  return out;
}

/**
 * Node-name prefix of the fishing ground's shallows in fishing.glb: the lobed
 * patch of paler water (`Fishground_patch`) and the sand bar, rocks awash and
 * fins on it (`Fishground_features`). Neutral like the weir: a ground pays
 * whoever is on its shore.
 */
export const FISHGROUND_PREFIX = "Fishground_";

/**
 * The height the shallows are laid at: the sea's mean waterline.
 *
 * The file's y = 0 is the mean waterline (top +0.023 at the centre, rim down
 * to -0.043), so the swell eats into its edge and it reads as shallow water.
 * Not seated (`seatOn` would lift the rim out of the water), and at scale 1:
 * authored in world units, unlike the weir's `MODULE_SCALE.fishingGround`.
 */
export const FISHGROUND_Y = SURFACE.sea;

/**
 * How high any part of the shallows may stand, in the file's own frame, inside
 * `GROUND_CHIP_FIT_RADIUS` of the hex centre, where the chip lies above it.
 * The art test holds the file to it.
 */
export const FISHGROUND_UNDER_CHIP_Y = 0.025;

/** A fishing ground's shallows: at its sea hex's centre, the sand bar landward. */
export interface GroundPlacement extends Placement {
  key: string;
}

/**
 * One patch of shallows per fishing ground, under its chip.
 *
 * The chip gives the number and the weirs the corners; the shallows mark the
 * patch of sea that is the ground. They stay lower than the chip and clear of
 * it (nothing above `FISHGROUND_UNDER_CHIP_Y` within the chip's radius), so
 * the number reads first.
 *
 * Turned landward with the weir's convention: the sand bar is on the file's
 * -z side (`WEIR_FACES`), and `weirBearingY` turns it toward the centroid of
 * the ground's corners. A ground whose sea hex cannot be resolved draws
 * nothing, as for the weirs and the chip.
 */
export function planFishingGrounds(view: FullView): GroundPlacement[] {
  const grounds = fishExt(view)?.grounds ?? [];
  const out: GroundPlacement[] = [];
  for (const g of grounds) {
    const sea = groundHex(g);
    if (!sea || g.v.length === 0) continue;
    const [sx, , sz] = hexToWorld(sea);
    let lx = 0;
    let lz = 0;
    for (const v of g.v) {
      const [vx, , vz] = vertexToWorld(v);
      lx += vx / g.v.length;
      lz += vz / g.v.length;
    }
    out.push({
      position: [sx, FISHGROUND_Y, sz],
      rotationY: weirBearingY(lx - sx, lz - sz),
      scale: 1,
      key: `fishground:${hexKey(sea)}`,
    });
  }
  return out;
}

// Variant counts come from the manifest, as in `planChips`: 2 and 12 have one
// variant and the rest two; a ground's numbers (4, 5, 6, 8, 9, 10) all have
// art. Not shared code because the two pick their hexes differently.
const VARIANTS = new Map(CHIPS.map((c) => [c.number, c.variants]));

/**
 * The number chip lying at each fishing ground's centre.
 *
 * A `ChipPlacement`, so it draws with the same subsetting and numerals as every
 * other chip, including the red 6 and 8.
 *
 * Centred rather than offset by `CHIP_OFFSET_Z`, which keeps a chip off a land
 * tile's props; a ground's hex is open water.
 *
 * Keyed on the hex like every other chip. They cannot collide: a fishing
 * ground's hex is water and carries no terrain chip.
 */
export function planGroundChips(view: FullView): ChipPlacement[] {
  const grounds = fishExt(view)?.grounds ?? [];
  const out: ChipPlacement[] = [];
  for (const g of grounds) {
    const count = VARIANTS.get(g.number);
    if (!count) continue; // no art for this number
    const sea = groundHex(g);
    if (!sea) continue;
    const [cx, , cz] = hexToWorld(sea);
    const position: Vec3 = [cx, 0, cz];
    out.push({
      number: g.number,
      // The same deterministic variant rule as terrain chips, so a replay
      // renders the same board.
      variant: (Math.abs(sea.q * 7 + sea.r * 13) % count) + 1,
      position,
      key: chipKey(sea),
    });
  }
  return out;
}

/**
 * How far out from its centre a ground's chip has to stay on screen, in world
 * units: the chip's own radius with a little air round it.
 */
export const GROUND_CHIP_FIT_RADIUS = 1.1;

/**
 * Points the opening camera must keep in frame so every ground's chip is seen.
 *
 * A ground sits on a sea hex, and the base board ships no sea tiles, so a
 * camera fitted to the tiles left the ground chips outside the frame (at
 * 1280x800 the southern ones were half under the dock). Four points round
 * each chip at board level give the fit its full extent.
 */
export function groundFitPoints(view: FullView): [number, number][] {
  const out: [number, number][] = [];
  const r = GROUND_CHIP_FIT_RADIUS;
  for (const c of planGroundChips(view)) {
    const [x, , z] = c.position;
    out.push([x + r, z], [x - r, z], [x, z + r], [x, z - r]);
  }
  return out;
}
