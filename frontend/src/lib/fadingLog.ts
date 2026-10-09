/**
 * The event log in memory mode: lines that expire.
 *
 * With `GameConfig.memory_mode` there is no scrollback. A line is readable for
 * fifteen seconds after it arrives, fades briefly, and is gone.
 *
 * The client keeps the whole log (see routes/Game.tsx), and a join, reload or
 * reconnect delivers all of it at once. That backfill is anchored as already
 * expired, so only rows arriving afterwards are timed (as the sound cues and
 * card flights treat a backfill).
 *
 * Game.tsx re-renders about nineteen times a second and the feed rows are
 * memoised, so everything here is an absolute deadline rather than a remaining
 * duration: a row's `fadeAt` never changes, so it is not re-rendered and its
 * fade does not restart.
 */
import * as React from "react";
import type { GameEvent } from "./gamestate";

/** How long a line stays fully readable, from the moment the client sees it. */
export const LOG_LIFE_MS = 15_000;

/**
 * The fade at the end of that, during which the row is still in the DOM.
 *
 * Short, so a busy turn does not leave half the feed in different shades of
 * translucent.
 */
export const LOG_FADE_MS = 600;

/**
 * Where the visible window starts, given each row's arrival time.
 *
 * An index, not a filtered array, so the caller can slice in a memo and keep
 * one array identity while the window holds still.
 *
 * Arrivals are monotonic in `seq` (stamped when first seen; the log only grows
 * at the end), so the first live row is the boundary. `arrivalOf` must answer
 * for every row, pruned ones included: "forgotten" and "brand new" would
 * otherwise look the same.
 */
export function firstVisible(
  events: readonly GameEvent[],
  arrivalOf: (seq: number) => number,
  now: number,
): number {
  const cutoff = now - LOG_LIFE_MS - LOG_FADE_MS;
  let lo = 0;
  let hi = events.length;
  // Binary search: by the endgame the log is the whole game.
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arrivalOf(events[mid].seq) > cutoff) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** What the hook hands back. */
export interface FadingLog {
  /** The rows to draw, oldest first. Identity holds still between changes. */
  events: readonly GameEvent[];
  /**
   * When a given row should begin fading, as a timestamp, or null when nothing
   * is expiring (memory mode off). Stable for the life of a row.
   */
  fadeAt: ((seq: number) => number) | null;
}

/**
 * The log as memory mode shows it: a tail that expires, or the whole thing.
 *
 * `enabled` is memory mode and a game still in play (see the call site).
 * When off, the full log comes back unfiltered.
 */
export function useFadingLog(events: readonly GameEvent[], enabled: boolean): FadingLog {
  // seq -> when this client first saw the row. A ref so stamping does not
  // schedule a render.
  const arrivals = React.useRef(new Map<number, number>());
  // Whether the backfill has been anchored (marked already expired).
  const anchored = React.useRef(false);
  // The highest seq whose stamp was pruned. Rows at or below it are gone for
  // good; without this an absent stamp would read as brand new.
  const pruned = React.useRef(-1);
  // Rows expire on a clock, not a socket frame (a table can sit silent), so
  // this ticks when the next row is due to go.
  const [, tick] = React.useReducer((n: number) => n + 1, 0);

  const now = Date.now();
  if (!enabled) {
    // Nothing is timed while off, and the anchor is dropped: if the mode comes
    // back on (a spectator moving between tables shares this hook), the log in
    // hand is a backfill again.
    arrivals.current.clear();
    anchored.current = false;
    pruned.current = -1;
  } else {
    if (!anchored.current) {
      anchored.current = true;
      // Past the fade as well as the life, so the backfill is never drawn.
      const expired = now - LOG_LIFE_MS - LOG_FADE_MS - 1;
      for (const e of events) arrivals.current.set(e.seq, expired);
    }
    // Unstamped and not already pruned. A pruned row is absent from the map, so
    // without the watermark the expired history would get fresh stamps.
    for (const e of events) {
      if (e.seq > pruned.current && !arrivals.current.has(e.seq)) {
        arrivals.current.set(e.seq, now);
      }
    }
  }

  // Stamped, pruned or unknown, as one number each. Not a `useCallback`: it
  // closes over this render's `now`.
  const arrivalOf = (seq: number): number => {
    const at = arrivals.current.get(seq);
    if (at !== undefined) return at;
    return seq <= pruned.current ? Number.NEGATIVE_INFINITY : now;
  };
  const start = enabled ? firstVisible(events, arrivalOf, now) : 0;

  // The window as an array, rebuilt only when the log or the window moves.
  const visible = React.useMemo(
    () => (start === 0 ? events : events.slice(start)),
    [events, start],
  );

  // One timer for the whole feed, aimed at when the oldest visible row leaves.
  const oldest = enabled && visible.length ? arrivals.current.get(visible[0].seq) : undefined;
  React.useEffect(() => {
    if (oldest === undefined) return;
    const due = oldest + LOG_LIFE_MS + LOG_FADE_MS - Date.now();
    // Never zero, or a timer firing while the row is still visible would re-arm
    // against it forever.
    const id = setTimeout(tick, Math.max(due, 16));
    return () => clearTimeout(id);
  }, [oldest]);

  // Rows below the window are never asked about again; drop their stamps so
  // the map does not grow for the whole game.
  if (enabled && start > 0) {
    for (let i = 0; i < start; i++) {
      arrivals.current.delete(events[i].seq);
      if (events[i].seq > pruned.current) pruned.current = events[i].seq;
    }
  }

  const fadeAt = React.useCallback(
    (seq: number) => (arrivals.current.get(seq) ?? Date.now()) + LOG_LIFE_MS,
    [],
  );

  return { events: visible, fadeAt: enabled ? fadeAt : null };
}
