// Tipping the robber over to read the number it is standing on.
//
// The robber stands on the number chip (see robberOnChip), hiding it, as on a
// physical table. Hovering tips it over and un-hovering stands it up. Every
// client already has every tile's number, so this reveals nothing secret (see
// Board3D).
//
// The pointer can change its mind at any instant, so the tip is reversible
// mid-flight: a leg from where the piece visibly is toward where it is wanted,
// `planTrip`'s redirect rule applied to an angle.
//
// Pure, like flip.ts and robberMotion.ts, so it tests with no GL context.
import { ROBBER_HALF_WIDTH } from "./flip";

/**
 * How far over the robber goes, in radians. Derived so the number is readable.
 *
 * In screen space at the default elevation (`CAMERA_TILT_DEG` = 56), a point at
 * ground offset `u` (away from the camera) and height `v` lands at
 * `u*sin(56) + v*cos(56)` = 0.829u + 0.559v, so the chip's far rim
 * (`CHIP_DISC_RADIUS` = 1.0) is at 0.829.
 *
 * Tipping about the far bottom edge (`peekPivot`), the lowest screen point is
 * the near bottom corner, moving from `-W` to `(W - 2W*cos t, 2W*sin t)` with
 * `W = ROBBER_HALF_WIDTH`. Clearing the rim at W = 0.675 needs:
 *
 *     0.560*(1 - 2 cos t) + 0.755*sin t  >  0.829
 *
 * which holds from about 68 degrees. 75 adds margin and stays short of flat
 * (90 reads as knocked over). Lower elevations clear sooner; near overhead the
 * robber barely covered the numerals in the first place.
 */
export const PEEK_TILT = (75 * Math.PI) / 180;

/**
 * How long the tip takes, and how long standing back up takes.
 *
 * In the board's usual range (chip turn 460ms, pulse 420, drop 380). Down is
 * quicker because the player is waiting to see the number; up is slower so it
 * reads as a piece being let go rather than sprung, and a quick sweep across
 * the robber gives one soft wobble.
 *
 * Full-travel times: a partial leg (a reversal) covers its shorter distance at
 * the same speed.
 */
export const PEEK_TIP_MS = 240;
export const PEEK_RIGHT_MS = 380;

/**
 * How long a tapped tip stays down before it puts itself back. Touch has no
 * hover, so the gesture is a tap; a second tap ends it, or this does. Four
 * seconds is enough to read a digit and short enough that a stray tap is
 * forgotten within the turn.
 */
export const PEEK_TAP_HOLD_MS = 4000;

/**
 * The tip in progress, or the tip being held.
 *
 * `from`/`to` rather than a start stamp because this motion can reverse: it
 * answers "where between upright and tipped, heading which way", which still
 * has an answer when the pointer leaves halfway.
 *
 * `from === to` is the settled state, also used for reduced motion: a
 * zero-length leg is already over, so nothing animates.
 */
export interface Peek {
  /** Progress when this leg began. 0 is upright, 1 is fully tipped. */
  from: number;
  /** Where this leg is heading: 1 while the pointer is on the piece, else 0. */
  to: 0 | 1;
  /** Shared-clock time this leg began. */
  start: number;
  /**
   * Which horizontal axis to turn about, as `flipAxisY`'s azimuth. Read off the
   * camera when a tip begins and held while the piece is off vertical, so
   * orbiting doesn't swing it sideways (as `fireChipFlip` samples once per
   * roll).
   */
  axisY: number;
}

/** Ease in and out, the same smoothstep the flip turns on. */
const smooth = (t: number): number => t * t * (3 - 2 * t);

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** The full-travel duration of a leg heading toward `to`. */
function legMs(to: 0 | 1): number {
  return to === 1 ? PEEK_TIP_MS : PEEK_RIGHT_MS;
}

/**
 * How far over the piece is at `nowMs`, from 0 (upright) to 1 (fully tipped).
 *
 * Linear in time, eased later in `peekTilt`, so a reversal resumes from the
 * exact angle shown.
 *
 * A negative elapsed (a rebuilt rig's ticker restarts at zero, see
 * `stillFlipping`) is treated as landed, so the leg terminates instead of
 * holding the ticker forever.
 */
export function peekProgress(peek: Peek | null, nowMs: number): number {
  if (!peek) return 0;
  const span = Math.abs(peek.to - peek.from);
  if (span <= 0) return peek.to;
  const elapsed = nowMs - peek.start;
  if (elapsed < 0) return peek.to;
  if (elapsed === 0) return peek.from;
  const travelled = elapsed / legMs(peek.to);
  return clamp01(peek.to > peek.from ? peek.from + travelled : peek.from - travelled);
}

/**
 * The angle to hand `InstancePose.tilt`, in radians.
 *
 * Positive: about `flipAxisY`'s axis that carries the piece's top away from the
 * viewer. The other way would lay it over the number it should reveal.
 * (`flipAxisY` describes the same rotation as the near edge rising, which for
 * a tall piece is falling away.)
 */
export function peekTilt(peek: Peek | null, nowMs: number): number {
  return PEEK_TILT * smooth(peekProgress(peek, nowMs));
}

// Playing dead uses the peek's own angle. `PEEK_TILT` is derived, and a second
// angle would rest the piece at a different height from the one players know
// from hovering, and lift it whenever the dead flag was dropped.

/** Whether the piece is still moving, and so whether the ticker is still needed. */
export function peekMoving(peek: Peek | null, nowMs: number): boolean {
  if (!peek) return false;
  const span = Math.abs(peek.to - peek.from);
  if (span <= 0) return false;
  const elapsed = nowMs - peek.start;
  if (elapsed < 0) return false;
  return elapsed < legMs(peek.to) * span;
}

/**
 * The leg the piece should be running, given what the pointer is now asking.
 *
 * The same three cases as `planTrip`:
 *
 *  - Already heading there: return the leg unchanged, start stamp included.
 *    This is every pointermove on the piece; a fresh leg would restart the tip
 *    each sample.
 *  - A reversal: a new leg from where the piece visibly is.
 *  - Nothing to do: no leg, so an un-hover on an upright piece costs nothing.
 *
 * `axisY` is adopted only when starting from upright; a reversal keeps the
 * original axis.
 */
export function planPeek(
  peek: Peek | null,
  want: boolean,
  axisY: number,
  nowMs: number,
): Peek | null {
  const to: 0 | 1 = want ? 1 : 0;
  const from = peekProgress(peek, nowMs);
  // Upright and wanted upright: no leg, so an idle board carries no peek state.
  if (to === 0 && from === 0) return null;
  if (peek && peek.to === to) return peek;
  return { from, to, start: nowMs, axisY: from === 0 ? axisY : (peek?.axisY ?? axisY) };
}

/**
 * The same answer with no motion in it, for `prefers-reduced-motion`: a
 * zero-length leg, so the piece is simply tipped or upright.
 *
 * Unlike the chip flip and the somersault, which are skipped under the
 * preference because the dice, log and cards say the same thing, this is the
 * information itself. So the motion goes and the reveal stays.
 */
export function stillPeek(want: boolean, axisY: number): Peek | null {
  if (!want) return null;
  return { from: 1, to: 1, start: 0, axisY };
}

/**
 * Where the turn's axis passes through the board, as an offset from the
 * robber's placement.
 *
 * The far bottom edge in the falling direction, where a pushed object pivots.
 * About the base centre the near side would still cover the numerals at 75
 * degrees; rolling over the far edge carries the footprint off the chip.
 *
 * The direction is the camera's flattened view direction: for
 * `axis = (cos a, 0, sin a)`, the top travels along
 * `axis x (0,1,0) = (-sin a, 0, cos a)`.
 *
 * World units: `ROBBER_HALF_WIDTH` is the drawn half-width (0.45 times
 * `ROBBER_SCALE`), and `InstancePose`'s pivot offsets apply after the
 * placement's scale.
 */
export function peekPivot(axisY: number): { x: number; z: number } {
  return { x: -Math.sin(axisY) * ROBBER_HALF_WIDTH, z: Math.cos(axisY) * ROBBER_HALF_WIDTH };
}
