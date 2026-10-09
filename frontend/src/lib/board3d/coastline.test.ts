import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  solveCoastLoops,
  landKeys,
  coastTurnsOut,
  WATER,
  WATER_TERRAINS,
  type CoastLoop,
} from "./coastline";
import { neighbor, hexKey, hexToWorld } from "./coords";
import { APOTHEM } from "./beachGeometry";
import type { BoardTile, Hex } from "@/lib/types";

// res is a string on the wire, never an index.
const sea = (q: number, r: number): BoardTile => ({ hex: { q, r }, res: "sea", num: 0 });
const land = (q: number, r: number): BoardTile => ({ hex: { q, r }, res: "wood", num: 8 });

/** Every land tile edge that faces something that is not land. */
function coastalEdgeCount(tiles: BoardTile[]): number {
  const solid = landKeys(tiles);
  let n = 0;
  for (const t of tiles) {
    if (!solid.has(hexKey(t.hex))) continue;
    for (let d = 0; d < 6; d++) if (!solid.has(hexKey(neighbor(t.hex, d)))) n++;
  }
  return n;
}

const key = (p: readonly [number, number]): string =>
  `${Math.round(p[0] * 1e4)}:${Math.round(p[1] * 1e4)}`;

/** Whether a loop really closes: every edge ends where the next one starts. */
function chains(loop: CoastLoop): boolean {
  return loop.every((e, i) => key(e.b) === key(loop[(i + 1) % loop.length].a));
}

test("recognises water resources and treats a lake as land", () => {
  expect(WATER.has("sea")).toBe(true);
  expect(WATER.has("fog")).toBe(true);
  expect(WATER.has("wood")).toBe(false);
  // A lake is land (the engine's `board.Land` is true for it) with its own
  // tile. As water it would be scaled over its own gutter and ringed with
  // ocean beach. See the header of coastline.ts.
  expect(WATER.has("lake")).toBe(false);
});

test("blend water terrains are water here", () => {
  // Matches `tools/blender/lattice.py`'s WATER_TERRAINS {Ocean, Port, Shoal,
  // Council}, drawn at LATTICE_SCALE with no gutter. A missing entry (e.g.
  // `sea_shoal`) draws the tile at land scale with a beach facing open sea.
  for (const [terrain, res] of Object.entries(WATER_TERRAINS)) {
    expect(WATER.has(res), `${terrain} (${res}) must be water`).toBe(true);
  }
  // Nothing else is water except `fog`, which has no terrain and falls back to
  // the sea tile (RESOURCE_FALLBACK).
  expect([...WATER].sort()).toEqual([...Object.values(WATER_TERRAINS), "fog"].sort());
});

test("WATER_TERRAINS matches lattice.py", () => {
  // Read from lattice.py rather than restated. A terrain the art scales as
  // water that the renderer does not know is drawn 4.8% short with a gutter
  // seam.
  const lattice = readFileSync(
    join(__dirname, "..", "..", "..", "..", "tools", "blender", "lattice.py"),
    "utf8",
  );
  const m = lattice.match(/^WATER_TERRAINS = frozenset\(\{([^}]*)\}\)/m);
  expect(m, "lattice.py WATER_TERRAINS did not parse").not.toBeNull();
  const blend = [...m![1].matchAll(/"(\w+)"/g)].map((x) => x[1]).sort();
  expect(Object.keys(WATER_TERRAINS).sort()).toEqual(blend);
});

test("a lone land tile is one closed loop of six edges", () => {
  // The base game's tile list has no water (the ocean is backdrop), so
  // anything that is not land counts as water.
  const loops = solveCoastLoops([land(0, 0)]);
  expect(loops).toHaveLength(1);
  expect(loops[0]).toHaveLength(6);
  expect(chains(loops[0])).toBe(true);
});

test("every land edge facing water is in a loop exactly once", () => {
  // Twice and the sand doubles up and z-fights; once fewer and there is a hole.
  const tiles = [land(0, 0), land(1, 0), land(0, 1), sea(2, 0)];
  const loops = solveCoastLoops(tiles);
  const edges = loops.flat();
  expect(edges).toHaveLength(coastalEdgeCount(tiles));
  expect(new Set(edges.map((e) => key(e.a))).size).toBe(edges.length);
  for (const loop of loops) expect(chains(loop)).toBe(true);
});

test("edge normals face the water and edges sit on the lattice", () => {
  // The beach reaches along `n` from the line the two cells share; a flipped
  // normal lays it across the land.
  const loops = solveCoastLoops([land(0, 0)]);
  for (const e of loops[0]) {
    const mid = [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2];
    expect(Math.hypot(mid[0], mid[1]), "on the lattice line").toBeCloseTo(APOTHEM, 9);
    // Outward from the hex centre, which is the origin here.
    expect(mid[0] * e.n[0] + mid[1] * e.n[1]).toBeCloseTo(APOTHEM, 9);
    // ...and perpendicular to the edge it belongs to.
    expect((e.b[0] - e.a[0]) * e.n[0] + (e.b[1] - e.a[1]) * e.n[1]).toBeCloseTo(0, 9);
    expect(Math.hypot(e.n[0], e.n[1])).toBeCloseTo(1, 12);
  }
});

test("a headland turns out and a bay turns in", () => {
  // `beachGeometry.ts` chooses a fan or a mitre on this sign. Every corner of a
  // lone hex is a headland; a domino has two bays and eight headlands, the 360
  // degrees a closed loop turns through: 8 * 60 - 2 * 60.
  const lone = solveCoastLoops([land(0, 0)])[0];
  const turns = (loop: CoastLoop): boolean[] =>
    loop.map((e, i) => coastTurnsOut(loop[(i - 1 + loop.length) % loop.length].n, e.n));
  expect(turns(lone)).toEqual([true, true, true, true, true, true]);

  const domino = solveCoastLoops([land(0, 0), land(1, 0)])[0];
  expect(domino).toHaveLength(10);
  const out = turns(domino);
  expect(out.filter(Boolean)).toHaveLength(8);
  expect(out.filter((t) => !t)).toHaveLength(2);
});

test("a pond enclosed by land is its own loop", () => {
  const ring: Hex[] = [];
  for (let d = 0; d < 6; d++) ring.push(neighbor({ q: 0, r: 0 }, d));
  const tiles = [sea(0, 0), ...ring.map((h) => land(h.q, h.r))];
  const loops = solveCoastLoops(tiles);

  // The pond's shore is six inward-facing edges, a loop separate from the
  // island's outside.
  const inner = loops.find((loop) =>
    loop.every((e) => Math.hypot((e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2) < APOTHEM + 1e-9),
  );
  expect(inner).toBeDefined();
  expect(inner).toHaveLength(6);
  expect(chains(inner!)).toBe(true);
  // Facing the middle of the pond, not away from it.
  for (const e of inner!) {
    const mid = [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2];
    expect(mid[0] * e.n[0] + mid[1] * e.n[1]).toBeLessThan(0);
  }
});

test("two islands are two loops", () => {
  const tiles = [land(0, 0), land(4, 0)];
  const loops = solveCoastLoops(tiles);
  expect(loops).toHaveLength(2);
  for (const loop of loops) expect(loop).toHaveLength(6);
  // Each one is round its own island.
  const centres = loops.map((loop) => {
    const x = loop.reduce((s, e) => s + e.a[0], 0) / loop.length;
    const z = loop.reduce((s, e) => s + e.a[1], 0) / loop.length;
    return [x, z];
  });
  const [ax, , az] = hexToWorld({ q: 0, r: 0 });
  const [bx, , bz] = hexToWorld({ q: 4, r: 0 });
  const near = centres.map((c) =>
    Math.min(Math.hypot(c[0] - ax, c[1] - az), Math.hypot(c[0] - bx, c[1] - bz)),
  );
  for (const d of near) expect(d).toBeLessThan(1e-9);
});

test("the solver is deterministic and order-independent", () => {
  const a = solveCoastLoops([sea(0, 0), land(1, 0), land(0, 1)]);
  const b = solveCoastLoops([land(0, 1), land(1, 0), sea(0, 0)]);
  expect(a).toEqual(b);
});

test("a board with no land has no coastline", () => {
  expect(solveCoastLoops([sea(0, 0), sea(1, 0)])).toEqual([]);
});
