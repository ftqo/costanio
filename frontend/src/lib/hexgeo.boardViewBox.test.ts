import { describe, it, expect } from "vitest";
import { boardViewBox, hexCenter } from "./hexgeo";
import type { Hex } from "./types";

// Framed boards are sparse (land and sea only) and their silhouette need not be
// hexagonal, so the viewBox must bound only the tiles present.
describe("boardViewBox on sparse / non-hexagon boards", () => {
  const S = 10;

  it("tightens to a horizontal strip, not a hexagon", () => {
    // A 1-row horizontal strip of 5 hexes: wide and short.
    const strip: { hex: Hex }[] = [];
    for (let q = -2; q <= 2; q++) strip.push({ hex: { q, r: 0 } });
    const vb = boardViewBox(strip, S, 0); // no margin, to test the raw bounds

    const xs = strip.map((t) => hexCenter(t.hex, S).x);
    const ys = strip.map((t) => hexCenter(t.hex, S).y);
    expect(vb.x).toBeCloseTo(Math.min(...xs));
    expect(vb.y).toBeCloseTo(Math.min(...ys));
    expect(vb.w).toBeCloseTo(Math.max(...xs) - Math.min(...xs));
    expect(vb.h).toBeCloseTo(Math.max(...ys) - Math.min(...ys));
    // A horizontal strip is far wider than tall, not a square hexagon box.
    expect(vb.w).toBeGreaterThan(vb.h * 3);
  });

  it("ignores absent hexes", () => {
    // Two far-apart tiles (a gap between them, like two islands). The viewBox
    // spans only the two present tiles; nothing assumes the gap is filled.
    const tiles: { hex: Hex }[] = [{ hex: { q: -4, r: 0 } }, { hex: { q: 4, r: 0 } }];
    const vb = boardViewBox(tiles, S, 0);
    const left = hexCenter({ q: -4, r: 0 }, S).x;
    const right = hexCenter({ q: 4, r: 0 }, S).x;
    expect(vb.x).toBeCloseTo(left);
    expect(vb.w).toBeCloseTo(right - left);
  });
});
