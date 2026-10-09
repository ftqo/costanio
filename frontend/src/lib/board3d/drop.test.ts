import { describe, expect, it } from "vitest";
import {
  DROP_BULK_LIMIT,
  DROP_FALL_MS,
  DROP_HEIGHT,
  DROP_STAGGER_MS,
  DROP_TOTAL_MS,
  dropPose,
  dropStarts,
  newlyPlaced,
  pieceKey,
  stillFalling,
} from "./drop";

describe("dropPose", () => {
  it("starts in the air and ends at rest", () => {
    expect(dropPose(0)).toEqual({ lift: DROP_HEIGHT, squashY: 1 });
    expect(dropPose(DROP_TOTAL_MS)).toEqual({ lift: 0, squashY: 1 });
  });

  it("holds in the air before its slot", () => {
    expect(dropPose(-500).lift).toBe(DROP_HEIGHT);
  });

  it("does not extrapolate past the end", () => {
    expect(dropPose(DROP_TOTAL_MS * 10)).toEqual({ lift: 0, squashY: 1 });
  });

  it("accelerates: the second half of the fall covers more ground", () => {
    const first = DROP_HEIGHT - dropPose(DROP_FALL_MS / 2).lift;
    const second = dropPose(DROP_FALL_MS / 2).lift - dropPose(DROP_FALL_MS * 0.999).lift;
    expect(second).toBeGreaterThan(first);
  });

  it("falls monotonically", () => {
    let last = Infinity;
    for (let t = 0; t <= DROP_FALL_MS; t += 10) {
      const { lift } = dropPose(t);
      expect(lift).toBeLessThanOrEqual(last);
      last = lift;
    }
  });

  it("squashes only on landing, and never stretches", () => {
    expect(dropPose(DROP_FALL_MS / 2).squashY).toBe(1);
    const mid = dropPose(DROP_FALL_MS + (DROP_TOTAL_MS - DROP_FALL_MS) / 2).squashY;
    expect(mid).toBeGreaterThan(0.5);
    expect(mid).toBeLessThan(1);
    for (let t = DROP_FALL_MS; t <= DROP_TOTAL_MS; t += 5) {
      expect(dropPose(t).squashY).toBeLessThanOrEqual(1);
    }
  });
});

describe("newlyPlaced", () => {
  const key = (n: number) => pieceKey("road", 0, `e${n}`);

  it("drops nothing on the first build of a board", () => {
    expect(newlyPlaced(null, [key(1), key(2), key(3)])).toEqual([]);
  });

  it("finds only the added keys", () => {
    const prev = new Set([key(1), key(2)]);
    expect(newlyPlaced(prev, [key(1), key(2), key(3)])).toEqual([key(3)]);
  });

  it("ignores removals", () => {
    const prev = new Set([key(1), key(2)]);
    expect(newlyPlaced(prev, [key(1)])).toEqual([]);
  });

  it("drops nothing when the whole board arrives at once", () => {
    const next = Array.from({ length: DROP_BULK_LIMIT + 1 }, (_, i) => key(i));
    expect(newlyPlaced(new Set(), next)).toEqual([]);
  });

  it("still animates a batch at the limit", () => {
    const next = Array.from({ length: DROP_BULK_LIMIT }, (_, i) => key(i));
    expect(newlyPlaced(new Set(), next)).toHaveLength(DROP_BULK_LIMIT);
  });

  it("treats a piece changing hands as a new piece", () => {
    const prev = new Set([pieceKey("settlement", 0, "v1")]);
    expect(newlyPlaced(prev, [pieceKey("settlement", 1, "v1")])).toEqual([
      pieceKey("settlement", 1, "v1"),
    ]);
  });

  it("treats an upgrade to a city as a placement", () => {
    const prev = new Set([pieceKey("settlement", 0, "v1")]);
    expect(newlyPlaced(prev, [pieceKey("city", 0, "v1")])).toEqual([pieceKey("city", 0, "v1")]);
  });
});

describe("dropStarts", () => {
  it("staggers in a stable order regardless of how the planners emitted them", () => {
    const a = dropStarts(["b", "a"], 1000);
    const b = dropStarts(["a", "b"], 1000);
    expect([...a]).toEqual([...b]);
    expect(a.get("a")).toBe(1000);
    expect(a.get("b")).toBe(1000 + DROP_STAGGER_MS);
  });

  it("does not stagger a lone piece", () => {
    expect(dropStarts(["a"], 500).get("a")).toBe(500);
  });
});

describe("stillFalling", () => {
  const live = new Set(["a", "b"]);

  it("keeps a fall in progress across a rebuild, with its original start", () => {
    const kept = stillFalling(new Map([["a", 100]]), live, 100 + DROP_TOTAL_MS / 2);
    expect(kept.get("a")).toBe(100);
  });

  it("forgets a fall that has landed", () => {
    expect(stillFalling(new Map([["a", 100]]), live, 100 + DROP_TOTAL_MS)).toEqual(new Map());
  });

  it("forgets a piece that left the board mid-fall", () => {
    const kept = stillFalling(new Map([["gone", 100]]), live, 150);
    expect(kept.size).toBe(0);
  });
});
