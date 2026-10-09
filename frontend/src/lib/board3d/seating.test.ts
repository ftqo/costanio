import { test, expect } from "vitest";
import { seat, seatY, SURFACE } from "./seating";
import type { Placement } from "./instancing";
import { SAND_Y } from "./gapGeometry";
import { OCEAN_BAKED_MAX_Y, OCEAN_MEAN_Y, OCEAN_MIN_Y } from "./ocean";

test("a piece's base lands on the surface, whatever it is scaled to", () => {
  // instanceGeometry composes translate-rotate-scale, so the scale multiplies
  // the art's authored base too.
  for (const scale of [1, 1.15, 1.5, 2]) {
    for (const base of [0, 0.25, 0.415]) {
      const y = seatY(SURFACE.gutter, base, scale);
      expect(y + scale * base).toBeCloseTo(SURFACE.gutter, 9);
    }
  }
});

test("art authored at zero and art authored on a tile both land level", () => {
  // Pieces and chips start at 0.25 (modelled on a tile); knights, metropolises,
  // walls, ships and the merchant start at 0.
  const onTile = seatY(SURFACE.gutter, 0.25, 2);
  const offBoard = seatY(SURFACE.gutter, 0, 2);
  expect(onTile + 2 * 0.25).toBeCloseTo(offBoard + 2 * 0, 9);
});

test("an unseated road is off by little, a building by a lot", () => {
  // Their factor is 1.15, so the error was 0.0375 rather than a settlement's
  // 0.25: small enough to look correct.
  const roadErrorBefore = 1.15 * 0.25 - SURFACE.gutter;
  const buildingErrorBefore = 2 * 0.25 - SURFACE.gutter;
  expect(Math.abs(roadErrorBefore)).toBeLessThan(0.08);
  expect(buildingErrorBefore).toBeGreaterThan(0.25);
});

test("seat applies the height and the scale to every placement", () => {
  const input: Placement[] = [{ position: [1, 99, 2] }, { position: [3, -99, 4] }];
  const out = seat(input, SURFACE.sea, 0.5, 2);
  for (const p of out) expect(p.position[1]).toBeCloseTo(SURFACE.sea - 1.0, 9);
  expect(out.map((p) => [p.position[0], p.position[2]])).toEqual([
    [1, 2],
    [3, 4],
  ]);
  for (const p of out) expect(p.scale).toBe(2);
});

test("the surfaces are the ones the art uses", () => {
  // The gutter is the gap fill's own top face, so moving the gap moves what
  // stands in it.
  expect(SURFACE.gutter).toBe(SAND_Y);
  // Sea is the water's mean, not the crests, or every ship would float.
  expect(SURFACE.sea).toBe(OCEAN_MEAN_Y);
  expect(SURFACE.sea).toBeGreaterThan(OCEAN_MIN_Y);
  expect(SURFACE.sea).toBeLessThan(OCEAN_BAKED_MAX_Y);
  expect(SURFACE.sea).toBeLessThan(SURFACE.land);
});
