import { test, expect } from "vitest";
import { NO_SPENT, addSpent, dropSpend, spentFor, CMD_COST } from "./optimistic";

test("addSpent applies a cost against the current seq", () => {
  const s = addSpent(NO_SPENT, 10, "a", CMD_COST.build_knight); // sheep(3)+ore(5)
  expect(s.seq).toBe(10);
  expect(s.spends).toHaveLength(1);
  expect(spentFor(s, 10, 3)).toBe(1);
  expect(spentFor(s, 10, 5)).toBe(1);
});

test("overlay expires when the snapshot seq advances (no double-count)", () => {
  const s = addSpent(NO_SPENT, 10, "a", CMD_COST.build_knight);
  // A newer authoritative snapshot (seq 11) already reflects the deduction, so
  // the overlay must contribute nothing.
  expect(spentFor(s, 11, 3)).toBe(0);
  expect(spentFor(s, 11, 5)).toBe(0);
});

test("multiple actions before a snapshot accumulate on the same seq", () => {
  let s = addSpent(NO_SPENT, 10, "a", CMD_COST.build_knight); // sheep+ore
  s = addSpent(s, 10, "b", CMD_COST.activate_knight); // wheat(4)
  expect(spentFor(s, 10, 3)).toBe(1); // sheep
  expect(spentFor(s, 10, 4)).toBe(1); // wheat
  expect(spentFor(s, 10, 5)).toBe(1); // ore
});

test("a stale overlay is discarded before a new action accumulates", () => {
  const old = addSpent(NO_SPENT, 10, "a", CMD_COST.build_city); // wheat+ore
  // Snapshot advanced to 11; a new action should not carry the old city cost.
  const s = addSpent(old, 11, "b", CMD_COST.build_knight);
  expect(s.seq).toBe(11);
  expect(spentFor(s, 11, 4)).toBe(0); // no leftover wheat from the city
  expect(spentFor(s, 11, 3)).toBe(1); // just the knight's sheep
  expect(spentFor(s, 11, 5)).toBe(1); // and ore
});

test("promote costs the same as a knight build; setup/improve are free", () => {
  expect(CMD_COST.promote_knight).toEqual(CMD_COST.build_knight);
  expect(CMD_COST.place_settlement).toBeUndefined();
  expect(CMD_COST.improve_city).toBeUndefined();
});

test("free road/ship placement does not deduct resources from the overlay", () => {
  // During Road Building the road is free; no wood/brick should dim.
  const s = addSpent(NO_SPENT, 5, "a", CMD_COST.build_road, /* free= */ true);
  expect(s.seq).toBe(5);
  // wood (1) and brick (2) must not be deducted
  expect(spentFor(s, 5, 1)).toBe(0);
  expect(spentFor(s, 5, 2)).toBe(0);
});

test("free flag only affects roads", () => {
  // Passing free=false on a knight is identical to omitting the flag.
  const paid = addSpent(NO_SPENT, 7, "a", CMD_COST.build_knight, /* free= */ false);
  expect(spentFor(paid, 7, 3)).toBe(1); // sheep
  expect(spentFor(paid, 7, 5)).toBe(1); // ore
});

test("free road accumulates seq correctly alongside other actions", () => {
  // A paid knight then a free road: knight cost stays, road adds nothing.
  let s = addSpent(NO_SPENT, 10, "a", CMD_COST.build_knight);
  s = addSpent(s, 10, "b", CMD_COST.build_road, /* free= */ true);
  expect(spentFor(s, 10, 3)).toBe(1); // sheep (knight)
  expect(spentFor(s, 10, 5)).toBe(1); // ore   (knight)
  expect(spentFor(s, 10, 1)).toBe(0); // wood  (road, free)
  expect(spentFor(s, 10, 2)).toBe(0); // brick (road, free)
});

// ---------------------------------------------------------------------------
// Undoing one command's spend without disturbing the others
// ---------------------------------------------------------------------------

test("a refusal withdraws only the cost of the command it names", () => {
  // Refusing one of two staged builds must not hand back the other's resources.
  let s = addSpent(NO_SPENT, 10, "city", CMD_COST.build_city); // wheat(4)x2 + ore(5)x3
  s = addSpent(s, 10, "knight", CMD_COST.build_knight); // sheep(3) + ore(5)
  const after = dropSpend(s, "knight");
  expect(spentFor(after, 10, 3)).toBe(0); // the knight's sheep is back
  expect(spentFor(after, 10, 4)).toBe(CMD_COST.build_city[4]); // the city's wheat is not
  expect(spentFor(after, 10, 5)).toBe(CMD_COST.build_city[5]); // nor its ore
});

test("dropping the last spend empties the overlay", () => {
  const s = addSpent(NO_SPENT, 10, "a", CMD_COST.build_knight);
  const after = dropSpend(s, "a");
  expect(after.spends).toEqual([]);
  expect(spentFor(after, 10, 3)).toBe(0);
});

test("dropping an id the overlay never held is identity-stable", () => {
  // A refusal about a free or superseded command must not cause a render.
  const s = addSpent(NO_SPENT, 10, "a", CMD_COST.build_knight);
  expect(dropSpend(s, "zz")).toBe(s);
  expect(dropSpend(s, undefined)).toBe(s);
});

test("a free placement files nothing, so there is nothing to withdraw", () => {
  const s = addSpent(NO_SPENT, 10, "road", CMD_COST.build_road, /* free= */ true);
  expect(s.spends).toEqual([]);
  expect(dropSpend(s, "road")).toBe(s);
});

test("the same cost staged twice is withdrawn one at a time", () => {
  // Two roads in one armed build mode: refusing the second leaves the first
  // deducted.
  let s = addSpent(NO_SPENT, 10, "r1", CMD_COST.build_road);
  s = addSpent(s, 10, "r2", CMD_COST.build_road);
  expect(spentFor(s, 10, 1)).toBe(2 * CMD_COST.build_road[1]);
  const after = dropSpend(s, "r2");
  expect(spentFor(after, 10, 1)).toBe(CMD_COST.build_road[1]);
});
