// Commands that have left this client and not yet been answered.
//
// One record serves two purposes:
//
//   Gating. The UI's gates come from the snapshot, which lags the command, so
//     without this a second click (a second `roll_dice`, a second build) is sent
//     and refused.
//
//   Optimism. An entry with a ViewPatch is an optimistic placement; one without
//     is just a gate.
//
// An entry leaves in one of three ways:
//
//   - its `settle` predicate holds against the current view. Stated against the
//     observable view rather than a seq, so a fold, a snapshot or an optimistic
//     redraw all discharge it the same way.
//   - an `err` frame arrives naming its id (the client frame id echoed back as
//     `ref`, server/ws.go).
//   - TTL. A successful command gets no reply, and a frame can be dropped on a
//     full send buffer, so without a timeout a gate could stick for the game.
import type { FullView } from "./types";
import { pendingSnapshot, type AutoResolveKind } from "./autoResolveToast";
import { applyPatch, patchApplied, type ViewPatch } from "./viewPatch";

/**
 * How we recognise that a command landed.
 *
 * A data descriptor rather than a closure, so an entry is plain state that can
 * be compared, logged and tested, and cannot capture a stale view.
 */
export type Settle =
  /** The board shows it (see viewPatch.patchApplied). The entry must carry a patch. */
  | { by: "patch" }
  /** The roll landed. */
  | { by: "rolled" }
  /** The turn moved off the seat it was on when we sent. */
  | { by: "turn"; cur: number }
  /**
   * The forced decision this command answered is no longer owed.
   *
   * For commands that resolve a pending. `seq` is too weak for these: it settles
   * on any newer snapshot, including an opponent's move, so the entry could be
   * gone before its refusal arrived and `rollbackCmd` would match nothing,
   * leaving e.g. a stuck `initiated` flag. A refused command leaves its pending
   * owed, so this keeps the entry until the refusal finds it.
   */
  | { by: "pending"; kind: AutoResolveKind }
  /**
   * Last resort: any authoritative view newer than the one we acted against.
   *
   * Only where there is nothing to undo (no patch, no un-gated staged cost, no
   * pending claim), so settling early at worst un-gates a control a bit soon.
   */
  | { by: "seq"; seq: number };

export interface InFlight {
  /** Client-generated; comes back as `err.ref` if the server refuses this one. */
  id: string;
  /** Command type, for gating a specific control (`isInFlight`). */
  type: string;
  /** Wall-clock at send, for the TTL. */
  sentAt: number;
  /** What the board would look like if this succeeds; absent for a pure gate. */
  patch?: ViewPatch;
  /**
   * The forced decision this command claimed to answer, if any.
   *
   * Recorded at send rather than at rollback, because it depends on screen
   * state at send time (whether the progress hand was over its limit), which may
   * have moved by the time a refusal arrives.
   */
  kind?: AutoResolveKind;
  settle: Settle;
}

/**
 * How long a command may stay outstanding before we stop believing in it.
 *
 * Long enough that a slow connection does not re-enable a control under the
 * player's thumb, short enough that a lost frame does not strand the dice for a
 * turn. Expiry also triggers a resync.
 */
export const INFLIGHT_TTL_MS = 3000;

let counter = 0;
/** A per-session unique frame id. Only ever compared, never parsed. */
export function nextCmdId(): string {
  counter += 1;
  return `c${counter}`;
}

/**
 * How we will know a command landed, chosen from what it is.
 *
 * Priority, strongest evidence first (a pending-resolving command falling
 * through to `seq` would lose its rollback):
 *
 *   1. a patch answers for itself, by appearing on the board;
 *   2. a forced decision is answered when it stops being owed;
 *   3. roll and end turn wait on the fact they change;
 *   4. otherwise the weak `seq` fallback, safe only where there is nothing to
 *      undo.
 */
export function settleFor(
  type: string,
  kind: AutoResolveKind | undefined,
  hasPatch: boolean,
  view: FullView,
): Settle {
  if (hasPatch) return { by: "patch" };
  if (kind) return { by: "pending", kind };
  if (type === "roll_dice") return { by: "rolled" };
  if (type === "end_turn") return { by: "turn", cur: view.cur };
  return { by: "seq", seq: view.seq };
}

/** Whether `e` has been answered by the view. */
export function isSettled(e: InFlight, view: FullView): boolean {
  switch (e.settle.by) {
    case "patch":
      return !!e.patch && patchApplied(view, e.patch);
    case "rolled":
      return !!view.rolled;
    case "turn":
      return view.cur !== e.settle.cur;
    case "pending":
      return pendingSnapshot(view)[e.settle.kind] === 0;
    case "seq":
      return view.seq > e.settle.seq;
  }
}

/**
 * Drop everything the view has answered.
 *
 * Returns the same array when nothing was dropped: this runs from an effect
 * keyed on the view, and a fresh array every time would loop.
 *
 * Settling only, never expiry. Expiry has consequences (refund a spend, retract
 * a pending claim, resync) and is handled by `takeExpired`; settling has none.
 * Combining them let this frequent caller drop expired entries silently.
 */
export function dropSettled(list: InFlight[], view: FullView): InFlight[] {
  const kept = list.filter((e) => !isSettled(e, view));
  return kept.length === list.length ? list : kept;
}

/**
 * Split off the entries that have waited too long.
 *
 * The caller rolls each one back and pulls a fresh view.
 */
export function takeExpired(
  list: InFlight[],
  now: number,
): { kept: InFlight[]; expired: InFlight[] } {
  const expired = list.filter((e) => now - e.sentAt >= INFLIGHT_TTL_MS);
  if (!expired.length) return { kept: list, expired };
  return { kept: list.filter((e) => now - e.sentAt < INFLIGHT_TTL_MS), expired };
}

/** Drop the one entry a refusal names. Identity-stable when `ref` matches none. */
export function dropByRef(list: InFlight[], ref: string | undefined): InFlight[] {
  if (!ref) return list;
  const out = list.filter((e) => e.id !== ref);
  return out.length === list.length ? list : out;
}

/** Whether a command of this type is outstanding, for gating its control. */
export function isInFlight(list: InFlight[], type: string): boolean {
  return list.some((e) => e.type === type);
}

/**
 * The view the board should draw: authoritative, plus every outstanding piece
 * that is not in it yet.
 *
 * Only for the board: a phantom piece is right for drawing pieces and wrong for
 * counting them, so the dock, rail, log and VP column use the authoritative
 * view.
 *
 * Entries already reflected are skipped, so this is stable however the piece
 * arrived. `applyPatch` returns its input for a no-op, so with nothing
 * outstanding the view comes back by identity.
 */
export function applyPending(view: FullView, list: InFlight[]): FullView {
  let out = view;
  for (const e of list) {
    if (e.patch && !patchApplied(out, e.patch)) out = applyPatch(out, e.patch);
  }
  return out;
}
