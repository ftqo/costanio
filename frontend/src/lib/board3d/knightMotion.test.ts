import { describe, test, expect } from "vitest";
import {
  hopPose,
  newlyReady,
  HOP_HEIGHT,
  HOP_RISE_MS,
  HOP_SETTLE_MS,
  HOP_TOTAL_MS,
} from "./knightMotion";
import { DROP_SETTLE_MS, DROP_STAGGER_MS, DROP_BULK_LIMIT, dropStarts } from "./drop";

describe("hopPose", () => {
  test("is the identity before it starts and after it ends", () => {
    // The pose is an offset from the placement and exactly zero at both ends,
    // so a knight readied repeatedly never drifts. A staggered wait rests on
    // the board, unlike a drop's.
    for (const t of [-1000, -1, 0, HOP_TOTAL_MS, HOP_TOTAL_MS + 1, 1e6]) {
      expect(hopPose(t), `t = ${t}`).toEqual({ lift: 0, squashY: 1 });
    }
  });

  test("rises, peaks mid-rise, and lands", () => {
    expect(hopPose(1).lift).toBeGreaterThan(0);
    expect(hopPose(HOP_RISE_MS / 2).lift).toBeCloseTo(HOP_HEIGHT, 6);
    expect(hopPose(HOP_RISE_MS - 1).lift).toBeGreaterThan(0);
    expect(hopPose(HOP_RISE_MS).lift).toBe(0);
    // Symmetric: a ballistic hop rises and falls the same way.
    for (const t of [10, 40, 90]) {
      expect(hopPose(t).lift).toBeCloseTo(hopPose(HOP_RISE_MS - t).lift, 6);
    }
  });

  test("never goes as high as a piece is dropped from", () => {
    // A hop is coming to attention in place; anything near DROP_HEIGHT would
    // read as a placement.
    let peak = 0;
    for (let t = 0; t <= HOP_TOTAL_MS; t++) peak = Math.max(peak, hopPose(t).lift);
    expect(peak).toBeCloseTo(HOP_HEIGHT, 6);
    expect(peak).toBeLessThan(0.5);
  });

  test("lands with the drop's settle, and never overshoots it", () => {
    expect(HOP_SETTLE_MS).toBe(DROP_SETTLE_MS);
    const mid = hopPose(HOP_RISE_MS + HOP_SETTLE_MS / 2);
    expect(mid.lift).toBe(0);
    expect(mid.squashY).toBeLessThan(1);
    // Compresses and returns with no bounce past full height.
    for (let t = HOP_RISE_MS; t < HOP_TOTAL_MS; t++) {
      expect(hopPose(t).squashY).toBeLessThanOrEqual(1);
      expect(hopPose(t).squashY).toBeGreaterThan(0.9);
    }
  });

  test("is continuous where the rise hands over to the settle", () => {
    // A step at the handover would read as the knight snapping.
    expect(hopPose(HOP_RISE_MS - 1).lift).toBeLessThan(0.02);
    expect(hopPose(HOP_RISE_MS).squashY).toBeCloseTo(1, 6);
  });
});

describe("newlyReady", () => {
  const standing = new Set(["knight:0:a", "knight:0:b", "knight:1:c"]);

  test("finds a knight that just stood to attention", () => {
    expect(newlyReady(new Set(["knight:0:a"]), ["knight:0:a", "knight:0:b"], standing)).toEqual([
      "knight:0:b",
    ]);
  });

  test("says nothing about a board it has not seen before", () => {
    // A spectator arriving, a rejoin, a replay scrubbed forward: none of its
    // active knights just readied.
    expect(newlyReady(null, ["knight:0:a", "knight:0:b"], standing)).toEqual([]);
  });

  test("ignores a knight that was already ready, and one that stood down", () => {
    expect(newlyReady(new Set(["knight:0:a", "knight:0:b"]), ["knight:0:a"], standing)).toEqual([]);
  });

  test("refuses a knight that was not on the board last commit", () => {
    // Moving an active knight changes its key (the vertex is in it), so the
    // new key is new to the ready set as well as to the board. Without this it
    // would be dropped and hopped at once, two poses on one instance.
    const moved = "knight:0:z";
    expect(newlyReady(new Set(["knight:0:a"]), ["knight:0:a", moved], standing)).toEqual([]);
    // The arrival wins: drop.ts still sees the new key.
    expect(standing.has(moved)).toBe(false);
  });

  test("a bulk arrival of ready knights is a state load, not an event", () => {
    const many = Array.from({ length: DROP_BULK_LIMIT + 2 }, (_, i) => `knight:0:${i}`);
    expect(newlyReady(new Set(), many, new Set(many))).toEqual([]);
  });

  test("hands its keys to dropStarts, which staggers them in a stable order", () => {
    // One command cannot ready two knights, but a rebuild can land two
    // messages together. Ordering by key keeps a rebuild mid-hop from
    // reshuffling one already in the air.
    const keys = newlyReady(new Set(), ["knight:0:b", "knight:0:a"], standing);
    expect([...dropStarts(keys, 1000).entries()]).toEqual([
      ["knight:0:a", 1000],
      ["knight:0:b", 1000 + DROP_STAGGER_MS],
    ]);
  });
});
