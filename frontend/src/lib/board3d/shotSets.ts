// The two shot sets the game asks for, kept outside the hooks so the lobby can
// warm them before the game screen mounts.
import { SHOP_SHOTS, THUMB_W, THUMB_H } from "./thumbnail";
import { PIECE_ICON_SHOTS, PIECE_ICON_W, PIECE_ICON_H } from "./pieceIconShots";
import { PIECE_PREFIX } from "./pieceArt";
import { STOCK_PIECES_FILE } from "@/lib/pieceSets";
import type { ShotSet } from "./shotCache";

/** Shop tiles: your own pieces, on a 3:4 card. The stock art. */
export const SHOP_SET: ShotSet = {
  id: "shop",
  shots: SHOP_SHOTS,
  size: { w: THUMB_W, h: THUMB_H },
};

/**
 * The shop tiles drawn from the viewer's equipped piece set, so a build card
 * shows the piece the click would buy. Only parts from the stock pieces file
 * that a set covers are redirected; ships, knights, improvement props and the
 * robber keep the stock art.
 *
 * The id includes the file so sets do not collide on disk. The stock file
 * returns `SHOP_SET` itself, keeping the existing cache entry.
 */
export function shopSetFor(pieceSetFile: string): ShotSet {
  if (pieceSetFile === STOCK_PIECES_FILE) return SHOP_SET;
  return {
    id: `shop|${pieceSetFile}`,
    shots: SHOP_SHOTS.map((shot) => ({
      ...shot,
      parts: shot.parts.map((part) =>
        part.file === STOCK_PIECES_FILE && SET_PREFIXES.has(part.prefix)
          ? { ...part, file: pieceSetFile }
          : part,
      ),
    })),
    size: { w: THUMB_W, h: THUMB_H },
  };
}

/**
 * The node prefixes a set replaces inside `pieces.glb`. `Robber_` is in that
 * file too and is excluded. Derived from PIECE_PREFIX.
 */
const SET_PREFIXES = new Set<string>(Object.values(PIECE_PREFIX));

/** Log icons: everyone's pieces, square and small. */
export const ICON_SET: ShotSet = {
  id: "icon",
  shots: PIECE_ICON_SHOTS,
  size: { w: PIECE_ICON_W, h: PIECE_ICON_H },
  // Drawn at ~18px on a text baseline; 2x would be wasted pixels.
  pixelRatio: 1,
};
