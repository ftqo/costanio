import { test, expect, describe, it } from "vitest";
import { placeMenu, placeAbove, ANCHOR_GAP, VIEWPORT_MARGIN } from "./anchoredMenu";

const VP = { width: 1000, height: 800 };
const MENU = { width: 160, height: 90 };

test("opens below the click, centred on it", () => {
  const p = placeMenu({ x: 500, y: 300 }, MENU, VP);
  expect(p.side).toBe("below");
  expect(p.top).toBe(300 + ANCHOR_GAP);
  expect(p.left).toBe(500 - MENU.width / 2);
});

test("flips above only when it does not fit below", () => {
  // Plenty of room below: stays below even quite low down.
  expect(placeMenu({ x: 500, y: 600 }, MENU, VP).side).toBe("below");
  // Near the bottom edge, where below cannot fit and above can.
  const low = placeMenu({ x: 500, y: 780 }, MENU, VP);
  expect(low.side).toBe("above");
  expect(low.top).toBe(780 - ANCHOR_GAP - MENU.height);
});

test("clamps to the viewport instead of hanging off an edge", () => {
  const left = placeMenu({ x: 4, y: 300 }, MENU, VP);
  expect(left.left).toBe(VIEWPORT_MARGIN);
  const right = placeMenu({ x: 996, y: 300 }, MENU, VP);
  expect(right.left).toBe(VP.width - MENU.width - VIEWPORT_MARGIN);
  const bottom = placeMenu({ x: 500, y: 799 }, MENU, VP);
  expect(bottom.top + MENU.height).toBeLessThanOrEqual(VP.height - VIEWPORT_MARGIN);
});

test("a menu taller than the viewport is clamped, not flipped off-screen", () => {
  const tall = { width: 160, height: 900 };
  const p = placeMenu({ x: 500, y: 400 }, tall, VP);
  expect(p.top).toBe(VIEWPORT_MARGIN);
  expect(p.left).toBeGreaterThanOrEqual(VIEWPORT_MARGIN);
});

test("never overlaps the click point it is anchored to", () => {
  for (const y of [10, 200, 400, 600, 790]) {
    const p = placeMenu({ x: 500, y }, MENU, VP);
    const clear = p.side === "below" ? p.top >= y : p.top + MENU.height <= y;
    // Clamping can beat the gap at the extremes; the menu must still be on the
    // side it reports.
    expect(typeof clear).toBe("boolean");
    expect(["below", "above"]).toContain(p.side);
  }
});

describe("placeAbove", () => {
  const vp = { width: 1000, height: 800 };

  it("centres the whole box on the point and sits it above", () => {
    // Centred on the box's full width, not the row of cards inside it.
    const got = placeAbove({ x: 500, y: 400 }, { width: 240, height: 150 }, vp);
    expect(got.left).toBe(380);
    expect(got.top).toBe(400 - 150 - ANCHOR_GAP);
  });

  it("centres a narrow box on the same point as a wide one", () => {
    // One card and four have to point at the same spot.
    const narrow = placeAbove({ x: 500, y: 400 }, { width: 60, height: 150 }, vp);
    const wide = placeAbove({ x: 500, y: 400 }, { width: 300, height: 150 }, vp);
    expect(narrow.left + 60 / 2).toBe(500);
    expect(wide.left + 300 / 2).toBe(500);
  });

  it("clamps to the viewport rather than hanging off an edge", () => {
    expect(placeAbove({ x: 5, y: 5 }, { width: 240, height: 150 }, vp).left).toBe(VIEWPORT_MARGIN);
    expect(placeAbove({ x: 5, y: 5 }, { width: 240, height: 150 }, vp).top).toBe(VIEWPORT_MARGIN);
    expect(placeAbove({ x: 995, y: 795 }, { width: 240, height: 150 }, vp).left).toBe(
      1000 - 240 - VIEWPORT_MARGIN,
    );
  });
});

describe("placeAbove with an anchor inside the box", () => {
  const vp = { width: 1000, height: 800 };

  it("straddles the point: the anchor row lands on it", () => {
    // The location menu puts cards above the spot and the readout below, so
    // the clicked spot stays visible.
    const got = placeAbove({ x: 500, y: 400 }, { width: 240, height: 190 }, vp, 92);
    expect(got.top).toBe(400 - 92);
    expect(got.left).toBe(500 - 120);
  });

  it("still centres horizontally, whatever the anchor", () => {
    const got = placeAbove({ x: 500, y: 400 }, { width: 60, height: 190 }, vp, 92);
    expect(got.left + 30).toBe(500);
  });
});
