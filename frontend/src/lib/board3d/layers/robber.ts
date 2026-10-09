// The robber. Neutral art (Mat_Robber), outside the Seat_* tint system: it
// belongs to no player.
import * as THREE from "three";
import { ROBBERS, ROBBER_MATERIAL } from "@/lib/robbers";
import type { LoadedAsset } from "../loader";
import type { Board, Hex } from "@/lib/types";
import { hexToWorld } from "../coords";
import type { Placement } from "../instancing";
// Type-only, so erased at compile time: ghostMesh imports ROBBER_PREFIX from
// here, and this keeps the runtime dependency one-way.
import type { GhostSeat } from "../ghostMesh";
import { SURFACE } from "../seating";
import { robberOnBoard } from "@/lib/robber";
import { hasChip, CHIP_OFFSET_Z } from "./chips";
import type { LakeNumbers } from "@/lib/fish";

// Re-exported so the board layers have one import for the robber, as for the
// chip it stands on. The rule lives in lib/robber, which is three.js-free:
// lib/fish uses it to decide whether the two-fish spend is available and must
// not pull in a renderer.
export { robberOnBoard };

export const ROBBER_PREFIX = "Robber_";

/** The file the stock robber ships in, alongside the base pieces. */
export const STOCK_ROBBER_FILE = "pieces.glb";

/**
 * The file to draw an equipped robber skin from.
 *
 * Every skin carries `Robber_`-prefixed nodes in its own glb, so stock and
 * purchased art are interchangeable: same prefix, seating and animation,
 * different file.
 *
 * Unrecognised ids get the stock art: a bundle can be older than the catalog
 * (a skin ships, a player buys it, a client that has not reloaded is asked for
 * an unknown file), and a failed cosmetic should lose the decoration, not the
 * robber.
 */
export function robberAssetFile(skin: string): string {
  return ROBBERS[skin]?.file ?? STOCK_ROBBER_FILE;
}

/**
 * Recolour a skin's three material slots for the chroma it was bought in.
 *
 * A chroma is a colourway of a design, sharing the design's file and differing
 * only here, so it costs no download.
 *
 * The materials are cloned first: `subsetByPrefix` returns meshes still
 * pointing at the cached asset's materials, so recolouring in place would
 * repaint every other instance of that file for the session.
 *
 * A no-op for a design (its colours are in its file) and for anything this
 * client does not recognise.
 */
export function applyRobberChroma(art: LoadedAsset, skin: string): LoadedAsset {
  const colors = ROBBERS[skin]?.colors;
  if (!colors) return art;
  const bySlot: Record<string, [number, number, number]> = {
    [ROBBER_MATERIAL.body]: colors.body,
    [ROBBER_MATERIAL.shade]: colors.shade,
    [ROBBER_MATERIAL.detail]: colors.detail,
  };
  art.scene.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const next = mats.map((mat) => {
      const rgb = bySlot[mat.name];
      if (!rgb) return mat;
      const clone = (mat as THREE.MeshStandardMaterial).clone();
      // Linear, like the authored colour and palette.json: assignment, not
      // conversion.
      clone.color.setRGB(rgb[0], rgb[1], rgb[2], THREE.LinearSRGBColorSpace);
      return clone;
    });
    mesh.material = Array.isArray(mesh.material) ? next : next[0];
  });
  return art;
}

/**
 * The robber's identity, for the animation bookkeeping in `instancing`.
 *
 * A constant rather than derived from its hex. A position-based key would
 * change on every move, which suits buildings (`pieceKey`: a city is a new
 * piece) but not the robber: there is one for the whole game and it moves, so
 * the renderer carries it rather than building a second one. See
 * robberMotion.ts.
 */
export const ROBBER_KEY = "robber";

/**
 * True when the robber's hex carries a number chip.
 *
 * It stands on the chip when there is one (as on a physical board, so the
 * blocked number reads at a glance) and on the bare tile otherwise, usually
 * the desert, where it starts.
 *
 * The caller uses this to pick the seating surface; chip height is not this
 * layer's concern.
 */
export function robberOnChip(board: Board, lakes: readonly LakeNumbers[] = []): boolean {
  return !!board.robber && hasChip(board.tiles, board.robber, lakes);
}

/**
 * Where the robber's ghost stands over a hex the pointer is offering it.
 *
 * `planRobber` answers this for the hex the robber is on; a preview needs it
 * for a hex it is not on yet. Same rule: onto the chip where there is one,
 * onto the tile otherwise.
 *
 * `chipTop` is measured off the loaded chip art at build time (Board3D's
 * `chipTopRef`) and is null before chips are built (an unnumbered map, or a
 * hover early in a load). Falling back to the tile face stands the ghost
 * slightly low rather than dropping it through the board.
 */
export function robberGhostSeat(
  board: Board,
  h: Hex,
  chipTop: number | null,
  lakes: readonly LakeNumbers[] = [],
): GhostSeat {
  // Always the chip's spot: every tile keeps it flat and clear whether or not
  // it has a chip (the socket contract in hexcontract.py), so on a desert,
  // oasis or lake the robber avoids the tile's middle (the oasis pond). Only
  // the height depends on the chip.
  if (!hasChip(board.tiles, h, lakes)) return { surface: SURFACE.land, dz: CHIP_OFFSET_Z };
  return { surface: chipTop ?? SURFACE.land, dz: CHIP_OFFSET_Z };
}

/**
 * Nothing to draw when the robber is not on the board.
 *
 * `board.robber` is truthy even at `board.OffBoard` (Fishermen's robber beside
 * the board until the first 7 and after a two-fish spend), so this checks the
 * hex against the board, as `robberOnChip` does.
 */
export function planRobber(board: Board): Placement[] {
  if (!robberOnBoard(board)) return [];
  const [x, , z] = hexToWorld(board.robber);
  // Always the chip's spot, chip or not (see robberGhostSeat). y is left to
  // the caller; see seating.ts.
  return [{ position: [x, 0, z + CHIP_OFFSET_Z], key: ROBBER_KEY }];
}
