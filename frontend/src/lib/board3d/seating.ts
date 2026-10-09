// How a piece sits on the board.
//
// Each family's art has its own authored base: settlements, cities, roads and
// number chips were modelled on a tile and start at y = 0.25; knights,
// metropolises, walls, ships and the merchant start at y = 0.
//
// Two things matter:
//
//  1. Where the piece stands. Vertices and edge midpoints are in the gutter
//     between tiles; a chip is on the tile face; a ship is on the lower water.
//  2. The scale it is drawn at. `instanceGeometry` composes translate-rotate-
//     scale, so the scale multiplies the authored base too: a settlement
//     authored at 0.25 and drawn at 2.0 has its base at 0.5.
//
// The base is measured off the art rather than assumed: see `assetBaseY`.
import { SAND_Y } from "./gapGeometry";
import { OCEAN_MEAN_Y } from "./ocean";
import type { Placement } from "./instancing";

/**
 * The heights things stand on, in world units, measured off the shipped art:
 * `gutter` is the gap fill's top face and `land` is a tile slab's. `sea` is the
 * mean of the water surface (the slab is sunk out of the way, see ocean.ts).
 */
export const SURFACE = {
  /** Between tiles: where vertices and edge midpoints are. */
  gutter: SAND_Y,
  /** A land tile's top face. */
  land: 0.25,
  /** The mean water line. Ships float here, not on the wave crests. */
  sea: OCEAN_MEAN_Y,
} as const;

/**
 * Where to put a placement's origin so the art's base lands on `surface`.
 * `baseY` is the art's lowest point in its own space; `scale` is its draw scale.
 */
export function seatY(surface: number, baseY: number, scale = 1): number {
  return surface - scale * baseY;
}

/** `seatY`, applied to a batch of placements. */
export function seat<T extends Placement>(
  placements: T[],
  surface: number,
  baseY: number,
  scale = 1,
): T[] {
  const y = seatY(surface, baseY, scale);
  return placements.map((p) => ({
    ...p,
    position: [p.position[0], y, p.position[2]] as Placement["position"],
    scale,
    // Kept so an animation can scale the piece about the ground; it cannot be
    // recovered from the seated position without the art's base.
    groundY: surface,
  }));
}
