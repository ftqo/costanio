// Turn the coastline solver's output into the two meshes the board draws.
//
// The ribbon is one smooth closed curve per island (see shoreCurve.ts), built
// once in world space per board, so there is nothing to place.
//
// Geometry comes from beachGeometry.ts; beach.glb is loaded only for its two
// sand materials. The blend also carries the old canonical strip and wedge,
// generated from the same constants so terrain art can be modelled against
// the coast; assetAnchors.test.ts checks that copy still matches.
//
// Fog: an unrevealed hex is drawn as land (see `layers/fog.ts`), so it has a
// shore like any other, but sand round it reads as an island under the cloud.
// Its stretches of the ribbon come back separately, as `mist`, for the fog
// layer's cloud materials. The geometry is the same ribbon either way, so
// revealing a hex only turns its shore from cloud to sand, and no known coast
// moves.
import type { BoardTile } from "@/lib/types";
import * as THREE from "three";
import { solveCoastLoops } from "../coastline";
import { hexKey, worldToHex } from "../coords";
import { beachRibbonGeometry, shoreSegmentLand, type SandKind } from "../beachGeometry";
import type { ShoreStation } from "../shoreCurve";

/**
 * The ribbon, by material. `dry` and `wet` are the sand of every shore that
 * is not a fog hex's; `mist` is a fog hex's shore in the same two bands, or
 * null when no shore is fogged.
 */
export type PlannedBeaches = Record<SandKind, THREE.BufferGeometry> & {
  mist: Record<SandKind, THREE.BufferGeometry> | null;
};

/**
 * `land` is forwarded to `solveCoastLoops`; see there for what it is for.
 * `fog` names (by `hexKey`) the hexes whose shore is drawn as `mist`: a
 * stretch belongs to the land hex `shoreSegmentLand` lands in.
 */
export function planBeaches(
  tiles: BoardTile[],
  land?: ReadonlySet<string>,
  fog?: ReadonlySet<string>,
): PlannedBeaches | null {
  const loops = solveCoastLoops(tiles, land);
  if (!loops.length) return null;
  if (!fog?.size) {
    return {
      dry: beachRibbonGeometry(loops, "dry"),
      wet: beachRibbonGeometry(loops, "wet"),
      mist: null,
    };
  }
  const fogged = (a: ShoreStation, b: ShoreStation) => {
    const [x, z] = shoreSegmentLand(a, b);
    return fog.has(hexKey(worldToHex(x, z)));
  };
  const known = (a: ShoreStation, b: ShoreStation) => !fogged(a, b);
  const mist = {
    dry: beachRibbonGeometry(loops, "dry", fogged),
    wet: beachRibbonGeometry(loops, "wet", fogged),
  };
  const none = mist.dry.getAttribute("position").count === 0;
  if (none) {
    mist.dry.dispose();
    mist.wet.dispose();
  }
  return {
    dry: beachRibbonGeometry(loops, "dry", known),
    wet: beachRibbonGeometry(loops, "wet", known),
    mist: none ? null : mist,
  };
}
