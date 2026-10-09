// The rail's geometry, which must hold at every track length without the
// layout moving.
import { test, expect, describe } from "vitest";
import {
  RAIL_BOX_W,
  RAIL_BOX_H,
  MIN_DIST,
  railBoxW,
  hexSizeFor,
  railCells,
  hexPoints,
  railStroke,
  RAIL_FINE_HEX,
  railRowCells,
  railRowH,
  hexSizeForRow,
} from "./barbRail";

/** Every distance `barbDist` can return, plus the two the lobby recommends. */
const DISTANCES = [4, 7, 9, 11, 12];

describe("rail box", () => {
  test("every configured distance fills exactly the same height", () => {
    for (const d of DISTANCES) {
      const cells = railCells(d);
      const s = hexSizeFor(d);
      const top = cells[0].y - s;
      const bottom = cells[cells.length - 1].y + s;
      expect(top).toBeCloseTo(0, 6);
      expect(bottom).toBeCloseTo(RAIL_BOX_H, 6);
    }
  });

  test("every configured distance fits inside the same width", () => {
    for (const d of DISTANCES) {
      const s = hexSizeFor(d);
      const w = (Math.sqrt(3) / 2) * s;
      const xs = railCells(d).map((c) => c.x);
      expect(Math.min(...xs) - w).toBeGreaterThanOrEqual(0);
      expect(Math.max(...xs) + w).toBeLessThanOrEqual(RAIL_BOX_W);
    }
  });

  // The shortest track has the largest hexes, so it sets the width.
  test("the shortest track is the one that fills the width", () => {
    const s = hexSizeFor(MIN_DIST);
    expect(RAIL_BOX_W).toBeGreaterThanOrEqual(3 * (Math.sqrt(3) / 2) * s);
    for (const d of DISTANCES) expect(hexSizeFor(d)).toBeLessThanOrEqual(s);
  });

  test("the width follows the height budget", () => {
    expect(railBoxW(120)).toBeLessThan(railBoxW(RAIL_BOX_H));
    const s = hexSizeFor(MIN_DIST, 120);
    expect(railBoxW(120)).toBeGreaterThanOrEqual(3 * (Math.sqrt(3) / 2) * s);
  });

  test("the tack is centred in the box at every distance", () => {
    for (const d of DISTANCES) {
      const xs = railCells(d).map((c) => c.x);
      expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(RAIL_BOX_W / 2, 6);
    }
  });

  // `s` is solved, so a longer track gets smaller hexes and the rail height
  // (which the event feed reserves) does not change.
  test("a longer track gets smaller hexes, not a taller rail", () => {
    for (let i = 1; i < DISTANCES.length; i++) {
      expect(hexSizeFor(DISTANCES[i])).toBeLessThan(hexSizeFor(DISTANCES[i - 1]));
    }
    expect(hexSizeFor(7)).toBeCloseTo(14, 6);
    expect(hexSizeFor(12)).toBeCloseTo(8.75, 6);
  });

  // Short landscape phones pass a smaller budget; everything re-solves.
  test("a smaller height budget keeps every step", () => {
    const cells = railCells(12, 120);
    expect(cells).toHaveLength(13);
    expect(cells[12].y + hexSizeFor(12, 120)).toBeCloseTo(120, 6);
  });
});

describe("the tack", () => {
  test("has one cell per step, standoff through landfall", () => {
    for (const d of DISTANCES) {
      const cells = railCells(d);
      expect(cells).toHaveLength(d + 1);
      expect(cells[0].step).toBe(0);
      expect(cells[d].step).toBe(d);
    }
  });

  test("descends monotonically", () => {
    const cells = railCells(9);
    for (let i = 1; i < cells.length; i++) expect(cells[i].y).toBeGreaterThan(cells[i - 1].y);
  });

  // A pointy-top grid has no due-north neighbour, so consecutive cells must
  // differ in x.
  test("alternates sides every step", () => {
    const cells = railCells(12);
    for (let i = 1; i < cells.length; i++) {
      expect(cells[i].x).not.toBeCloseTo(cells[i - 1].x, 6);
    }
    // Two columns only, and they straddle the centre line evenly.
    const xs = [...new Set(cells.map((c) => c.x.toFixed(4)))];
    expect(xs).toHaveLength(2);
  });

  test("steps by one hex spacing", () => {
    const d = 7;
    const s = hexSizeFor(d);
    const cells = railCells(d);
    for (let i = 1; i < cells.length; i++) {
      const dx = Math.abs(cells[i].x - cells[i - 1].x);
      const dy = cells[i].y - cells[i - 1].y;
      // A pointy-top SE/SW neighbour is (±√3/2·s, +1.5·s).
      expect(dx).toBeCloseTo((Math.sqrt(3) / 2) * s, 6);
      expect(dy).toBeCloseTo(1.5 * s, 6);
    }
  });
});

describe("drawing", () => {
  test("a hex is six pointy-top corners", () => {
    const pts = hexPoints(0, 0, 10)
      .split(" ")
      .map((p) => p.split(",").map(Number));
    expect(pts).toHaveLength(6);
    // A vertex at top and bottom makes it pointy-top, which forces the tack.
    expect(pts[0]).toEqual([0, -10]);
    expect(pts[3]).toEqual([0, 10]);
    const w = (Math.sqrt(3) / 2) * 10;
    expect(pts[1][0]).toBeCloseTo(w, 2);
    expect(pts[4][0]).toBeCloseTo(-w, 2);
  });

  test("outlines thicken once the hexes get fine", () => {
    expect(railStroke(hexSizeFor(4))).toBe(1.1);
    expect(railStroke(hexSizeFor(7))).toBe(1.1);
    // Distance 12 lands at 8.75, under the threshold.
    expect(hexSizeFor(12)).toBeLessThan(RAIL_FINE_HEX);
    expect(railStroke(hexSizeFor(12))).toBe(1.4);
  });
});

describe("the horizontal rail", () => {
  const W = 320;

  test("has the same cells as the vertical one, laid across", () => {
    for (const d of DISTANCES) {
      const cells = railRowCells(d, W);
      expect(cells).toHaveLength(d + 1);
      expect(cells[0].step).toBe(0);
      expect(cells[d].step).toBe(d);
    }
  });

  test("fits the width budget exactly, whatever the track length", () => {
    for (const d of DISTANCES) {
      const s = hexSizeForRow(d, W);
      const cells = railRowCells(d, W);
      const w = Math.sqrt(3) * s;
      expect(cells[0].x - w / 2).toBeCloseTo(0, 6);
      expect(cells[d].x + w / 2).toBeCloseTo(W, 6);
    }
  });

  // East is a pointy-top neighbour, so the row tessellates edge to edge with
  // no zigzag.
  test("runs dead straight, edge to edge", () => {
    const d = 7;
    const s = hexSizeForRow(d, W);
    const cells = railRowCells(d, W);
    for (let i = 1; i < cells.length; i++) {
      expect(cells[i].y).toBeCloseTo(cells[i - 1].y, 6);
      expect(cells[i].x - cells[i - 1].x).toBeCloseTo(Math.sqrt(3) * s, 6);
    }
  });

  test("advances left to right", () => {
    const cells = railRowCells(9, W);
    for (let i = 1; i < cells.length; i++) expect(cells[i].x).toBeGreaterThan(cells[i - 1].x);
  });

  // The horizontal rail exists because it is short: a phone cannot give the
  // column its 12.5*s of height.
  test("is two hexes tall", () => {
    for (const d of DISTANCES) {
      expect(railRowH(d, W)).toBeCloseTo(2 * hexSizeForRow(d, W), 6);
      expect(railRowH(d, W)).toBeLessThan(RAIL_BOX_H / 2);
    }
  });
});
