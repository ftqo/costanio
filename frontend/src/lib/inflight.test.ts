import { test, expect } from "vitest";
import {
  INFLIGHT_TTL_MS,
  applyPending,
  dropByRef,
  isInFlight,
  isSettled,
  nextCmdId,
  dropSettled,
  settleFor,
  takeExpired,
  type InFlight,
} from "./inflight";
import type { FullView, Vertex } from "./types";

const V = (q: number, r: number, side: 0 | 1 = 0): Vertex => ({ q, r, side });

function base(over: Partial<FullView> = {}): FullView {
  return {
    seq: 10,
    viewer: 0,
    config: {} as never,
    phase: "play",
    cur: 0,
    board: { radius: 2, tiles: [], robber: { q: 0, r: 0 }, harbors: [] },
    bank: [0, 0, 0, 0, 0, 0],
    players: [],
    buildings: [],
    roads: [],
    dev_deck_count: 0,
    longest_road: -1,
    largest_army: -1,
    winner: -1,
    ...over,
  };
}

const entry = (over: Partial<InFlight> = {}): InFlight => ({
  id: "c1",
  type: "build_settlement",
  sentAt: 1000,
  patch: { kind: "settlement", v: V(0, 0), owner: 0 },
  settle: { by: "patch" },
  ...over,
});

test("ids are unique within a session", () => {
  const a = nextCmdId();
  const b = nextCmdId();
  expect(a).not.toBe(b);
});

// ---------------------------------------------------------------------------
// Settling
// ---------------------------------------------------------------------------

test("a patch entry settles when the board shows its piece", () => {
  const e = entry();
  expect(isSettled(e, base())).toBe(false);
  expect(isSettled(e, base({ buildings: [{ v: V(0, 0), owner: 0, city: false }] }))).toBe(true);
});

test("a patch entry settles the same way whoever put the piece there", () => {
  // Stated against the view, so a fold, a snapshot and an optimistic redraw are
  // equivalent.
  const e = entry();
  const folded = base({ buildings: [{ v: V(0, 0), owner: 0, city: false }], seq: 10 });
  const snapshot = base({ buildings: [{ v: V(0, 0), owner: 0, city: false }], seq: 12 });
  expect(isSettled(e, folded)).toBe(true);
  expect(isSettled(e, snapshot)).toBe(true);
});

test("the roll gate settles on `rolled`, not on a new seq", () => {
  const e = entry({ type: "roll_dice", patch: undefined, settle: { by: "rolled" } });
  // A newer view without the roll must not reopen the dice (the double-roll
  // window).
  expect(isSettled(e, base({ seq: 99 }))).toBe(false);
  expect(isSettled(e, base({ rolled: true }))).toBe(true);
});

test("the end-turn gate settles when the turn leaves the seat it was on", () => {
  const e = entry({ type: "end_turn", patch: undefined, settle: { by: "turn", cur: 0 } });
  expect(isSettled(e, base({ cur: 0 }))).toBe(false);
  expect(isSettled(e, base({ cur: 1 }))).toBe(true);
});

test("the fallback gate settles on any strictly newer view", () => {
  const e = entry({ type: "play_progress", patch: undefined, settle: { by: "seq", seq: 10 } });
  expect(isSettled(e, base({ seq: 10 }))).toBe(false);
  expect(isSettled(e, base({ seq: 11 }))).toBe(true);
});

test("a patch entry never settles on a seq alone", () => {
  // A build whose piece has not arrived stays outstanding however far the
  // snapshot moves.
  expect(isSettled(entry(), base({ seq: 500 }))).toBe(false);
});

// ---------------------------------------------------------------------------
// Pruning
// ---------------------------------------------------------------------------

test("settling drops what the view has answered and keeps the rest", () => {
  const settled = entry({ id: "a" });
  const open = entry({ id: "b", patch: { kind: "settlement", v: V(5, 5), owner: 0 } });
  const view = base({ buildings: [{ v: V(0, 0), owner: 0, city: false }] });
  expect(dropSettled([settled, open], view).map((e) => e.id)).toEqual(["b"]);
});

test("settling returns the same array when it drops nothing", () => {
  // The caller runs this from a view-keyed effect; a fresh array would loop.
  const list = [entry()];
  expect(dropSettled(list, base())).toBe(list);
});

test("settling never expires an entry", () => {
  // Settling must not consume expired entries: expiry triggers rollback, spend
  // refund, pending retraction and resync; settling has no consequences.
  const ancient = entry({ sentAt: -1_000_000 });
  expect(dropSettled([ancient], base())).toHaveLength(1);
});

test("expiry reports what it took, so the caller can roll it back", () => {
  const { kept, expired } = takeExpired([entry({ sentAt: 0 })], INFLIGHT_TTL_MS);
  expect(kept).toEqual([]);
  expect(expired.map((e) => e.id)).toEqual(["c1"]);
});

test("expiry is identity-stable and silent when nothing has timed out", () => {
  const list = [entry({ sentAt: 1000 })];
  const { kept, expired } = takeExpired(list, 1000);
  expect(kept).toBe(list);
  expect(expired).toEqual([]);
});

// ---------------------------------------------------------------------------
// Rejection and gating
// ---------------------------------------------------------------------------

test("a refusal drops exactly the command it names", () => {
  const list = [entry({ id: "a" }), entry({ id: "b" })];
  expect(dropByRef(list, "a").map((e) => e.id)).toEqual(["b"]);
});

test("a refusal about nothing of ours leaves everything alone, by identity", () => {
  const list = [entry({ id: "a" })];
  expect(dropByRef(list, "zz")).toBe(list);
  expect(dropByRef(list, undefined)).toBe(list);
  expect(dropByRef(list, "")).toBe(list);
});

test("isInFlight gates by command type", () => {
  const list = [entry({ type: "roll_dice" })];
  expect(isInFlight(list, "roll_dice")).toBe(true);
  expect(isInFlight(list, "end_turn")).toBe(false);
  expect(isInFlight([], "roll_dice")).toBe(false);
});

// ---------------------------------------------------------------------------
// The overlay
// ---------------------------------------------------------------------------

test("applyPending draws outstanding pieces", () => {
  const view = base();
  expect(applyPending(view, [])).toBe(view);
  expect(applyPending(view, [entry({ patch: undefined, settle: { by: "seq", seq: 10 } })])).toBe(
    view,
  );
  const out = applyPending(view, [entry()]);
  expect(out.buildings).toEqual([{ v: V(0, 0), owner: 0, city: false }]);
});

test("an outstanding piece the view already shows is not drawn twice", () => {
  const view = base({ buildings: [{ v: V(0, 0), owner: 0, city: false }] });
  // The fold has landed but the entry is not pruned yet: a no-op.
  expect(applyPending(view, [entry()])).toBe(view);
});

test("several outstanding pieces all land", () => {
  const out = applyPending(base(), [
    entry({ id: "a", patch: { kind: "settlement", v: V(0, 0), owner: 0 } }),
    entry({ id: "b", patch: { kind: "road", e: { a: V(0, 0), b: V(0, 0, 1) }, owner: 0 } }),
  ]);
  expect(out.buildings).toHaveLength(1);
  expect(out.roads).toHaveLength(1);
});

test("the overlay withdraws the spot it took", () => {
  // The board stops offering a location as soon as a command claims it.
  const view = base({ legal: { settlements: [V(0, 0), V(1, 1)] } });
  const out = applyPending(view, [entry()]);
  expect(out.legal?.settlements).toEqual([V(1, 1)]);
});

// ---------------------------------------------------------------------------
// A pending-resolving command settles on its pending, not on the clock
// ---------------------------------------------------------------------------

test("a pending settle survives an opponent's snapshot and clears on its own", () => {
  // `{by:"seq"}` would settle on any newer view (an opponent's move), losing
  // the entry before its refusal arrived and leaving the "answered" flag set.
  const e = entry({
    type: "discard_cards",
    patch: undefined,
    kind: "discard",
    settle: { by: "pending", kind: "discard" },
  });
  const owed = base({ seq: 99, viewer: 0, pending_discards: { 0: 3 } });
  expect(isSettled(e, owed)).toBe(false); // still owed, however new the view
  expect(isSettled(e, base({ seq: 100, viewer: 0, pending_discards: { 0: 0 } }))).toBe(true);
});

// ---------------------------------------------------------------------------
// Choosing the settle: the priority order
// ---------------------------------------------------------------------------

test("a patch answers for itself, ahead of everything else", () => {
  expect(settleFor("build_settlement", undefined, true, base())).toEqual({ by: "patch" });
  // A patch wins even when the command also resolves a pending
  // (`deserter_place`).
  expect(settleFor("deserter_place", "deserter_place", true, base())).toEqual({ by: "patch" });
});

test("a pending-resolving command settles on its pending, never on the clock", () => {
  // These must not fall through to `{by:"seq"}` (see above).
  for (const [type, kind] of [
    ["discard_cards", "discard"],
    ["give_cards", "give"],
    ["harbor_give", "harbor"],
    ["aqueduct_pick", "aqueduct"],
    ["relocate_knight", "relocate_knight"],
    ["metropolis_pick", "metropolis_pick"],
  ] as const) {
    expect(settleFor(type, kind, false, base())).toEqual({ by: "pending", kind });
  }
});

test("the two controls with no position to state wait on the fact they mean", () => {
  expect(settleFor("roll_dice", undefined, false, base())).toEqual({ by: "rolled" });
  expect(settleFor("end_turn", undefined, false, base({ cur: 2 }))).toEqual({ by: "turn", cur: 2 });
});

test("the weak fallback is reached only where there is nothing to undo", () => {
  // No patch, no pending claim. A staged cost is fine: the spend overlay is
  // seq-gated on its own.
  expect(settleFor("offer_trade", undefined, false, base({ seq: 7 }))).toEqual({
    by: "seq",
    seq: 7,
  });
  expect(settleFor("buy_dev_card", undefined, false, base({ seq: 7 }))).toEqual({
    by: "seq",
    seq: 7,
  });
});
