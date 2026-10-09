// Which halves of the lattice gap are sand.
//
// All of them, and only land tiles have any: water is drawn a full lattice
// cell wide (see LATTICE_SCALE), so it meets a land tile's ring on the midline
// and meets other water with no gap. That avoids the coast problem a sea-gap
// fill would have: a beach stops at its water hex's rim, so water-coloured gaps
// would notch the beach ring and sand-coloured ones would spike into the sea.
//
// The land test is the coastline's `WATER`: a tile list does not reliably
// carry the sea round its coast (the base game ships none), so anything the
// list does not name as land is water.
import type { BoardTile } from "@/lib/types";
import { hexToWorld, edgeAngleY, hexKey } from "../coords";
import { WATER } from "../coastline";
import type { Placement } from "../instancing";

/** Whether a tile is drawn as water, and so fills its lattice cell. */
export function isWaterTile(res: string): boolean {
  return WATER.has(res);
}

/**
 * Every half-gap the sand covers, as transforms for `gapStripGeometry`.
 *
 * `land` forces named hexes (by `hexKey`) to be treated as land whatever
 * their resource. A module can repaint a hex with a land model its resource
 * does not name (the Caravans oasis, `lake` once Fishermen floods it), and a
 * land model does not fill its cell, so it needs its own gutter sand. See
 * `layers/caravans.ts`.
 *
 * `skip` names hexes whose halves another layer covers: a fog hex's whole
 * cell, gutter included, is a plate of cloud (see `fogPlateGeometry` in
 * `layers/fog.ts`).
 */
export function planGapSand(
  tiles: BoardTile[],
  land?: ReadonlySet<string>,
  skip?: ReadonlySet<string>,
): Placement[] {
  const out: Placement[] = [];
  for (const t of tiles) {
    if (isWaterTile(t.res) && !land?.has(hexKey(t.hex))) continue;
    if (skip?.has(hexKey(t.hex))) continue;
    for (let dir = 0; dir < 6; dir++) {
      out.push({ position: hexToWorld(t.hex), rotationY: edgeAngleY(dir) });
    }
  }
  return out;
}
