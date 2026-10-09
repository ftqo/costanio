import { test, expect, describe } from "vitest";
import { sailPose, easeOutCubic, HEEL_DEG } from "./barbMotion";
import { railCells } from "./barbRail";

const cells = railCells(7);

describe("the slide", () => {
  test("starts on the origin cell and ends on the target", () => {
    const a = sailPose(cells[2], cells[3], 0);
    expect(a.x).toBeCloseTo(cells[2].x, 6);
    expect(a.y).toBeCloseTo(cells[2].y, 6);

    const b = sailPose(cells[2], cells[3], 1);
    expect(b.x).toBeCloseTo(cells[3].x, 6);
    expect(b.y).toBeCloseTo(cells[3].y, 6);
  });

  // The ship must never leave the span between the two cells.
  test("never leaves the span between the two cells", () => {
    for (let i = 0; i <= 40; i++) {
      const p = sailPose(cells[2], cells[3], i / 40);
      expect(p.y).toBeGreaterThanOrEqual(cells[2].y - 1e-9);
      expect(p.y).toBeLessThanOrEqual(cells[3].y + 1e-9);
      const lo = Math.min(cells[2].x, cells[3].x);
      const hi = Math.max(cells[2].x, cells[3].x);
      expect(p.x).toBeGreaterThanOrEqual(lo - 1e-9);
      expect(p.x).toBeLessThanOrEqual(hi + 1e-9);
    }
  });

  test("descends monotonically across the move", () => {
    let last = -Infinity;
    for (let i = 0; i <= 40; i++) {
      const p = sailPose(cells[4], cells[5], i / 40);
      expect(p.y).toBeGreaterThanOrEqual(last);
      last = p.y;
    }
  });

  test("clamps when the clock overshoots", () => {
    const p = sailPose(cells[0], cells[1], 1.4);
    expect(p.y).toBeCloseTo(cells[1].y, 6);
    expect(p.rot).toBeCloseTo(0, 6);
  });

  test("eases out", () => {
    expect(easeOutCubic(0)).toBeCloseTo(0, 6);
    expect(easeOutCubic(1)).toBeCloseTo(1, 6);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });
});

describe("the rocking", () => {
  // The heel is a half-sine roll: upright at both ends of every move, so
  // nothing carries into the next step.
  test("is upright at both ends of every move", () => {
    for (let i = 0; i < cells.length - 1; i++) {
      expect(sailPose(cells[i], cells[i + 1], 0).rot).toBeCloseTo(0, 6);
      expect(sailPose(cells[i], cells[i + 1], 1).rot).toBeCloseTo(0, 6);
    }
  });

  test("peaks in the middle at the full heel", () => {
    expect(Math.abs(sailPose(cells[0], cells[1], 0.5).rot)).toBeCloseTo(HEEL_DEG, 6);
  });

  test("leans the way the ship is travelling", () => {
    // Consecutive cells alternate side, so consecutive moves lean opposite ways.
    const a = sailPose(cells[0], cells[1], 0.5).rot;
    const b = sailPose(cells[1], cells[2], 0.5).rot;
    expect(Math.sign(a)).toBe(Math.sign(cells[1].x - cells[0].x));
    expect(Math.sign(b)).toBe(Math.sign(cells[2].x - cells[1].x));
    expect(Math.sign(a)).not.toBe(Math.sign(b));
  });

  test("never exceeds the heel it is given", () => {
    for (let i = 0; i <= 40; i++) {
      expect(Math.abs(sailPose(cells[0], cells[1], i / 40).rot)).toBeLessThanOrEqual(
        HEEL_DEG + 1e-9,
      );
    }
  });
});
