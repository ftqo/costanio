// The fixture has to describe a board a real game could reach.
//
// A Vertex is (hex, side) and a hex's six corners come from `hexVertices`; an
// edge joins two adjacent ones. Side 0 and side 1 of one hex are opposite
// corners, so an "edge" between them draws a road through the tile's centre,
// which looks like a renderer bug.
import { test, expect } from "vitest";
import { previewView } from "./previewFixture";
import { vertexToWorld, LATTICE_SIZE } from "@/lib/board3d/coords";
import { islandsExt, knightsExt, type Edge, type Vertex } from "@/lib/types";
import { metropolisVertexKeys } from "@/lib/board3d/layers/knights";
import { planPieces } from "@/lib/board3d/layers/pieces";
import { planPorts } from "@/lib/board3d/layers/harbors";
import { hexKey } from "@/lib/board3d/coords";

/** Length of the segment an edge spans, in world units. */
function span(e: Edge): number {
  const [ax, , az] = vertexToWorld(e.a);
  const [bx, , bz] = vertexToWorld(e.b);
  return Math.hypot(bx - ax, bz - az);
}

const key = (v: Vertex) => `${v.q},${v.r},${v.side}`;

test("every road spans one hex side, not a diagonal across a tile", () => {
  expect(previewView.roads.length).toBeGreaterThan(0);
  for (const r of previewView.roads) {
    // Adjacent corners are exactly one side apart; opposite corners are two.
    expect(span(r.e), `road of seat ${r.owner}`).toBeCloseTo(LATTICE_SIZE, 6);
  }
});

test("every ship spans one hex side too", () => {
  const ships = islandsExt(previewView)?.ships ?? [];
  expect(ships.length).toBeGreaterThan(0);
  for (const s of ships) {
    expect(span(s.e), `ship of seat ${s.owner}`).toBeCloseTo(LATTICE_SIZE, 6);
  }
});

test("no knight stands on a vertex that already has a building", () => {
  // A knight and a settlement cannot share a corner in a real game.
  const built = new Set(previewView.buildings.map((b) => key(b.v)));
  for (const k of knightsExt(previewView)?.knights ?? []) {
    expect(built.has(key(k.v)), `knight of seat ${k.owner} shares a vertex`).toBe(false);
  }
});

test("every knight stands on a vertex its owner's network reaches", () => {
  // A knight is placed on its owner's road network, never an unconnected
  // corner.
  const knights = knightsExt(previewView)?.knights ?? [];
  expect(knights.length).toBeGreaterThan(0);
  for (const k of knights) {
    const own = new Set<string>();
    for (const r of previewView.roads.filter((r) => r.owner === k.owner)) {
      own.add(key(r.e.a));
      own.add(key(r.e.b));
    }
    for (const b of previewView.buildings.filter((b) => b.owner === k.owner)) own.add(key(b.v));
    expect(own.has(key(k.v)), `knight of seat ${k.owner} is off its network`).toBe(true);
  }
});

test("the pirate is on open water, not parked on a harbour dock", () => {
  // planPorts stands a dock on the sea hex beside each harbour edge; a pirate
  // on it would bury the hut.
  const pirate = islandsExt(previewView)?.pirate;
  expect(pirate).toBeDefined();
  const docks = new Set(
    planPorts(previewView.board.harbors ?? [], previewView.board.tiles).map((p) => hexKey(p.hex)),
  );
  expect(docks.size).toBeGreaterThan(0);
  expect(docks.has(hexKey(pirate!)), "pirate shares a hex with a dock").toBe(false);
});

test("a metropolis replaces its city rather than stacking on it", () => {
  // Drawn at one vertex, the larger piece swallows the smaller.
  const replaced = metropolisVertexKeys(previewView);
  expect(replaced.size).toBeGreaterThan(0);
  const drawn = planPieces(previewView, replaced);
  // Placements carry positions, not vertices, so compare where things ended
  // up: no building may be drawn where a metropolis stands.
  const taken = previewView.buildings
    .filter((b) => replaced.has(key(b.v)))
    .map((b) => vertexToWorld(b.v).join(","));
  expect(taken.length).toBeGreaterThan(0);
  for (const at of taken) {
    expect(drawn.some((p) => p.position.join(",") === at)).toBe(false);
  }
  // And the city was in the input, so this is suppression, not absence.
  expect(previewView.buildings.some((b) => replaced.has(key(b.v)))).toBe(true);
  expect(planPieces(previewView).length).toBe(drawn.length + replaced.size);
});

test("no two buildings share a vertex", () => {
  const seen = new Set<string>();
  for (const b of previewView.buildings) {
    expect(seen.has(key(b.v))).toBe(false);
    seen.add(key(b.v));
  }
});

test("the walled city and its metropolis are on an actual city", () => {
  const cities = new Set(previewView.buildings.filter((b) => b.city).map((b) => key(b.v)));
  for (const v of knightsExt(previewView)?.walled ?? []) {
    expect(cities.has(key(v)), "wall is on a city").toBe(true);
  }
  for (const p of knightsExt(previewView)?.players ?? []) {
    p.metropolis?.forEach((held, track) => {
      if (!held) return;
      expect(cities.has(key(p.metropolis_at[track])), `metropolis ${track} is on a city`).toBe(
        true,
      );
    });
  }
});
