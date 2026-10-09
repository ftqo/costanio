// Islands pieces: route ships along the sea, and the pirate.
//
// Both come off `islandsExt(view)`, the same slice the 2D board reads, so the
// two boards agree about where a ship is.
//
// A ship spans a sea edge, so it takes the road's geometry: the edge
// midpoint, turned along the edge. The pirate sits on a sea hex, so it takes
// the robber's.
import { islandsExt, type FullView } from "@/lib/types";
import { edgeKey } from "@/lib/hexgeo";
import { edgeToWorld, edgeRotationY, hexToWorld } from "../coords";
import { pieceKey } from "../drop";
import type { Placement } from "../instancing";
import { shipShiftsOnCamelPaths } from "./caravans";

/** Node-name prefixes in ships.glb. */
export const SHIP_PREFIX = "Ship_route";
export const PIRATE_PREFIX = "Ship_pirate";

export interface OwnedPlacement extends Placement {
  owner: number;
}

/**
 * Route ships, one per sea edge a player has built on.
 *
 * The rotation is the road's: `edgeRotationY`, shared with roads and the ghost
 * preview.
 *
 * One exception to the midpoint: under Caravans with Islands, a camel on its
 * punt may share a sea path with a ship, and they split the path's length.
 * The ship moves `SHIP_SHIFT` toward the caravan's tail along the edge while
 * the camel moves the other way; `shipShiftsOnCamelPaths` owns both halves.
 */
export function planShips(view: FullView): OwnedPlacement[] {
  const ships = islandsExt(view)?.ships ?? [];
  if (ships.length === 0) return [];
  const shifts = shipShiftsOnCamelPaths(view);
  return ships.map((s) => {
    const [x, y, z] = edgeToWorld(s.e);
    const [dx, dz] = shifts.get(edgeKey(s.e)) ?? [0, 0];
    return {
      owner: s.owner,
      position: [x + dx, y, z + dz],
      rotationY: edgeRotationY(s.e),
      key: pieceKey("ship", s.owner, edgeKey(s.e)),
    };
  });
}

/**
 * The pirate, if the board has one.
 *
 * Zero or one, as an array so the caller can pass it to `instanceAsset`
 * without a null check, like `planRobber`.
 */
export function planPirate(view: FullView): Placement[] {
  const pirate = islandsExt(view)?.pirate;
  if (!pirate) return [];
  return [{ position: hexToWorld(pirate) }];
}
