// Number chips.
//
// Mounted at the same place on every tile, not where the blend's
// Token_<Terrain> empties say: those were placed by eye (most at z = -1.5,
// the generic tile's at the centre, the desert's at (-0.019, -1.335)). Chips
// are UI that players scan, so they should not wander.
//
// The socket still says whether a tile takes a chip (sea variants have none)
// and how high it sits, so the artist keeps the mount height.
import type { BoardTile, Hex } from "@/lib/types";
import type { LakeNumbers } from "@/lib/fish";
import { hexToWorld, hexKey, type Vec3 } from "../coords";
import { TILES, CHIPS, HEX_SIZE } from "../manifest.generated";

/**
 * Where the chip sits on its tile, as an offset from the centre.
 *
 * The tiles' authored socket carried through the half turn every tile is laid
 * with (see TILE_ROTATION_Y): -1.5 in the blend becomes +1.5, the near edge on
 * screen. Chips are placed here rather than rotated with the tile so every
 * number sits in the same spot whatever the terrain.
 *
 * Measured off HEX_SIZE, not LATTICE_SIZE: this is an offset within a tile's
 * own art, and the gutter between tiles is not part of it.
 */
export const CHIP_OFFSET_Z = HEX_SIZE / 2;

/**
 * Chips carry their own mount height, so nothing is added here.
 *
 * The chip art is exported at its modelled height (geometry from y = 0.25 on
 * a 0.25-high tile), so adding the socket's y would float it. The ground under
 * every chip is capped at 0.235 by edits/0006_clear_chip_footprint.py.
 *
 * The socket only says whether a tile takes a chip (sea variants have none).
 * Seating is `seating.ts`'s job.
 */

export interface ChipPlacement {
  number: number;
  variant: number;
  position: Vec3;
  /**
   * Stable identity, so the chip can be found again after a rebuild.
   *
   * Derived from the hex only. The number can change: the Knights Inventor
   * card swaps the tokens on two hexes, and the swap animation has to address
   * "the chip on this hex" across the rebuild where both numbers change.
   * Whether a hex takes a chip never changes. Unlike a building (see
   * `pieceKey`), the place is the piece here.
   */
  key: string;
}

const CHIP_KEY_PREFIX = "chip:";

/** The identity of the chip on `hex`, whether or not that hex has one. */
export function chipKey(hex: { q: number; r: number }): string {
  return CHIP_KEY_PREFIX + hexKey(hex);
}

/**
 * Whether a key names a chip.
 *
 * The renderer's animation bookkeeping is keyed by string across every family,
 * and the drop needs to exclude chips (see startPieceMotion), or a chip would
 * be dropped in like a newly placed piece.
 */
export function isChipKey(key: string): boolean {
  return key.startsWith(CHIP_KEY_PREFIX);
}

/**
 * The chips a roll turns over.
 *
 * Every chip showing the number, minus the one under the robber. Not only the
 * chips that paid someone: a roll is a fact about the board, and this leaves
 * the robber's chip as the only still one.
 *
 * The robber's chip is excluded because the robber stands on it (see
 * robberOnChip); the board answers that case with a pulse.
 */
export function chipsMatching(
  tiles: BoardTile[],
  robber: { q: number; r: number } | undefined,
  total: number,
  lakes: readonly LakeNumbers[] = [],
): string[] {
  const blocked = robber ? chipKey(robber) : null;
  // A lake's chip carries every number it pays on, so it turns for any of
  // them, and not at all under the robber, which blocks the whole lake.
  return [
    ...planChips(tiles).filter((c) => c.number === total),
    ...planLakeChips(tiles, lakes).filter((c) => c.numbers.includes(total)),
  ]
    .filter((c) => c.key !== blocked)
    .map((c) => c.key);
}

// Variant counts come from the manifest, which counts them from the blend.
// 2 and 12 have one variant; the rest have two.
const VARIANTS = new Map(CHIPS.map((c) => [c.number, c.variants]));

/**
 * The chip on `hex`, if that tile has one.
 *
 * Shared so the robber can stand on it. A tile takes a chip only when it has a
 * number, art exists for that number, and its terrain has a socket (sea
 * variants have none); other code should ask this rather than re-derive it.
 */
export function chipFor(
  tiles: BoardTile[],
  hex: { q: number; r: number },
): ChipPlacement | undefined {
  return planChips(tiles.filter((t) => t.hex.q === hex.q && t.hex.r === hex.r))[0];
}

export function planChips(tiles: BoardTile[]): ChipPlacement[] {
  const out: ChipPlacement[] = [];
  for (const t of tiles) {
    const count = t.num ? VARIANTS.get(t.num) : undefined;
    if (!count) continue; // no number, or no art for it (e.g. 7)
    const entry = TILES[t.res];
    if (!entry?.socket) continue;
    const [cx, , cz] = hexToWorld(t.hex);
    // Deterministic variant from the hex itself: the same board always renders
    // the same chips, so a replay looks identical to the live game.
    const variant = (Math.abs(t.hex.q * 7 + t.hex.r * 13) % count) + 1;
    out.push({
      number: t.num,
      variant,
      position: [cx, 0, cz + CHIP_OFFSET_Z],
      key: chipKey(t.hex),
    });
  }
  return out;
}

/**
 * A lake's chip: one chip carrying every number the lake pays fish on.
 *
 * A lake pays on two or four numbers (engine/scenarios.fishLake), so the numbers
 * come from `ext.fishermen` (`lakeNumbers`), and the art is composed from the
 * chip file's parts: see lib/board3d/lakeChip.
 */
export interface LakeChipPlacement {
  numbers: number[];
  position: Vec3;
  /** `chipKey` of the lake's hex, like every chip: the flip finds it by that. */
  key: string;
}

/**
 * One chip per lake that has numbers to show, on the lake tile's own socket,
 * the same spot as every other chip (the water is in the northern half; the
 * socket is on the grass).
 *
 * A number with no chip art (a 7) is left off, and a lake with nothing left
 * draws no chip, as in `planChips`.
 */
export function planLakeChips(
  tiles: BoardTile[],
  lakes: readonly LakeNumbers[],
): LakeChipPlacement[] {
  if (!lakes.length || !TILES.lake?.socket) return [];
  const byHex = new Map(lakes.map((l) => [hexKey(l.hex), l.numbers]));
  const out: LakeChipPlacement[] = [];
  for (const t of tiles) {
    if (t.res !== "lake") continue;
    const numbers = (byHex.get(hexKey(t.hex)) ?? []).filter((n) => VARIANTS.has(n));
    if (!numbers.length) continue;
    const [cx, , cz] = hexToWorld(t.hex);
    out.push({ numbers, position: [cx, 0, cz + CHIP_OFFSET_Z], key: chipKey(t.hex) });
  }
  return out;
}

/**
 * Whether `hex` carries a chip of any kind: a numbered tile's or a lake's.
 *
 * What the robber asks before standing on one. `chipFor` stays the answer for
 * a numbered tile alone, because its callers want the chip's number.
 */
export function hasChip(tiles: BoardTile[], hex: Hex, lakes: readonly LakeNumbers[] = []): boolean {
  if (chipFor(tiles, hex)) return true;
  const here = tiles.filter((t) => t.hex.q === hex.q && t.hex.r === hex.r);
  return planLakeChips(here, lakes).length > 0;
}
