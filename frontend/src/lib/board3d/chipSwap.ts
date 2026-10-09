// Two number chips trade places (the Inventor).
//
// Board numbers are otherwise fixed, so `chips.ts` keys a chip by its hex and
// the number is part of `staticBoardKey`. Without this the two hexes would
// simply show different numbers on the next frame.
//
// The chips travel to each other's hex along one shared ellipse (major axis
// the line between the hexes), half a lap apart. On a straight line they would
// meet head-on; on the ellipse they are always diametrically opposite, and the
// closest they come is the full minor axis as they pass.
//
// Pure, like `flip.ts` and `markerMotion.ts`: no three.js, so it tests without
// a GL context. Board3D owns the instance matrices; this module owns where a
// chip is at time t.
import type { Vec3 } from "./coords";

/** How the pair of chips travel. */
export interface SwapSpec {
  /** The whole exchange, in milliseconds. */
  ms: number;
  /**
   * The ellipse's semi-minor axis, as a fraction of the distance between the
   * two hex centres.
   *
   * A quarter, so the oval is twice as long as wide. A ratio rather than world
   * units because the near case matters: adjacent hexes are 5.45 apart, and a
   * fixed bow sized for a long swap would be flat there. At this ratio the
   * shortest swap bows 1.36 off the line and the chips pass 2.7 apart.
   */
  minorRatio: number;
  /** How high the chips rise at the widest point, as a fraction of the span. */
  arcRatio: number;
  /** Floor on that rise. */
  arcMin: number;
  /** Ceiling on it. */
  arcMax: number;
}

/**
 * The exchange.
 *
 * 560ms against the chip flip's 460 (`CHIP_FLIP`): the chips cover real
 * distance and two things move at once. It happens at most once a game.
 *
 * The arc reuses `markerMotion`'s numbers: `arcRatio` is BOARD_PACE's 0.22 and
 * `arcMax` is `ROBBER_TRAVEL`'s 1.8, since the chips cross the same air as the
 * robber.
 *
 * `arcMin` is `CHIP_FLIP.lift`, the least rise that clears the slab (see
 * flip.ts). It does not bind at the current lattice (the closest pair gets
 * 1.20 from the ratio) but guards a tighter lattice or a lower tuning.
 */
export const CHIP_SWAP: SwapSpec = {
  ms: 560,
  minorRatio: 0.25,
  arcRatio: 0.22,
  arcMin: 1.15,
  arcMax: 1.8,
};

/** Where a travelling chip is, relative to the placement it was built at. */
export interface SwapPose {
  /** World-space displacement in the horizontal plane. */
  offsetX: number;
  offsetZ: number;
  /** World units above the resting height. */
  lift: number;
  /** True once the exchange is over and the caller can stop ticking. */
  done: boolean;
}

/**
 * Standing on its own hex with nothing left to draw.
 *
 * Every field is the built placement, so `poseInstanceAt` reproduces the
 * instanced matrix exactly. The ticker poses one frame past the end, so any
 * drift would be a permanent offset (the same contract as `AT_REST` and
 * `LANDED`).
 */
const SEATED: SwapPose = { offsetX: 0, offsetZ: 0, lift: 0, done: true };

/** Ease in and out, as the flip and the carry do. */
const smooth = (t: number): number => t * t * (3 - 2 * t);

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/** How far apart the two hexes are, horizontally. Both chips seat level. */
function span(from: Vec3, to: Vec3): number {
  return Math.hypot(to[0] - from[0], to[2] - from[2]);
}

/** How high the pair rise at the widest point of the oval. */
export function swapArc(spec: SwapSpec, from: Vec3, to: Vec3): number {
  return clamp(spec.arcRatio * span(from, to), spec.arcMin, spec.arcMax);
}

/**
 * Where one chip of the pair is, `elapsedMs` into the exchange.
 *
 * Called once per chip with its own ends: `to` is where this chip finishes
 * (its own hex, where the layer built it, showing its new number) and `from`
 * is the other hex. The two calls pass the same points in opposite orders,
 * which is all that puts the chips half a lap apart.
 *
 * In the pair's shared frame:
 *
 *   u = the unit vector from `from` to `to`; v = u turned a quarter turn.
 *   The ellipse is centred on the midpoint M, with semi-major |from-to|/2
 *   along u and semi-minor `minorRatio * |from-to|` along v. The chip runs
 *   theta from pi (`from`) to 2pi (`to`), half the ellipse.
 *
 * Swapping `from` and `to` negates u and v, so the other chip is this one
 * reflected through M at every theta.
 *
 * v is `(-u.z, u.x)`, turning u toward +z. The camera looks down -z, so +z is
 * the bottom of the screen and the lap reads as clockwise. The oval is fixed
 * in world space (legible from any angle), so "clockwise" holds for the
 * default overhead view.
 *
 * Vertically it is a half sine on the eased time, unlike `tripPose`: the chips
 * have no landing squash, so the descent must arrive at rest. Easing both axes
 * together also puts the highest lift at the widest bow.
 *
 * At or past the end it is `SEATED` exactly; before the start it holds at the
 * other hex.
 */
export function swapPose(spec: SwapSpec, from: Vec3, to: Vec3, elapsedMs: number): SwapPose {
  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  const d = Math.hypot(dx, dz);
  // A degenerate pair would divide by zero, and NaN in an instance matrix
  // blanks the whole InstancedMesh.
  if (d === 0 || elapsedMs >= spec.ms) return SEATED;
  if (elapsedMs <= 0) {
    return { offsetX: -dx, offsetZ: -dz, lift: 0, done: false };
  }

  const u = smooth(elapsedMs / spec.ms);
  const theta = Math.PI + Math.PI * u;
  const ux = dx / d;
  const uz = dz / d;
  // A quarter turn toward +z: clockwise on screen. See above.
  const vx = -uz;
  const vz = ux;
  const major = d / 2;
  const minor = spec.minorRatio * d;
  const along = major * Math.cos(theta);
  const across = minor * Math.sin(theta);
  // Relative to `to`, at M + major*u, so the offset is exactly zero at
  // theta = 2pi.
  return {
    offsetX: (along - major) * ux + across * vx,
    offsetZ: (along - major) * uz + across * vz,
    lift: swapArc(spec, from, to) * Math.sin(Math.PI * u),
    done: false,
  };
}

/**
 * Whether an exchange stamped at `startMs` is still running at `nowMs`.
 *
 * Both edges, as in `stillFlipping`: a rebuild long after must not replay the
 * swap, and a rebuilt rig's fresh ticker starts at zero, so an old stamp reads
 * as future. An unguarded negative elapsed would leave the chips swapped and a
 * subscriber pinned on the ticker forever.
 */
export function stillSwapping(spec: SwapSpec, startMs: number, nowMs: number): boolean {
  const elapsed = nowMs - startMs;
  return elapsed >= 0 && elapsed < spec.ms;
}
