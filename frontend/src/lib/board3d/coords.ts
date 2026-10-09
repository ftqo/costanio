// Pointy-top axial hex geometry in three.js world space.
//
// These are lib/hexgeo.ts's formulas with screen y as world z. The camera looks
// down -z, so +z is the bottom of the screen as +y is on the SVG board. If the
// two disagree the 3D board is mirrored, which no camera position can undo.
//
// Do not derive the sign from the export (export_yup=True maps Blender
// (x, y, z) to glTF (x, z, -y), so the art's north is -z). That describes which
// way a tile's art faces, not which way the board's rows run.
import type { Hex, Vertex, Edge } from "@/lib/types";
import { HEX_SIZE } from "./manifest.generated";

export type Vec3 = [number, number, number];

const SQRT3 = Math.sqrt(3);

/** Axial neighbour offsets. The index is the edge index used everywhere else. */
export const DIRS: readonly Hex[] = [
  { q: 1, r: 0 },
  { q: 0, r: 1 },
  { q: -1, r: 1 },
  { q: -1, r: 0 },
  { q: 0, r: -1 },
  { q: 1, r: -1 },
] as const;

/**
 * Width of the gutter between one tile's rim and the next, in world units.
 *
 * Roads, settlements, cities, knights and paths all sit on the tile perimeter,
 * where terrain art would otherwise spread. The gutter gives them space no tile
 * owns.
 *
 * 0.25 because a road is 0.21 wide (its 1.716 x 1.112 bounding box is a bar
 * at 30 degrees, 1.86 by 0.21), or 0.24 at render scale, which leaves 0.01.
 */
export const LATTICE_GAP = 0.25;

/**
 * The hex size the lattice is laid out at, as against `HEX_SIZE`, the size the
 * tile art is drawn at.
 *
 * Adjacent centres sit `sqrt(3) * size` apart, so adding `LATTICE_GAP / sqrt(3)`
 * opens exactly `LATTICE_GAP` between two rims.
 *
 * Spreading the lattice rather than shrinking tiles keeps every asset at its
 * authored scale; shrinking would scale props and heights too (notably the
 * number chip's clearance above the ground).
 */
export const LATTICE_SIZE = HEX_SIZE + LATTICE_GAP / SQRT3;

/**
 * `LATTICE_SIZE / HEX_SIZE`, for art drawn to fill its whole lattice cell.
 *
 * Only water does this. The gap reserves a land tile's perimeter; between sea
 * hexes it would be a seam in open water. So the sea has no seams, and the gap
 * remains only where land is involved: a full one between land tiles, half
 * where land meets water.
 */
export const LATTICE_SCALE = LATTICE_SIZE / HEX_SIZE;

/**
 * Every hex is laid down turned half a turn from how it was modelled.
 *
 * The blend authors a tile with its chip socket and prop composition at -z
 * (the far side on screen). Turning it brings that face to the front. A
 * regular hexagon maps onto itself under a half turn, so the board still
 * tessellates.
 *
 * Defined here rather than in `layers/tiles` to avoid an import cycle:
 * `layers/rivers` needs it, `layers/tiles` reaches `loader`, and `loader`
 * reads `layers/rivers` at module scope (`MODULE_TILES` spreads
 * `RIVER_MODULE_TILES`), which would be a load-order ReferenceError. This
 * module imports only types and the manifest. `layers/tiles` re-exports it.
 */
export const TILE_ROTATION_Y = Math.PI;

export function neighbor(h: Hex, dir: number): Hex {
  const d = DIRS[((dir % 6) + 6) % 6];
  return { q: h.q + d.q, r: h.r + d.r };
}

export function hexKey(h: Hex): string {
  return `${h.q},${h.r}`;
}

/**
 * `size` is the lattice size, not the art size (they differ by `LATTICE_GAP`;
 * see `LATTICE_SIZE`). Every position here is a lattice position with the same
 * default. Pass `HEX_SIZE` for the ungapped geometry, as the tests comparing
 * against the SVG board's formulas do.
 */
export function hexToWorld(h: Hex, size = LATTICE_SIZE): Vec3 {
  return [size * SQRT3 * (h.q + h.r / 2), 0, size * 1.5 * h.r];
}

/**
 * The hex whose lattice cell holds world point (x, z): the inverse of
 * `hexToWorld`, rounded in cube coordinates. A point exactly on a lattice line
 * goes to either side.
 */
export function worldToHex(x: number, z: number, size = LATTICE_SIZE): Hex {
  const fr = z / (1.5 * size);
  const fq = x / (size * SQRT3) - fr / 2;
  const fs = -fq - fr;
  let q = Math.round(fq);
  let r = Math.round(fr);
  const s = Math.round(fs);
  const dq = Math.abs(q - fq);
  const dr = Math.abs(r - fr);
  const ds = Math.abs(s - fs);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  // `+ 0` folds a rounded -0 into 0, so the key matches `hexKey`'s.
  return { q: q + 0, r: r + 0 };
}

/** side 0 is the North corner, side 1 the South. North is -z, toward the back. */
export function vertexToWorld(v: Vertex, size = LATTICE_SIZE): Vec3 {
  const [x, , z] = hexToWorld({ q: v.q, r: v.r }, size);
  return [x, 0, z + (v.side === 2 ? 0 : v.side === 0 ? -size : size)];
}

export function edgeToWorld(e: Edge, size = LATTICE_SIZE): Vec3 {
  const [ax, , az] = vertexToWorld(e.a, size);
  const [bx, , bz] = vertexToWorld(e.b, size);
  return [(ax + bx) / 2, 0, (az + bz) / 2];
}

/** Corner i of a pointy-top hex, counting clockwise from the North corner. */
export function cornerToWorld(h: Hex, i: number, size = LATTICE_SIZE): Vec3 {
  const [cx, , cz] = hexToWorld(h, size);
  const a = (Math.PI / 3) * i;
  return [cx + size * Math.sin(a), 0, cz - size * Math.cos(a)];
}

/**
 * Y rotation that aligns an edge-aligned mesh (beach strip, road) with edge
 * `dir`. Edge 0 is the reference orientation the art is authored in.
 *
 * Negative, because three.js turns +x toward -z for a positive Y rotation
 * while edge 1 lies at +z of edge 0. Flipped, the coastline is mirrored about
 * the hex; the test checks where the rotated edge-0 midpoint lands.
 */
export function edgeAngleY(dir: number): number {
  return (-Math.PI / 3) * (((dir % 6) + 6) % 6);
}

/**
 * Y rotation that lays a bar-shaped piece (a road, a ship, or a ghost of
 * either) along the edge it spans.
 *
 * Same sign convention as `edgeAngleY`, from the endpoints because a wire
 * `Edge` is a vertex pair with no index. A Y rotation of `a` sends local +x to
 * (cos a, -sin a), so art authored along +x aligns with an edge running
 * (dx, dz) at `a = -atan2(dz, dx)`; `anchors.turn_for` ensures the art is
 * exported along +x.
 *
 * `NewEdge` normalises the pair by (q, r, side), so the axis points an
 * arbitrary way along the edge. Fine for symmetric pieces (the road, ship and
 * waypost). Not for directional ones like the camel (head at +x): use
 * `edgeBearingY` with the endpoints in facing order; `planCamels` gets that
 * order from the caravan chain.
 */
export function edgeRotationY(e: Edge, size = LATTICE_SIZE): number {
  return edgeBearingY(e.a, e.b, size);
}

/**
 * Y rotation that lays a bar-shaped piece along an edge facing `to`: art
 * authored along +x has its +x end at `to`. For callers that know which way
 * the piece faces (the far end of a caravan, the oasis end of a spoke).
 */
export function edgeBearingY(from: Vertex, to: Vertex, size = LATTICE_SIZE): number {
  const [ax, , az] = vertexToWorld(from, size);
  const [bx, , bz] = vertexToWorld(to, size);
  return -Math.atan2(bz - az, bx - ax);
}
