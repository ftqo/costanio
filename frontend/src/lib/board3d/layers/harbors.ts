// Harbours: where the dock, its dressing and its ratio sign stand, on the sea
// side of the harbour edge and turned to face the land they trade with.
import type { BoardTile, Harbor, Hex } from "@/lib/types";
import { vertexHexes } from "@/lib/hexgeo";
import { vertexToWorld, hexToWorld, hexKey, LATTICE_SCALE, type Vec3 } from "../coords";
import { WATER } from "../coastline";
import { HEX_SIZE } from "../manifest.generated";
import type { Placement } from "../instancing";
import { TILE_ROTATION_Y } from "./tiles";

export interface PortPlacement extends Placement {
  /** The water hex the dock stands on, so the plain sea tile can give way. */
  hex: Hex;
  /**
   * What this harbour trades, so the dock can be dressed for it.
   *
   * The resource string for a 2:1 port; "none" for a 3:1, which trades
   * everything and so has nothing particular to advertise.
   */
  res: string;
  ratio: number;
}

/** The tile file carrying the dock. */
export const PORT_TILE = "sea_port";

/**
 * `Port_deck` reaches out along -x from the hex centre, so an unrotated dock
 * points that way. A Y rotation of `a` sends the local -x axis to
 * (-cos a, sin a), so aiming the dock down (dx, dz) means a = atan2(dz, -dx).
 */
function dockAngle(dx: number, dz: number): number {
  return Math.atan2(dz, -dx);
}

/** The water hex beside a harbour edge, and the midpoint of that edge. */
function seaSide(h: Harbor, isWater: (k: string) => boolean): { sea: Hex; mid: Vec3 } | null {
  if (!h.verts || h.verts.length < 2) return null;
  const [a, b] = h.verts;
  const [ax, , az] = vertexToWorld(a);
  const [bx, , bz] = vertexToWorld(b);
  const mid: Vec3 = [(ax + bx) / 2, 0, (az + bz) / 2];

  // The two hexes sharing this edge are those touched by both vertices.
  const shared = vertexHexes(a).filter((x) =>
    vertexHexes(b).some((y) => y.q === x.q && y.r === x.r),
  );
  const sea = shared.find((x) => isWater(hexKey(x)));
  // A harbour with no sea side has nothing to face; skip rather than emit NaN.
  return sea ? { sea, mid } : null;
}

/**
 * Node-name prefix in docks.glb for a harbour's dressing.
 *
 * `Dock_wood`, `Dock_brick`, and so on: the wire's resource strings, so no
 * translation table is needed.
 *
 * A 3:1 takes `Dock_generic`: the general market, drawn as a covered hall
 * rather than a heap of one resource (see
 * `tools/blender/edits/0031_dock_generic.py`).
 */
export function dockPrefix(res: string, ratio: number): string {
  return ratio === 3 || res === "none" ? "Dock_generic" : `Dock_${res}`;
}

/**
 * Which ratio sign a harbour flies.
 *
 * The sign is authored art (`Hwedge_<key>_{body,face,text}`, built by
 * `tools/blender/edits/0025_harbour_ratio_signs.py` and shipped in
 * `signs.glb`), so this layer only picks one of six families. Position and
 * scale are the dock's own placement, since the sign is modelled on the pier
 * in the dock's frame like the dressing. Only its rotation is its own, in
 * thirds of a turn (see `signRotationY`).
 *
 * Keyed on the engine's resource names (`sheep`, `wheat`), so there is
 * nothing to mistranslate.
 */
export function wedgePrefix(res: string, ratio: number): string {
  return ratio === 3 || res === "none" ? "Hwedge_3to1" : `Hwedge_${res}`;
}

/**
 * Where the sign's centre sits along the pier, in the dock's own (unscaled)
 * frame: the pivot the sign can be spun about without moving.
 *
 * Mirrors `tools/blender/lattice.py`, as `coords.ts` mirrors its lattice
 * constants: the wedge is an equilateral triangle with its base at
 * `TOKEN_ALONG_PIER - h/2` and its apex at `+ h/2` (`h` its height), so the
 * centroid sits `h/6` inboard of `TOKEN_ALONG_PIER`. The bounding-box centre
 * is `TOKEN_ALONG_PIER` itself; pivoting there would swing the wedge a tenth
 * of a hex off its pier.
 *
 * The pier runs along -x, hence the signs.
 */
const TOKEN_ALONG_PIER = -1.12;
const TOKEN_SCALE = 0.385;
const WEDGE_HEIGHT = ((HEX_SIZE * Math.sqrt(3)) / 2) * TOKEN_SCALE;
export const SIGN_PIVOT_X = TOKEN_ALONG_PIER - WEDGE_HEIGHT / 6;

/**
 * The Y rotation at which a sign's ratio reads the right way up on screen.
 *
 * The default camera looks down -z with +y up, so world -z is the top of the
 * screen (which is why an unrotated number chip reads upright). The sign's
 * ratio is turned a quarter clockwise on the wedge so the baseline runs across
 * the pier (`TEXT_TURN` in `edits/0025_harbour_ratio_signs.py`), putting the
 * glyphs' up axis along local -x. A Y rotation of `a` sends local -x to
 * (-cos a, sin a), which is (0, -1) at a = -pi/2.
 */
export const SIGN_UPRIGHT_Y = -Math.PI / 2;

/** The turns that map the equilateral wedge onto its own footprint. */
const WEDGE_SYMMETRY = (2 * Math.PI) / 3;

/** `a` folded into (-pi, pi], so two angles can be compared for closeness. */
function wrapPi(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/**
 * The Y rotation to draw a harbour's ratio sign at, given its dock's.
 *
 * A dock faces the land it trades with, inward, so at the dock's rotation the
 * northern harbours of a round board read upside down.
 *
 * The wedge is a sixth of its hex lying on the pier, so an arbitrary turn
 * about the hex centre would slide it into the water. But an equilateral
 * triangle maps onto itself under a third of a turn about its centroid, so
 * `dock + k * 120deg` draws the same wedge on the same pier with only the
 * ratio turned. (60deg would invert the triangle.)
 *
 * Of those three, this picks the one closest to `SIGN_UPRIGHT_Y`. Dock
 * rotations are multiples of 60deg and upright is an odd multiple of 90, so
 * every harbour comes out 30deg off, the same for all, and none upside down.
 */
export function signRotationY(dockRotationY: number): number {
  let best = wrapPi(dockRotationY);
  for (let k = 1; k < 3; k++) {
    const cand = wrapPi(dockRotationY + k * WEDGE_SYMMETRY);
    if (Math.abs(wrapPi(cand - SIGN_UPRIGHT_Y)) < Math.abs(wrapPi(best - SIGN_UPRIGHT_Y))) {
      best = cand;
    }
  }
  return best;
}

/**
 * The dock's placement, re-aimed so its ratio reads as upright as the wedge
 * allows.
 *
 * The instance rotates about the placement's origin, so holding the centroid
 * still needs a translation of `R(dock)c - R(sign)c`, with `c` the pivot in
 * the dock's frame. Three.js turns +x toward -z for a positive Y rotation, so
 * `R(a)` sends `(c, 0, 0)` to `(c cos a, 0, -c sin a)`.
 */
export function signPlacement(dock: Placement): Placement {
  const a = dock.rotationY ?? 0;
  const t = signRotationY(a);
  const s = dock.scale ?? 1;
  const c = s * SIGN_PIVOT_X;
  return {
    position: [
      dock.position[0] + c * (Math.cos(a) - Math.cos(t)),
      dock.position[1],
      dock.position[2] - c * (Math.sin(a) - Math.sin(t)),
    ],
    rotationY: t,
    scale: dock.scale,
  };
}

/**
 * A harbour's dressing, grouped by the `Dock_*` family each instanced mesh
 * needs.
 *
 * The dressing rides the dock's own placement, not the sign's. `signPlacement`
 * spins the wedge a third of a turn about its centroid, which works only
 * because the triangle is symmetric (see `signRotationY`). For a hall or a
 * heap the same spin is a displacement of
 * `2 * LATTICE_SCALE * |SIGN_PIVOT_X| * sin(60deg)`, about 2.34 world units,
 * which would throw the dressing off the pier on four of six orientations.
 *
 * Reduced to position, facing and scale.
 */
export function groupDockArt(ports: readonly PortPlacement[]): Map<string, Placement[]> {
  const groups = new Map<string, Placement[]>();
  for (const p of ports) {
    const prefix = dockPrefix(p.res, p.ratio);
    groups.set(prefix, [
      ...(groups.get(prefix) ?? []),
      { position: p.position, rotationY: p.rotationY, scale: p.scale },
    ]);
  }
  return groups;
}

/**
 * A harbour's ratio sign, grouped by the `Hwedge_*` family each instanced mesh
 * needs.
 *
 * This one does take `signPlacement`: the wedge can be spun in place, which
 * keeps the far half of a round board's ratios upright.
 */
export function groupSignArt(ports: readonly PortPlacement[]): Map<string, Placement[]> {
  const groups = new Map<string, Placement[]>();
  for (const p of ports) {
    const prefix = wedgePrefix(p.res, p.ratio);
    groups.set(prefix, [...(groups.get(prefix) ?? []), signPlacement(p)]);
  }
  return groups;
}

/**
 * The dock tiles. The blend ships a whole harbour (deck, frame, roof, cargo,
 * sail) as `tiles/sea_port.glb`. A harbour arrives on the wire as an edge
 * with a ratio, not a tile resource, so `tileFileFor` cannot reach it.
 *
 * The dock stands on the water hex beside its edge, turned to face the land
 * it trades with, and replaces that hex's plain sea tile (hence the hex on the
 * placement).
 *
 * One dock per water hex is a board invariant enforced upstream: generation
 * places harbours on distinct water hexes, the map builder will not stack
 * two, and ValidateLayout and Lint reject a board that does (see
 * docs/maps.md). This layer does not hide violations.
 */
export function planPorts(harbors: Harbor[], tiles: BoardTile[]): PortPlacement[] {
  const byKey = new Map(tiles.map((t) => [hexKey(t.hex), t]));
  const isWater = (k: string): boolean => {
    const t = byKey.get(k);
    return t === undefined || WATER.has(t.res);
  };

  const out: PortPlacement[] = [];
  for (const h of harbors) {
    const found = seaSide(h, isWater);
    if (!found) continue;
    const { sea, mid } = found;

    const [sx, , sz] = hexToWorld(sea);
    out.push({
      hex: sea,
      res: h.res,
      ratio: h.ratio,
      position: [sx, 0, sz],
      rotationY: dockAngle(mid[0] - sx, mid[2] - sz),
      // A dock replaces that hex's sea tile, so it must fill the cell the same
      // way (see tileScale) or it leaves a moat around itself.
      scale: LATTICE_SCALE,
    });
  }
  return out;
}

/**
 * Where a dock's own water goes: everything the dock has except its facing.
 *
 * A dock is the only turned water tile, and its sea must not turn: the wave
 * relief is carved into the tile, so turned water would cross the ocean's
 * crests and crease along the tile edge. Standing the sheet at every other
 * tile's half turn makes it exactly the sea tile the dock displaced. See
 * `splitOceanSurface`, which separates the two halves.
 */
export function portWaterPlacements(ports: readonly PortPlacement[]): Placement[] {
  return ports.map((p) => ({ ...p, rotationY: TILE_ROTATION_Y }));
}
