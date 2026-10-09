// The lattice gap as generated geometry.
//
// coords.ts spreads the lattice so no tile owns its own perimeter; this fills
// the gap that opens. Generated rather than modelled so it follows the lattice
// constants when LATTICE_GAP changes.
//
// Colour comes from materials in the .glb files, so palette.json controls it.
//
// Mirrored into the blend as `Ref_Gap_*` so terrain rims can be modelled
// against it. tools/blender/lattice.py generates that mirror from these
// constants; change them here and re-run `make apply-edits`.
import * as THREE from "three";
import { HEX_SIZE } from "./manifest.generated";
import { LATTICE_SIZE } from "./coords";

const SQRT3_2 = Math.sqrt(3) / 2;

/** Distance from a hex centre to the middle of the tile art's own edge. */
export const TILE_APOTHEM = HEX_SIZE * SQRT3_2;

/**
 * Distance from a hex centre to the middle of its lattice edge: the midline
 * down the gap, where one tile's half of the fill meets its neighbour's.
 */
export const LATTICE_APOTHEM = LATTICE_SIZE * SQRT3_2;

/**
 * How far the fill reaches back underneath its own tile.
 *
 * Stopping exactly on the tile's rim would z-fight with the tile's outer wall.
 * Running under the tile hides the seam behind something opaque, and the fill
 * sits below the tile's top face so the overlap costs nothing.
 *
 * The inner boundary is the tile hexagon scaled about its centre, so the six
 * pieces of one tile's ring share their radial sides and close at the corners.
 */
const UNDERLAP = 0.06;

/** Inner boundary of the fill, as a fraction of the tile hexagon. */
const INNER_SCALE = (TILE_APOTHEM - UNDERLAP) / TILE_APOTHEM;

/**
 * Height of the sand.
 *
 * Land tile tops and the beach's dry sand are both at 0.25. The gap sits just
 * below: close enough to read as the same surface, far enough not to z-fight
 * with the tile across the underlap.
 */
export const SAND_Y = 0.22;

/** Underside, matching the tile slab's own bottom face. */
const BOTTOM_Y = -0.25;

/** A point on the fill's top surface. */
export interface Top {
  x: number;
  z: number;
}

/**
 * Extrude a convex top polygon down to a flat bottom.
 *
 * `top` is wound counter-clockwise seen from above, so the top normal is +y and
 * the sides face outward. The materials are double-sided, which flips the
 * shading normal on back faces, so the winding decides how the fill is lit.
 */
export function prism(top: Top[], y: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const tri = (
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cx: number,
    cy: number,
    cz: number,
  ) => {
    pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
  };

  for (let i = 1; i + 1 < top.length; i++) {
    tri(top[0].x, y, top[0].z, top[i].x, y, top[i].z, top[i + 1].x, y, top[i + 1].z);
  }
  for (let i = 1; i + 1 < top.length; i++) {
    const [a, b, c] = [top[0], top[i + 1], top[i]];
    tri(a.x, BOTTOM_Y, a.z, b.x, BOTTOM_Y, b.z, c.x, BOTTOM_Y, c.z);
  }
  for (let i = 0; i < top.length; i++) {
    const a = top[i];
    const b = top[(i + 1) % top.length];
    tri(a.x, y, a.z, a.x, BOTTOM_Y, a.z, b.x, BOTTOM_Y, b.z);
    tri(a.x, y, a.z, b.x, BOTTOM_Y, b.z, b.x, y, b.z);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  // Flat, not smoothed: the whole board is faceted low-poly.
  geo.computeVertexNormals();
  return geo;
}

/**
 * One tile's half of the gap along edge 0 (the +x edge of a hex at the
 * origin), from under that tile's rim out to the midline it shares with its
 * neighbour.
 *
 * Only land tiles have one: water is drawn a full lattice cell wide (see
 * LATTICE_SCALE), so on a coast the water meets the land's half on the
 * midline. Between two land tiles the two halves make the whole gap.
 */
export function gapStripGeometry(y: number): THREE.BufferGeometry {
  const xi = TILE_APOTHEM * INNER_SCALE;
  const zi = (HEX_SIZE / 2) * INNER_SCALE;
  const xo = LATTICE_APOTHEM;
  const zo = LATTICE_SIZE / 2;
  return prism(
    [
      { x: xi, z: zi },
      { x: xo, z: zo },
      { x: xo, z: -zo },
      { x: xi, z: -zi },
    ],
    y,
  );
}

/**
 * Material in beach.glb the gap is drawn in.
 *
 * Its own rather than `Mat_Shore_sand`: painting the strip like the shore made
 * the board read as tiles laid out on sand. Each tile draws half the gutter
 * (see `gapStripGeometry`), so colouring it as a path draws half a path around
 * every hex.
 */
export const GAP_SAND_MATERIAL = "Mat_Path";
