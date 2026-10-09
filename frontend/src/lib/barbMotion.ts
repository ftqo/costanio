// The barbarian ship's sail between two hexes of the rail.
//
// A pose function driven per frame rather than a CSS transition. CSS
// interpolates transform lists elementwise (a sign-flipping heel swings through
// upright), and a `transition` lags a state behind React's writes. Driving
// frames ourselves avoids both, and matches how the rest of the board moves
// (robberMotion, knightMotion, chipSwap).
//
// The heel is a half sine over the move: zero at both ends, peak in the middle,
// signed by direction of travel. The ship leans and returns upright, so nothing
// carries into the next step.
import type { RailCell } from "./barbRail";

/** How long one step of the track takes to sail. */
export const SAIL_MS = 460;

/**
 * How far the hull leans at the middle of a move, in degrees. Tuned against
 * the ship (12px to 22px hull), not the track, since the rail's hex size varies
 * by more than 2x (see hexSizeFor).
 */
export const HEEL_DEG = 16;

export interface ShipPose {
  x: number;
  y: number;
  /** Degrees. Positive leans to starboard, the direction of increasing x. */
  rot: number;
}

/**
 * Ease for the slide: out-cubic, matching how other pieces settle (see the
 * drop). A linear slide looks dragged.
 */
export function easeOutCubic(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}

/**
 * Where the ship is, `t` of the way from one cell to the next. `t` is clamped,
 * since the last rAF frame rarely lands on exactly 1.
 */
export function sailPose(from: RailCell, to: RailCell, t: number): ShipPose {
  const k = Math.min(1, Math.max(0, t));
  const e = easeOutCubic(k);
  // The heel uses raw t, not eased; easing it would bunch the lean into the
  // first third and read as a flinch.
  const dir = Math.sign(to.x - from.x);
  return {
    x: from.x + (to.x - from.x) * e,
    y: from.y + (to.y - from.y) * e,
    rot: dir * HEEL_DEG * Math.sin(Math.PI * k),
  };
}
