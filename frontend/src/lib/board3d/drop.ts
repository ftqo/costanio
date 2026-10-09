// Pieces fall into place, so the player's eye follows the fall to the spot
// that just changed.
//
// Two pure parts, free of three.js so they test without a GL context:
//
//  1. Which pieces are new. The board is drawn from a full plan each update
//     and everything is instanced, so instances have no identity across a
//     rebuild. Each placement gets a stable key, and new ones are found by
//     set difference.
//  2. Where a falling piece is at time t.
//
// Board3D applies the animation, since it owns the instance matrices.
import type { Placement } from "./instancing";

/**
 * How high a piece starts, in world units: a third of a hex (5.2 across; a
 * settlement is ~0.5). High enough to read as a fall, low enough to stay on a
 * framed board and inside the shadow light's frustum.
 */
export const DROP_HEIGHT = 1.6;

/** The fall. Short: this is punctuation, not a cutscene. */
export const DROP_FALL_MS = 260;

/** The landing: the piece squashing and recovering. */
export const DROP_SETTLE_MS = 120;

export const DROP_TOTAL_MS = DROP_FALL_MS + DROP_SETTLE_MS;

/**
 * How much the piece compresses at the bottom of the landing, as a fraction of
 * its height. Small (stone and timber, not rubber) but not zero.
 */
const SQUASH = 0.07;

/**
 * The gap between two pieces landing together. A setup turn places a
 * settlement and a road at once; offsetting the second reads as two
 * placements in order.
 */
export const DROP_STAGGER_MS = 80;

/**
 * Above this many new pieces at once, nothing drops.
 *
 * A whole board arriving (a replay scrub, a rejoin, a spectator joining) is a
 * state load, not placements. The threshold is above the most pieces one
 * legal action can place (a setup turn's settlement + road, a road-building
 * card's two roads, plus room for two actions in one message) and below a bulk
 * load.
 */
export const DROP_BULK_LIMIT = 6;

/** Where a falling piece is, relative to where it will end up. */
export interface DropPose {
  /** World units above its resting position. */
  lift: number;
  /**
   * Vertical scale about the point the piece stands on. 1 while falling; dips
   * below 1 during the landing. The caller widens by `1 / sqrt(squashY)` in
   * the two horizontal axes so the piece keeps its volume.
   */
  squashY: number;
}

const RESTING: DropPose = { lift: 0, squashY: 1 };

/**
 * A piece's pose `elapsedMs` into its drop.
 *
 * The fall is `h(1 - t^2)`, constant acceleration, which gives it weight;
 * anything that decelerates on approach looks lowered on a wire.
 *
 * Negative time is the waiting-in-the-air state of a staggered piece; past
 * the end it is landed, so extra ticks return the identity transform.
 */
export function dropPose(elapsedMs: number): DropPose {
  if (elapsedMs >= DROP_TOTAL_MS) return RESTING;
  if (elapsedMs <= 0) return { lift: DROP_HEIGHT, squashY: 1 };
  if (elapsedMs < DROP_FALL_MS) {
    const t = elapsedMs / DROP_FALL_MS;
    return { lift: DROP_HEIGHT * (1 - t * t), squashY: 1 };
  }
  // One half-sine over the settle: compress, then back to full height with no
  // overshoot.
  const t = (elapsedMs - DROP_FALL_MS) / DROP_SETTLE_MS;
  return { lift: 0, squashY: 1 - SQUASH * Math.sin(Math.PI * t) };
}

/** A placement that can be told apart from one update to the next. */
export interface KeyedPlacement extends Placement {
  /**
   * Stable across rebuilds and unique across the board, built from what the
   * piece is rather than its array position; see `pieceKey`.
   */
  key: string;
}

/**
 * The identity of one piece on the board.
 *
 * Includes the owner, so a settlement changing hands drops in rather than
 * recolouring. Includes the kind, so upgrading to a city retires one key and
 * adds another, and the city drops onto the settlement's spot.
 */
export function pieceKey(kind: string, owner: number, at: string): string {
  return `${kind}:${owner}:${at}`;
}

/**
 * The keys on the board now that were not there last time.
 *
 * `prev` is null on a board's first build, which returns nothing: the opening
 * board is drawn as it stands. Bulk arrivals likewise (see DROP_BULK_LIMIT).
 *
 * Removals are ignored. A piece leaving the board is not a placement; the key
 * of its replacement is what drops.
 */
export function newlyPlaced(prev: ReadonlySet<string> | null, next: Iterable<string>): string[] {
  if (!prev) return [];
  const added: string[] = [];
  for (const key of next) {
    if (prev.has(key)) continue;
    added.push(key);
    if (added.length > DROP_BULK_LIMIT) return [];
  }
  return added;
}

/**
 * When each newly placed piece should start falling, in shared-clock time.
 * Ordered by key, so the same pieces always land in the same order and a
 * rebuild mid-drop cannot reshuffle the stagger.
 */
export function dropStarts(keys: readonly string[], nowMs: number): Map<string, number> {
  const out = new Map<string, number>();
  [...keys].sort().forEach((key, i) => out.set(key, nowMs + i * DROP_STAGGER_MS));
  return out;
}

/**
 * Drops not finished by `nowMs`, so a rebuild can keep their start times
 * instead of restarting or cutting them short.
 *
 * The content effect rebuilds every instanced mesh whenever the view changes,
 * including for unrelated reasons (a trade offer, a chat message, a roll).
 *
 * `withinMs` is the animation's length; knightMotion.ts's hop uses this with a
 * different length.
 */
export function stillFalling(
  starts: ReadonlyMap<string, number>,
  live: ReadonlySet<string>,
  nowMs: number,
  withinMs = DROP_TOTAL_MS,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [key, at] of starts) {
    if (live.has(key) && nowMs - at < withinMs) out.set(key, at);
  }
  return out;
}
