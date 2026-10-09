import { test, expect } from "vitest";
import {
  applyEdits,
  beginEdit,
  deepEqual,
  dropEdit,
  nextDeadline,
  pick,
  pruneEdits,
  settleEdit,
  EDIT_TIMEOUT_MS,
  SETTLE_HOLD_MS,
  type PendingEdit,
} from "./lobbyOptimistic";

interface Cfg {
  players: number;
  target_vp: number;
  ruleset: string;
  modules?: Record<string, unknown>;
}

const SERVER: Cfg = { players: 4, target_vp: 10, ruleset: "base" };
const T0 = 1_000_000;

test("an edit shows before the server has answered", () => {
  const edits = beginEdit<Cfg>([], 1, { target_vp: 12 }, T0);
  expect(applyEdits(SERVER, edits).target_vp).toBe(12);
  // and leaves everything it did not touch alone
  expect(applyEdits(SERVER, edits).players).toBe(4);
});

test("no edits is the server value itself, identity included", () => {
  expect(applyEdits(SERVER, [])).toBe(SERVER);
});

test("an edit the server already agrees with does not re-render the panel", () => {
  // A settled edit holds the server's own answer, so a summary carrying that
  // answer must not produce a fresh object.
  const edits = beginEdit<Cfg>([], 1, { target_vp: 10 }, T0);
  expect(applyEdits(SERVER, edits)).toBe(SERVER);
});

test("later edits win over earlier ones for the same field", () => {
  let edits = beginEdit<Cfg>([], 1, { target_vp: 12 }, T0);
  edits = beginEdit(edits, 2, { target_vp: 13 }, T0 + 50);
  expect(applyEdits(SERVER, edits).target_vp).toBe(13);
});

test("settling swaps in the server's answer, so a clamp corrects itself", () => {
  // Host asks for 18; switching Knights off drops the ceiling and the server
  // answers 13. The overlay shows 13.
  let edits = beginEdit<Cfg>([], 1, { target_vp: 18 }, T0);
  const answered: Cfg = { ...SERVER, target_vp: 13 };
  edits = settleEdit(edits, 1, pick(answered, { target_vp: 18 }), T0 + 120);
  expect(applyEdits(SERVER, edits).target_vp).toBe(13);
  expect(edits[0].settled).toBe(true);
});

test("a settled edit pins the answer against a summary captured before it", () => {
  // The REST answer lands, then a delayed `lobby` broadcast (or an in-flight
  // refetch) delivers the old config. The control must not flip back.
  let edits = beginEdit<Cfg>([], 1, { ruleset: "base+cak" }, T0);
  edits = settleEdit(edits, 1, { ruleset: "base+cak" }, T0 + 120);
  const stale: Cfg = { ...SERVER, ruleset: "base" };
  expect(applyEdits(stale, edits).ruleset).toBe("base+cak");
  // …and the pin is released once the hold is up.
  const { edits: kept, reverted } = pruneEdits(edits, T0 + 120 + SETTLE_HOLD_MS + 1);
  expect(kept).toHaveLength(0);
  expect(reverted).toBe(0); // a hold ending is not a revert
});

test("a refusal withdraws exactly its own edit", () => {
  let edits = beginEdit<Cfg>([], 1, { target_vp: 12 }, T0);
  edits = beginEdit(edits, 2, { players: 6 }, T0 + 10);
  edits = dropEdit(edits, 1);
  const shown = applyEdits(SERVER, edits);
  expect(shown.target_vp).toBe(10); // back to the server's truth
  expect(shown.players).toBe(6); // the other edit still stands
});

test("dropping an unknown id is identity-stable", () => {
  const edits = beginEdit<Cfg>([], 1, { target_vp: 12 }, T0);
  expect(dropEdit(edits, 99)).toBe(edits);
});

test("an unanswered edit reverts on the timeout and reports it", () => {
  const edits = beginEdit<Cfg>([], 1, { target_vp: 12 }, T0);
  expect(pruneEdits(edits, T0 + EDIT_TIMEOUT_MS - 1).edits).toHaveLength(1);
  const out = pruneEdits(edits, T0 + EDIT_TIMEOUT_MS + 1);
  expect(out.edits).toHaveLength(0);
  expect(out.reverted).toBe(1);
  expect(applyEdits(SERVER, out.edits).target_vp).toBe(10);
});

test("settling an id the timeout already dropped is a no-op", () => {
  const edits: PendingEdit<Cfg>[] = [];
  expect(settleEdit(edits, 7, { target_vp: 12 }, T0)).toBe(edits);
});

test("the wake-up is the earliest deadline outstanding", () => {
  expect(nextDeadline([])).toBeNull();
  let edits = beginEdit<Cfg>([], 1, { target_vp: 12 }, T0);
  edits = beginEdit(edits, 2, { players: 6 }, T0 + 1000);
  expect(nextDeadline(edits)).toBe(T0 + EDIT_TIMEOUT_MS);
  // Settling the older one shortens its deadline to the hold and it stays the
  // earliest, so the timer must be recomputed.
  edits = settleEdit(edits, 1, { target_vp: 12 }, T0 + 100);
  expect(nextDeadline(edits)).toBe(T0 + 100 + SETTLE_HOLD_MS);
});

test("pick takes the server's values for exactly the fields an edit touched", () => {
  const answered: Cfg = { players: 6, target_vp: 13, ruleset: "base" };
  expect(pick(answered, { target_vp: 18, players: 6 })).toEqual({ players: 6, target_vp: 13 });
});

test("deepEqual compares structure, not key order", () => {
  expect(deepEqual({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 })).toBe(true);
  expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
  expect(deepEqual([1, 2], [2, 1])).toBe(false);
  expect(deepEqual(null, {})).toBe(false);
});

test("a module option edit replaces the whole modules slice", () => {
  const server: Cfg = { ...SERVER, modules: { islands: { island_vp: 2, pirate: true } } };
  const edits = beginEdit<Cfg>([], 1, { modules: { islands: { island_vp: 3, pirate: true } } }, T0);
  expect(applyEdits(server, edits).modules).toEqual({ islands: { island_vp: 3, pirate: true } });
});
