import { describe, expect, it, test } from "vitest";
import { seatRingAnim, timerTier, tierEndsInMs, type TimerTier } from "./seatRing";
import { timerBarPct } from "./gamestate";

// The keyframe's transform-only contract is asserted as text in
// seatRing.css.test.ts. These cover turning a remaining/budget pair into a
// position in that keyframe.

describe("seatRingAnim", () => {
  const BUDGET = 60_000;

  const cases: {
    name: string;
    remaining: number | null;
    budget: number | null;
    want: { static: boolean; durationMs: number; delayMs: number } | null;
  }[] = [
    {
      name: "no countdown for this seat (bot/auto seat, or timers off)",
      remaining: null,
      budget: null,
      want: null,
    },
    {
      name: "no countdown, even with a budget stamped",
      remaining: null,
      budget: BUDGET,
      want: null,
    },
    {
      name: "no budget: a full, motionless ring",
      remaining: 12_345,
      budget: null,
      want: { static: true, durationMs: 0, delayMs: 0 },
    },
    {
      name: "zero budget is treated as no budget",
      remaining: 12_345,
      budget: 0,
      want: { static: true, durationMs: 0, delayMs: 0 },
    },
    {
      name: "negative budget is treated as no budget",
      remaining: 12_345,
      budget: -1,
      want: { static: true, durationMs: 0, delayMs: 0 },
    },
    {
      name: "untouched budget starts at the head of the keyframe",
      remaining: BUDGET,
      budget: BUDGET,
      want: { static: false, durationMs: BUDGET, delayMs: 0 },
    },
    {
      name: "half spent starts halfway in",
      remaining: BUDGET / 2,
      budget: BUDGET,
      want: { static: false, durationMs: BUDGET, delayMs: -BUDGET / 2 },
    },
    {
      name: "expired lands on the keyframe's end (fill-mode holds it empty)",
      remaining: 0,
      budget: BUDGET,
      want: { static: false, durationMs: BUDGET, delayMs: -BUDGET },
    },
    {
      name: "remaining above the budget clamps rather than delaying the start",
      remaining: BUDGET * 2,
      budget: BUDGET,
      want: { static: false, durationMs: BUDGET, delayMs: 0 },
    },
    {
      name: "remaining below zero clamps to spent",
      remaining: -5_000,
      budget: BUDGET,
      want: { static: false, durationMs: BUDGET, delayMs: -BUDGET },
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const got = seatRingAnim(c.remaining, c.budget);
      if (c.want == null) {
        expect(got).toBeNull();
        return;
      }
      expect(got).not.toBeNull();
      expect(got!.static).toBe(c.want.static);
      expect(got!.durationMs).toBe(c.want.durationMs);
      expect(got!.delayMs).toBe(c.want.delayMs);
    });
  }

  it("never produces a positive delay", () => {
    for (const remaining of [-1, 0, 1, 999, 30_000, 60_000, 120_000]) {
      const got = seatRingAnim(remaining, BUDGET);
      expect(got!.delayMs).toBeLessThanOrEqual(0);
    }
  });

  it("draws something for every budget a live seat can carry", () => {
    // null/0 budgets take the `static` branch and the real one does not; neither
    // may return null while the seat has time left.
    for (const budget of [null, 0, BUDGET]) {
      expect(seatRingAnim(1_000, budget)).not.toBeNull();
    }
  });

  // React must leave a running bar alone across re-renders with the same
  // numbers, and remount it when the server sends new ones.
  it("keys on the pair, so it restarts only when the pair changes", () => {
    expect(seatRingAnim(30_000, BUDGET)!.key).toBe(seatRingAnim(30_000, BUDGET)!.key);
    expect(seatRingAnim(30_000, BUDGET)!.key).not.toBe(seatRingAnim(29_000, BUDGET)!.key);
    expect(seatRingAnim(30_000, BUDGET)!.key).not.toBe(seatRingAnim(30_000, 30_000)!.key);
  });

  // The remaining stream can tick upward, so using it as the budget would
  // re-fill the bar mid-countdown.
  it("does not substitute the remaining for a missing budget", () => {
    const got = seatRingAnim(12_345, null)!;
    expect(got.durationMs).toBe(0);
    expect(got.durationMs).not.toBe(12_345);
  });
});

// The coin's ring and the expanded card's bar read the same two numbers and
// must agree on the budget-less fallback.
test("ring and bar agree that a missing budget means full", () => {
  expect(seatRingAnim(12_345, null)).toMatchObject({ static: true, delayMs: 0 });
  expect(timerBarPct(12_345, null)).toBe(100);
  expect(seatRingAnim(12_345, 0)).toMatchObject({ static: true, delayMs: 0 });
  expect(timerBarPct(12_345, 0)).toBe(100);
});

// The colour keys off absolute seconds, not a fraction of the budget: ten
// seconds is equally urgent on a 30s discard and a 120s turn.
describe("timerTier", () => {
  const cases: { name: string; remaining: number | null; want: TimerTier }[] = [
    { name: "no countdown at all", remaining: null, want: "green" },
    { name: "plenty of time", remaining: 120_000, want: "green" },
    { name: "just above the yellow line", remaining: 30_001, want: "green" },
    { name: "exactly on the yellow line", remaining: 30_000, want: "yellow" },
    { name: "just above the red line", remaining: 10_001, want: "yellow" },
    { name: "exactly on the red line", remaining: 10_000, want: "red" },
    { name: "seconds left", remaining: 2_500, want: "red" },
    { name: "expired", remaining: 0, want: "red" },
  ];
  for (const c of cases) {
    it(c.name, () => expect(timerTier(c.remaining)).toBe(c.want));
  }
});

// What the bar arms its timeout with. Each answer must land exactly on the
// next crossing: earlier re-renders to the same colour, later shows the old
// colour too long.
describe("tierEndsInMs", () => {
  it("counts down to yellow from green", () => {
    expect(tierEndsInMs(45_000)).toBe(15_000);
    expect(timerTier(45_000 - tierEndsInMs(45_000)!)).toBe("yellow");
  });
  it("counts down to red from yellow", () => {
    expect(tierEndsInMs(25_000)).toBe(15_000);
    expect(timerTier(25_000 - tierEndsInMs(25_000)!)).toBe("red");
  });
  it("has nothing left to become once red", () => {
    expect(tierEndsInMs(9_000)).toBeNull();
    expect(tierEndsInMs(0)).toBeNull();
    expect(tierEndsInMs(null)).toBeNull();
  });
});
