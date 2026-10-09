// Terrain placement and the ocean backdrop.
//
// The backdrop is an instanced grid of the exported sea tile, so it always
// matches the real sea tiles.
import type { BoardTile, Hex } from "@/lib/types";
import {
  hexToWorld,
  hexKey,
  LATTICE_SIZE,
  LATTICE_SCALE,
  TILE_ROTATION_Y,
  type Vec3,
} from "../coords";
import { isWaterTile } from "./gap";
import { boardExtent, oceanBackdropRadius } from "../scene";
import { tileFileFor } from "../loader";

// The board's half turn lives in `../coords`, which imports nothing that could
// import a layer back. Re-exported here for existing callers.
export { TILE_ROTATION_Y };

export interface TilePlacement {
  file: string;
  position: Vec3;
  rotationY: number;
  scale: number;
}

/**
 * Land is drawn at its authored size and water a whole lattice cell wide.
 *
 * The lattice is spread so no land tile owns its own perimeter (roads and
 * buildings go there). At sea there is nothing to reserve, and a gutter would
 * be a seam in open water that also breaks up the beach ring, so water fills
 * its cell.
 */
export function tileScale(res: string): number {
  return isWaterTile(res) ? LATTICE_SCALE : 1;
}

/**
 * `overrides` repaints named hexes, keyed by `hexKey`; `land` says which of
 * them are drawn as land.
 *
 * For terrain a resource cannot name: the Caravans oasis is derived at setup,
 * so it wears `none` (or `lake` under Fishermen) on the wire and no
 * resource-keyed lookup reaches its file; see `layers/caravans.ts`.
 *
 * `yaw` turns named hexes, separately from `overrides`. A hex with no entry
 * keeps `TILE_ROTATION_Y`. The value replaces `TILE_ROTATION_Y` rather than
 * adding to it. Rivers fills it with `TILE_ROTATION_Y` itself, so nothing
 * turns a tile today (turning a tile turns its chip socket away from the chip;
 * see `layers/rivers.ts`); the seam is kept for a future module.
 *
 * Scale follows the coastline's rule (`landKeys` in coastline.ts): a hex is
 * water when its resource says so and `land` does not name it, and only water
 * is drawn a whole cell wide. It must be the same rule, or a hex the gutter
 * sand treats as land would float over the gutter or bury it under its rim.
 *
 * So `land` forces, rather than lists. It holds the overrides whose resource
 * reads water but whose art is a land slab (the flooded oasis, the fog slab),
 * drawn at 1. An override on a land resource (every Rivers channel) needs no
 * entry; reading the set as exhaustive would draw those 4.8% too wide.
 * Explorers' `sea_shoal` is a water override and nothing forces it.
 */
export function planTiles(
  tiles: BoardTile[],
  overrides?: ReadonlyMap<string, string>,
  yaw?: ReadonlyMap<string, number>,
  land?: ReadonlySet<string>,
): TilePlacement[] {
  const out: TilePlacement[] = [];
  for (const t of tiles) {
    const key = hexKey(t.hex);
    const override = overrides?.get(key);
    const file = override ?? tileFileFor(t.res);
    // An unknown resource is a data problem, not a reason to blank the board.
    if (!file) continue;
    out.push({
      file,
      position: hexToWorld(t.hex),
      rotationY: yaw?.get(key) ?? TILE_ROTATION_Y,
      scale: land?.has(key) ? 1 : tileScale(t.res),
    });
  }
  return out;
}

/**
 * Backdrop sea hexes out to the near field only, skipping every real tile.
 *
 * `aspect` is the viewport's: a portrait window stands the camera further back
 * and sees further out to sea.
 *
 * Bounded by distance rather than by the camera: everything past
 * `nearOceanRadius` is one flat ring (see `oceanAnnulusGeometry`), since
 * filling the frame with hexes made the water 83% of the board's triangles.
 *
 * `oceanBackdropRadius` rather than `nearOceanRadius`: it reaches one hex past
 * where the flat ring begins, the smallest overlap that leaves no gap.
 */
export function oceanHexes(tiles: BoardTile[], aspect = 1, exclude?: ReadonlySet<string>): Hex[] {
  const occupied = new Set(tiles.map((t) => hexKey(t.hex)));
  const radius = oceanBackdropRadius(boardExtent(tiles), aspect);
  // A disc of hexes, not a hexagon of rings: the flat sea beyond is a circle,
  // and a hexagon's corners (15% further out than its edges) would be drawn
  // over it from `nearOceanRadius` on. See `oceanBackdropRadius` for the
  // radius. The cut also drops about a fifth of the backdrop that was hidden
  // under the annulus.
  //
  // The ring count still bounds the scan (a hex outside the disc cannot be
  // inside it), so this filters the same loop.
  const rings = Math.ceil(radius / (LATTICE_SIZE * 1.5));
  const out: Hex[] = [];
  for (let q = -rings; q <= rings; q++) {
    for (let r = -rings; r <= rings; r++) {
      if (Math.abs(q + r) > rings) continue;
      if (occupied.has(hexKey({ q, r }))) continue;
      // A dock tile stands here instead; two sea hexes would z-fight.
      if (exclude?.has(hexKey({ q, r }))) continue;
      const [x, , z] = hexToWorld({ q, r });
      if (Math.hypot(x, z) > radius) continue;
      out.push({ q, r });
    }
  }
  return out;
}

/** Sea-hex positions filling the backdrop, skipping every real tile. */
export function planOcean(tiles: BoardTile[], aspect = 1, exclude?: ReadonlySet<string>): Vec3[] {
  return oceanHexes(tiles, aspect, exclude).map((h) => hexToWorld(h));
}
