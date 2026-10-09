import { test, expect } from "vitest";
import { placeTooltip } from "./floating";

const VIEWPORT = { width: 1000, height: 800 };
const TIP = { width: 220, height: 40 };
const M = 6; // default margin

// anchor helper: a rect of the trigger element in layout (CSS) px.
const anchor = (left: number, top: number, w = 24, h = 24) => ({
  left,
  top,
  right: left + w,
  bottom: top + h,
  width: w,
  height: h,
});

test("a centered trigger places the tip centered above it", () => {
  const p = placeTooltip(anchor(500, 400), TIP, VIEWPORT);
  expect(p.placement).toBe("above");
  // centered: left = center - tipW/2 = (500+12) - 110 = 402
  expect(p.left).toBeCloseTo(402, 5);
  expect(p.left + TIP.width).toBeLessThanOrEqual(VIEWPORT.width - M);
});

test("a left-edge trigger does not overflow the left viewport edge", () => {
  // Trigger near the left edge (the 'Resource cards' / 'Defender of the realm' case).
  const p = placeTooltip(anchor(20, 400), TIP, VIEWPORT);
  expect(p.left).toBeGreaterThanOrEqual(M);
  expect(p.left + TIP.width).toBeLessThanOrEqual(VIEWPORT.width - M);
});

test("a right-edge trigger does not overflow the right viewport edge", () => {
  const p = placeTooltip(anchor(970, 400), TIP, VIEWPORT);
  expect(p.left).toBeGreaterThanOrEqual(M);
  expect(p.left + TIP.width).toBeLessThanOrEqual(VIEWPORT.width - M);
});

test("a top-edge trigger flips below instead of clipping the top", () => {
  const p = placeTooltip(anchor(500, 4), TIP, VIEWPORT);
  expect(p.placement).toBe("below");
  expect(p.top).toBeGreaterThanOrEqual(M);
});

test("a bottom-edge trigger stays within the bottom viewport edge", () => {
  const p = placeTooltip(anchor(500, 790), TIP, VIEWPORT);
  expect(p.top + TIP.height).toBeLessThanOrEqual(VIEWPORT.height - M);
});

test("respects a custom margin and gap", () => {
  const p = placeTooltip(anchor(0, 400), TIP, VIEWPORT, { margin: 12, gap: 4 });
  expect(p.left).toBeGreaterThanOrEqual(12);
});
