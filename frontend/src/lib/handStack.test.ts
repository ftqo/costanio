import { describe, it, expect } from "vitest";
import { handStack, HAND_STACK_STEP } from "@/lib/handStack";

describe("handStack", () => {
  it("draws nothing behind zero or one card", () => {
    for (const n of [-1, 0, 1]) {
      const s = handStack(n);
      expect(s.behind).toHaveLength(0);
      expect(s.width).toBe(1);
    }
  });

  // No cap: depth must track the count, especially near the discard
  // threshold.
  it("draws one card per copy however deep the pile goes", () => {
    for (const n of [2, 7, 8, 13, 40]) {
      expect(handStack(n).behind).toHaveLength(n - 1);
      expect(handStack(n).width).toBeCloseTo(1 + (n - 1) * HAND_STACK_STEP);
    }
  });

  // The slot must contain its backs, or a deep pile reaches under its
  // neighbour and looks truncated.
  it("is exactly as wide as the pile it draws", () => {
    for (let n = 1; n <= 40; n++) {
      const s = handStack(n);
      expect(s.width).toBeCloseTo(1 + (n - 1) * HAND_STACK_STEP);
      // Every back lands inside the slot; the front card (one card wide, at the
      // right edge) sets the width.
      for (const off of s.behind) expect(off + 1).toBeLessThanOrEqual(s.width + 1e-9);
    }
  });

  it("fans left from the slot's left edge", () => {
    const s = handStack(4);
    expect(s.behind[0]).toBe(0); // the back-most card starts the slot
    // Ascending, so DOM order is paint order and the front card lands on top.
    const steps = [...s.behind, s.width - 1];
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i] - steps[i - 1]).toBeCloseTo(HAND_STACK_STEP);
    }
  });

  it("steps by an eighth of a card, measured in card widths", () => {
    // Card widths, not pixels, since cards change size across the breakpoint.
    expect(HAND_STACK_STEP).toBe(0.125);
    expect(handStack(2).behind).toEqual([0]);
    expect(handStack(3).behind).toEqual([0, 0.125]);
  });

  it("hands the same object back for the same pile", () => {
    expect(handStack(3)).toBe(handStack(3));
    expect(handStack(3.4)).toBe(handStack(3));
  });
});
