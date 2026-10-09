// Optimistic resource overlay for the local player's own paid actions.
//
// The displayed hand is the server's snapshot, which arrives a round trip after
// an action, so a new build would look free for a beat. This overlay subtracts
// the command's known cost immediately and expires once a newer snapshot (which
// includes the deduction) arrives.
//
// Expiry is seq-gated: the overlay is tagged with the snapshot seq it was
// applied against and ignored once that seq advances, so it never
// double-counts and never flashes.
//
// Seq, not the in-flight registry: lib/inflight settles a build when its piece
// appears via the event fold, a round trip before the snapshot updates the
// hand. Only the snapshot shows the hand has caught up.
//
// Each staged spend is filed under its command id, so a refusal withdraws
// exactly that command's cost (dropSpend) and leaves the others.

import { COST } from "./costs";

/** One command's staged cost, filed under the id that will name it if refused. */
export interface Spend {
  id: string;
  cost: Record<number, number>;
}

export interface Spent {
  // The full-view seq the overlay was applied against; undefined before any
  // snapshot. The overlay is live only while this matches the current seq.
  seq: number | undefined;
  spends: Spend[];
}

export const NO_SPENT: Spent = { seq: undefined, spends: [] };

// Resource cost per command type. Setup placements are free (omitted); city
// improvements cost commodities, not resources (omitted). activate_knight is the
// one paid action not in the shared build COST table (1 wheat).
export const CMD_COST: Record<string, Record<number, number>> = {
  build_road: COST.road,
  build_settlement: COST.settlement,
  build_city: COST.city,
  build_ship: COST.ship,
  build_knight: COST.knight,
  promote_knight: COST.knight,
  activate_knight: { 4: 1 },
  build_wall: COST.wall,
  buy_dev_card: COST.dev,
  // No row for `build_bridge`, `buy_coin` or `spend_coins`: none has a fixed
  // cost. The bridge price is published on the view (`ext.rivers.bridge_cost`),
  // a coin costs the buyer's own maritime rate, and spending coins costs no
  // resources. A wrong overlay is worse than none; these settle on the next
  // snapshot.
};

// addSpent files a command's cost under its id. Multiple actions taken before
// the next snapshot accumulate (same seq baseline); a stale overlay (older seq)
// is discarded first so it never leaks across snapshots.
// Pass free=true for placements that consume no resources (e.g. Road Building
// free roads/ships): the seq is updated but no cost is filed.
export function addSpent(
  prev: Spent,
  curSeq: number | undefined,
  id: string,
  cost: Record<number, number>,
  free?: boolean,
): Spent {
  const base = prev.seq === curSeq ? prev.spends : [];
  if (free) return { seq: curSeq, spends: base };
  return { seq: curSeq, spends: [...base, { id, cost }] };
}

/**
 * Withdraw one command's staged cost, by the id the refusal named.
 *
 * Identity-stable when the id matches nothing (a free command, or a spend a
 * newer snapshot already superseded), so such a refusal costs no render.
 */
export function dropSpend(prev: Spent, id: string | undefined): Spent {
  if (!id) return prev;
  const spends = prev.spends.filter((s) => s.id !== id);
  return spends.length === prev.spends.length ? prev : { seq: prev.seq, spends };
}

// spentFor returns the pending spend for a resource index, but only while the
// overlay is still current (its seq matches the live snapshot). A superseded
// overlay contributes nothing.
export function spentFor(spent: Spent, curSeq: number | undefined, idx: number): number {
  if (spent.seq !== curSeq) return 0;
  let n = 0;
  for (const s of spent.spends) n += s.cost[idx] ?? 0;
  return n;
}
