// The neutral props, shot as icons for the rules page.
//
// ICON_SET covers seat pieces only. The robber, pirate, barbarian fleet and
// merchant had no icon, since the game draws them on the board and names them
// in the log; the rules page needs to show what they look like (a CSS stand-in
// vanished on a dark panel).
//
// Their materials sit outside the Seat_* system (loader.test.ts pins that), so
// `seatColor` doesn't affect them. The set is requested in one fixed colour
// (RULES_COLOR in routes/HowToPlay), so the cache holds a single copy.
import type { PieceShot } from "./thumbnail";
import type { ShotSet } from "./shotCache";
import { PIECE_ICON_W, PIECE_ICON_H } from "./pieceIconShots";

/**
 * Fill, matched to the piece icons (see PIECE_ICON_SHOTS' 0.86), so the robber
 * reads at the same scale as the settlement beside it.
 */
const FILL = 0.86;

export const RULES_SHOTS: PieceShot[] = [
  {
    // The robber, yawed a touch so the brim reads as a hat rather than a
    // disc.
    slot: "prop_robber",
    parts: [{ file: "pieces.glb", prefix: "Robber_" }],
    yawDeg: -12,
    fill: FILL,
  },
  {
    slot: "prop_pirate",
    parts: [{ file: "ships.glb", prefix: "Ship_pirate" }],
    yawDeg: -20,
    fill: FILL,
  },
  {
    slot: "prop_barbarian",
    parts: [{ file: "ships.glb", prefix: "Ship_barbarian" }],
    yawDeg: -20,
    fill: FILL,
  },
  {
    slot: "prop_merchant",
    parts: [{ file: "trader.glb", prefix: "Trader_merchant" }],
    yawDeg: -10,
    fill: FILL,
  },
];

/** Neutral props for the rules page: square and small, like the log icons. */
export const RULES_SET: ShotSet = {
  id: "rules",
  shots: RULES_SHOTS,
  size: { w: PIECE_ICON_W, h: PIECE_ICON_H },
  // Drawn at 22-28px in prose. As with ICON_SET, 2x would cost four times the
  // bytes for no visible difference.
  pixelRatio: 1,
};
