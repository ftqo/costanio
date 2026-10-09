import { expect, test } from "vitest";
import { FREE_SEAT_COLORS, isFreeSeatColor } from "./freeColors";

test("there are exactly ten free colours", () => {
  // cosmetics.FreeCount. The Go drift test checks the same thing and names the
  // mismatch.
  expect(FREE_SEAT_COLORS).toHaveLength(10);
});

test("every entry is a lowercase 6-digit hex", () => {
  // Cache keys are built from these, so an uppercase or 3-digit form would
  // split one colour's cache across two entries.
  for (const c of FREE_SEAT_COLORS) expect(c).toMatch(/^#[0-9a-f]{6}$/);
});

test("the free colours are distinct", () => {
  expect(new Set(FREE_SEAT_COLORS).size).toBe(FREE_SEAT_COLORS.length);
});

test("a free colour is recognised however it is written", () => {
  // A colour reaches the client from the seat wire, a cosmetics loadout and the
  // colourblind override, and they do not all agree on case or the leading #.
  expect(isFreeSeatColor("#ff0000")).toBe(true);
  expect(isFreeSeatColor("#FF0000")).toBe(true);
  expect(isFreeSeatColor("ff0000")).toBe(true);
  expect(isFreeSeatColor("FF0000")).toBe(true);
});

test("a supporter colour is not free, and so is never persisted", () => {
  // A supporter-gated cube colour renders on the fly and stays in memory, so
  // the disk cache does not grow with the long tail.
  expect(isFreeSeatColor("#aa5500")).toBe(false);
  expect(isFreeSeatColor("#55aa55")).toBe(false);
});

test("an absent colour is not free", () => {
  // Spectators and pre-seat renders arrive here as null/undefined/"".
  expect(isFreeSeatColor(null)).toBe(false);
  expect(isFreeSeatColor(undefined)).toBe(false);
  expect(isFreeSeatColor("")).toBe(false);
});
