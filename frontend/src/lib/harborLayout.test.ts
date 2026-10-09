import { test, expect } from "vitest";
import { harborLayouts } from "./hexgeo";
import type { Hex } from "./types";

const S = 44;

// Label rect as the map builder draws it: 46 wide x 30 tall, centred on `out`.
// Two labels collide iff their centres are within those extents on both axes.
function overlaps(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return Math.abs(a.x - b.x) < 46 && Math.abs(a.y - b.y) < 30;
}

const isLandSet = (hexes: Hex[]) => {
  const keys = new Set(hexes.map((h) => `${h.q},${h.r}`));
  return (h: Hex) => keys.has(`${h.q},${h.r}`);
};

const CENTER = { x: 0, y: 0 };

// Two land hexes flanking a single sea hex (0,0) on opposite sides, each with a
// port on the edge it shares with the sea hex, so both ports belong to the same
// sea hex.
const harborA = {
  verts: [
    { q: 0, r: 1, side: 0 },
    { q: 1, r: -1, side: 1 },
  ],
};
const harborB = {
  verts: [
    { q: 0, r: -1, side: 1 },
    { q: -1, r: 1, side: 0 },
  ],
};

test("two harbors sharing one sea hex get non-overlapping labels", () => {
  const isLand = isLandSet([
    { q: 1, r: 0 },
    { q: -1, r: 0 },
  ]);
  const [a, b] = harborLayouts([harborA, harborB], isLand, CENTER, S);
  expect(overlaps(a.out, b.out)).toBe(false);
});

test("each shared-hex label hugs its own coast edge, not the sea-hex center", () => {
  const isLand = isLandSet([
    { q: 1, r: 0 },
    { q: -1, r: 0 },
  ]);
  const seaCenter = { x: S * Math.sqrt(3) * 0, y: 0 }; // hex (0,0) center is the origin
  const [a, b] = harborLayouts([harborA, harborB], isLand, CENTER, S);
  // Each label stays out toward its edge (apothem ~0.866*S ~ 38), not
  // collapsed onto the shared sea-hex centre.
  expect(Math.hypot(a.out.x - seaCenter.x, a.out.y - seaCenter.y)).toBeGreaterThan(0.5 * S);
  expect(Math.hypot(b.out.x - seaCenter.x, b.out.y - seaCenter.y)).toBeGreaterThan(0.5 * S);
});

test("a solo coastal harbor keeps the long seaward push", () => {
  // Only one land hex here, so the sea hex (0,0) hosts a single port.
  const isLand = isLandSet([{ q: 1, r: 0 }]);
  const [a] = harborLayouts([harborA], isLand, CENTER, S);
  // Pushed deep into open water toward the sea-hex centre (~0.166*S away).
  expect(Math.hypot(a.out.x, a.out.y)).toBeLessThan(0.4 * S);
});

test("dock points are the two vertex pixel positions", () => {
  const isLand = isLandSet([{ q: 1, r: 0 }]);
  const [a] = harborLayouts([harborA], isLand, CENTER, S);
  expect(a.pts).toHaveLength(2);
});
