// The knight's sword: what it says, and how it moves when that changes.
//
// Every knight holds one, and its two states show activation: dull steel and
// pointed down at ease, gold and raised once the knight is ready.
//
// Four things happen to a sword:
//
//  1. It is raised when its knight is activated: the blade sweeps from the
//     resting lean to vertical about a horizontal axis through the grip, in
//     the same beat as the knight's hop (knightMotion.ts) and the
//     `sound_knight_ready` cue.
//  2. It grows with the knight on promotion. `planKnights` keeps level out of
//     the key so a promotion swaps the model in place rather than re-dropping.
//  3. It comes on guard while the knight is hovered, so the blade moves with
//     the body's swell. See `swordGuardTilt`.
//  4. It is lowered when the barbarians land, the only deactivation the board
//     animates; see `swordLowerPose`.
//
// The resting pose is baked into the art, never produced by a pose function.
// Under `prefers-reduced-motion` the ticker never calls back, not even at
// t = 0, so a sword lowered only by a pose would render raised on every
// inactive knight. The blend ships two objects per level
// (`Knight_sword_<level>_{dark,gold}`), the dark one already turned
// `SWORD_REST_TILT` about its grip, and `Board3D` picks one at build time from
// `active`. Every pose here is the identity at the end of its animation.
//
// Pure, like drop.ts, knightMotion.ts and flip.ts: no three.js, so it tests
// with no GL context. `Board3D` owns the instance matrices.
import { DROP_BULK_LIMIT, DROP_SETTLE_MS } from "./drop";

/**
 * Where each knight's hand is, in the art's own space: `[x, y]`.
 *
 * Measured off `knights.glb`: the node translations of the six sword objects,
 * which the blend places at the grip. Restated here because the raise turns
 * about that point and `poseInstanceAt` needs it as a pivot.
 *
 * `knightSwordArt.test.ts` fails if these drift from the glb, or if the grip
 * stops being at the outer edge of the knight's silhouette (the arm is part of
 * the body mesh and cannot be measured on its own).
 *
 * Indexed by level as `KNIGHT_PREFIX` is: basic, strong, mighty.
 *
 * Shoulder height (64-67% of the body), out past the plinth: the blade is as
 * long as the knight is tall, and the hand is where a blade that long must be
 * held to rest its point on the ground. See
 * `tools/blender/edits/0040_the_knight_holds_a_sword.py`.
 */
export const KNIGHT_GRIP: readonly (readonly [number, number])[] = [
  [-0.2808, 0.3675],
  [-0.3712, 0.4442],
  [-0.4086, 0.5125],
];

/**
 * The three bodies' heights in the art's own space, same indexing.
 *
 * Bodies only: `KNIGHT_PREFIX` subsets the glb by name and `Knight_sword_*`
 * does not match, so the sword is a separate draw. The promotion growth wants
 * the size of the body.
 *
 * Only the ratios are used (see `KNIGHT_GROW_START`); the test measures
 * heights.
 */
export const KNIGHT_ART_HEIGHT: readonly number[] = [0.55, 0.68, 0.795];

/**
 * How far off vertical a resting sword leans, in radians. 124 degrees.
 *
 * The blade is as long as the knight is tall, so its reach exceeds the height
 * of any hand on the body by about 11% on all three levels and it cannot hang
 * plumb. `|cos(tilt)| = (grip - clearance) / reach` is capped near 0.6, so
 * the blade lies out and down at 34 degrees above the ground with its point on
 * the ground beside the plinth.
 *
 * Outboard reach is `reach * sin(tilt) + |grip|`, independent of ground
 * clearance, so resting the point on the ground gives the highest hand, the
 * steepest blade and the smallest sprawl. It still ends 1.6 to 2.3 world units
 * from the vertex; the edit script measures what is there and
 * `knightSwordArt.test.ts` holds the budget.
 *
 * The 56 degree camera foreshortens verticals to 56%, so a plumb blade would
 * read as a stripe down the piece anyway.
 *
 * This is also where the raise starts, since the gold sword is built upright
 * and must begin where the dark one stood. Restated in
 * `tools/blender/edits/0040_the_knight_holds_a_sword.py` as `REST_TILT_DEG`;
 * the art test pins them together.
 */
export const SWORD_REST_TILT = (124 * Math.PI) / 180;

/**
 * Which horizontal axis the blade sweeps about, as a ground-plane azimuth.
 *
 * `Math.PI / 2` is world +Z (see `InstancePose.tiltAxisY`), which puts the
 * sweep in the x-y plane the sword is authored in, on the -x side opposite the
 * shield. A positive tilt moves the point outward and down, so the raise's 124
 * degrees run through open space.
 *
 * Not camera-relative, unlike `flipAxisY`: a chip has no front, but a knight
 * does, and re-aiming the plane at the viewer would swing the blade through the
 * knight's chest from half the orbit.
 */
export const SWORD_FLIP_AXIS_Y = Math.PI / 2;

/**
 * How long the raise takes.
 *
 * Longer than the hop it rides (`HOP_TOTAL_MS`, 340), in the band of the
 * chip's turn (460) and the robber's pulse (420): the knight lands, then
 * presents the blade.
 */
export const SWORD_RAISE_MS = 420;

/** Ease in and out. Smoothstep, as flip.ts uses for the same reason. */
const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Where a sword is, partway through being raised. */
export interface SwordPose {
  /**
   * Radians about `SWORD_FLIP_AXIS_Y`, through the grip. `SWORD_REST_TILT` is
   * where the dark sword stood; 0 is upright, how the gold one was built.
   */
  tilt: number;
  /** True once the sword is up and the caller can stop ticking. */
  done: boolean;
}

/** Raised and finished: the pose the gold sword was built at. */
const RAISED: SwordPose = { tilt: 0, done: true };

/**
 * Down and about to go. Differs from raised-and-finished because a carrier
 * stops on the frame a pose reports `done` (see flip.ts).
 */
const AT_EASE: SwordPose = { tilt: SWORD_REST_TILT, done: false };

/**
 * A sword's pose `elapsedMs` into its raise.
 *
 * Smoothstepped, like an arm lifting a weight. No lift or squash: the hop
 * supplies those and this pose is combined with it.
 *
 * Exactly the identity at and past the end, because `poseInstanceAt` skips its
 * rotation on a zero tilt and the sword returns to its built matrix.
 */
export function swordRaisePose(elapsedMs: number): SwordPose {
  if (elapsedMs >= SWORD_RAISE_MS) return RAISED;
  if (elapsedMs <= 0) return AT_EASE;
  return { tilt: SWORD_REST_TILT * (1 - smooth(elapsedMs / SWORD_RAISE_MS)), done: false };
}

/**
 * How far the blade moves while its knight is hovered, in radians, as an
 * offset from the pose the sword was built at.
 *
 * The body swells on hover (`BULGE_SCALE`, 1.12); the sword is a separate
 * instance, and without this the fist grew around a still blade.
 *
 * Two angles of different sizes:
 *
 *  - At ease the blade lies 124 degrees over with its point on the ground.
 *    A couple of degrees there is invisible, so 52 lifts the point clear and
 *    stands the sword to about 72.
 *  - Activated, the blade is vertical. It gets 22 degrees, a nod.
 *
 * Past about 25 degrees a raised sword starts to look like the barbarian
 * lower below, which a hover must never resemble. Neither angle reaches the
 * other state's pose: only colour and resting angle say whether a knight is
 * ready.
 *
 * Signs follow `SWORD_FLIP_AXIS_Y` (positive is outward and down), so the
 * at-ease lift is negative (up off the ground) and the activated dip positive
 * (into the raise's open space). Neither crosses the chest.
 */
export const SWORD_GUARD_AT_EASE = -(52 * Math.PI) / 180;
export const SWORD_GUARD_READY = (22 * Math.PI) / 180;

/**
 * The guard angle at ramp position `k`, where 0 is as built and 1 is on guard.
 *
 * `k` rather than a clock: the swell is driven by a pointer that can reverse,
 * resume mid-shrink, and overshoot on the way up (`bulgeEase`) but not on the
 * way back (`shrinkEase`). The renderer passes
 * `k = (at - 1) / (BULGE_SCALE - 1)` off the scale it writes that frame, so
 * blade and body cannot come apart. Unclamped, so the blade overshoots by the
 * same fraction as the body.
 *
 * Exactly 0 at k = 0, so an unhovered knight keeps its built matrix; under
 * `prefers-reduced-motion` the ramp simply lands.
 */
export function swordGuardTilt(active: boolean, k: number): number {
  return (active ? SWORD_GUARD_READY : SWORD_GUARD_AT_EASE) * k;
}

/**
 * The blade coming down when the barbarians land.
 *
 * Other deactivations (moving a knight, chasing the robber, forcing a road)
 * are not animated: they follow an action the player just took on a piece
 * they are looking at. A landfall is one event that happens to the table, has
 * its own horn (`sound_barbarians`), and deactivates every active knight at
 * once (`engine/knights/apply.go`, `EvBarbarianAttack`), so the swords come down
 * together. The gate is the event, not the diff; see `newlyStoodDown`.
 *
 * The shape is a fall, where the raise is a lift: it accelerates all the way
 * down (`t^2`) and bounces, because nothing is holding it.
 *
 * `SWORD_LOWER_BOUNCE` is the recoil: a half sine, leaving and returning to
 * rest with no velocity, so the seam with the fall is continuous. Small (7
 * degrees) because the point lands on a tile face.
 */
export const SWORD_LOWER_FALL_MS = 300;
export const SWORD_LOWER_SETTLE_MS = 140;
export const SWORD_LOWER_MS = SWORD_LOWER_FALL_MS + SWORD_LOWER_SETTLE_MS;
export const SWORD_LOWER_BOUNCE = (7 * Math.PI) / 180;

/** Down and settled: the pose the dark sword was built at. */
const LOWERED: SwordPose = { tilt: 0, done: true };

/**
 * Raised and about to fall. Negative where `AT_EASE` is positive: this pose is
 * applied to the dark sword, which is built leaning, so it turns the other way
 * to stand where the gold one was.
 */
const STILL_UP: SwordPose = { tilt: -SWORD_REST_TILT, done: false };

/**
 * A sword's pose `elapsedMs` into being lowered.
 *
 * Exactly the identity at and past the end, like the raise.
 */
export function swordLowerPose(elapsedMs: number): SwordPose {
  if (elapsedMs >= SWORD_LOWER_MS) return LOWERED;
  if (elapsedMs <= 0) return STILL_UP;
  if (elapsedMs < SWORD_LOWER_FALL_MS) {
    const t = elapsedMs / SWORD_LOWER_FALL_MS;
    // Accelerating: leaves the top slowly, arrives fast. An ease-out would be
    // an arm putting the sword down; here the barbarians took the activation.
    return { tilt: -SWORD_REST_TILT * (1 - t * t), done: false };
  }
  const t = (elapsedMs - SWORD_LOWER_FALL_MS) / SWORD_LOWER_SETTLE_MS;
  return { tilt: -SWORD_LOWER_BOUNCE * Math.sin(Math.PI * t), done: false };
}

/**
 * The knights that were activated and no longer are, and are still standing.
 *
 * Beside `newlyPlaced`, `newlyReady` and `promoted`. `Board3D` runs it only on
 * the commit after a landfall, because the diff alone cannot tell a landfall
 * from a player spending a knight, and the latter stays silent (see
 * `swordLowerPose`).
 *
 * `onBoard` is the current commit's key set. A knight's key carries its
 * vertex, so a knight that moved (and was deactivated by it) has no key here;
 * filtering against the previous set would lower a sword where the knight no
 * longer stands.
 *
 * No bulk limit: `DROP_BULK_LIMIT` separates events from state loads for
 * arrivals, but here the bulk is the event (two dozen knights on a ten-player
 * table). The announcement keeps state loads out.
 */
export function newlyStoodDown(
  prevReady: ReadonlySet<string> | null,
  nextReady: ReadonlySet<string>,
  onBoard: ReadonlySet<string>,
): string[] {
  if (!prevReady) return [];
  const out: string[] = [];
  for (const key of prevReady) {
    if (nextReady.has(key) || !onBoard.has(key)) continue;
    out.push(key);
  }
  return out;
}

/**
 * The grip, in world units, as an offset from the placement's own origin.
 *
 * What `InstancePose.tiltPivotX`/`tiltPivotY` want. The z component is zero on
 * every level, so it is not returned.
 *
 * `scale` is the drawn size (`MODULE_SCALE.knight`), passed in so this module
 * describes only the art. Levels are clamped like `planKnights`, so the sword
 * always turns about a real point.
 */
export function swordPivot(level: number, scale: number): { x: number; y: number } {
  const grip = KNIGHT_GRIP[Math.min(KNIGHT_GRIP.length - 1, Math.max(0, level))];
  return { x: grip[0] * scale, y: grip[1] * scale };
}

/**
 * How big a promoted knight starts, as a fraction of its new size.
 *
 * The old model's height over the new one's, so the animation starts at the
 * old size and the swap is invisible.
 *
 * One constant for both steps: basic to strong is 0.809, strong to mighty
 * 0.829. A pair would mean carrying the from-level with every growth across
 * rebuilds, for two percent on one frame.
 */
export const KNIGHT_GROW_START = KNIGHT_ART_HEIGHT[0] / KNIGHT_ART_HEIGHT[1];

/**
 * How far past full size the growth reaches before settling back.
 *
 * A promotion overshoots and settles where a landing (drop.ts,
 * knightMotion.ts) compresses and recovers; the magnitudes are similar (0.07
 * there, 0.08 here).
 */
export const KNIGHT_GROW_OVERSHOOT = 0.08;

/** The growth itself. Longer than a fall (260). */
export const KNIGHT_GROW_RISE_MS = 240;

/** The settle, the same as the drop's. */
export const KNIGHT_GROW_SETTLE_MS = DROP_SETTLE_MS;

export const KNIGHT_GROW_MS = KNIGHT_GROW_RISE_MS + KNIGHT_GROW_SETTLE_MS;

/** How big a growing knight is, relative to the size it was built at. */
export interface GrowPose {
  /** Uniform scale about the ground the piece stands on. 1 is as built. */
  scale: number;
  /** True once it has settled and the caller can stop ticking. */
  done: boolean;
}

const GROWN: GrowPose = { scale: 1, done: true };

/**
 * A promoted knight's pose `elapsedMs` into its growth.
 *
 * The rise eases out (fast off the mark, decelerating into the overshoot)
 * because the swap is instant and the growth has to catch up; an ease-in
 * leaves the new model undersized for a beat.
 *
 * Exactly 1 at and past the end, so the piece settles on its built matrix.
 * Before the start it holds the old model's size, as `dropPose` does, so
 * arming and ticking on the same frame does not jump.
 */
export function knightGrowPose(elapsedMs: number): GrowPose {
  if (elapsedMs >= KNIGHT_GROW_MS) return GROWN;
  if (elapsedMs <= 0) return { scale: KNIGHT_GROW_START, done: false };
  const peak = 1 + KNIGHT_GROW_OVERSHOOT;
  if (elapsedMs < KNIGHT_GROW_RISE_MS) {
    const t = elapsedMs / KNIGHT_GROW_RISE_MS;
    const eased = 1 - (1 - t) * (1 - t);
    return { scale: KNIGHT_GROW_START + (peak - KNIGHT_GROW_START) * eased, done: false };
  }
  const t = (elapsedMs - KNIGHT_GROW_RISE_MS) / KNIGHT_GROW_SETTLE_MS;
  // Quarter cosine: leaves the overshoot at full height and arrives at 1 with
  // no velocity, so the piece stops rather than snapping.
  return { scale: 1 + KNIGHT_GROW_OVERSHOOT * Math.cos((Math.PI / 2) * t), done: false };
}

/**
 * The knights whose level went up since last time.
 *
 * Beside `newlyPlaced` (arrived) and `newlyReady` (activated). The key excludes
 * level, so a promotion swaps the model and changes nothing else in the plan;
 * the previous level has to be remembered.
 *
 * Refusals are `newlyPlaced`'s: a null `prev` is a board nobody has seen yet
 * (a rejoin, a spectator, a replay scrubbed forward), and a bulk arrival past
 * `DROP_BULK_LIMIT` is a state load.
 *
 * Level decreases are ignored: nothing in the rules demotes a knight.
 */
export function promoted(
  prev: ReadonlyMap<string, number> | null,
  next: ReadonlyMap<string, number>,
): string[] {
  if (!prev) return [];
  const out: string[] = [];
  for (const [key, level] of next) {
    const was = prev.get(key);
    if (was === undefined || level <= was) continue;
    out.push(key);
    if (out.length > DROP_BULK_LIMIT) return [];
  }
  return out;
}
