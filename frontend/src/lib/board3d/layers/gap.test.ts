import { test, expect } from "vitest";
import type { BoardTile } from "@/lib/types";
import { hexToWorld, edgeAngleY, hexKey, neighbor } from "../coords";
import { planGapSand } from "./gap";

// res is a string on the wire, never an index.
const land = (q: number, r: number): BoardTile => ({ hex: { q, r }, res: "wood", num: 8 });
const sea = (q: number, r: number): BoardTile => ({ hex: { q, r }, res: "sea", num: 0 });

/** Which (hex, dir) halves a plan covers, as a set of keys. */
function halves(tiles: BoardTile[]): Set<string> {
  const out = new Set<string>();
  for (const p of planGapSand(tiles)) {
    // Recover the hex and direction the placement came from.
    for (let dir = 0; dir < 6; dir++) {
      if (Math.abs(edgeAngleY(dir) - (p.rotationY ?? 0)) > 1e-9) continue;
      out.add(`${p.position[0].toFixed(4)},${p.position[2].toFixed(4)}|${dir}`);
    }
  }
  return out;
}

function key(q: number, r: number, dir: number): string {
  const [x, , z] = hexToWorld({ q, r });
  return `${x.toFixed(4)},${z.toFixed(4)}|${dir}`;
}

test("a land tile fills all six of its halves", () => {
  const got = halves([land(0, 0)]);
  for (let dir = 0; dir < 6; dir++) {
    expect(got.has(key(0, 0, dir)), `edge ${dir}`).toBe(true);
  }
});

test("a water hex fills no halves of its own", () => {
  // Water is drawn a lattice cell wide, so it meets the land's half on the
  // midline. Sand on the water's side too would stack two coplanar sands along
  // every coastal edge.
  const got = halves([land(0, 0)]);
  for (let dir = 0; dir < 6; dir++) {
    const n = neighbor({ q: 0, r: 0 }, dir);
    for (let d = 0; d < 6; d++) {
      expect(got.has(key(n.q, n.r, d)), `water hex ${n.q},${n.r} edge ${d}`).toBe(false);
    }
  }
});

test("open water gets no sand at all", () => {
  // Nothing on an all-sea board, however the tile list names it, so the sand
  // does not grid the ocean.
  expect(planGapSand([sea(0, 0), sea(1, 0), sea(0, 1)])).toEqual([]);
});

test("the sand covers every land tile and stops at the water's edge", () => {
  // A board of one land tile has exactly its own six halves.
  expect(planGapSand([land(0, 0)])).toHaveLength(6);
});

test("no half is filled twice", () => {
  // Two coplanar sands z-fight, and the land and water passes are the two
  // sources that could collide.
  const tiles = [land(0, 0), land(1, 0), land(0, 1), sea(1, -1)];
  const plan = planGapSand(tiles);
  expect(halves(tiles).size).toBe(plan.length);
});

test("fog counts as water, and a lake does not", () => {
  // One list, read from the coastline's `WATER` (see gap.ts), so sand and
  // beach always agree about a hex.
  //
  // A lake gets its six half-gaps like any land tile: roads and settlements go
  // round its shore, and its slab is authored at the land circumradius, so as
  // water it would sit in a ring of bare seam.
  expect(planGapSand([{ hex: { q: 0, r: 0 }, res: "fog", num: 0 }])).toEqual([]);
  expect(planGapSand([{ hex: { q: 0, r: 0 }, res: "lake", num: 0 }])).toHaveLength(6);
  expect(hexKey({ q: 0, r: 0 })).toBe("0,0");
});
