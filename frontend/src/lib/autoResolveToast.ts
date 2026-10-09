// Toasts for decisions the server resolved for you on timeout.
//
// When a prompt's countdown runs out, the actor force-resolves the decision
// (engine/knights/hooks.go's `auto`, plus the base 7-roll discard) and the prompt
// disappears. These toasts tell the player what was done for them.
//
// Both tables below are total maps over `AutoResolveKind` (see
// lib/board3d/ghost.ts), so a new pending fails the build until it has a
// message and a detector.
//
// Pure (no React, no toast library) so it can be unit tested from tables.
import { knightsExt, islandsExt, type FullView } from "./types";
import { plural, t } from "@lingui/core/macro";
import { autoReceivedCard } from "./cardPhrases";
import { isResKey } from "./cardFace";

/** One force-resolvable decision. */
export type AutoResolveKind =
  /** 7-roll (or Saboteur) discard: engine-level `pending_discards`. */
  | "discard"
  /** Wedding: hand cards to the active player. */
  | "give"
  /** Commercial Harbor: return a commodity for the taker's resource. */
  | "harbor"
  /** Spy: take one of the victim's progress cards. */
  | "spy"
  /** Master Merchant: take up to 2 cards from the victim. */
  | "master_merchant"
  /** Deserter, victim's half: surrender a knight. */
  | "deserter_surrender"
  /** Deserter, taker's half: place the replacement knight. */
  | "deserter_place"
  /** Aqueduct: take a free resource from the bank. */
  | "aqueduct"
  /** A displaced knight needs a new home. */
  | "relocate_knight"
  /** Tied top defender: draw a progress card of your chosen discipline. */
  | "defender_draw"
  /** Barbarians broke through: choose which of your own cities they raze. */
  | "barbarian_downgrade"
  /** Over the progress-card hand limit: discard down to it. */
  | "progress_discard"
  /** Earned a metropolis: choose which of your cities it stands on. */
  | "metropolis_pick"
  /** Islands: resources owed from a gold hex, the seat's own pick. */
  | "gold";

/**
 * What the local player currently owes, as numbers (booleans as 0/1).
 *
 * A count where possible, because a resolved discard's toast says how many,
 * and by then the count is only in the previous snapshot.
 */
export type PendingSnapshot = Record<AutoResolveKind, number>;

/** An empty snapshot: nothing owed. Also the shape the totality test asserts. */
export const NO_PENDINGS: PendingSnapshot = {
  discard: 0,
  give: 0,
  harbor: 0,
  spy: 0,
  master_merchant: 0,
  deserter_surrender: 0,
  deserter_place: 0,
  aqueduct: 0,
  relocate_knight: 0,
  defender_draw: 0,
  barbarian_downgrade: 0,
  progress_discard: 0,
  metropolis_pick: 0,
  gold: 0,
};

/** The engine's progress-card hand limit (engine/knights/knights.go: progressHandSize). */
export const PROGRESS_HAND_LIMIT = 4;

/**
 * Read what the viewer owes from their own view. Every pending is already on
 * the wire (the prompts use these fields). A spectator (`viewer < 0`) owes
 * nothing.
 */
export function pendingSnapshot(view: FullView | null | undefined): PendingSnapshot {
  const s: PendingSnapshot = { ...NO_PENDINGS };
  if (!view || view.viewer < 0) return s;
  const me = view.viewer;
  s.discard = view.pending_discards?.[me] ?? 0;
  // Before the Knights early return: gold is an Islands debt, and Islands
  // without Knights has no `ext.cak`. The server picks for a seat whose clock
  // runs out (docs/rules/islands.md).
  s.gold = islandsExt(view)?.pending_gold?.[me] ?? 0;
  const x = knightsExt(view);
  if (!x) return s;
  s.give = x.pending_give?.[me] ?? 0;
  s.harbor = x.harbor_give?.[me] !== undefined ? 1 : 0;
  // The thief-only look fields are present while that thief owes a pick.
  s.spy = x.spy ? 1 : 0;
  s.master_merchant = x.master_merchant ? 1 : 0;
  s.deserter_surrender = x.deserter_victim === me ? 1 : 0;
  s.deserter_place = x.deserter_taker === me ? 1 : 0;
  s.aqueduct = (x.aqueduct ?? []).includes(me) ? 1 : 0;
  s.relocate_knight = x.reloc_player === me ? 1 : 0;
  // Only the seat at the front of the queue draws next; the others are
  // waiting and the timer cannot resolve theirs yet.
  s.defender_draw = (x.defender_draws ?? [])[0] === me ? 1 : 0;
  // These resolve simultaneously, so every listed seat owes now.
  s.barbarian_downgrade = (x.barbarian_downgrade ?? []).includes(me) ? 1 : 0;
  s.metropolis_pick = x.metropolis_pick?.player === me ? 1 : 0;
  const held = x.players?.[me]?.progress_count ?? 0;
  s.progress_discard = Math.max(0, held - PROGRESS_HAND_LIMIT);
  return s;
}

/** What a message may need beyond the count that was owed. */
export interface AutoResolveDetail {
  /** How many of the thing were owed when the timer took over. */
  n: number;
  /** The resource the Aqueduct pick landed on; "" when the bank was empty. */
  res: string;
}

/**
 * The toast for each kind. Total, so a new `AutoResolveKind` fails the build.
 *
 * Each starts with "Time ran out" and says what the server did, in the
 * prompt's vocabulary.
 */
export const AUTO_RESOLVE_MESSAGES: Record<AutoResolveKind, (d: AutoResolveDetail) => string> = {
  discard: ({ n }) =>
    t`Time ran out. ${plural(n, { one: "# card", other: "# cards" })} discarded automatically.`,
  give: ({ n }) =>
    t`Time ran out. ${plural(n, { one: "# card", other: "# cards" })} handed over automatically (Wedding).`,
  harbor: () => t`Time ran out. A commodity was handed over automatically (Commercial Harbor).`,
  spy: () => t`Time ran out. A progress card was taken for you (Spy).`,
  master_merchant: () => t`Time ran out. Cards were taken for you (Master Merchant).`,
  deserter_surrender: () =>
    t`Time ran out. Your strongest knight was surrendered automatically (Deserter).`,
  deserter_place: () => t`Time ran out. Your replacement knight was placed for you (Deserter).`,
  // The one toast that names a card. One full sentence per resource
  // (lib/cardPhrases), because a "received 1 {resource}" frame does not inflect
  // in English, German or Spanish. Unknown resources get a sentence naming none.
  aqueduct: ({ res }) => {
    if (!res) return t`Time ran out. The bank was empty, so the Aqueduct gave nothing.`;
    return isResKey(res)
      ? autoReceivedCard(res)
      : t`Time ran out. The Aqueduct's resource was taken for you.`;
  },
  relocate_knight: () => t`Time ran out. Your displaced knight was relocated for you.`,
  defender_draw: () => t`Time ran out. A progress card was drawn for you (top defender).`,
  barbarian_downgrade: () =>
    t`Time ran out. A city was chosen for the barbarians and is now a settlement.`,
  progress_discard: () =>
    t`Time ran out. A progress card was discarded for you (over the hand limit).`,
  metropolis_pick: () => t`Time ran out. A city was chosen to hold your new metropolis.`,
  gold: ({ n }) =>
    t`Time ran out. ${plural(n, { one: "# resource was", other: "# resources were" })} picked for you from the gold hex.`,
};

/** Every kind, in the order the toasts should appear. Derived, never hand-listed. */
export const AUTO_RESOLVE_KINDS = Object.keys(NO_PENDINGS) as AutoResolveKind[];

/**
 * Which pending each wire command resolves, keyed by command type.
 *
 * A table rather than a flag at each call site, so every command goes through
 * one dispatcher that consults it. A missing entry shows up as a false "Time
 * ran out" toast on a manual play.
 *
 * Command names mirror the engine constants (engine/types.go,
 * engine/knights/decide.go). `play_progress` is absent: it resolves
 * `progress_discard` only when over the hand limit (see `resolvesPending`).
 */
export const PENDING_RESOLVED_BY: Readonly<Record<string, AutoResolveKind>> = {
  discard_cards: "discard",
  give_cards: "give",
  harbor_give: "harbor",
  spy_pick: "spy",
  master_merchant_pick: "master_merchant",
  deserter_surrender: "deserter_surrender",
  deserter_place: "deserter_place",
  aqueduct_pick: "aqueduct",
  relocate_knight: "relocate_knight",
  defender_draw: "defender_draw",
  barbarian_downgrade: "barbarian_downgrade",
  // Buying the city back clears `barbarian_downgrade` just as handing one over does.
  pillage_buyout: "barbarian_downgrade",
  metropolis_pick: "metropolis_pick",
  discard_progress: "progress_discard",
  choose_gold: "gold",
};

/**
 * The pending a command about to be sent will resolve, or null.
 *
 * `overProgressLimit` handles `play_progress`: a player over the four-card
 * progress limit may play a card down to it instead of discarding
 * (docs/rules/knights.md; `decidePlayProgress` skips the check), which clears
 * `progress_discard` as `discard_progress` does.
 */
export function resolvesPending(type: string, overProgressLimit: boolean): AutoResolveKind | null {
  if (type === "play_progress") return overProgressLimit ? "progress_discard" : null;
  return PENDING_RESOLVED_BY[type] ?? null;
}

export interface AutoResolveOpts {
  /**
   * Kinds the local player resolved themselves. A confirm and a timeout
   * produce the same state frame, so the caller, which knows what it sent,
   * says so.
   */
  initiated?: Iterable<AutoResolveKind>;
  /** The resource the Aqueduct pick took, for the one message that names it. */
  aqueductRes?: string;
}

/**
 * Everything that went from owed to resolved between two frames, however it
 * was resolved.
 *
 * The caller uses this to clear the `initiated` flag it set when sending. The
 * flag must survive unrelated frames between the send and the resolution
 * (an opponent's build also sends a state frame), so it is cleared only by the
 * transition it was set for.
 */
export function resolvedKinds(
  prev: PendingSnapshot | null | undefined,
  next: PendingSnapshot,
): AutoResolveKind[] {
  if (!prev) return [];
  return AUTO_RESOLVE_KINDS.filter((k) => prev[k] > 0 && next[k] <= 0);
}

/**
 * The toasts owed for everything that went from owed to resolved between two
 * frames: one loop over the total table.
 */
export function autoResolveToasts(
  prev: PendingSnapshot | null | undefined,
  next: PendingSnapshot,
  opts: AutoResolveOpts = {},
): string[] {
  if (!prev) return [];
  const mine = new Set(opts.initiated ?? []);
  const out: string[] = [];
  for (const kind of AUTO_RESOLVE_KINDS) {
    const was = prev[kind];
    if (was <= 0 || next[kind] > 0) continue;
    if (mine.has(kind)) continue;
    out.push(AUTO_RESOLVE_MESSAGES[kind]({ n: was, res: opts.aqueductRes ?? "" }));
  }
  return out;
}

// The original call sites (routes/Game.tsx) read the table above, so each
// string exists once.
export function autoDiscardToast(n: number): string {
  return AUTO_RESOLVE_MESSAGES.discard({ n, res: "" });
}

// res is the received resource name ("wood".."ore"); "" means the bank was empty
// and the pick resolved to nothing.
export function autoAqueductToast(res: string): string {
  return AUTO_RESOLVE_MESSAGES.aqueduct({ n: 1, res });
}

/**
 * The resource an auto-resolved Aqueduct pick landed on, from the event stream.
 *
 * It is not in the snapshot, but it is in the log in the same state frame that
 * clears the requirement, so take the newest `cak_aqueduct_taken` for our seat
 * (searched newest first, since a long game can have many).
 * Returns "" for the empty-bank pick (`res: "none"`), which the message table
 * renders as "the bank was empty".
 */
export function aqueductResourceFrom(
  events: readonly { type: string; data?: unknown }[] | null | undefined,
  viewer: number | null | undefined,
): string {
  if (!events || viewer == null || viewer < 0) return "";
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type !== "cak_aqueduct_taken") continue;
    const d = e.data as { player?: number; res?: unknown } | undefined;
    if (d?.player !== viewer) continue;
    return typeof d.res === "string" && d.res !== "none" ? d.res : "";
  }
  return "";
}
