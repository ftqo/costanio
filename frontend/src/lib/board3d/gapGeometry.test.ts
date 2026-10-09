import { test, expect } from "vitest";
import { gapStripGeometry, SAND_Y, TILE_APOTHEM, LATTICE_APOTHEM } from "./gapGeometry";
import { LATTICE_GAP, edgeAngleY } from "./coords";

/** Every vertex of a geometry, as [x, y, z] triples. */
function verts(geo: ReturnType<typeof gapStripGeometry>): [number, number, number][] {
  const a = geo.getAttribute("position");
  const out: [number, number, number][] = [];
  for (let i = 0; i < a.count; i++) out.push([a.getX(i), a.getY(i), a.getZ(i)]);
  return out;
}

/** Y component of a triangle's geometric normal. */
function normalY(p: [number, number, number][], i: number): number {
  const [a, b, c] = [p[i], p[i + 1], p[i + 2]];
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return u[2] * v[0] - u[0] * v[2];
}

test("a half-gap runs from under its tile out to the midline it shares", () => {
  // The two halves have to meet exactly on the midline or the gap shows a
  // seam down the middle of every edge on the board.
  const p = verts(gapStripGeometry(SAND_Y));
  const xs = p.map((v) => v[0]);
  expect(Math.max(...xs), "outer edge sits on the lattice midline").toBeCloseTo(LATTICE_APOTHEM, 5);
  expect(Math.min(...xs), "inner edge tucks under the tile").toBeLessThan(TILE_APOTHEM);
});

test("the midline is exactly half a gap past the tile's own rim", () => {
  expect(LATTICE_APOTHEM - TILE_APOTHEM).toBeCloseTo(LATTICE_GAP / 2, 5);
});

test("the top face sits at the height it was asked for, facing up", () => {
  const p = verts(gapStripGeometry(SAND_Y));
  // The first two triangles are the top fan. Positions are stored as float32,
  // so 0.22 does not survive the round trip exactly.
  for (const v of p.slice(0, 6)) expect(v[1]).toBeCloseTo(SAND_Y, 6);
  expect(normalY(p, 0), "top face normal points up").toBeGreaterThan(0);
  expect(normalY(p, 3), "second top triangle agrees").toBeGreaterThan(0);
});

test("a tile's six halves close into a ring with no crack at the corners", () => {
  // Each half is the edge-0 piece turned by edgeAngleY(dir). Neighbouring
  // halves share a radial side only if turning one edge's side by 60 degrees
  // lands on the next edge's; otherwise every tile corner opens a notch.
  const p = verts(gapStripGeometry(SAND_Y));
  const a = edgeAngleY(1);
  // three.js composes a Y rotation as x' = x cos + z sin, z' = -x sin + z cos.
  const turn = (v: [number, number, number]): [number, number] => [
    v[0] * Math.cos(a) + v[2] * Math.sin(a),
    -v[0] * Math.sin(a) + v[2] * Math.cos(a),
  ];
  const has = (x: number, z: number) =>
    p.some((v) => Math.abs(v[0] - x) < 1e-4 && Math.abs(v[2] - z) < 1e-4);

  // Edge 1's -z side, turned home, must be one of edge 0's own vertices.
  for (const v of p.filter((q) => q[2] < 0)) {
    const [x, z] = turn(v);
    expect(has(x, z), `corner vertex (${v[0]}, ${v[2]}) should be shared`).toBe(true);
  }
});
