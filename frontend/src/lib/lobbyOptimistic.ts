// Optimistic overlay for the host's own lobby settings.
//
// Each settings control draws from the server's config
// (`summary.game.config`), and each edit is a REST round trip returning a new
// summary. Without an overlay a switch lags the click, then twitches again when
// the `lobby` broadcast, a react-query refetch or a resubscribe delivers the
// same summary.
//
// Like lib/optimistic for resources, this is a derived overlay over the
// authoritative value, never a mutation of it, and it always expires.
//
// The client computes no config (see lib/cmdPatch and lib/viewPatch). It shows
// the value the host asked for until the server answers, then the server's own
// values for those fields, so a clamped or normalised value corrects itself; a
// refusal drops the overlay alongside the error toast.
//
// Two deadlines:
//
//   - An unsettled edit expires after EDIT_TIMEOUT_MS, so a request that never
//     answers does not leave a switch on a value nothing agreed to. Long enough
//     that a slow request still wins.
//
//   - A settled edit holds for SETTLE_HOLD_MS, pinning the server's answer over
//     stale summaries captured before the edit (a delayed broadcast, an
//     in-flight refetch, a resubscribe's cache) so the control does not flip
//     back for a frame.
//
// Edits are a list, not one slot: edits to different rows are independent, and
// a refusal withdraws exactly one (as lib/optimistic keys spends by command id).

import * as React from "react";

/** How long an unanswered edit keeps its optimistic value before reverting. */
export const EDIT_TIMEOUT_MS = 5000;

/** How long a settled edit keeps pinning the server's answer over late frames. */
export const SETTLE_HOLD_MS = 1500;

/**
 * One in-flight (or just-landed) settings edit.
 *
 * `fields` is what the host asked for while `settled` is false, and what the
 * server answered once it is true.
 */
export interface PendingEdit<T> {
  id: number;
  fields: Partial<T>;
  settled: boolean;
  /** Wall-clock ms after which this edit stops overriding the server value. */
  expires: number;
}

/**
 * Structural equality over config-shaped values: JSON scalars, arrays and plain
 * objects. Not JSON.stringify, which is sensitive to key order (a board back
 * from a Go round trip may reorder keys).
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  if (ak.length !== Object.keys(bo).length) return false;
  return ak.every((k) => Object.hasOwn(bo, k) && deepEqual(ao[k], bo[k]));
}

/**
 * The value to draw: the server's, with every live edit laid over it in the
 * order they were made (so a later edit to the same field wins).
 *
 * Identity-stable with no edits, and when the edits change nothing, so a
 * settled edit holding the server's answer does not re-render the panel.
 */
export function applyEdits<T extends object>(server: T, edits: PendingEdit<T>[]): T {
  if (edits.length === 0) return server;
  const merged = Object.assign({}, server, ...edits.map((e) => e.fields)) as T;
  return deepEqual(merged, server) ? server : merged;
}

/** Stage an edit. `fields` is what the host asked for. */
export function beginEdit<T>(
  edits: PendingEdit<T>[],
  id: number,
  fields: Partial<T>,
  now: number,
): PendingEdit<T>[] {
  return [...edits, { id, fields, settled: false, expires: now + EDIT_TIMEOUT_MS }];
}

/**
 * The server answered: swap in its values for the same fields and start the
 * short hold. An id no longer staged (its request outran the timeout) is
 * ignored; the caller applies the authoritative summary either way.
 */
export function settleEdit<T>(
  edits: PendingEdit<T>[],
  id: number,
  fields: Partial<T>,
  now: number,
): PendingEdit<T>[] {
  if (!edits.some((e) => e.id === id)) return edits;
  return edits.map((e) =>
    e.id === id ? { id, fields, settled: true, expires: now + SETTLE_HOLD_MS } : e,
  );
}

/** Withdraw one edit (a refusal), leaving every other outstanding one standing. */
export function dropEdit<T>(edits: PendingEdit<T>[], id: number): PendingEdit<T>[] {
  const next = edits.filter((e) => e.id !== id);
  return next.length === edits.length ? edits : next;
}

/**
 * Drop everything past its deadline, reporting how many were still unsettled
 * (reverts the host must be told about; an expired settled edit is just the
 * hold ending).
 */
export function pruneEdits<T>(
  edits: PendingEdit<T>[],
  now: number,
): { edits: PendingEdit<T>[]; reverted: number } {
  const next = edits.filter((e) => e.expires > now);
  if (next.length === edits.length) return { edits, reverted: 0 };
  return { edits: next, reverted: edits.filter((e) => e.expires <= now && !e.settled).length };
}

/** The earliest deadline to wake up for, or null when nothing is outstanding. */
export function nextDeadline<T>(edits: PendingEdit<T>[]): number | null {
  if (edits.length === 0) return null;
  return Math.min(...edits.map((e) => e.expires));
}

/** The server's values for exactly the fields an edit touched. */
export function pick<T extends object>(source: T, shape: Partial<T>): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(shape) as (keyof T)[]) out[k] = source[k];
  return out;
}

/**
 * The overlay as a hook: `value` is what to draw, and begin/settle/drop are the
 * three things a mutation does to it.
 *
 * `onRevert` fires when an edit times out unanswered (not on a refusal, which
 * has the server's error text).
 */
export function usePendingEdits<T extends object>(server: T, onRevert?: () => void) {
  const [edits, setEdits] = React.useState<PendingEdit<T>[]>([]);
  const idRef = React.useRef(0);
  // A ref so a caller's inline arrow does not restart the timer every render.
  const revertRef = React.useRef(onRevert);
  revertRef.current = onRevert;

  const value = React.useMemo(() => applyEdits(server, edits), [server, edits]);

  // One timer at the earliest deadline: a request that never answers produces
  // no event.
  React.useEffect(() => {
    const deadline = nextDeadline(edits);
    if (deadline === null) return;
    const timer = setTimeout(
      () => {
        // Pruned outside the updater: any change to `edits` re-runs this effect,
        // so `edits` is current here, and a StrictMode double-invoked updater
        // must not fire the revert notice twice.
        const { edits: kept, reverted } = pruneEdits(edits, Date.now());
        if (reverted > 0) revertRef.current?.();
        setEdits(kept);
      },
      Math.max(0, deadline - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [edits]);

  const begin = React.useCallback((fields: Partial<T>) => {
    const id = ++idRef.current;
    setEdits((prev) => beginEdit(prev, id, fields, Date.now()));
    return id;
  }, []);
  const settle = React.useCallback((id: number, fields: Partial<T>) => {
    setEdits((prev) => settleEdit(prev, id, fields, Date.now()));
  }, []);
  const drop = React.useCallback((id: number) => {
    setEdits((prev) => dropEdit(prev, id));
  }, []);

  return { value, begin, settle, drop };
}
