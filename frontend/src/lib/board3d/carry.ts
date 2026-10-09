// A preview the pointer is carrying: it follows the hover from one legal spot
// to the next.
//
// markerMotion.ts already moves a neutral marker between hexes (an eased arc
// with a settle, and a redirect so a new move mid-flight continues from where
// the piece is). This module only supplies different paces; the motion itself
// is markerMotion's `planTrip` and `tripPose`.
//
// What moves is the translucent preview, not the real piece. Nothing is
// committed while hovering, so the real piece stays where it is: solid is
// where a thing is, translucent is where it would go.
import { type TravelSpec } from "./markerMotion";

/**
 * The pace of a carry, much faster than a move.
 *
 * `ROBBER_TRAVEL` is tuned for a committed move the table should follow. A
 * carry answers the pointer and will be redirected as soon as it moves, so it
 * takes about a fifth of the time with a flatter arc (still an arc, so the
 * piece does not cut through number chips).
 *
 * A short settle and small squash, so the landing reads only on the commit.
 */
export const CARRY_PACE: TravelSpec = {
  baseMs: 70,
  msPerUnit: 9,
  // Floor and ceiling well under `BOARD_PACE`'s 320ms and 620ms. The ceiling
  // matters most: a pointer thrown across the board.
  minMs: 110,
  maxMs: 260,
  settleMs: 60,
  settleSquash: 0.05,
  arcRatio: 0.14,
  arcMin: 0.35,
  arcMax: 0.9,
};

/**
 * A ghost sliding between candidate spots, at the pace of something
 * weightless: faster, with almost no arc, and no squash since it is not
 * touching the board. The slide gives continuity, one preview travelling
 * rather than one vanishing and another appearing.
 */
export const GHOST_SLIDE: TravelSpec = {
  baseMs: 45,
  msPerUnit: 6,
  minMs: 90,
  maxMs: 200,
  settleMs: 1,
  settleSquash: 0,
  arcRatio: 0.08,
  arcMin: 0.15,
  arcMax: 0.4,
};
