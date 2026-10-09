// A neutral marker (robber or merchant) is picked up, carried, and set down.
//
// These pieces are moved, not built, so they are not drops (see drop.ts). The
// carry shows where the piece came from, so a player who glanced away can see
// which hex stopped producing or lost its trade rate.
//
// The mechanism (arc, easing, landing, redirect) is shared; per-piece numbers
// are a `TravelSpec`. The robber's pulse stays in robberMotion.ts.
//
// Pure, so it tests without a GL context. Board3D owns the instance matrices;
// this module owns where a marker is at time t.
import type { Vec3 } from "./coords";

/**
 * How one marker travels.
 *
 * The arc has to scale with the piece being lifted, so it is per-spec. The
 * timing is the same for both markers but lives here too so a future marker
 * can differ.
 */
export interface TravelSpec {
  /**
   * The fixed part of a trip, in milliseconds.
   *
   * Duration scales with distance: adjacent hex centres are
   * `sqrt(3) * LATTICE_SIZE` = 5.45 world units apart and a 10-player board is
   * nine hexes across, so any fixed total is wrong at one end. This is the
   * pick-up-and-put-down every move pays.
   */
  baseMs: number;
  /** Milliseconds per world unit travelled. */
  msPerUnit: number;
  /** Floor: a nudge to the hex next door still reads as a carry. */
  minMs: number;
  /**
   * Ceiling: right across a 10-player board. Longer and the player is waiting
   * on it.
   */
  maxMs: number;
  /** The landing. Same as DROP_SETTLE_MS so all landings match. */
  settleMs: number;
  /** Same as drop.ts's SQUASH. */
  settleSquash: number;
  /** How high the arc rises, as a fraction of how far it goes. */
  arcRatio: number;
  /** A move too short to earn an arc still gets one, or it reads as a slide. */
  arcMin: number;
  /**
   * Ceiling on the arc. As in drop.ts: high enough to read, low enough to stay
   * inside a framed board and the shadow light's frustum.
   */
  arcMax: number;
}

/** The timing every marker shares, spread into both specs below. */
const BOARD_PACE = {
  baseMs: 160,
  msPerUnit: 32,
  minMs: 320,
  maxMs: 620,
  settleMs: 120,
  settleSquash: 0.07,
  arcRatio: 0.22,
} as const;

/**
 * The robber: 1.5 world units of art drawn at 1.5, so 2.25 units tall.
 *
 * `arcMax` is near DROP_HEIGHT's 1.6, the tallest anything on this board is
 * thrown; `arcMin` keeps a one-hex nudge from reading as a slide.
 */
export const ROBBER_TRAVEL: TravelSpec = { ...BOARD_PACE, arcMin: 0.85, arcMax: 1.8 };

/**
 * The merchant: a stall 1.085 units tall drawn at 1.5, so 1.63 units, 0.72 of
 * the robber.
 *
 * Same pace, landing and distance-to-arc ratio, so an adjacent hop arcs to the
 * same height as the robber's. Only the two bounds are scaled by 0.72, since
 * at the extremes the arc tracks the piece's size rather than the distance.
 */
export const MERCHANT_TRAVEL: TravelSpec = { ...BOARD_PACE, arcMin: 0.62, arcMax: 1.3 };

/** A marker on its way from one resting spot to another. */
export interface Trip {
  /** Where it left, in world space: the full seated position, not a hex. */
  from: Vec3;
  /** Where it is going. Also the position the built instance already sits at. */
  to: Vec3;
  /** Shared-clock time the trip began. See anim.ts's `now`. */
  start: number;
}

/** Where a marker is, relative to the resting placement it was built at. */
export interface TripPose {
  /** World-space displacement from the resting position. */
  offsetX: number;
  lift: number;
  offsetZ: number;
  /**
   * Vertical scale about the ground it stands on; the caller widens the
   * horizontals by `1/sqrt` of it so the piece keeps its volume. 1 except
   * during the landing.
   */
  squashY: number;
}

/** A trip pose plus whether the ticker still has anything to do. */
export interface MarkerPose extends TripPose {
  done: boolean;
}

/**
 * The identity pose.
 *
 * `poseInstanceAt` reproduces the built matrix from it bit for bit, so the
 * animation is only ever an offset that ends at zero and a marker moved many
 * times never drifts.
 */
export const AT_REST: TripPose = { offsetX: 0, lift: 0, offsetZ: 0, squashY: 1 };

/** A marker standing where it belongs, with nothing left to draw. */
export const MARKER_RESTING: MarkerPose = { ...AT_REST, done: true };

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/**
 * How far the trip goes across the board. Horizontal only: the ends can differ
 * by a chip's height, which shouldn't change the duration.
 */
function span(from: Vec3, to: Vec3): number {
  return Math.hypot(to[0] - from[0], to[2] - from[2]);
}

/** How long the carry itself takes, before the landing. */
export function travelMs(spec: TravelSpec, from: Vec3, to: Vec3): number {
  return clamp(spec.baseMs + span(from, to) * spec.msPerUnit, spec.minMs, spec.maxMs);
}

/** How high above the destination the arc peaks. */
export function arcHeight(spec: TravelSpec, from: Vec3, to: Vec3): number {
  return clamp(spec.arcRatio * span(from, to), spec.arcMin, spec.arcMax);
}

/** Carry plus landing: the whole trip. */
export function tripMs(spec: TravelSpec, from: Vec3, to: Vec3): number {
  return travelMs(spec, from, to) + spec.settleMs;
}

/**
 * Where the marker is `nowMs` into `trip`, relative to its destination.
 *
 * It arcs so it clears the tiles and chips in between. Horizontally it is a
 * smoothstep (a carried piece starts and ends at rest, unlike drop.ts's free
 * fall). Vertically it is a half sine on the raw t, so the apex is at the
 * midpoint and the piece comes down fast into the settle squash.
 *
 * No extrapolation: before the start it holds at the origin, and at or past the
 * end it is exactly `AT_REST`. Same contract as `dropPose`.
 */
export function tripPose(spec: TravelSpec, trip: Trip, nowMs: number): TripPose {
  const { from, to } = trip;
  const travel = travelMs(spec, from, to);
  const e = nowMs - trip.start;
  if (e >= travel + spec.settleMs) return AT_REST;
  if (e <= 0) {
    return {
      offsetX: from[0] - to[0],
      lift: from[1] - to[1],
      offsetZ: from[2] - to[2],
      squashY: 1,
    };
  }
  if (e < travel) {
    const t = e / travel;
    const u = t * t * (3 - 2 * t);
    return {
      offsetX: (from[0] - to[0]) * (1 - u),
      lift: (from[1] - to[1]) * (1 - u) + arcHeight(spec, from, to) * Math.sin(Math.PI * t),
      offsetZ: (from[2] - to[2]) * (1 - u),
      squashY: 1,
    };
  }
  // One half-sine over the settle, no overshoot: drop.ts's landing.
  const t = (e - travel) / spec.settleMs;
  return { ...AT_REST, squashY: 1 - spec.settleSquash * Math.sin(Math.PI * t) };
}

/**
 * The absolute world point a trip has reached, for a trip that is about to be
 * redirected. See `planTrip`.
 */
export function tripPointAt(spec: TravelSpec, trip: Trip, nowMs: number): Vec3 {
  const p = tripPose(spec, trip, nowMs);
  return [trip.to[0] + p.offsetX, trip.to[1] + p.lift, trip.to[2] + p.offsetZ];
}

/** Whether `trip` has anything left to draw at `nowMs`. */
export function tripRunning(spec: TravelSpec, trip: Trip | null, nowMs: number): boolean {
  return !!trip && nowMs - trip.start < tripMs(spec, trip.from, trip.to);
}

/**
 * The whole pose for a marker whose only motion is travel (the merchant), plus
 * whether the ticker can stop. The robber composes this with its pulse; see
 * robberMotion.ts.
 */
export function markerPose(spec: TravelSpec, trip: Trip | null, nowMs: number): MarkerPose {
  if (!trip) return MARKER_RESTING;
  return { ...tripPose(spec, trip, nowMs), done: !tripRunning(spec, trip, nowMs) };
}

/**
 * The trip that is still running at `nowMs`, with its original start time.
 *
 * Like `stillFalling` in drop.ts: every view change (a chat message, a trade
 * offer) rebuilds the board's meshes, and without this a carry in flight would
 * be cut short or restart.
 */
export function stillTrip(spec: TravelSpec, trip: Trip | null, nowMs: number): Trip | null {
  return tripRunning(spec, trip, nowMs) ? trip : null;
}

/** Two resting spots that are the same spot, allowing for float drift. */
function samePlace(a: Vec3, b: Vec3): boolean {
  return (
    Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6 && Math.abs(a[2] - b[2]) < 1e-6
  );
}

/**
 * The trip a rebuild should be animating, given where the marker was last time.
 *
 *  - `prev` is null: a state load (spectator, rejoin, replay scrub) or the
 *    merchant's first appearance. No trip, as with `newlyPlaced(null, ...)`.
 *  - Not moved: return the trip already in flight, original start time
 *    included, so the arc continues.
 *  - Moved: a new trip from where the marker visibly is, so a redirect mid-air
 *    (a knight right after a 7, a second merchant card) doesn't snap backwards.
 *
 * `to` is the caller's `next`, unmodified, so the marker lands exactly where
 * the placement layer put it.
 */
export function planTrip(
  spec: TravelSpec,
  prev: Vec3 | null,
  next: Vec3,
  inFlight: Trip | null,
  nowMs: number,
): Trip | null {
  if (!prev) return null;
  if (samePlace(prev, next)) return inFlight;
  return { from: inFlight ? tripPointAt(spec, inFlight, nowMs) : prev, to: next, start: nowMs };
}
