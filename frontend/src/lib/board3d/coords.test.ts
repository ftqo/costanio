import { test, expect } from "vitest";
import {
  DIRS,
  neighbor,
  hexToWorld,
  vertexToWorld,
  edgeToWorld,
  cornerToWorld,
  edgeAngleY,
  edgeRotationY,
  hexKey,
  LATTICE_GAP,
  LATTICE_SIZE,
} from "./coords";
import { HEX_SIZE } from "./manifest.generated";
import { hexCenter, vertexPt } from "@/lib/hexgeo";

const S = 3.0;

/** The tile art's own apothem, from its centre to its rim. */
const TILE_APOTHEM = (HEX_SIZE * Math.sqrt(3)) / 2;

test("row r runs toward the viewer, the way the board is dealt", () => {
  // The rows follow the SVG board's layout, not costanio.blend (a showcase
  // whose layout says which way a tile's art faces, not how rows run).
  const cases: [number, number, number, number][] = [
    [0, 0, 0, 0],
    [1, 0, 5.196, 0],
    [0, 1, 2.598, 4.5],
    [-2, 1, -7.794, 4.5],
    [1, -1, 2.598, -4.5],
  ];
  for (const [q, r, x, z] of cases) {
    const [wx, wy, wz] = hexToWorld({ q, r }, S);
    expect(wx).toBeCloseTo(x, 3);
    expect(wy).toBe(0);
    expect(wz).toBeCloseTo(z, 3);
  }
});

test("north and south vertices straddle their hex center on z", () => {
  const [, , cz] = hexToWorld({ q: 0, r: 0 }, S);
  const [, , nz] = vertexToWorld({ q: 0, r: 0, side: 0 }, S);
  const [, , sz] = vertexToWorld({ q: 0, r: 0, side: 1 }, S);
  // side 0 is the North corner: away from the viewer, which is -z.
  expect(nz).toBeCloseTo(cz - S, 5);
  expect(sz).toBeCloseTo(cz + S, 5);
});

test("an edge midpoint is the mean of its endpoints", () => {
  const e = { a: { q: 0, r: 0, side: 0 as const }, b: { q: 0, r: 0, side: 1 as const } };
  const [x, y, z] = edgeToWorld(e, S);
  expect(x).toBeCloseTo(hexToWorld({ q: 0, r: 0 }, S)[0], 5);
  expect(y).toBe(0);
  expect(z).toBeCloseTo(hexToWorld({ q: 0, r: 0 }, S)[2], 5);
});

test("the six corners sit one circumradius from the center", () => {
  const [cx, , cz] = hexToWorld({ q: 2, r: -1 }, S);
  for (let i = 0; i < 6; i++) {
    const [x, y, z] = cornerToWorld({ q: 2, r: -1 }, i, S);
    expect(Math.hypot(x - cx, z - cz)).toBeCloseTo(S, 5);
    expect(y).toBe(0);
  }
});

test("neighbors are reciprocal across opposite edges", () => {
  expect(DIRS).toHaveLength(6);
  for (let i = 0; i < 6; i++) {
    const back = neighbor(neighbor({ q: 4, r: -2 }, i), (i + 3) % 6);
    expect(hexKey(back)).toBe(hexKey({ q: 4, r: -2 }));
  }
});

test("adjacent hexes are exactly one hex width apart", () => {
  const width = Math.sqrt(3) * S;
  for (let i = 0; i < 6; i++) {
    const [ax, , az] = hexToWorld({ q: 0, r: 0 }, S);
    const [bx, , bz] = hexToWorld(neighbor({ q: 0, r: 0 }, i), S);
    expect(Math.hypot(bx - ax, bz - az)).toBeCloseTo(width, 5);
  }
});

test("neighbouring tiles leave exactly one gutter between their rims", () => {
  // The lattice is wider than the art, so no tile owns its perimeter. Checked
  // as a distance between rims, since the gutter width is what roads fit in.
  const origin = { q: 0, r: 0 };
  const [ax, , az] = hexToWorld(origin);
  for (let i = 0; i < 6; i++) {
    const [bx, , bz] = hexToWorld(neighbor(origin, i));
    const centres = Math.hypot(bx - ax, bz - az);
    expect(centres - 2 * TILE_APOTHEM, `edge ${i}`).toBeCloseTo(LATTICE_GAP, 5);
  }
});

test("a road's edge midpoint clears the tile rim by half a gutter", () => {
  // Each tile gives up half the gutter, so an edge midpoint lies between the
  // two tiles, on neither's art.
  const e = { a: { q: 0, r: 0, side: 0 as const }, b: { q: 1, r: -1, side: 1 as const } };
  const [x, , z] = edgeToWorld(e);
  const [cx, , cz] = hexToWorld({ q: 0, r: 0 });
  expect(Math.hypot(x - cx, z - cz)).toBeCloseTo(TILE_APOTHEM + LATTICE_GAP / 2, 5);
});

test("a building's vertex lands past the tile's own corner", () => {
  // Settlements and knights stand on vertices. They overhang (a settlement is
  // 0.84 across against a 0.25 gutter), but the vertex must be off the art for
  // the overhang to be symmetric.
  for (const side of [0, 1] as const) {
    const v = { q: 2, r: -1, side };
    const [x, , z] = vertexToWorld(v);
    const [cx, , cz] = hexToWorld({ q: 2, r: -1 });
    expect(Math.hypot(x - cx, z - cz), `side ${side}`).toBeCloseTo(LATTICE_SIZE, 5);
  }
  expect(LATTICE_SIZE).toBeGreaterThan(HEX_SIZE);
});

test("the 3D board lays out the same way round as the SVG board", () => {
  // The renderer looks down -z, so +z is the bottom of the screen, as +y is on
  // the SVG board. If they disagree the 3D board is a mirror image, which no
  // camera position can fix. Checked against the live board's module.
  for (const h of [
    { q: 0, r: 1 },
    { q: -2, r: 1 },
    { q: 1, r: -1 },
    { q: 3, r: -2 },
    { q: -1, r: 0 },
  ]) {
    const flat = hexCenter(h, S);
    const [x, , z] = hexToWorld(h, S);
    expect(x, `hex ${h.q},${h.r} x`).toBeCloseTo(flat.x, 5);
    expect(z, `hex ${h.q},${h.r} z should follow the SVG board's y`).toBeCloseTo(flat.y, 5);
  }
});

test("a vertex sits on the same side of its hex as it does in the SVG board", () => {
  for (const side of [0, 1] as const) {
    const v = { q: 1, r: -1, side };
    const flat = vertexPt(v, S);
    const [x, , z] = vertexToWorld(v, S);
    expect(x, `side ${side} x`).toBeCloseTo(flat.x, 5);
    expect(z, `side ${side} z`).toBeCloseTo(flat.y, 5);
  }
});

test("corner 0 is the north corner, the same one the SVG board draws first", () => {
  const [x, , z] = cornerToWorld({ q: 0, r: 0 }, 0, S);
  const [cx, , cz] = hexToWorld({ q: 0, r: 0 }, S);
  expect(x).toBeCloseTo(cx, 5);
  expect(z, "north is -z, toward the back of the scene").toBeCloseTo(cz - S, 5);
});

test("edge rotations are distinct multiples of 60 degrees", () => {
  const seen = new Set<number>();
  for (let i = 0; i < 6; i++) {
    const deg = Math.round(((edgeAngleY(i) * 180) / Math.PI + 360) % 360);
    expect(deg % 60).toBe(0);
    seen.add(deg);
  }
  expect(seen.size).toBe(6);
});

test("edgeAngleY turns edge 0 onto the edge it names", () => {
  // Six distinct multiples of 60 would also pass with the rotation reversed,
  // which mirrors beach strips about the hex. Rotate the edge-0 midpoint by
  // edgeAngleY(dir) and it must land on edge dir's midpoint.
  //
  // three.js composes a Y rotation as x' = x cos + z sin, z' = -x sin + z cos.
  const midpoint = (dir: number): [number, number] => {
    const [x, , z] = hexToWorld(neighbor({ q: 0, r: 0 }, dir), S);
    return [x / 2, z / 2];
  };
  const [x0, z0] = midpoint(0);
  for (let dir = 0; dir < 6; dir++) {
    const a = edgeAngleY(dir);
    const turned = [x0 * Math.cos(a) + z0 * Math.sin(a), -x0 * Math.sin(a) + z0 * Math.cos(a)];
    const [ex, ez] = midpoint(dir);
    expect(turned[0], `edge ${dir} x`).toBeCloseTo(ex, 5);
    expect(turned[1], `edge ${dir} z`).toBeCloseTo(ez, 5);
  }
});

test("edgeRotationY lays a bar along the edge it spans, either way round", () => {
  // Roads, ships and their ghosts face along this, so art authored along +x
  // must come out parallel to the edge.
  //
  // Both endpoint orders, because a wire Edge is normalised to an arbitrary
  // order; a symmetric bar may differ only by half a turn.
  for (const dir of [0, 1, 2, 3, 4, 5]) {
    const a = { q: 0, r: 0, side: 0 as const };
    const b = {
      q: neighbor({ q: 0, r: 0 }, dir).q,
      r: neighbor({ q: 0, r: 0 }, dir).r,
      side: 1 as const,
    };
    const [ax, , az] = vertexToWorld(a);
    const [bx, , bz] = vertexToWorld(b);
    const run = Math.hypot(bx - ax, bz - az);
    for (const e of [
      { a, b },
      { a: b, b: a },
    ]) {
      const t = edgeRotationY(e);
      // A Y rotation of t sends +x to (cos t, -sin t).
      const dot = ((bx - ax) * Math.cos(t) + (bz - az) * -Math.sin(t)) / run;
      expect(Math.abs(dot), `dir ${dir}`).toBeCloseTo(1, 10);
    }
  }
});
