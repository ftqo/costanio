// The pieces that turn over when the dice land.
//
// Every chip showing the rolled number turns over: up off its tile, one full
// revolution, back down, all at once. The chip under the robber stays still.
// On a seven, which no chip carries, the robber turns instead.
//
// One motion, two specs, like `markerMotion` with `ROBBER_TRAVEL` and
// `MERCHANT_TRAVEL`. The pieces clip against the board in opposite ways (see
// the specs), so one lift cannot serve both.
//
// Pure, like drop.ts and robberMotion.ts: no three.js, so it tests with no GL
// context. Board3D owns the instance matrices.

/**
 * How one piece turns over.
 *
 * A piece turning about its own middle swings below that middle by more than
 * it stands above it, and the board is opaque, so `lift` is derived from the
 * art to keep the piece out of the slab (see the specs and the clearance test).
 */
export interface FlipSpec {
  /** The whole turn, in milliseconds. */
  ms: number;
  /** How far the piece rises at the top of the turn, in world units. */
  lift: number;
}

/**
 * The chip disc's radius, measured off the shipped art.
 *
 * `chips.glb`, node `Chip_08_1_body`: the disc spans +/-1.0 in x and z. If the
 * art changes size, re-derive `CHIP_FLIP`'s lift; the clearance test pins both.
 */
export const CHIP_DISC_RADIUS = 1.0;

/**
 * Half the chip's thickness, measured off the same art.
 *
 * The loaded subset (`Chip_08_*` body, face, numeral and pips) spans 0.19 in y,
 * and Board3D turns the chip about its middle, so at rest the pivot is this far
 * above the tile. Board3D measures the same value off the asset at build time;
 * this copy lets the derivation and the clearance test run without a loader.
 */
export const CHIP_HALF_THICKNESS = 0.095;

/**
 * The robber's half-extents as drawn, measured off `pieces.glb`.
 *
 * `Robber_body` spans 1.5 in y and 0.9 across, drawn at `ROBBER_SCALE` (1.5),
 * so 2.25 tall and 1.35 wide on the board.
 */
export const ROBBER_HALF_HEIGHT = 1.125;
export const ROBBER_HALF_WIDTH = 0.675;

/**
 * The chips.
 *
 * 460ms, close to the robber's pulse (420) and a piece's drop (380): this runs
 * every turn and must not hold the player up.
 *
 * The lift is derived, because a chip that does not clear its tile turns
 * through an opaque slab. From `chips.glb`: the disc is 2.0 across
 * (`CHIP_DISC_RADIUS`; 1.76 is the face inlay, not the body), and its middle
 * sits `CHIP_HALF_THICKNESS` above the tile face. A disc of radius R turning
 * about a horizontal diameter puts its rim `R*|sin tilt|` below the pivot, so
 * the lift must satisfy `lift >= R*|sin tilt| - 0.095` at every instant. The
 * binding moment is not the apex: the turn is eased and the hop is not, so the
 * chip is edge-on about a third of the way through while the hop is still
 * climbing. Sampling the curves gives a minimum of 1.09 for a thin disc, a bit
 * more with thickness; 1.15 adds margin. That is about a fifth of a hex (5.2
 * flat-to-flat).
 */
export const CHIP_FLIP: FlipSpec = { ms: 460, lift: 1.15 };

/**
 * The robber, on a seven.
 *
 * 520ms, a little slower than the chips: it turns alone.
 *
 * The lift is derived as the chip's is and comes out smaller, because the
 * robber is tall and narrow (half-height 1.125, half-width 0.675), so its own
 * middle is most of the headroom. The worst angle alone suggests 0.187 (corner
 * at `sqrt(1.125^2 + 0.675^2)` = 1.312 against 1.125 of headroom), but the worst
 * moment is later: the turn is eased and the hop is not, so at 0.85 of the way
 * the piece is still far from upright while the hop has nearly landed. Sampling
 * the curves, that needs 0.376; 0.4 adds a little margin.
 */
export const ROBBER_FLIP: FlipSpec = { ms: 520, lift: 0.4 };

/** Where a flipping piece is, relative to where it rests. */
export interface FlipPose {
  /** World units above its resting position. */
  lift: number;
  /** How far through the turn, in radians. 0 and 2pi are both upright. */
  tilt: number;
  /** True once the turn is over and the caller can stop ticking. */
  done: boolean;
}

/** At rest and finished. Differs from at rest and waiting; see below. */
const LANDED: FlipPose = { lift: 0, tilt: 0, done: true };
/**
 * At rest and about to go.
 *
 * The carrier stops on the frame a pose reports `done`, so a flip armed on the
 * frame the clock reads its start time must not report done.
 */
const WAITING: FlipPose = { lift: 0, tilt: 0, done: false };

/** Ease in and out. Smoothstep: a turn with weight at both ends. */
const smooth = (t: number): number => t * t * (3 - 2 * t);

/**
 * A piece's pose `elapsedMs` into its flip.
 *
 * The turn is smoothstepped so it starts and stops with weight. The hop is a
 * half sine on the raw time, so it peaks with the piece edge-on rather than
 * lagging the eased turn, and is exactly zero at both ends.
 */
export function flipPose(spec: FlipSpec, elapsedMs: number): FlipPose {
  if (elapsedMs >= spec.ms) return LANDED;
  if (elapsedMs <= 0) return WAITING;
  const t = elapsedMs / spec.ms;
  return {
    lift: spec.lift * Math.sin(Math.PI * t),
    tilt: Math.PI * 2 * smooth(t),
    done: false,
  };
}

/**
 * Whether a flip stamped at `startMs` is still turning at `nowMs`.
 *
 * Asked when a board is rebuilt mid-turn, to decide whether to hand the piece
 * back to the ticker or forget it.
 *
 * The clock is the ticker's own accumulator, which starts at zero, and a
 * rebuilt rig brings a new ticker. A flip stamped by the previous one can read
 * as starting in the future; armed, `flipPose` would report it not-yet-started
 * forever and its subscription would keep the ticker redrawing every frame.
 * So a future start is rejected as well as an expired one.
 */
export function stillFlipping(spec: FlipSpec, startMs: number, nowMs: number): boolean {
  const elapsed = nowMs - startMs;
  return elapsed >= 0 && elapsed < spec.ms;
}

/**
 * Which horizontal axis to turn about, given where the camera is looking.
 *
 * The board orbits, so the axis is the ground-plane direction square to the
 * camera's view; a fixed axis would read as a barrel roll from some sides.
 *
 * Of the two perpendiculars, this is the one for which a positive tilt lifts
 * the near edge, tipping the piece toward the viewer. With n = -dir, the
 * vertical component of `axis x n` is `axis.z * n.x - axis.x * n.z`: +1 for
 * `axis = (dirZ, 0, -dirX)`, -1 for the other.
 *
 * `dirX`/`dirZ` are the view direction flattened onto the ground; y is not
 * read, and it need not be normalised.
 */
export function flipAxisY(dirX: number, dirZ: number): number {
  return Math.atan2(-dirX, dirZ);
}
