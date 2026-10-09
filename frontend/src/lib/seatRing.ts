/**
 * The turn-timer countdown, as CSS animation parameters (see
 * components/game/hud/SeatTimerBar). The precise seconds live on the expanded
 * PlayerCard (TileCountdown); this is the bar visible on the default coin view.
 *
 * It is one CSS animation with a negative animation-delay rather than a
 * per-frame React or rAF loop, so the countdown runs on the compositor and
 * React only touches it when the server sends a new pair. The maths for where
 * in the keyframe the bar starts lives here so it can be tested without a DOM.
 *
 * The "ring" name is historical; the shape is a bar driven by a transform (see
 * SeatTimerBar and the keyframe in index.css).
 */

export interface RingAnim {
  /** `animation-duration`, in ms: the decision's whole budget. */
  durationMs: number;
  /** `animation-delay`, in ms. Always <= 0: how far in the ring already is. */
  delayMs: number;
  /** Draw a full ring and hold it still: no budget to count down against. */
  static: boolean;
  /**
   * Changes exactly when the animation must restart. Changing
   * `animation-delay` on a running animation keeps its original start time, so
   * callers use this as the element's `key`: a new pair remounts it with the
   * fresh delay, and an unchanged pair leaves it running.
   */
  key: string;
}

/**
 * How urgent the countdown is, as a colour name. Absolute seconds rather than
 * a fraction of the budget: ten seconds left is equally urgent on a 30s discard
 * and a 120s turn.
 */
export type TimerTier = "green" | "yellow" | "red";

/** Under this much left, the bar is red. */
export const TIMER_RED_MS = 10_000;
/** Under this much left (but over `TIMER_RED_MS`), the bar is yellow. */
export const TIMER_YELLOW_MS = 30_000;

export function timerTier(remainingMs: number | null): TimerTier {
  if (remainingMs == null) return "green";
  if (remainingMs <= TIMER_RED_MS) return "red";
  if (remainingMs <= TIMER_YELLOW_MS) return "yellow";
  return "green";
}

/** The CSS colour each tier paints with. */
export const TIER_COLOR: Record<TimerTier, string> = {
  green: "var(--color-green)",
  yellow: "var(--color-yellow)",
  red: "var(--color-red)",
};

/**
 * How long the current tier still has, in ms, or null when there is nothing
 * left to change into (red, or no countdown).
 *
 * Lets the bar change colour without a per-frame tick: a timeout armed for the
 * crossing costs two re-renders per decision, where a 250ms interval would put
 * the HUD back on the main thread.
 */
export function tierEndsInMs(remainingMs: number | null): number | null {
  if (remainingMs == null) return null;
  if (remainingMs > TIMER_YELLOW_MS) return remainingMs - TIMER_YELLOW_MS;
  if (remainingMs > TIMER_RED_MS) return remainingMs - TIMER_RED_MS;
  return null;
}

/**
 * seatRingAnim turns the seat's remaining budget and its decision's full budget
 * into the bar's animation, or null when none should be drawn. Its fallbacks
 * mirror `timerBarPct` (lib/gamestate.ts) so the coin and the expanded card
 * agree:
 *
 *   - no remaining: no bar. `seatCountdownMs` already returns null for a
 *     bot/auto seat and for a game with timers off.
 *   - no budget (older server, or an unstamped decision): a full, still bar.
 *     `remainingMs` is not substituted, because it can tick upward (a new
 *     decision, the main-turn inactivity floor) and would re-fill the bar
 *     mid-countdown (see types.ts's `seat_budgets`).
 */
export function seatRingAnim(remainingMs: number | null, budgetMs: number | null): RingAnim | null {
  if (remainingMs == null) return null;
  if (budgetMs == null || budgetMs <= 0) {
    return { durationMs: 0, delayMs: 0, static: true, key: "static" };
  }
  // Clamped both ways: a remaining above the budget would give a positive delay,
  // which CSS reads as "start later", leaving the bar frozen full.
  const clamped = Math.max(0, Math.min(budgetMs, remainingMs));
  return {
    durationMs: budgetMs,
    // Elapsed time as a head start. At zero remaining this is -budget and
    // `fill-mode: forwards` holds the bar empty, so expiry needs no special
    // case. Written as a subtraction so an untouched budget yields +0, not -0
    // ("-0ms" in the DOM).
    delayMs: clamped - budgetMs,
    static: false,
    key: `${remainingMs}:${budgetMs}`,
  };
}
