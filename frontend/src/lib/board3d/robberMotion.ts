// The robber is carried, it answers when you point at it, and it turns over on
// a seven.
//
// All pure, so they test without a GL context. Board3D owns the instance
// matrix and nothing else.
//
//  1. Travel lives in markerMotion.ts, shared with the merchant; the robber's
//     numbers are `ROBBER_TRAVEL`.
//
//  2. Pulse. In `robber` and `chaserobber` mode the robber's own hex isn't a
//     legal destination, so a click there hits no target and would otherwise
//     get no response. The robber pulses to say "I'm already here". It is
//     raised on the client because the client never sends that command, and
//     the server's error for it carries no location anyway.
//
//  3. The seven's turn, here only as a clock; the turn itself is `flip.ts`,
//     shared with the number chips. No chip carries a seven, so the robber
//     answers it instead.
//
//  4. The peek (`robberPeek.ts`): hovering tips the robber off its chip so the
//     blocked number can be read. The pose carries it and `done` accounts for
//     it. A pointer can reverse at any instant, so it keeps a from/to leg
//     rather than a start stamp.
//
//  5. The drop, borrowed from drop.ts. The player who moved the robber already
//     watched it travel under their pointer (see `carryOnHover`), so for them
//     it just lands; everyone else sees the carry.
//
// They all compose (one exception, at `turning` below): a knight can start a
// trip while a pulse decays, and a seven can turn the piece while the player
// drags it.
import {
  AT_REST,
  ROBBER_TRAVEL,
  stillTrip,
  tripPose,
  tripRunning,
  type Trip,
  type TripPose,
} from "./markerMotion";
import { ROBBER_FLIP, flipPose, stillFlipping } from "./flip";
import { peekMoving, peekTilt, type Peek } from "./robberPeek";
import { dropPose, DROP_TOTAL_MS } from "./drop";

/** Whether the commit drop still has anything to draw. */
function dropping(anim: RobberAnim, nowMs: number): boolean {
  return anim.drop !== null && anim.drop !== undefined && nowMs - anim.drop < DROP_TOTAL_MS;
}

/**
 * The whole pulse, in milliseconds: one beat out and back at ~210ms each. It
 * answers a click, so it must land while the player is still waiting.
 */
export const ROBBER_PULSE_MS = 420;

/** How much bigger the robber gets at the top of the pulse. */
export const ROBBER_PULSE_GROW = 0.18;

/** Everything the robber is doing right now. The parts are independent. */
export interface RobberAnim {
  trip: Trip | null;
  /** Shared-clock time the pulse began, or null if it is not pulsing. */
  pulse: number | null;
  /**
   * Shared-clock time the seven's turn began, or null if it is not turning.
   * No chip carries a seven, so the robber answers it with the chips' turn
   * (see flip.ts). Separate from the pulse because both can be true at once.
   */
  flip: number | null;
  /**
   * The hover tip, or null when the pointer is nowhere near the piece.
   * Optional because it is a state, not an event: a finished tip still holds
   * the piece over.
   */
  peek?: Peek | null;
  /**
   * The robber is playing dead: the tip is latched down at the peek's angle
   * (see robberPeek) rather than held by a pointer. No clock of its own; it
   * changes a seven into a spin on the spot instead of a somersault. See the
   * renderer's `frame`.
   */
  dead?: boolean;
  /**
   * Shared-clock time this viewer's own move landed the piece, or null. In
   * practice exclusive with `trip`, depending on whether this viewer made the
   * move; the board picks (Board3D's `startRobber`).
   */
  drop?: number | null;
}

/** The robber standing where it belongs, doing nothing. */
export const ROBBER_STILL: RobberAnim = {
  trip: null,
  pulse: null,
  flip: null,
  peek: null,
  dead: false,
  drop: null,
};

/** Where the robber is, relative to the resting placement it was built at. */
export interface RobberPose extends TripPose {
  /**
   * Uniform scale about the ground it stands on. Volume is not conserved: a
   * pulse is meant to grow.
   */
  scale: number;
  /**
   * How far through the seven's turn, in radians, about a horizontal axis.
   * The renderer fills in the axis (from the camera) and the pivot (the
   * piece's middle, from the art). See `flipAxisY`.
   */
  tilt: number;
  /**
   * How far the hover tip has the piece over, in radians, about the axis the
   * tip began with and a pivot at its far bottom edge. Separate from `tilt`
   * because the pivots differ and one instance matrix has one pivot; the
   * renderer picks using `turning`.
   */
  peek: number;
  /**
   * True while the somersault has the piece, which is when the tip yields. A
   * seven during a hover is rare and the somersault is the louder gesture; the
   * tip resumes where its leg has reached when the turn lands.
   */
  turning: boolean;
  /** True once none of the motions has anything left to do. */
  done: boolean;
}

/** The robber at rest and quiet, what an unanimated board shows. */
export const ROBBER_RESTING: RobberPose = {
  ...AT_REST,
  scale: 1,
  tilt: 0,
  peek: 0,
  turning: false,
  done: true,
};

/**
 * The uniform scale `elapsedMs` into a pulse.
 *
 * One sine period under a linear decay: about +13.5% a quarter of the way in,
 * back through 1 at the midpoint, about -4.5% at three quarters, and exactly 1
 * at the end, so the ticker can stop.
 */
export function robberPulseScale(elapsedMs: number): number {
  if (elapsedMs <= 0 || elapsedMs >= ROBBER_PULSE_MS) return 1;
  const t = elapsedMs / ROBBER_PULSE_MS;
  return 1 + ROBBER_PULSE_GROW * Math.sin(2 * Math.PI * t) * (1 - t);
}

function pulseRunning(anim: RobberAnim, nowMs: number): boolean {
  if (anim.pulse === null) return false;
  const elapsed = nowMs - anim.pulse;
  // Bounded below too: a rebuilt rig's ticker starts at zero, so an old stamp
  // reads as in the future and would never report done (see `stillFlipping`).
  return elapsed >= 0 && elapsed < ROBBER_PULSE_MS;
}

function flipRunning(anim: RobberAnim, nowMs: number): boolean {
  return anim.flip !== null && stillFlipping(ROBBER_FLIP, anim.flip, nowMs);
}

/**
 * The whole pose: travel, pulse and the seven's turn together, plus whether
 * anything is left. The lifts add, so turning doesn't drop the piece out of
 * its arc.
 */
export function robberPose(anim: RobberAnim, nowMs: number): RobberPose {
  const trip = anim.trip ? tripPose(ROBBER_TRAVEL, anim.trip, nowMs) : AT_REST;
  const scale = anim.pulse === null ? 1 : robberPulseScale(nowMs - anim.pulse);
  const flip = anim.flip === null ? null : flipPose(ROBBER_FLIP, nowMs - anim.flip);
  const peek = anim.peek ?? null;
  // The drop adds to the trip like the flip's lift. In practice a viewer gets
  // one or the other.
  const drop = anim.drop === null || anim.drop === undefined ? null : dropPose(nowMs - anim.drop);
  return {
    ...trip,
    squashY: trip.squashY * (drop?.squashY ?? 1),
    lift: trip.lift + (drop?.lift ?? 0) + (flip?.lift ?? 0),
    scale,
    tilt: flip?.tilt ?? 0,
    peek: peekTilt(peek, nowMs),
    turning: flipRunning(anim, nowMs),
    // The tip counts only while moving; an arrived tip holds for the whole
    // hover, and counting it would keep the ticker redrawing a still scene.
    done:
      !tripRunning(ROBBER_TRAVEL, anim.trip, nowMs) &&
      !pulseRunning(anim, nowMs) &&
      !flipRunning(anim, nowMs) &&
      !peekMoving(peek, nowMs) &&
      !dropping(anim, nowMs),
  };
}

/**
 * What is still running at `nowMs`, with its original start times. Like
 * `stillTrip`, for each part independently: a pulse can outlive a carry, and a
 * seven's turn can outlive its pulse.
 */
export function stillMoving(anim: RobberAnim, nowMs: number): RobberAnim {
  return {
    trip: stillTrip(ROBBER_TRAVEL, anim.trip, nowMs),
    pulse: pulseRunning(anim, nowMs) ? anim.pulse : null,
    flip: flipRunning(anim, nowMs) ? anim.flip : null,
    // Carried whole: it follows the pointer, and a rebuild isn't the pointer
    // letting go.
    peek: anim.peek ?? null,
    dead: anim.dead ?? false,
    // Expires like the other motions: it has an end.
    drop: dropping(anim, nowMs) ? (anim.drop ?? null) : null,
  };
}
