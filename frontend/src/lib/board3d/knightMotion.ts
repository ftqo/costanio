// A knight stands to attention.
//
// Activating a knight costs a wheat and changes its sword from dull steel,
// pointed down, to gold and raised (see knightSword.ts). A colour change alone
// is easy to miss on a crowded board, so the knight hops once in place.
//
// It is not a drop (a piece arriving from DROP_HEIGHT, which would say the
// knight was just built) and not a carry (markerMotion.ts; a hop has no origin
// or destination). The landing is shared: DROP_SETTLE_MS with drop.ts's
// squash, so a piece coming down looks the same whatever lifted it.
//
// Pure, testable without a GL context. Board3D owns the instance matrices;
// this owns where a knight is at time t and which knights are newly ready.
import { DROP_SETTLE_MS, newlyPlaced, type DropPose } from "./drop";

/**
 * How high the hop goes, in world units.
 *
 * A knight is 0.55 to 0.795 units of art drawn at MODULE_SCALE.knight = 2, so
 * 1.10 to 1.59 tall; this is about a fifth of that. Anything near
 * DROP_HEIGHT's 1.6 would read as the knight being picked up and moved.
 */
export const HOP_HEIGHT = 0.3;

/**
 * The hop itself: up and back down.
 *
 * Shorter than DROP_FALL_MS (260): it covers a fifth of the distance, and the
 * whole gesture should fit inside the activation sound.
 */
export const HOP_RISE_MS = 220;

/** The landing, the same as drop.ts's. */
export const HOP_SETTLE_MS = DROP_SETTLE_MS;

export const HOP_TOTAL_MS = HOP_RISE_MS + HOP_SETTLE_MS;

/**
 * How much the knight compresses at the bottom of the landing.
 *
 * Matches drop.ts's SQUASH and markerMotion.ts's `settleSquash` (0.07). Stated
 * again because neither exports it; keep all three in step.
 */
const HOP_SQUASH = 0.07;

/** Standing still, exactly as built. See `dropPose`'s RESTING. */
const RESTING: DropPose = { lift: 0, squashY: 1 };

/**
 * Where a hopping knight is, `elapsedMs` into its hop.
 *
 * One ballistic arc, `4h*t*(1-t)`: leaves the ground with speed, slows to the
 * apex at the midpoint, comes back at the same speed. An eased arc would read
 * as the knight being lifted, which is the carry's gesture.
 *
 * Outside the hop it is `RESTING` at both ends: a knight waiting in a stagger
 * stands on the board (unlike a drop's in-the-air hold), and after the hop it
 * is bit for bit the placement, so repeated readying never drifts. Same
 * contract as `dropPose` and `tripPose`.
 */
export function hopPose(elapsedMs: number): DropPose {
  if (elapsedMs <= 0 || elapsedMs >= HOP_TOTAL_MS) return RESTING;
  if (elapsedMs < HOP_RISE_MS) {
    const t = elapsedMs / HOP_RISE_MS;
    return { lift: HOP_HEIGHT * 4 * t * (1 - t), squashY: 1 };
  }
  // One half-sine over the settle: compress, then back to full height with no
  // overshoot, as in drop.ts.
  const t = (elapsedMs - HOP_RISE_MS) / HOP_SETTLE_MS;
  return { lift: 0, squashY: 1 - HOP_SQUASH * Math.sin(Math.PI * t) };
}

/**
 * The knights that are ready now, were not last time, and were already on the
 * board.
 *
 * Activation is a set-membership transition like placement, so this reuses
 * `newlyPlaced`'s diff and both its refusals: a null `prev` is a board nobody
 * has seen yet (a rejoin, a spectator, a replay scrubbed forward), and a bulk
 * arrival past DROP_BULK_LIMIT is a state load.
 *
 * `standing` adds one rule: a knight's key carries its vertex, so moving an
 * active knight introduces a new key. Only a key that was on the board last
 * commit can have been readied; a new key is an arrival, which drop.ts owns.
 */
export function newlyReady(
  prevReady: ReadonlySet<string> | null,
  nextReady: Iterable<string>,
  standing: ReadonlySet<string> | null,
): string[] {
  return newlyPlaced(
    prevReady,
    [...nextReady].filter((key) => standing?.has(key) ?? false),
  );
}
