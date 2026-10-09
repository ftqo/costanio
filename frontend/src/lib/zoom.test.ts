import { test, expect } from "vitest";
import { zoomFactor, toLayoutPoint, toLayoutSize, layoutViewport } from "./zoom";
import { placeMenu, ANCHOR_GAP } from "./anchoredMenu";

// The zoom levels index.css actually applies, plus 1 for the common case.
const ZOOMS = [1, 1.2, 1.45, 1.7, 2];

test("an anchored menu paints on the click at every zoom level", () => {
  // The menu opens where you clicked. The component measures visual px and
  // writes layout px to `style`, which is scaled by the zoom before paint, so
  // the test multiplies back to get the painted position.
  for (const z of ZOOMS) {
    const click = { x: 800, y: 500 }; // pointer event: visual px
    const box = { width: 120 * z, height: 60 * z }; // getBoundingClientRect: visual px
    const viewport = { width: 1600 / z, height: 1000 / z }; // layout px

    const place = placeMenu(toLayoutPoint(click, z), toLayoutSize(box, z), viewport);
    const painted = { left: place.left * z, top: place.top * z };

    // Centred on the click horizontally, just below it vertically.
    expect(painted.left + box.width / 2, `zoom ${z} x`).toBeCloseTo(click.x, 6);
    expect(painted.top, `zoom ${z} y`).toBeCloseTo(click.y + ANCHOR_GAP * z, 6);
  }
});

test("placeMenu without the zoom conversion is offset", () => {
  // Visual px handed straight to placeMenu. The error is
  // (zoom - 1) * (click - menuWidth/2): zero at the origin and growing away
  // from it.
  const z = 2;
  const width = 240;
  const off = (x: number) => {
    const naive = placeMenu({ x, y: 500 }, { width, height: 120 }, { width: 1600, height: 1000 });
    return naive.left * z + width / 2 - x;
  };
  expect(off(800)).toBe((z - 1) * (800 - width / 2));
  expect(off(800)).toBe(680); // most of the way across a 1600px screen
  // Small near the corner, large away from it.
  expect(off(300)).toBeLessThan(off(700));
  expect(off(700)).toBeLessThan(off(1100));
});

test("a menu near the edge stays inside the normalized viewport", () => {
  // Clamping a layout-px box against a visual-px viewport lets it overhang the
  // real edge by the zoom factor.
  const z = 2;
  const click = { x: 1580, y: 980 }; // hard against the bottom-right corner
  const box = { width: 200 * z, height: 80 * z };
  const place = placeMenu(toLayoutPoint(click, z), toLayoutSize(box, z), {
    width: 1600 / z,
    height: 1000 / z,
  });
  expect(place.left * z + box.width).toBeLessThanOrEqual(1600);
  expect(place.top * z + box.height).toBeLessThanOrEqual(1000);
});

test("zoomFactor falls back to 1 when unreported", () => {
  // jsdom reports no zoom, like a browser without the property. NaN would
  // propagate into every coordinate.
  expect(zoomFactor()).toBe(1);
  expect(toLayoutPoint({ x: 10, y: 20 }, zoomFactor())).toEqual({ x: 10, y: 20 });
  expect(toLayoutSize({ width: 10, height: 20 }, zoomFactor())).toEqual({
    width: 10,
    height: 20,
  });
});

test("layoutViewport divides the visual viewport", () => {
  expect(layoutViewport(2)).toEqual({
    width: window.innerWidth / 2,
    height: window.innerHeight / 2,
  });
});
